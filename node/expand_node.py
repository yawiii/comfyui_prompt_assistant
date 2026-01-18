import asyncio
import random
import time
import threading
import hashlib
import re

from comfy.model_management import InterruptProcessingException

from ..services.llm import LLMService
from ..utils.common import format_api_error, format_model_with_thinking, generate_request_id, log_prepare, log_error, TASK_EXPAND, SOURCE_NODE
from ..services.thinking_control import build_thinking_suppression
from .base import LLMNodeBase


class PromptExpand(LLMNodeBase):
    """
    提示词增强节点
    - 输入"source_text"，根据所选规则模板或自定义规则进行增强/扩写
    - 仅包含一个字符串输入和一个字符串输出
    """

    @classmethod
    def INPUT_TYPES(cls):
        # 从config_manager获取系统提示词配置
        from ..config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()

        # 获取所有expand_prompts作为下拉选项
        expand_prompts = {}
        active_expand_id = None
        if system_prompts:
            expand_prompts = system_prompts.get('expand_prompts', {}) or {}
            active_expand_id = system_prompts.get('active_prompts', {}).get('expand')

        # 构建提示词模板选项（支持分类格式：类别/规则名称）
        prompt_template_options = []
        id_to_display_name = {}
        for key, value in expand_prompts.items():
            # 过滤掉不在后端显示的规则
            show_in = value.get('showIn', ["frontend", "node"])
            if 'node' not in show_in:
                continue

            name = value.get('name', key)
            category = value.get('category', '')
            # 如果有分类，显示为 "类别/规则名称"，否则直接显示规则名称
            display_name = f"{category}/{name}" if category else name
            id_to_display_name[key] = display_name
            prompt_template_options.append(display_name)

        # 默认选项回退
        default_template_name = prompt_template_options[0] if prompt_template_options else "扩写-自然语言"
        if active_expand_id and active_expand_id in id_to_display_name:
            default_template_name = id_to_display_name[active_expand_id]
        
        # ---动态获取LLM服务/模型列表---
        service_options = cls.get_llm_service_options()
        default_service = service_options[0] if service_options else "智谱"

        return {
            "required": {
                # 规则模板：来自系统配置的所有扩写规则
                "rule": (prompt_template_options or ["扩写-自然语言"], {"default": default_template_name, "tooltip": "Choose a preset rule for prompt enhancement"}),
                # 临时规则开关
                "custom_rule": ("BOOLEAN", {"default": False, "label_on": "Enable", "label_off": "Disable", "tooltip": "Enable to use custom rule content below instead of preset"}),
                # 临时规则内容输入框
                "custom_rule_content": ("STRING", {"multiline": True, "default": "", "placeholder": "在此输入临时规则，仅在启用'临时规则'时生效", "tooltip": "在此输入您的自定义规则内容; 💡输入触发词[R],可以让节点每次都被执行"}),
                # 用户提示词
                "user_prompt": ("STRING", {"multiline": True, "default": "", "placeholder": "填写的要优化的提示词原文，若存在原文端口输入和内容输入，将合并提交", "tooltip": "想要增强的原始提示词; 💡输入触发词[R],可以让节点每次都被执行"}),
                # 扩写服务
                "llm_service": (service_options, {"default": default_service, "tooltip": "Select LLM service and model"}),
                # Ollama自动释放显存
                "ollama_auto_unload": ("BOOLEAN", {"default": True, "label_on": "Enable", "label_off": "Disable", "tooltip": "Auto unload Ollama model after generation"}),
            },
            "optional": {
                # 原文输入端口
                "source_text": ("STRING", {"default": "", "multiline": True, "defaultInput": True, "placeholder": "Input text to enhance...", "tooltip": "可选的输入文本; 💡输入触发词[R],可以让节点每次都被执行"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("enhanced_text",)
    FUNCTION = "enhance"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False

    @classmethod
    def IS_CHANGED(cls, rule=None, custom_rule=None, custom_rule_content=None, user_prompt=None, llm_service=None, ollama_auto_unload=None, source_text=None, unique_id=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 检查是否包含强制刷新符号 [R]
        if cls._check_is_changed_bypass(rule, custom_rule_content, user_prompt, source_text):
            return float("nan")

        text_hash = hashlib.md5(((source_text or "")).encode('utf-8')).hexdigest()
        temp_rule_hash = hashlib.md5((custom_rule_content or "").encode('utf-8')).hexdigest()
        user_hint_hash = hashlib.md5((user_prompt or "").encode('utf-8')).hexdigest()

        input_hash = hash((
            rule,
            bool(custom_rule),
            temp_rule_hash,
            user_hint_hash,
            llm_service,
            bool(ollama_auto_unload),
            text_hash,
        ))
        return input_hash

    def enhance(self, rule, custom_rule, custom_rule_content, user_prompt, llm_service, ollama_auto_unload, source_text=None, unique_id=None):
        """
        增强/扩写文本函数
        """
        try:
            # 允许原文为空，但原文与用户提示词至少有一项非空
            source_text = (source_text or "").strip()
            user_prompt = (user_prompt or "").strip()
            if not source_text and not user_prompt:
                return ("",)

            # 准备系统提示词（规则）
            system_message = None
            rule_name = "Custom Rule" if (custom_rule and custom_rule_content) else rule

            if custom_rule and custom_rule_content:
                # 使用临时规则
                system_message = {"role": "system", "content": custom_rule_content}
            else:
                # 使用模板：从config_manager获取系统提示词配置
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()
                expand_prompts = system_prompts.get('expand_prompts', {}) if system_prompts else {}

                # 查找选定的提示词模板（按显示名称匹配）
                # 显示名称格式：有分类时为 "类别/规则名称"，无分类时为 "规则名称"
                template_found = False
                for key, value in expand_prompts.items():
                    name = value.get('name', key)
                    category = value.get('category', '')
                    # 构建与下拉列表一致的显示名称
                    display_name = f"{category}/{name}" if category else name
                    if display_name == rule:
                        system_message = {"role": value.get('role', 'system'), "content": value.get('content', '')}
                        template_found = True
                        break
                if not template_found:
                    # 允许用规则名称或键名直接匹配（兼容旧格式）
                    for key, value in expand_prompts.items():
                        if value.get('name') == rule or key == rule:
                            system_message = {"role": value.get('role', 'system'), "content": value.get('content', '')}
                            template_found = True
                            break
                if not template_found or not system_message or not system_message.get('content'):
                    # 回退到默认
                    system_message = {"role": "system", "content": "你是一名提示词扩写专家，请将用户给定文本扩写为更完整、更具可读性和可执行性的提示词。"}
                    rule_name = "Default Rule"

            # ---解析服务/模型字符串---
            service_id, model_name = self.parse_service_model(llm_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {llm_service}")
            
            # ---获取服务配置---
            from ..config_manager import config_manager
            service = config_manager.get_service(service_id)
            if not service:
                raise ValueError(f"Service config not found: {llm_service}")
            
            # ---构建provider_config---
            # 查找指定的模型或默认模型
            llm_models = service.get('llm_models', [])
            target_model = None
            
            if model_name:
                # 查找指定的模型
                target_model = next((m for m in llm_models if m.get('name') == model_name), None)
            
            if not target_model:
                # 使用默认模型或第一个模型
                target_model = next((m for m in llm_models if m.get('is_default')), 
                                    llm_models[0] if llm_models else None)
            
            if not target_model:
                raise ValueError(f"Service {llm_service} has no available models")
            
            # 构建配置对象
            provider_config = {
                'provider': service_id,
                'model': target_model.get('name', ''),
                'base_url': service.get('base_url', ''),
                'api_key': service.get('api_key', ''),
                'temperature': target_model.get('temperature', 0.7),
                'max_tokens': target_model.get('max_tokens', 1000),
                'top_p': target_model.get('top_p', 0.9),
                'send_temperature': target_model.get('send_temperature', True),
                'send_top_p': target_model.get('send_top_p', True),
                'send_max_tokens': target_model.get('send_max_tokens', True),
                'custom_params': target_model.get('custom_params', ''),
            }
            
            # Ollama特殊处理:添加auto_unload配置
            if service.get('type') == 'ollama':
                provider_config['auto_unload'] = ollama_auto_unload

            # 执行扩写（异步线程 + 可中断）
            request_id = generate_request_id("exp", None, unique_id)
            
            # 合并原文与用户提示词
            # 合并顺序：输入端口(source_text)在前，节点输入框(user_prompt)在后
            combined_text = user_prompt if not source_text else (f"{source_text}\n\n{user_prompt}" if user_prompt else source_text)
            
            # 检查是否关闭思维链
            model_name = provider_config.get('model')
            disable_thinking_enabled = service.get('disable_thinking', True)
            thinking_extra = build_thinking_suppression(service_id, model_name) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model_name, bool(thinking_extra))
            
            # 获取服务显示名称
            service_display_name = service.get('name', service_id)

            # 准备阶段日志
            log_prepare(TASK_EXPAND, request_id, SOURCE_NODE, service_display_name, model_display, rule_name, {"长度": len(combined_text)})

            # 检查API密钥和模型
            api_key = provider_config.get('api_key', '')
            model = provider_config.get('model', '')
            
            if not api_key or not model:
                raise ValueError(f"Please configure API key and model for {llm_service}")

            # 执行扩写（异步线程 + 可中断）
            result = self._run_llm_task(
                LLMService.expand_prompt,
                service_id,
                prompt=combined_text,
                request_id=request_id,
                stream_callback=None,
                custom_provider=service_id,
                custom_provider_config=provider_config,
                system_message_override=system_message,
                task_type=TASK_EXPAND,
                source=SOURCE_NODE
            )

            if result and result.get('success'):
                expanded_text = result.get('data', {}).get('expanded', '').strip()
                if not expanded_text:
                    error_msg = 'API returned empty result'
                    log_error(TASK_EXPAND, request_id, error_msg, source=SOURCE_NODE)
                    raise RuntimeError(f"Enhancement failed: {error_msg}")
                # 结果阶段日志由服务层统一输出，节点层不再重复打印
                return (expanded_text,)
            else:
                error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
                # 如果是中断错误,直接抛出InterruptProcessingException,不打印日志(由基类打印)
                if error_msg == "任务被中断":
                    raise InterruptProcessingException()
                log_error(TASK_EXPAND, request_id, error_msg, source=SOURCE_NODE)
                raise RuntimeError(f"Enhancement failed: {error_msg}")

        except InterruptProcessingException:
            # 不打印日志,由基类统一打印
            raise
        except Exception as e:
            error_msg = format_api_error(e, llm_service)
            log_error(TASK_EXPAND, request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"Enhancement error: {error_msg}")

    # _get_provider_config 方法已由基类 LLMNodeBase 提供
    


# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "PromptExpand": PromptExpand,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptExpand": "✨Prompt Enhance",
}
