"""
VLM服务 - 重构版本
提供视觉模型的图像分析功能
继承OpenAICompatibleService以复用通用逻辑
"""

import json
import time
import asyncio
from typing import Optional, Dict, Any, List, Callable
import httpx
from .openai_base import OpenAICompatibleService, filter_thinking_content
from ..utils.common import (
    format_api_error, preprocess_image, check_multi_image_support, ProgressBar,
    log_complete, log_error,
    PREFIX, PROCESS_PREFIX, WARN_PREFIX, ERROR_PREFIX, format_elapsed_time,
    TASK_IMAGE_CAPTION, TASK_VIDEO_CAPTION
)
from .thinking_control import build_thinking_suppression


class VisionService(OpenAICompatibleService):
    """
    视觉模型服务
    支持单图和多图分析
    """
    
    @staticmethod
    def _get_config() -> Dict[str, Any]:
        """获取视觉模型配置"""
        from ..config_manager import config_manager
        config = config_manager.get_vision_config()
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
    async def _call_ollama_native_vision(
        model: str,
        system_prompt: str,
        images_b64: List[str],
        temperature: float,
        top_p: float,
        max_tokens: int,
        base_url: str,
        send_temperature: bool = True,
        send_top_p: bool = True,
        send_max_tokens: bool = True,
        stream_callback: Optional[Callable[[str], None]] = None,
        request_id: Optional[str] = None,
        is_multi: bool = False,
        auto_unload: bool = True,
        enable_advanced_params: bool = False,
        thinking_extra: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: str = None
    ) -> Dict[str, Any]:
        """
        调用Ollama原生视觉API (/api/chat)
        支持单图和多图分析
        
        参数:
            enable_advanced_params: 是否发送高级参数(temperature/top_p/num_predict)
            thinking_extra: 思维链控制参数
        """
        from ..server import is_streaming_progress_enabled
        
        try:
            start_time = time.perf_counter()
            
            _thinking_extra = thinking_extra  # 使用传入的参数
            _thinking_tag = "💭" if _thinking_extra else ""
            
            # 计算基准 URL (确保移除 /v1 和末尾斜杠)
            native_base = base_url.rstrip('/') if base_url else 'http://localhost:11434'
            if native_base.endswith('/v1'):
                native_base = native_base[:-3].rstrip('/')
            
            # 动态计算num_ctx（根据图像数量）
            # 每张图片约需要1024-2048 tokens
            img_count = len(images_b64)
            
            # 文本Token估算 (0.6系数)
            prompt_ctx = int(len(system_prompt) * 0.6)
            
            # 图像Token估算 (每张2048作为基准)
            image_ctx = img_count * 2048
            
            # --- 智能预留策略 (适配 Vision 模型) ---
            # 关键点：Vision模型的思考过程同样占用大量 Output Token
            
            is_safe_standard_model = False
            if model:
                m = model.lower()
                if "instruct" in m or "chat" in m:
                    is_safe_standard_model = True

            if _thinking_extra or is_safe_standard_model:
                # 已关闭思维链 OR 标准指令模型 -> 极致节省模式
                min_output = 512
                # 单图允许进一步下探至 2048，多图保持 3072 起步以确保稳定
                ctx_floor = 2048 if not is_multi else 3072
                sys_buffer = 384
            else:
                # 未关闭思维链 -> 安全能够模式
                min_output = 1024
                # 单图下限从 4096 降至 2048 (适配 Ollama 显存分配优化)
                ctx_floor = 2048 if not is_multi else 4096
                sys_buffer = 384 if not is_multi else 1024
            
            # 输出预留 (多图需更多)
            # 如果是单图模式，预留 512 已足够描述；如果是多图，使用 min_output
            base_reserve = (img_count * 512) if is_multi else 512
            output_reserve = max(512 if not is_multi else min_output, base_reserve)
            
            required_ctx = prompt_ctx + image_ctx + output_reserve + sys_buffer
            
            # 范围: [ctx_floor, 65536]
            num_ctx = max(ctx_floor, min(65536, required_ctx))
            num_ctx = ((num_ctx + 1023) // 1024) * 1024
            
            # [Debug] 输出多图请求信息
            print(f"{PREFIX} 🐏 视觉请求 | 图片数量:{len(images_b64)} | num_ctx:{num_ctx} | 模型:{model}")
            
            # 构建基础请求体
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": system_prompt, "images": images_b64}],
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
            
            # 设置超时
            # 基础读取超时60秒 + 每张图片增加30秒 + 上下文长度自适应
            base_read_timeout = 60.0
            per_image_read_timeout = 30.0
            ctx_based_timeout = (num_ctx / 1000) * 2.0 # 每1000tokens增加2秒
            
            calculated_read_timeout = base_read_timeout + (img_count * per_image_read_timeout) + ctx_based_timeout
            
            # 最大读取超时限制为 10 分钟 (600s)
            final_read_timeout = min(600.0, max(60.0, calculated_read_timeout))
            
            # 创建统一进度条（自动处理等待→生成→完成的完整生命周期）
            extra_info = f"Context:{num_ctx} | Timeout:{int(final_read_timeout)}s"
            pbar = ProgressBar(
                request_id=request_id,
                service_name="Ollama",
                extra_info=extra_info,
                streaming=is_streaming_progress_enabled(),
                task_type=task_type,
                source=source
            )
            
            start_time = time.perf_counter()
            
            # 获取持久化客户端以支持连接复用
            from .core import HTTPClientPool
            client = HTTPClientPool.get_client(
                provider="Ollama(Vision)",
                base_url=native_base,
                timeout=final_read_timeout
            )
            
            full_content = ""
            
            async def _request_core():
                nonlocal full_content
                async with client.stream('POST', f"{native_base}/api/chat", json=payload, follow_redirects=True) as resp:
                    if resp.status_code != 200:
                        error_text = await resp.aread()
                        pbar.error(f"Ollama API 错误: {resp.status_code}")
                        try:
                            error_data = json.loads(error_text)
                            return {"success": False, "error": error_data.get('error', f'HTTP {resp.status_code}')}
                        except:
                            return {"success": False, "error": f'HTTP {resp.status_code}'}
                    
                    async for line in resp.aiter_lines():
                        if not line: continue
                        try:
                            chunk_data = json.loads(line)
                            message = chunk_data.get('message')
                            if message and isinstance(message, dict):
                                content = message.get('content', '') or ''
                                if not content.strip():
                                    thinking = message.get('thinking', '') or message.get('reasoning', '')
                                    if thinking and len(thinking.strip()) > 5:
                                        content = thinking
                                
                                if content and content.strip():
                                    full_content += content
                                    pbar.set_generating(len(full_content))
                                    pbar.update(len(full_content))
                                    if stream_callback: stream_callback(content)
                            
                            if chunk_data.get('done', False):
                                pbar.done(char_count=len(full_content), elapsed_ms=int((time.perf_counter() - start_time) * 1000))
                                break
                        except: continue
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
                # 兜底处理：确保失败结果时进度条已停止
                if not result.get("success") and not getattr(pbar, '_closed', False):
                    pbar.error(result.get("error", "未知错误"))
                return result
            except Exception as req_err:
                if 'pbar' in locals() and pbar:
                    pbar.error(f"Ollama(Vision) 请求异常: {req_err}")
                return {"success": False, "error": f"Ollama(Vision) 请求异常: {req_err}"}
            except asyncio.CancelledError:

                # 关键修复：确保进度条在监视器取消时被正确清理
                pbar.cancel(f"{WARN_PREFIX} 任务被中断 | 服务:Ollama(Vision)")
                return {"success": False, "error": "任务被中断", "interrupted": True}
            finally:
                if not monitor_task.done(): monitor_task.cancel()
                # 显存释放保证：视觉节点对显存更敏感，必须确保在所有退出路径执行
                try:
                    from .llm import LLMService
                    await LLMService._unload_ollama_model(model, {"base_url": native_base, "auto_unload": auto_unload})
                except: pass
        
        # 关键修复：单独捕获外层 CancelledError，确保 pbar 被正确停止
        except asyncio.CancelledError:
            if 'pbar' in locals() and pbar:
                pbar.cancel(f"{WARN_PREFIX} 任务被外部取消 | 服务:Ollama(Vision)")
            return {"success": False, "error": "任务被取消", "interrupted": True}
        
        except Exception as e:
            # 关键修复：确保 pbar 在异常时也被停止
            if 'pbar' in locals() and pbar:
                pbar.error(format_api_error(e, "Ollama"))
            return {"success": False, "error": format_api_error(e, "Ollama")}
    
    @staticmethod
    async def analyze_image(
        image_data: str,
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        prompt_content: Optional[str] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        使用视觉模型分析单张图像
        
        参数:
            image_data: 图像数据（Base64编码）
            request_id: 请求ID
            stream_callback: 流式输出回调
            prompt_content: 自定义提示词
            custom_provider: 自定义服务商
            custom_provider_config: 自定义配置
        
        返回:
            Dict: {"success": bool, "data": {"description": str}, "error": str}
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
                config = VisionService._get_config()
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

            provider_display_name = VisionService.get_provider_display_name(provider)

            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking
            
            # 检查服务配置以确定是否显示思维链标识
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            # 只有当开关开启且模型支持时才显示标识
            _thinking_check = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            thinking_disabled = _thinking_check is not None
            model_display = format_model_with_thinking(model, thinking_disabled)

            # 预处理图像
            processed_image = preprocess_image(image_data, request_id=request_id)

            # 获取系统提示词
            system_prompt = prompt_content or "请详细描述这张图片的内容，包括主要对象、场景、颜色、氛围等。"

            # Ollama走原生API (通过服务类型判断)
            if service and service.get('type') == 'ollama':
                # 读取 Ollama 服务的配置
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                _ollama_thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
                
                # 提取纯base64
                b64 = processed_image.split(',')[1] if ',' in processed_image else processed_image
                
                # 提前计算auto_unload配置
                native_base = base_url[:-3] if base_url.endswith('/v1') else (base_url or 'http://localhost:11434')
                native_base = native_base.rstrip('/')
                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                result = await VisionService._call_ollama_native_vision(
                    model=model,
                    system_prompt=system_prompt,
                    images_b64=[b64],
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    base_url=base_url,
                    send_temperature=send_temperature,
                    send_top_p=send_top_p,
                    send_max_tokens=send_max_tokens,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    is_multi=False,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_ollama_thinking_extra,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_IMAGE_CAPTION,
                    source=source
                )
                
                if result["success"]:
                    # 注：卸载已在 _call_ollama_native_vision 的 finally 块中处理
                    
                    # 应用思维链输出过滤
                    content = result["content"]
                    if filter_thinking_output:
                        content = filter_thinking_content(content)
                    
                    return {
                        "success": True,
                        "data": {"description": content}
                    }
                else:
                    return result

            # 其他服务走HTTP直连
            if not base_url:
                base_url = VisionService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)
            
            # 构建消息（图像格式）
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": system_prompt},
                        {"type": "image_url", "image_url": {"url": processed_image}}
                    ]
                }
            ]
            
            # 检查disable_thinking、enable_advanced_params和filter_thinking_output配置
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            
            debug_mode = None
            custom_params_text = None
            if custom_provider_config:
                debug_mode = custom_provider_config.get('debug_mode')
                custom_params_text = custom_provider_config.get('custom_params')
            if debug_mode is None:
                debug_mode = service.get('debug_mode', False) if service else False
            if custom_params_text is None:
                custom_params_text = config.get('custom_params', '') if config else ''
            
            custom_params = None
            if custom_params_text and str(custom_params_text).strip():
                try:
                    custom_params = json.loads(custom_params_text)
                    if not isinstance(custom_params, dict):
                        return {"success": False, "error": "自定义请求参数(JSON)必须是对象"}
                except Exception as e:
                    return {"success": False, "error": f"自定义请求参数(JSON)格式错误: {str(e)}"}
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            
            result = await VisionService._http_request_chat_completions(
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
                task_type=task_type or TASK_IMAGE_CAPTION,
                source=source
            )

            if result["success"]:
                # 根据配置决定是否应用思维链输出过滤
                content = result["content"]
                if filter_thinking_output:
                    content = filter_thinking_content(content)
                return {
                    "success": True,
                    "data": {"description": content}
                }
            else:
                return result

        except Exception as e:
            return {"success": False, "error": format_api_error(e, "VLM服务")}
    
    @staticmethod
    async def analyze_images(
        images_data: List[str],
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        prompt_content: Optional[str] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        使用视觉模型分析多张图像
        
        参数:
            images_data: 图像数据列表（Base64编码）
            request_id: 请求ID
            stream_callback: 流式输出回调
            prompt_content: 自定义提示词
            custom_provider: 自定义服务商
            custom_provider_config: 自定义配置
        
        返回:
            Dict: {"success": bool, "data": {"description": str}, "error": str}
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
                config = VisionService._get_config()
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

            provider_display_name = VisionService.get_provider_display_name(provider)

            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking
            
            # 检查服务配置以确定是否显示思维链标识
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            # 只有当开关开启且模型支持时才显示标识
            _thinking_check = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            thinking_disabled = _thinking_check is not None
            model_display = format_model_with_thinking(model, thinking_disabled)

            # 检查是否支持多图
            supports_multi, max_images = check_multi_image_support(provider, model)
            
            if not supports_multi:
                return {"success": False, "error": f"模型 {model} 不支持多图像分析"}
            
            if len(images_data) > max_images:
                return {"success": False, "error": f"图像数量 {len(images_data)} 超过模型限制 {max_images}"}

            # 预处理所有图像（智能压缩：根据图像数量动态调整质量）
            img_count = len(images_data)
            from ..utils.common import get_optimal_image_params
            _, _, compression_level = get_optimal_image_params(img_count)
            
            # 使用 ProgressBar 管理预处理进度
            pbar = ProgressBar(request_id=request_id, service_name="图像预处理", streaming=False)
            processed_images = []
            for idx, img in enumerate(images_data, 1):
                processed = preprocess_image(img, request_id=request_id, silent=True, image_count=img_count)
                processed_images.append(processed)
            
            pbar.done(f"{PREFIX} 🟡 预处理完成: {img_count}/{img_count} | 压缩:{compression_level}")

            # 获取系统提示词
            system_prompt = prompt_content or "请详细描述这些图片，分析它们之间的关系和差异。"

            # Ollama走原生API (通过服务类型判断)
            if service and service.get('type') == 'ollama':
                # 读取 Ollama 服务的配置
                from ..config_manager import config_manager
                # 此处保持类型判断，不再硬编码 ID 'ollama'
                disable_thinking_enabled = service.get('disable_thinking', True)
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                _ollama_thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
                
                # 提前计算auto_unload配置
                native_base = base_url[:-3] if base_url.endswith('/v1') else (base_url or 'http://localhost:11434')
                native_base = native_base.rstrip('/')
                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                # 提取纯base64
                b64_images = [img.split(',')[1] if ',' in img else img for img in processed_images]
                
                result = await VisionService._call_ollama_native_vision(
                    model=model,
                    system_prompt=system_prompt,
                    images_b64=b64_images,
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    base_url=base_url,
                    send_temperature=send_temperature,
                    send_top_p=send_top_p,
                    send_max_tokens=send_max_tokens,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    is_multi=True,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_ollama_thinking_extra,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_VIDEO_CAPTION,
                    source=source
                )
                
                if result["success"]:
                    # 注：卸载已在 _call_ollama_native_vision 的 finally 块中处理
                    
                    # 应用思维链输出过滤
                    content = result["content"]
                    if filter_thinking_output:
                        content = filter_thinking_content(content)
                    
                    return {
                        "success": True,
                        "data": {"description": content}
                    }
                else:
                    return result

            # 其他服务走HTTP直连
            if not base_url:
                base_url = VisionService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)
            
            # 构建多图消息
            content = [{"type": "text", "text": system_prompt}]
            for img in processed_images:
                content.append({"type": "image_url", "image_url": {"url": img}})
            
            messages = [{"role": "user", "content": content}]
            
            # 检查disable_thinking、enable_advanced_params和filter_thinking_output配置
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            
            debug_mode = None
            custom_params_text = None
            if custom_provider_config:
                debug_mode = custom_provider_config.get('debug_mode')
                custom_params_text = custom_provider_config.get('custom_params')
            if debug_mode is None:
                debug_mode = service.get('debug_mode', False) if service else False
            if custom_params_text is None:
                custom_params_text = config.get('custom_params', '') if config else ''
            
            custom_params = None
            if custom_params_text and str(custom_params_text).strip():
                try:
                    custom_params = json.loads(custom_params_text)
                    if not isinstance(custom_params, dict):
                        return {"success": False, "error": "自定义请求参数(JSON)必须是对象"}
                except Exception as e:
                    return {"success": False, "error": f"自定义请求参数(JSON)格式错误: {str(e)}"}
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            
            result = await VisionService._http_request_chat_completions(
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
                task_type=task_type or TASK_VIDEO_CAPTION,
                source=source
            )

            if result["success"]:
                # 根据配置决定是否应用思维链输出过滤
                content = result["content"]
                if filter_thinking_output:
                    content = filter_thinking_content(content)
                return {
                    "success": True,
                    "data": {"description": content}
                }
            else:
                return result

        except Exception as e:
            # 确保进度条在异常时被停止
            if 'pbar' in locals() and pbar and not getattr(pbar, '_closed', False):
                pbar.error(format_api_error(e, "VLM服务"))
            return {"success": False, "error": format_api_error(e, "VLM服务")}
