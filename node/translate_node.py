import asyncio
import random
import re
import time
import threading
import hashlib

import torch
from comfy.model_management import InterruptProcessingException

from ..services.llm import LLMService
from ..services.baidu import BaiduTranslateService
from ..utils.common import format_api_error, format_model_with_thinking, generate_request_id, log_prepare, log_error, TASK_TRANSLATE, SOURCE_NODE
from ..services.thinking_control import build_thinking_suppression
from .base import LLMNodeBase


class PromptTranslate(LLMNodeBase):
    """
    提示词翻译节点
    自动识别输入语言并翻译成目标语言，支持多种翻译服务
    """

    @classmethod
    def INPUT_TYPES(cls):
        # ---动态获取翻译服务/模型列表(包含硬编码的百度翻译)---
        service_options = cls.get_translate_service_options()
        default_service = service_options[0] if service_options else "百度翻译"
        
        return {
            "required": {
                "source_text": ("STRING", {"forceInput": True, "default": "", "multiline": True, "placeholder": "Input text to translate..."}),
                "target_language": (["English", "Chinese"], {"default": "English"}),
                "translate_service": (service_options, {"default": default_service, "tooltip": "Select translation service and model"}),
                # Ollama Automatic VRAM Unload
                "ollama_auto_unload": ("BOOLEAN", {"default": True, "label_on": "Enable", "label_off": "Disable", "tooltip": "Auto unload Ollama model after generation"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("translated_text",)
    FUNCTION = "translate"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False
    
    @classmethod
    def IS_CHANGED(cls, source_text=None, target_language=None, translate_service=None, ollama_auto_unload=None, unique_id=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 计算文本的哈希值
        text_hash = ""
        if source_text:
            # 使用hashlib计算文本的哈希值，更安全和一致
            text_hash = hashlib.md5(source_text.encode('utf-8')).hexdigest()

        # 组合所有输入的哈希值
        input_hash = hash((
            text_hash,
            target_language,
            translate_service,
            bool(ollama_auto_unload)
        ))

        return input_hash

    def _contains_chinese(self, text: str) -> bool:
        """检查文本是否包含中文字符"""
        if not text:
            return False
        return bool(re.search('[\u4e00-\u9fa5]', text))

    def _detect_language(self, text: str) -> str:
        """自动检测文本语言"""
        if not text:
            return "auto"

        # 检查是否为纯英文 (只包含ASCII可打印字符)
        is_pure_english = bool(re.fullmatch(r'[ -~]+', text))
        # 检查是否包含中文字符
        contains_chinese = self._contains_chinese(text)

        if contains_chinese:
            return "zh"
        elif is_pure_english:
            return "en"
        else:
            return "auto"
    
    def translate(self, source_text, target_language, translate_service, ollama_auto_unload, unique_id=None):
        """
        翻译文本函数
        """
        request_id = None  # 提升到方法级别作用域
        try:
            # 检查输入
            if not source_text or not source_text.strip():
                return ("",)

            # 自动检测源语言
            detected_lang = self._detect_language(source_text)
            to_lang = "en" if target_language == "English" else "zh"

            # 智能跳过翻译逻辑
            skip_translation = False
            if to_lang == 'en' and detected_lang == 'en':
                from ..utils.common import _ANSI_CLEAR_EOL
                print(f"\r{_ANSI_CLEAR_EOL}{self.REQUEST_PREFIX} 检测到英文输入，目标为英文，无需翻译", flush=True)
                skip_translation = True
            elif to_lang == 'zh' and detected_lang == 'zh':
                from ..utils.common import _ANSI_CLEAR_EOL
                print(f"\r{_ANSI_CLEAR_EOL}{self.REQUEST_PREFIX} 检测到中文输入，目标为中文，无需翻译", flush=True)
                skip_translation = True

            if skip_translation:
                return (source_text,)

            # 映射语言名称
            lang_map = {'zh': '中文', 'en': '英文', 'auto': '原文'}
            from_lang_name = lang_map.get(detected_lang, detected_lang)
            to_lang_name = lang_map.get(to_lang, to_lang)
            
            # ---解析服务/模型字符串---
            service_id, model_name = self.parse_service_model(translate_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {translate_service}")
            
            # ---百度翻译特殊处理---
            if service_id == 'baidu':
                request_id, result = self._translate_with_baidu(source_text, detected_lang, to_lang, translate_service, from_lang_name, to_lang_name, unique_id)
            else:
                # ---LLM翻译:获取服务配置---
                from ..config_manager import config_manager
                service = config_manager.get_service(service_id)
                if not service:
                    raise ValueError(f"Service config not found: {translate_service}")
                
                request_id, result = self._translate_with_llm(source_text, detected_lang, to_lang, service_id, model_name, service, translate_service, from_lang_name, to_lang_name, ollama_auto_unload, unique_id)

            if result and result.get('success'):
                translated_text = result.get('data', {}).get('translated', '').strip()
                if not translated_text:
                    error_msg = 'API returned empty result'
                    raise RuntimeError(f"❌Translation failed: {error_msg}")

                # 结果阶段日志由服务层统一输出，节点层不再重复打印
                return (translated_text,)
            else:
                error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
                # 如果是中断错误,直接抛出InterruptProcessingException,不打印日志(由基类打印)
                if error_msg == "任务被中断":
                    raise InterruptProcessingException()
                log_error(TASK_TRANSLATE, request_id, error_msg)
                raise RuntimeError(f"Translation failed: {error_msg}")

        except InterruptProcessingException:
            # 不打印日志,由基类统一打印
            raise
        except Exception as e:
            error_msg = format_api_error(e, translate_service)
            log_error(TASK_TRANSLATE, request_id, error_msg)
            raise RuntimeError(f"Translation error: {error_msg}")

    def _translate_with_baidu(self, text, from_lang, to_lang, service_name, from_lang_name, to_lang_name, unique_id):
        """使用百度翻译服务"""
        # 创建请求ID
        request_id = generate_request_id("trans", "baidu", unique_id)
        
        # 准备阶段日志
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, "百度翻译", None, None, {"方向": f"{from_lang_name}→{to_lang_name}", "长度": len(text)})
        
        # 执行翻译（异步线程 + 可中断）
        result = self._run_llm_task(
            BaiduTranslateService.translate,
            service_name,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )

        return request_id, result

    def _translate_with_llm(self, text, from_lang, to_lang, service_id, model_name, service, service_display_name, from_lang_name, to_lang_name, auto_unload, unique_id):
        """使用LLM翻译服务"""
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
            return {"success": False, "error": f"Service {service_display_name} has no available models"}
        
        # 构建配置对象
        provider_config = {
            'provider': service_id,
            'model': target_model.get('name', ''),
            'base_url': service.get('base_url', ''),
            'api_key': service.get('api_key', ''),
            'temperature': target_model.get('temperature', 0.7),
            'max_tokens': target_model.get('max_tokens', 1000),
            'top_p': target_model.get('top_p', 0.9),
        }
        
        # Ollama特殊处理:添加auto_unload配置
        if service.get('type') == 'ollama':
            provider_config['auto_unload'] = auto_unload

        # 创建请求ID
        request_id = generate_request_id("trans", "llm", unique_id)
        
        # 检查是否关闭思维链
        model_full_name = provider_config.get('model')
        disable_thinking_enabled = service.get('disable_thinking', True)
        thinking_extra = build_thinking_suppression(service_id, model_full_name) if disable_thinking_enabled else None
        model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))
        
        # 获取服务显示名称
        service_display_name = service.get('name', service_id)
        
        # 准备阶段日志
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, service_display_name, model_display, None, {"方向": f"{from_lang_name}→{to_lang_name}", "长度": len(text)})
        
        # 检查API密钥和模型
        api_key = provider_config.get('api_key', '')
        model = provider_config.get('model', '')
        
        if not api_key or not model:
            return {"success": False, "error": f"Please configure API key and model for {service_display_name}"}

        # 执行翻译（异步线程 + 可中断）
        result = self._run_llm_task(
            LLMService.translate,
            service_id,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            stream_callback=None,
            custom_provider=service_id,
            custom_provider_config=provider_config,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )

        return request_id, result


# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "PromptTranslate": PromptTranslate,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptTranslate": "✨Prompt Translate",
}
