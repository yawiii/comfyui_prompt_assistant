"""
LLM服务 - 重构版本
提供大语言模型的扩写和翻译功能
继承OpenAICompatibleService以复用通用逻辑
"""

import json
import time
import asyncio
from typing import Optional, Dict, Any, List, Callable
import httpx
from .openai_base import OpenAICompatibleService, filter_thinking_content
from ..utils.common import (
    format_api_error, ProgressBar, log_complete, log_error,
    PREFIX, PROCESS_PREFIX, WARN_PREFIX, ERROR_PREFIX, format_elapsed_time,
    TASK_EXPAND, TASK_TRANSLATE
)
from .thinking_control import build_thinking_suppression


class LLMService(OpenAICompatibleService):
    """
    大语言模型服务
    支持提示词扩写和文本翻译
    """
    
    @staticmethod
    def _get_config() -> Dict[str, Any]:
        """获取LLM配置"""
        from ..config_manager import config_manager
        config = config_manager.get_llm_config()
        current_provider = config.get('provider')

        if 'providers' in config and current_provider in config['providers']:
            provider_config = config['providers'][current_provider]
            return {
                'provider': current_provider,
                'model': provider_config.get('model', ''),
                'base_url': provider_config.get('base_url', ''),
                'api_key': provider_config.get('api_key', ''),
                'temperature': provider_config.get('temperature', 0.7),
                'top_p': provider_config.get('top_p', 0.9),
                'max_tokens': provider_config.get('max_tokens', 2000),
                'send_temperature': provider_config.get('send_temperature', True),
                'send_top_p': provider_config.get('send_top_p', True),
                'send_max_tokens': provider_config.get('send_max_tokens', True),
                'custom_params': provider_config.get('custom_params', ''),
                'auto_unload': provider_config.get('auto_unload', True)
            }
        else:
            return config
    
    @staticmethod
    def _is_chinese(text: str) -> bool:
        """判断文本是否包含中文"""
        return any('\u4e00' <= char <= '\u9fff' for char in text)
    
    @staticmethod
    async def _call_ollama_native(
        model: str,
        messages: List[Dict[str, str]],
        temperature: float,
        top_p: float,
        max_tokens: int,
        base_url: str,
        send_temperature: bool = True,
        send_top_p: bool = True,
        send_max_tokens: bool = True,
        stream_callback: Optional[Callable[[str], None]] = None,
        request_id: Optional[str] = None,
        provider_display_name: str = "Ollama",
        auto_unload: bool = True,
        enable_advanced_params: bool = False,
        thinking_extra: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: str = None
    ) -> Dict[str, Any]:
        """
        调用Ollama原生API（支持流式输出）
        用于支持智能上下文窗口和思维链控制
        
        参数:
            enable_advanced_params: 是否发送高级参数(temperature/top_p/num_predict)
            thinking_extra: 思维链控制参数
        """
        # ---初始化请求参数---
        
        try:
            start_time = time.perf_counter()
            _thinking_extra = thinking_extra  # 使用传入的参数
            _thinking_tag = "（已关闭思维链）" if _thinking_extra else ""
            
            # 计算基准 URL (确保移除 /v1 和末尾斜杠)
            native_base = base_url.rstrip('/') if base_url else 'http://localhost:11434'
            if native_base.endswith('/v1'):
                native_base = native_base[:-3].rstrip('/')
            
            # 智能动态上下文窗口计算 (Token估算策略: 中文0.7/char, 英文0.3/char -> 保守取 0.6/char)
            # 安全地计算输入长度 (包含 System Prompt 和 User Prompt，前提是都在 messages 中)
            input_char_len = 0
            for msg in messages:
                input_char_len += len(msg.get('content', '') or '')
            
            estimated_input_tokens = int(input_char_len * 0.6)
            
            # --- 智能预留策略 ---
            # 关键点：思考过程 (Thinking Process) 也占用 Output Token 额度
            # 1. 如果成功禁用了思维链 (_thinking_extra 非空) -> 安全
            # 2. 如果模型名明确包含 instruct/chat (通常无思考过程) -> 安全
            # 3. 其他未知模型 -> 假定可能存在思考过程，预留更多空间
            
            is_safe_standard_model = False
            if model:
                m = model.lower()
                if "instruct" in m or "chat" in m:
                    is_safe_standard_model = True

            if _thinking_extra or is_safe_standard_model: 
                # 已关闭思维链 OR 标准指令模型 -> 极致节省模式
                min_output = 512
                min_ctx = 1024
            else:
                # 未知/潜在思考模型 -> 安全能够模式 (为思考过程预留空间)
                min_output = 1024
                min_ctx = 2048
            
            # 任务类型预留
            output_reserve = max(min_output, int(estimated_input_tokens * 1.5))
            
            # 384为系统开销Buffer (System Prompt通常已在estimated_input_tokens中，这里是额外的安全余量)
            required_ctx = estimated_input_tokens + output_reserve + 384
            
            # 对齐到 1024 倍数
            # 限制在 [min_ctx, 32768] 范围内
            num_ctx = max(min_ctx, min(32768, required_ctx))
            num_ctx = ((num_ctx + 1023) // 1024) * 1024
            
            # 合并多条 System Message（Ollama 对多条 system 消息处理不佳）
            merged_messages = LLMService._merge_system_prompts(messages)
            
            # 构建请求（安全地构建messages列表）
            ollama_messages = []
            for msg in merged_messages:
                ollama_messages.append({
                    "role": msg.get('role', 'user'),
                    "content": msg.get('content', '')
                })
            
            # 构建基础请求体
            payload = {
                "model": model,
                "messages": ollama_messages,
                "stream": True
            }
            
            # ---构建 options---
            # 基础参数：num_ctx（动态上下文窗口大小）
            options = {
                "num_ctx": num_ctx
            }
            
            # 高级参数：仅在用户启用时发送
            # 参数说明（基于 Ollama 官方文档）：
            # - temperature: 控制随机性，默认0.8，值越低输出越稳定
            # - top_p: 核采样，默认0.9，限制候选词概率范围
            # - num_predict: 最大生成Token数，默认-1（无限）
            if enable_advanced_params:
                if send_temperature:
                    options["temperature"] = temperature
                if send_top_p:
                    options["top_p"] = top_p
                if send_max_tokens:
                    options["num_predict"] = max_tokens
            
            payload["options"] = options
            
            # 添加思维链控制参数（如 think: true 或 think: false）
            if _thinking_extra:
                payload.update(_thinking_extra)
            
            from ..server import is_streaming_progress_enabled
            
            # 动态超时计算: 基础30s + 每1000个Token预估增加5秒
            estimated_timeout = 30.0 + (num_ctx / 1000) * 5.0
            final_timeout = min(600.0, max(60.0, estimated_timeout)) # 限制在 60s - 600s 之间
            
            # 创建统一进度条（自动处理等待→生成→完成的完整生命周期）
            extra_info = f"Context:{num_ctx} | Timeout:{int(final_timeout)}s"
            pbar = ProgressBar(
                request_id=request_id,
                service_name=provider_display_name,
                extra_info=extra_info,
                streaming=is_streaming_progress_enabled(),
                task_type=task_type,
                source=source
            )
            
            start_time = time.perf_counter()
            
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(final_timeout, connect=10.0, read=final_timeout),
                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
            ) as client:
                full_content = ""
                
                # 定义请求核心逻辑
                async def _request_core():
                    async with client.stream('POST', f"{native_base}/api/chat", json=payload, follow_redirects=True) as resp:
                        if resp.status_code != 200:
                            error_text = await resp.aread()
                            try:
                                error_data = json.loads(error_text)
                                return {"success": False, "error": error_data.get('error', f'HTTP {resp.status_code}')}
                            except:
                                return {"success": False, "error": f'HTTP {resp.status_code}'}
                        
                        nonlocal full_content
                        async for line in resp.aiter_lines():
                            if not line: continue
                            try:
                                chunk_data = json.loads(line)
                                message = chunk_data.get('message')
                                if message and isinstance(message, dict):
                                    content = message.get('content', '')
                                    if content and content.strip():
                                        full_content += content
                                        pbar.set_generating(len(full_content))
                                        pbar.update(len(full_content))
                                        if stream_callback: stream_callback(content)
                                
                                if chunk_data.get('done', False):
                                    pbar.done(char_count=len(full_content), elapsed_ms=int((time.perf_counter() - start_time) * 1000))
                                    break
                            except:
                                continue
                        return {"success": True, "content": full_content.strip()}

                # 定义监视器逻辑
                async def _monitor_interrupts(target_task):
                    while not target_task.done():
                        is_interrupted = False
                        if cancel_event is not None and cancel_event.is_set():
                            is_interrupted = True
                        else:
                            try:
                                from server import PromptServer
                                if hasattr(PromptServer.instance, 'execution_interrupted') and PromptServer.instance.execution_interrupted:
                                    is_interrupted = True
                            except: pass
                        
                        if is_interrupted:
                            target_task.cancel()
                            return True
                        await asyncio.sleep(0.1)
                    return False

                # 并发执行
                req_task = asyncio.create_task(_request_core())
                monitor_task = asyncio.create_task(_monitor_interrupts(req_task))
                
                try:
                    result = await req_task
                    # 关键修复：检查返回的结果，如果失败则停止进度条
                    if not result.get("success"):
                        pbar.error(result.get("error", "未知错误"))
                    return result
                except Exception as req_err:
                    if 'pbar' in locals() and pbar:
                        pbar.error(f"Ollama 请求异常: {req_err}")
                    return {"success": False, "error": f"Ollama 请求异常: {req_err}"}
                except asyncio.CancelledError:

                    pbar.cancel(f"{WARN_PREFIX} 任务被中断 | 服务:Ollama")
                    return {"success": False, "error": "任务被中断", "interrupted": True}
                finally:
                    if not monitor_task.done(): monitor_task.cancel()
                    # 强力显存释放保证：不仅是成功，中断也要释放
                    if auto_unload:
                        try:
                            await cls._unload_ollama_model(model, {"base_url": native_base, "auto_unload": True})
                        except: pass
        
        # 关键修复：单独捕获外层 CancelledError，确保 pbar 被正确停止
        except asyncio.CancelledError:
            if 'pbar' in locals() and pbar:
                pbar.cancel(f"{WARN_PREFIX} 任务被外部取消 | 服务:Ollama")
            return {"success": False, "error": "任务被取消", "interrupted": True}
        
        except Exception as e:
            # 关键修复：确保 pbar 在异常时也被停止
            if 'pbar' in locals() and pbar:
                pbar.error(format_api_error(e, provider_display_name))
            return {"success": False, "error": format_api_error(e, provider_display_name)}
    
    @staticmethod
    async def expand_prompt(
        prompt: str,
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        system_message_override: Optional[Dict[str, str]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        使用大语言模型扩写提示词
        
        参数:
            prompt: 要扩写的提示词
            request_id: 请求ID
            stream_callback: 流式输出的回调函数
            custom_provider: 自定义服务商
            custom_provider_config: 自定义配置
            system_message_override: 覆盖系统提示词
        
        返回:
            Dict: {"success": bool, "data": {"original": str, "expanded": str}, "error": str}
        """
        try:
            # 获取配置
            if custom_provider and custom_provider_config:
                config = None
                provider = custom_provider
                api_key = custom_provider_config.get('api_key')
                model = custom_provider_config.get('model')
                temperature = custom_provider_config.get('temperature', 0.7)
                top_p = custom_provider_config.get('top_p', 0.9)
                max_tokens = custom_provider_config.get('max_tokens', 2000)
                send_temperature = custom_provider_config.get('send_temperature', True)
                send_top_p = custom_provider_config.get('send_top_p', True)
                send_max_tokens = custom_provider_config.get('send_max_tokens', True)
                base_url = custom_provider_config.get('base_url', '')
            else:
                config = LLMService._get_config()
                provider = config.get('provider', 'unknown')
                api_key = config.get('api_key')
                model = config.get('model')
                temperature = config.get('temperature', 0.7)
                top_p = config.get('top_p', 0.9)
                max_tokens = config.get('max_tokens', 2000)
                send_temperature = config.get('send_temperature', True)
                send_top_p = config.get('send_top_p', True)
                send_max_tokens = config.get('send_max_tokens', True)
                base_url = config.get('base_url', '')

            # 注：允许空API Key，支持无认证服务商（如deepinfra公开端点）
            if not model:
                return {"success": False, "error": "未配置模型名称"}

            provider_display_name = LLMService.get_provider_display_name(provider)
            


            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking
            
            # 获取系统提示词
            if system_message_override and system_message_override.get('content'):
                system_message = system_message_override
                prompt_name = system_message.get('name', '节点自定义规则')
            else:
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()

                if not system_prompts or 'expand_prompts' not in system_prompts:
                    return {"success": False, "error": "提示词优化系统提示词加载失败"}

                active_prompt_id = system_prompts.get('active_prompts', {}).get('expand', 'expand_default')
                if active_prompt_id not in system_prompts['expand_prompts']:
                    if len(system_prompts['expand_prompts']) > 0:
                        active_prompt_id = list(system_prompts['expand_prompts'].keys())[0]
                    else:
                        return {"success": False, "error": "未找到可用的提示词优化系统提示词"}

                system_message = system_prompts['expand_prompts'][active_prompt_id]
                prompt_name = system_message.get('name', active_prompt_id)
            
            # 检查服务配置的disable_thinking参数,只有开启时才关闭思维链
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            # 始终调用 build_thinking_suppression，传递 disable_thinking 参数
            _thinking_extra = build_thinking_suppression(provider, model, disable_thinking=disable_thinking_enabled)
            thinking_disabled = _thinking_extra is not None and disable_thinking_enabled
            model_display = format_model_with_thinking(model, thinking_disabled)

            # 构建消息
            lang_message = {
                "role": "system",
                "content": "请用中文回答" if LLMService._is_chinese(prompt) else "Please answer in English."
            }
            messages = [lang_message, system_message, {"role": "user", "content": prompt}]

            # Ollama走原生API (通过服务类型判断)
            if service and service.get('type') == 'ollama':
                # 读取 Ollama 服务的配置
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                
                # 统一计算 native_base (确保移除 /v1 和末尾斜杠)
                native_base = base_url.rstrip('/')
                if native_base.endswith('/v1'):
                    native_base = native_base[:-3].rstrip('/')
                
                # 再次兜底
                if not native_base:
                    native_base = 'http://localhost:11434'

                # 提前计算auto_unload配置
                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                result = await LLMService._call_ollama_native(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    send_temperature=send_temperature,
                    send_top_p=send_top_p,
                    send_max_tokens=send_max_tokens,
                    base_url=base_url,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    provider_display_name=provider_display_name,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_thinking_extra,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_EXPAND,
                    source=source
                )
                
                if result["success"]:
                    # 自动卸载 (原生调用路径需要手动触发，但使用补全后的基类逻辑)
                    await LLMService._unload_ollama_model(model, _cfg)
                    
                    # 应用思维链输出过滤
                    content = result["content"]
                    if filter_thinking_output:
                        content = filter_thinking_content(content)
                    
                    return {
                        "success": True,
                        "data": {"original": prompt, "expanded": content}
                    }
                else:
                    return result

            # 其他服务走HTTP直连
            if not base_url:
                base_url = LLMService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)
            
            # 检查disable_thinking、enable_advanced_params和filter_thinking_output配置
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            debug_mode = service.get('debug_mode', False) if service else False
            
            custom_params = None
            custom_params_text = None
            if custom_provider_config:
                custom_params_text = custom_provider_config.get('custom_params')
            if custom_params_text is None:
                custom_params_text = config.get('custom_params', '') if config else ''
            if custom_params_text is None or not str(custom_params_text).strip():
                custom_params_text = ''
            if custom_params_text and str(custom_params_text).strip():
                try:
                    custom_params = json.loads(custom_params_text)
                    if not isinstance(custom_params, dict):
                        return {"success": False, "error": "自定义请求参数(JSON)必须是对象"}
                except Exception as e:
                    return {"success": False, "error": f"自定义请求参数(JSON)格式错误: {str(e)}"}
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            
            result = await LLMService._http_request_chat_completions(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=messages,
                temperature=temperature,
                top_p=top_p,
                max_tokens=max_tokens,
                send_temperature=send_temperature,
                send_top_p=send_top_p,
                send_max_tokens=send_max_tokens,
                thinking_extra=thinking_extra,
                enable_advanced_params=enable_advanced_params,
                stream_callback=stream_callback,
                request_id=request_id,
                provider_display_name=provider_display_name,
                cancel_event=cancel_event,
                debug_mode=debug_mode,
                custom_request_params=custom_params,
                task_type=task_type or TASK_EXPAND,
                source=source
            )

            if result["success"]:
                # 根据配置决定是否应用思维链输出过滤
                content = result["content"]
                if filter_thinking_output:
                    content = filter_thinking_content(content)
                return {
                    "success": True,
                    "data": {"original": prompt, "expanded": content}
                }
            else:
                return result

        except Exception as e:
            return {"success": False, "error": format_api_error(e, "LLM服务")}
    
    @staticmethod
    async def translate(
        text: str,
        from_lang: str = 'auto',
        to_lang: str = 'zh',
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        使用大语言模型翻译文本
        
        参数:
            text: 要翻译的文本
            from_lang: 源语言
            to_lang: 目标语言
            request_id: 请求ID
            stream_callback: 流式输出回调
            custom_provider: 自定义服务商
            custom_provider_config: 自定义配置
        
        返回:
            Dict: {"success": bool, "data": {"original": str, "translated": str}, "error": str}
        """
        try:
            # 获取配置（翻译使用专门的翻译服务配置）
            if custom_provider and custom_provider_config:
                config = None
                provider = custom_provider
                api_key = custom_provider_config.get('api_key')
                model = custom_provider_config.get('model')
                temperature = custom_provider_config.get('temperature', 0.7)
                top_p = custom_provider_config.get('top_p', 0.9)
                max_tokens = custom_provider_config.get('max_tokens', 2000)
                send_temperature = custom_provider_config.get('send_temperature', True)
                send_top_p = custom_provider_config.get('send_top_p', True)
                send_max_tokens = custom_provider_config.get('send_max_tokens', True)
                base_url = custom_provider_config.get('base_url', '')
            else:
                # 使用翻译服务配置（而非LLM配置）
                from ..config_manager import config_manager
                config = config_manager.get_translate_config()
                provider = config.get('provider', 'unknown')
                api_key = config.get('api_key')
                model = config.get('model')
                temperature = config.get('temperature', 0.7)
                top_p = config.get('top_p', 0.9)
                max_tokens = config.get('max_tokens', 2000)
                send_temperature = config.get('send_temperature', True)
                send_top_p = config.get('send_top_p', True)
                send_max_tokens = config.get('send_max_tokens', True)
                base_url = config.get('base_url', '')

            # 注：允许空API Key，支持无认证服务商
            if not model:
                return {"success": False, "error": "未配置模型名称"}

            provider_display_name = LLMService.get_provider_display_name(provider)

            from ..config_manager import config_manager
            service = config_manager.get_service(provider)

            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking
            
            # 检测是否关闭思维链
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            _thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            thinking_disabled = _thinking_extra is not None and disable_thinking_enabled
            model_display = format_model_with_thinking(model, thinking_disabled)

            # 翻译提示词
            translate_instruction = f"请将以下文本从{from_lang}翻译成{to_lang}，只输出翻译结果，不要添加任何解释或额外内容："
            
            messages = [
                {"role": "system", "content": translate_instruction},
                {"role": "user", "content": text}
            ]

            # Ollama走原生API (通过服务类型判断)
            if service and service.get('type') == 'ollama':
                # 读取 Ollama 服务的配置
                disable_thinking_enabled = service.get('disable_thinking', True)
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                _ollama_thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
                
                # 统一计算 native_base (确保移除 /v1 和末尾斜杠)
                native_base = base_url.rstrip('/')
                if native_base.endswith('/v1'):
                    native_base = native_base[:-3].rstrip('/')
                
                # 再次兜底
                if not native_base:
                    native_base = 'http://localhost:11434'

                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                result = await LLMService._call_ollama_native(
                    model=model,
                    messages=[{"role": "system", "content": translate_instruction}, {"role": "user", "content": text}],
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    send_temperature=send_temperature,
                    send_top_p=send_top_p,
                    send_max_tokens=send_max_tokens,
                    base_url=base_url,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    provider_display_name=provider_display_name,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_ollama_thinking_extra,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_TRANSLATE,
                    source=source
                )
                
                if result["success"]:
                    await LLMService._unload_ollama_model(model, _cfg)
                    
                    # 应用思维链输出过滤
                    content = result["content"]
                    if filter_thinking_output:
                        content = filter_thinking_content(content)
                    
                    return {
                        "success": True,
                        "data": {"original": text, "translated": content}
                    }
                else:
                    return result

            # 其他服务走HTTP直连
            if not base_url:
                base_url = LLMService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)
            
            # 检查enable_advanced_params和filter_thinking_output配置
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            thinking_extra = _thinking_extra # 复用前面计算好的 suppression

            debug_mode = None
            custom_params_text = None
            if custom_provider_config:
                debug_mode = custom_provider_config.get('debug_mode')
                custom_params_text = custom_provider_config.get('custom_params')
            if debug_mode is None:
                debug_mode = service.get('debug_mode', False) if service else False
            if custom_params_text is None:
                custom_params_text = config.get('custom_params', '') if config else ''
            if custom_params_text is None or not str(custom_params_text).strip():
                custom_params_text = ''

            custom_params = None
            if custom_params_text and str(custom_params_text).strip():
                try:
                    custom_params = json.loads(custom_params_text)
                    if not isinstance(custom_params, dict):
                        return {"success": False, "error": "自定义请求参数(JSON)必须是对象"}
                except Exception as e:
                    return {"success": False, "error": f"自定义请求参数(JSON)格式错误: {str(e)}"}
            
            result = await LLMService._http_request_chat_completions(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=messages,
                temperature=temperature,
                top_p=top_p,
                max_tokens=max_tokens,
                send_temperature=send_temperature,
                send_top_p=send_top_p,
                send_max_tokens=send_max_tokens,
                thinking_extra=thinking_extra,
                enable_advanced_params=enable_advanced_params,
                stream_callback=stream_callback,
                request_id=request_id,
                provider_display_name=provider_display_name,
                cancel_event=cancel_event,
                debug_mode=debug_mode,
                custom_request_params=custom_params,
                task_type=task_type or TASK_TRANSLATE,
                source=source
            )

            if result["success"]:
                # 根据配置决定是否应用思维链输出过滤
                content = result["content"]
                if filter_thinking_output:
                    content = filter_thinking_content(content)
                return {
                    "success": True,
                    "data": {"original": text, "translated": content}
                }
            else:
                return result

        except Exception as e:
            return {"success": False, "error": format_api_error(e, "LLM服务")}
