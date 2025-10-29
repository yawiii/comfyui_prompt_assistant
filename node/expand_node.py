import asyncio
import random
import time
import threading
import hashlib
import re

from comfy.model_management import InterruptProcessingException

from ..services.llm import LLMService
from ..services.error_util import format_api_error


# 定义ANSI颜色代码常量
GREEN = "\033[32m"
BLUE = "\033[34m"
YELLOW = "\033[33m"
RESET = "\033[0m"


class PromptExpand:
    """
    文本扩写节点
    - 输入"原文"，根据所选扩写规则模板或临时规则进行扩写
    - 仅包含一个字符串输入和一个字符串输出
    """
    # 定义日志前缀
    LOG_PREFIX = f"{GREEN}[✨PromptAssistant]{RESET}"  # 绿色：结果阶段
    REQUEST_PREFIX = f"{BLUE}[✨PromptAssistant]{RESET}"  # 蓝色：准备阶段
    PROCESS_PREFIX = f"{YELLOW}[✨PromptAssistant]{RESET}"  # 黄色：API调用阶段
    
    # 提供商显示名称映射
    PROVIDER_DISPLAY_MAP = {
        "zhipu": "智谱",
        "siliconflow": "硅基流动",
        "302ai": "302.AI",
        "ollama": "Ollama",
        "custom": "自定义"
    }

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

        # 构建提示词模板选项（显示name）
        prompt_template_options = []
        id_to_name = {}
        for key, value in expand_prompts.items():
            name = value.get('name', key)
            id_to_name[key] = name
            prompt_template_options.append(name)

        # 默认选项回退
        default_template_name = prompt_template_options[0] if prompt_template_options else "扩写-自然语言"
        if active_expand_id and active_expand_id in id_to_name:
            default_template_name = id_to_name[active_expand_id]

        return {
            "required": {
                # 规则模板：来自系统配置的所有扩写规则
                "规则模板": (prompt_template_options or ["扩写-自然语言"], {"default": default_template_name}),
                # 临时规则开关：BOOLEAN，并添加中文开关标签
                "临时规则": ("BOOLEAN", {"default": False, "label_on": "启用", "label_off": "禁用"}),
                # 临时规则内容输入框：仅在启用临时规则时生效
                "临时规则内容": ("STRING", {"multiline": True, "default": "", "placeholder": "请输入临时规则内容，仅在启用'临时规则'时生效"}),
                # 用户提示词：与原文合并后提交
                "用户提示词": ("STRING", {"multiline": True, "default": "", "placeholder": "填写的要扩写的提示词原文，若存在原文端口输入和内容输入，将合并提交"}),
                # 扩写服务（使用LLM提供商）
                "扩写服务": (["智谱", "硅基流动", "302.AI", "Ollama", "自定义"], {"default": "智谱"}),
                # Ollama自动释放：仅对Ollama服务生效
                "Ollama自动释放": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用", "tooltip": "⚠️ 该选项仅在选择了Ollama服务时生效"}),
            },
            "optional": {
                # 原文输入端口：非必选
                "原文": ("STRING", {"default": "", "multiline": True, "defaultInput": True, "placeholder": "输入需要扩写的文本..."}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("扩写结果",)
    FUNCTION = "expand"
    CATEGORY = "✨提示词小助手"
    OUTPUT_NODE = False

    @classmethod
    def IS_CHANGED(cls, 规则模板, 临时规则, 临时规则内容, 用户提示词, 扩写服务, Ollama自动释放, 原文=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        text_hash = hashlib.md5(((原文 or "")).encode('utf-8')).hexdigest()
        temp_rule_hash = hashlib.md5((临时规则内容 or "").encode('utf-8')).hexdigest()
        user_hint_hash = hashlib.md5((用户提示词 or "").encode('utf-8')).hexdigest()

        input_hash = hash((
            规则模板,
            bool(临时规则),
            temp_rule_hash,
            user_hint_hash,
            扩写服务,
            bool(Ollama自动释放),
            text_hash,
        ))
        return input_hash

    def expand(self, 规则模板, 临时规则, 临时规则内容, 用户提示词, 扩写服务, Ollama自动释放, 原文=None):
        """
        扩写文本函数

        Args:
            原文: 输入的文本（可为空）
            规则模板: 选择的扩写规则模板名称（来自系统配置）
            临时规则: 是否启用临时规则（BOOLEAN）
            临时规则内容: 临时规则的内容（启用时生效）
            用户提示词: 附加的用户提示信息，将与原文合并提交
            扩写服务: LLM提供商（智谱/硅基流动/自定义）
            Ollama自动释放: 是否在调用完成后自动释放Ollama模型（仅对Ollama生效）

        Returns:
            tuple: 扩写结果
        """
        try:
            # 允许原文为空，但原文与用户提示词至少有一项非空
            原文 = (原文 or "").strip()
            用户提示词 = (用户提示词 or "").strip()
            if not 原文 and not 用户提示词:
                return ("",)

            # 准备系统提示词（规则）
            system_message = None
            rule_name = "临时规则" if (临时规则 and 临时规则内容) else 规则模板

            if 临时规则 and 临时规则内容:
                # 使用临时规则
                system_message = {"role": "system", "content": 临时规则内容}
            else:
                # 使用模板：从config_manager获取系统提示词配置
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()
                expand_prompts = system_prompts.get('expand_prompts', {}) if system_prompts else {}

                # 查找选定的提示词模板（按显示名称匹配）
                template_found = False
                for key, value in expand_prompts.items():
                    if value.get('name') == 规则模板:
                        system_message = {"role": value.get('role', 'system'), "content": value.get('content', '')}
                        template_found = True
                        break
                if not template_found:
                    # 允许用键名直接匹配
                    for key, value in expand_prompts.items():
                        if key == 规则模板:
                            system_message = {"role": value.get('role', 'system'), "content": value.get('content', '')}
                            template_found = True
                            break
                if not template_found or not system_message or not system_message.get('content'):
                    # 回退到默认
                    system_message = {"role": "system", "content": "你是一名提示词扩写专家，请将用户给定文本扩写为更完整、更具可读性和可执行性的提示词。"}
                    rule_name = "默认规则"

            # 选择服务提供商
            provider_map = {
                "智谱": "zhipu",
                "硅基流动": "siliconflow",
                "302.AI": "302ai",
                "Ollama": "ollama",
                "自定义": "custom",
            }
            selected_provider = provider_map.get(扩写服务)
            if not selected_provider:
                raise ValueError(f"不支持的扩写服务: {扩写服务}")

            # 获取对应provider的配置
            from ..config_manager import config_manager
            provider_config = self._get_provider_config(config_manager, selected_provider)
            if not provider_config:
                provider_display = {"zhipu": "智谱", "siliconflow": "硅基流动", "302ai": "302.AI", "ollama": "Ollama", "custom": "自定义"}.get(selected_provider, selected_provider)
                raise ValueError(f"未找到{provider_display}的配置，请先完成API配置")

            # 执行扩写（异步线程 + 可中断）
            request_id = f"expand_{int(time.time())}_{random.randint(1000, 9999)}"
            
            # 合并原文与用户提示词
            # 合并顺序：输入端口(原文)在前，节点输入框(用户提示词)在后
            combined_text = 用户提示词 if not 原文 else (f"{原文}\n\n{用户提示词}" if 用户提示词 else 原文)
            
            # 准备阶段日志（合并为一条）
            print(f"{self.REQUEST_PREFIX} 扩写准备 | 服务:{扩写服务} | 模型:{provider_config.get('model')} | 规则:{rule_name} | 长度:{len(combined_text)} | 请求ID:{request_id}")

            result_container = {}
            thread = threading.Thread(
                target=self._run_llm_expand,
                args=(combined_text, system_message, request_id, result_container, selected_provider, provider_config, 扩写服务, Ollama自动释放)
            )
            thread.start()

            # 等待扩写完成，同时检查中断
            while thread.is_alive():
                try:
                    import nodes
                    nodes.before_node_execution()
                except:
                    print(f"{self.LOG_PREFIX} 检测到中断信号，正在终止扩写任务...")
                    result_container['interrupted'] = True
                    thread.join(timeout=1.0)
                    if thread.is_alive():
                        print(f"{self.LOG_PREFIX} 扩写线程未能及时响应中断")
                    raise InterruptProcessingException()
                time.sleep(0.1)

            result = result_container.get('result')

            if result and result.get('success'):
                expanded_text = result.get('data', {}).get('expanded', '').strip()
                if not expanded_text:
                    error_msg = 'API返回结果为空，请检查API密钥、模型配置或网络连接'
                    print(f"{self.LOG_PREFIX} 扩写失败 | 错误:{error_msg}")
                    raise RuntimeError(f"扩写失败: {error_msg}")
                # 结果阶段日志（合并为一条）
                print(f"{self.LOG_PREFIX} 扩写完成 | 服务:{扩写服务} | 请求ID:{request_id} | 结果字符数:{len(expanded_text)}")
                return (expanded_text,)
            else:
                error_msg = result.get('error', '扩写失败，未知错误') if result else '扩写服务未返回结果'
                print(f"{self.LOG_PREFIX} 扩写失败: {error_msg}")
                raise RuntimeError(f"扩写失败: {error_msg}")

        except InterruptProcessingException:
            print(f"{self.LOG_PREFIX} 扩写任务被用户取消")
            raise
        except Exception as e:
            error_msg = format_api_error(e, 扩写服务)
            print(f"{self.LOG_PREFIX} 扩写异常: {error_msg}")
            raise RuntimeError(f"扩写异常: {error_msg}")

    def _get_provider_config(self, config_manager, provider):
        """获取指定provider的配置（LLM）"""
        llm_config = config_manager.get_llm_config()
        if 'providers' in llm_config and provider in llm_config['providers']:
            return llm_config['providers'][provider]
        return None
    
    async def _unload_ollama_model(self, model: str, provider_config: dict, auto_unload: bool):
        """
        卸载Ollama模型以释放显存和内存
        
        参数:
            model: 模型名称
            provider_config: 提供商配置字典
            auto_unload: 是否启用自动释放（来自节点参数）
        """
        try:
            # 检查是否启用自动释放（使用节点参数，不从provider_config读取）
            if not auto_unload:
                return
            
            # 获取base_url
            base_url = provider_config.get('base_url', 'http://localhost:11434')
            # 确保URL不以/v1结尾（Ollama原生API不需要/v1）
            if base_url.endswith('/v1'):
                base_url = base_url[:-3]
            
            # 调用Ollama API卸载模型
            url = f"{base_url}/api/generate"
            payload = {
                "model": model,
                "keep_alive": 0  # 立即卸载模型
            }
            
            print(f"{self.PROCESS_PREFIX} Ollama自动释放显存 | 模型:{model}")
            
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json=payload)
                
        except Exception as e:
            # 释放失败不影响主流程，只记录警告
            print(f"{self.LOG_PREFIX} Ollama模型释放失败（不影响结果） | 模型:{model} | 错误:{str(e)[:50]}")

    def _run_llm_expand(self, text, system_message, request_id, result_container, provider, provider_config, service_name, auto_unload):
        """在独立线程中运行LLM扩写"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            if result_container.get('interrupted'):
                result_container['result'] = {"success": False, "error": "任务被中断"}
                return

            # 获取API密钥和模型
            api_key = provider_config.get('api_key', '')
            model = provider_config.get('model', '')
            temperature = provider_config.get('temperature', 0.7)
            top_p = provider_config.get('top_p', 0.9)
            max_tokens = provider_config.get('max_tokens', 1500)

            if not api_key or not model:
                result_container['result'] = {
                    "success": False,
                    "error": f"请先配置{provider}的API密钥和模型"
                }
                return

            # 检查是否启用直连模式
            bypass_proxy = False
            try:
                from ..config_manager import config_manager as cm
                settings = cm.get_settings()
                bypass_proxy = settings.get('PromptAssistant.Settings.BypassProxy', False)
            except Exception:
                pass
            
            direct_mode_tag = "(直连)" if bypass_proxy else ""

            # 获取提供商显示名称
            provider_display_name = PromptExpand.PROVIDER_DISPLAY_MAP.get(provider, provider)

            # 创建客户端
            client = LLMService.get_openai_client(api_key, provider)

            # 判断输入语言，设置输出语言
            def is_chinese(text):
                return any('\u4e00' <= ch <= '\u9fff' for ch in text)
            lang_message = {"role": "system", "content": "请用中文回答"} if is_chinese(text) else {"role": "system", "content": "Please answer in English."}

            messages = [
                lang_message,
                system_message,
                {"role": "user", "content": text},
            ]

            # API调用阶段日志（由LLMService打印，这里不重复）
            print(f"{PromptExpand.PROCESS_PREFIX} 调用{provider_display_name}扩写API{direct_mode_tag} | 模型:{model}")

            stream = loop.run_until_complete(client.chat.completions.create(
                model=model,
                messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                temperature=temperature,
                top_p=top_p,
                max_tokens=max_tokens,
                stream=True,
                response_format={"type": "text"}
            ))

            full_content = ""

            async def process_stream():
                nonlocal full_content
                async for chunk in stream:
                    if result_container.get('interrupted'):
                        break
                    # 兼容部分第三方网关返回空 choices 的异常片段，做健壮性判断
                    choices = getattr(chunk, "choices", None) or []
                    for ch in choices:
                        delta = getattr(ch, "delta", None)
                        if not delta:
                            continue
                        content = getattr(delta, "content", None)
                        if content:
                            full_content += content

            loop.run_until_complete(process_stream())

            if result_container.get('interrupted'):
                result_container['result'] = {"success": False, "error": "任务被中断"}
                return

            result_container['result'] = {
                "success": True,
                "data": {
                    "original": text,
                    "expanded": full_content,
                },
            }
            
            # Ollama自动释放显存
            if provider == 'ollama':
                try:
                    loop.run_until_complete(self._unload_ollama_model(model, provider_config, auto_unload))
                except Exception as e:
                    # 释放失败不影响结果
                    pass
            
            # 结果日志已在expand方法中统一打印，这里不再重复

        except Exception as e:
            result_container['result'] = {
                "success": False,
                "error": format_api_error(e, provider_display_name)
            }
            print(f"{self.LOG_PREFIX} 扩写失败 | 服务:{provider_display_name} | 错误:{result_container['result']['error']}")
        finally:
            loop.close()


# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "PromptExpand": PromptExpand,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptExpand": "✨提示词扩写",
}

