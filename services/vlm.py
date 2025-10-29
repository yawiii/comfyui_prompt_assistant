import json
import os
import base64
from io import BytesIO
from PIL import Image
from typing import Optional, Dict, Any, List, Callable
import asyncio
from openai import AsyncOpenAI
import httpx
import time
from .thinking_control import build_thinking_suppression

from .error_util import format_api_error

class VisionService:
    _provider_base_urls = {
        'openai': None,  # 使用默认
        'siliconflow': 'https://api.siliconflow.cn/v1',  # 硅基流动
        'zhipu': 'https://open.bigmodel.cn/api/paas/v4/',  # 智谱（官方文档要求末尾斜杠）
        '302ai': 'https://api.302.ai/v1',
        'ollama': 'http://localhost:11434/v1',
        'custom': None  # 使用配置中的自定义URL
    }
    
    # 提供商显示名称映射
    _provider_display_names = {
        'zhipu': '智谱',
        'siliconflow': '硅基流动',
        'openai': 'OpenAI',
        '302ai': '302.AI',
        'ollama': 'Ollama',
        'custom': '自定义'
    }

    @classmethod
    def get_openai_client(cls, api_key: str, provider: str) -> AsyncOpenAI:
        """获取OpenAI客户端"""
        # 降低第三方库默认HTTP日志级别，避免重复输出，并关闭OpenAI SDK调试打印
        try:
            import logging
            import os as _os
            _os.environ["OPENAI_LOG"] = "error"
            for _name in ("openai", "openai._base_client", "httpx", "httpcore"):
                _logger = logging.getLogger(_name)
                _logger.setLevel(logging.WARNING)
        except Exception:
            pass

        # 否则创建新客户端
        base_url = None

        # 如果是自定义提供商，从配置中获取base_url
        if provider == 'custom':
            from ..config_manager import config_manager
            config = config_manager.get_vision_config()
            if 'providers' in config and 'custom' in config['providers']:
                base_url = config['providers']['custom'].get('base_url')
                # 确保base_url不以/chat/completions结尾，避免路径重复
                if base_url and base_url.endswith('/chat/completions'):
                    # 注意: str.rstrip 参数是字符集合，这里不能用来移除子串，否则会误删域名尾部字符
                    base_url = base_url[: -len('/chat/completions')]
        else:
            base_url = cls._provider_base_urls.get(provider)

        # 检查是否启用"跳过代理直连"
        bypass_proxy = False
        try:
            from ..config_manager import config_manager
            settings = config_manager.get_settings()
            bypass_proxy = settings.get('PromptAssistant.Settings.BypassProxy', False)
        except Exception:
            pass

        # 创建简化的httpx客户端，明确禁用HTTP/2以提高国内服务商兼容性
        # 视觉模型需要较长的超时时间
        # 仅在"发起请求"阶段打印一条请求日志，避免重复
        from ..server import PROCESS_PREFIX

        async def _on_request(request: httpx.Request):
            try:
                print(f"{PROCESS_PREFIX} HTTP Request: {request.method} {request.url}")
            except Exception:
                pass

        # 使用细粒度的超时配置，提高网络波动下的稳定性
        # 视觉模型处理需要较长时间，因此读取超时设置更长
        http_client_kwargs = {
            'timeout': httpx.Timeout(
                connect=15.0,   # 连接超时：15秒
                read=120.0,     # 读取超时：120秒（视觉模型分析需要更长时间）
                write=15.0,     # 写入超时：15秒
                pool=10.0       # 连接池超时：10秒
            ),
            'event_hooks': {'request': [_on_request]},
            'http2': False,    # 明确禁用HTTP/2，提高国内服务商兼容性
            'verify': True     # 启用SSL验证，但使用系统证书
        }
        
        # 如果启用"跳过代理直连"，则设置 proxy=None
        if bypass_proxy:
            http_client_kwargs['proxy'] = None
        
        http_client = httpx.AsyncClient(**http_client_kwargs)

        kwargs = {
            "api_key": api_key,
            "http_client": http_client,
            "max_retries": 3  # 增加重试次数到3次
        }
        if base_url:
            # 根据官方文档，保留base_url原样，不做处理
            # 智谱文档要求：https://open.bigmodel.cn/api/paas/v4/
            # 硅基流动文档要求：https://api.siliconflow.cn/v1
            # OpenAI SDK会自动处理URL拼接
            kwargs["base_url"] = base_url


        # 创建客户端
        client = AsyncOpenAI(**kwargs)
        return client

    @staticmethod
    def _get_config() -> Dict[str, Any]:
        """获取视觉模型配置"""
        from ..config_manager import config_manager
        config = config_manager.get_vision_config()
        current_provider = config.get('provider')

        # 获取实际配置
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
                'auto_unload': provider_config.get('auto_unload', True)
            }
        else:
            # 兼容旧版配置格式
            return config

    @staticmethod
    async def _unload_ollama_model(model: str, provider_config: Dict[str, Any]):
        """
        卸载Ollama模型以释放显存和内存
        
        参数:
            model: 模型名称
            provider_config: 提供商配置字典
        """
        try:
            # 检查是否启用自动释放
            auto_unload = provider_config.get('auto_unload', True)
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
            
            from ..server import PROCESS_PREFIX
            print(f"{PROCESS_PREFIX} Ollama自动释放显存 | 模型:{model}")
            
            import httpx as httpx_module
            async with httpx_module.AsyncClient(timeout=5.0) as client:
                await client.post(url, json=payload)
                
        except Exception as e:
            # 释放失败不影响主流程，只记录警告
            from ..server import WARN_PREFIX
            print(f"{WARN_PREFIX} Ollama模型释放失败（不影响结果） | 模型:{model} | 错误:{str(e)[:50]}")

    @staticmethod
    def preprocess_image(image_data: str, request_id: Optional[str] = None) -> str:
        """
        预处理图像数据，包括压缩和调整大小

        参数:
            image_data: 图像数据（Base64编码或URL）
            request_id: 请求ID，用于日志记录

        返回:
            处理后的图像数据
        """
        from ..server import REQUEST_PREFIX

        try:
            # 检查是否为base64编码的图像数据
            if image_data.startswith('data:image'):
                # 提取base64数据
                header, encoded = image_data.split(",", 1)
                image_bytes = base64.b64decode(encoded)

                # 打开图像
                img = Image.open(BytesIO(image_bytes))
                original_size = img.size
                original_format = img.format or 'JPEG'
                original_bytes = len(image_bytes)

                # 调整大小，保持纵横比
                max_size = 1024  # 最大尺寸设为1024px
                if max(img.size) > max_size:
                    ratio = max_size / max(img.size)
                    new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                    img = img.resize(new_size, Image.LANCZOS)

                # 压缩图像
                buffer = BytesIO()
                save_format = 'JPEG' if original_format not in ['PNG', 'GIF'] else original_format

                # 根据格式选择保存参数
                if save_format == 'JPEG':
                    img.save(buffer, format=save_format, quality=85, optimize=True)
                elif save_format == 'PNG':
                    img.save(buffer, format=save_format, optimize=True, compress_level=7)
                else:
                    img.save(buffer, format=save_format)

                compressed_bytes = buffer.getvalue()

                # 转回base64
                compressed_b64 = base64.b64encode(compressed_bytes).decode('utf-8')
                processed_image_data = f"{header},{compressed_b64}"

                # 计算压缩比例
                compressed_size = len(compressed_bytes)
                compression_ratio = (1 - compressed_size / original_bytes) * 100

                # 记录日志（蓝色前缀 + 紧凑格式）
                print(
                    f"{REQUEST_PREFIX} 图像预处理 | 请求ID:{request_id} | "
                    f"图像尺寸:{original_size} → {img.size} | "
                    f"大小:{original_bytes/1024:.1f}KB → {compressed_size/1024:.1f}KB | "
                    f"压缩率:{compression_ratio:.1f}%"
                )

                return processed_image_data

            # 如果不是base64编码的图像数据，直接返回
            return image_data

        except Exception as e:
            from ..server import WARN_PREFIX
            print(f"{WARN_PREFIX} 图像预处理失败 | 请求ID:{request_id} | 错误:{str(e)}")
            # 预处理失败时返回原始图像数据
            return image_data

    @staticmethod
    async def analyze_image(image_data: str, request_id: Optional[str] = None,
                          stream_callback: Optional[Callable[[str], None]] = None,
                          prompt_content: Optional[str] = None,
                          custom_provider: Optional[str] = None,
                          custom_provider_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        使用视觉模型分析图像

        参数:
            image_data: 图像数据（Base64编码）
            request_id: 请求ID
            lang: 分析语言，zh为中文，en为英文
            stream_callback: 流式输出的回调函数
            custom_prompt: 自定义提示词
            custom_provider: 自定义提供商
            custom_provider_config: 自定义提供商配置

        返回:
            包含分析结果的字典
        """
        from ..server import PREFIX, ERROR_PREFIX
        try:
            # 获取配置
            if custom_provider and custom_provider_config:
                # 使用自定义提供商和配置
                provider = custom_provider
                api_key = custom_provider_config.get('api_key', '')
                model = custom_provider_config.get('model', '')
                base_url = custom_provider_config.get('base_url', '')
                temperature = custom_provider_config.get('temperature', 0.7)
                top_p = custom_provider_config.get('top_p', 0.9)
                max_tokens = custom_provider_config.get('max_tokens', 2000)
            else:
                # 使用默认配置
                config = VisionService._get_config()
                api_key = config.get('api_key')
                model = config.get('model')
                provider = config.get('provider', 'unknown')
                temperature = config.get('temperature', 0.7)
                top_p = config.get('top_p', 0.9)
                max_tokens = config.get('max_tokens', 2000)

            if not api_key:
                return {"success": False, "error": "请先配置视觉模型API密钥"}
            if not model:
                return {"success": False, "error": "未配置视觉模型名称"}

            # 检查图片数据格式
            if not image_data:
                return {"success": False, "error": "未提供图像数据"}

            # 预处理图像数据（压缩和调整大小）
            image_data = VisionService.preprocess_image(image_data, request_id)

            # 获取提供商显示名称
            provider_display_name = VisionService._provider_display_names.get(provider, provider)

            # 直接使用传入的提示词内容
            system_prompt = prompt_content
            if not system_prompt:
                return {"success": False, "error": "未提供有效的提示词内容"}


            # 简化：仅当按内容精确匹配到系统内置视觉提示词时打印其名称（蓝色前缀），不输出ID
            try:
                from ..config_manager import config_manager
                system_prompts_all = config_manager.get_system_prompts()
                vision_prompts = (system_prompts_all or {}).get('vision_prompts', {})
                # 规则匹配不再打印，准备阶段已经显示过规则信息
                pass
            except Exception:
                pass

            # 模型能力守卫：拦截“图像生成类”模型，避免错误调用
            _lower_model = (model or "").lower()
            _gen_keywords = ("image-generation", "dall-e", "imagen-", "-imagen-", "sdxl", "flux")
            if any(k in _lower_model for k in _gen_keywords):
                return {"success": False, "error": f"模型不支持视觉理解（图→文）：{model}。请更换多模态对话/理解模型（如 gemini-2.0/2.5-flash、gpt-4o、GLM-4.5V、Qwen-VL 等）。"}

            # 发送请求
            _thinking_extra = build_thinking_suppression(provider, model)
            _thinking_tag = "（已关闭思维链）" if _thinking_extra else ""

            # 使用OpenAI SDK
            client = VisionService.get_openai_client(api_key, provider)
            
            # 添加手动重试机制，处理连接错误
            max_retries = 3
            retry_delay = 1.0  # 初始重试延迟（秒）
            
            # 检查是否启用直连模式
            bypass_proxy = False
            try:
                from ..config_manager import config_manager as cm
                settings = cm.get_settings()
                bypass_proxy = settings.get('PromptAssistant.Settings.BypassProxy', False)
            except Exception:
                pass
            
            direct_mode_tag = "(直连)" if bypass_proxy else ""
            
            for attempt in range(max_retries):
                try:
                    # 添加调试信息
                    from ..server import PROCESS_PREFIX
                    if attempt > 0:
                        print(f"{PROCESS_PREFIX} 重试视觉模型API调用{direct_mode_tag} | 尝试:{attempt + 1}/{max_retries} | 服务:{provider_display_name} | 模型:{model}{_thinking_tag}")
                    else:
                        print(f"{PROCESS_PREFIX} 调用视觉模型API{direct_mode_tag} | 服务:{provider_display_name} | 模型:{model}{_thinking_tag}")
                    start_time = time.perf_counter()

                    # 使用配置中的参数
                    _thinking_extra = build_thinking_suppression(provider, model)
                    try:
                        # 构建基础参数（保守：不带 response_format，默认流式）
                        create_kwargs = dict(
                            model=model,
                            messages=[{
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": system_prompt},
                                    {"type": "image_url", "image_url": {"url": image_data}}
                                ]
                            }],
                            max_tokens=max_tokens,
                            temperature=temperature,
                            top_p=top_p,
                            stream=True
                        )
                        # 思维链控制：extra_body 或 顶层参数
                        if _thinking_extra:
                            # Gemini 的 reasoning_effort 需要顶层；其余放入 extra_body
                            _extra = dict(_thinking_extra)
                            if "reasoning_effort" in _extra:
                                create_kwargs["reasoning_effort"] = _extra.pop("reasoning_effort")
                            if _extra:
                                create_kwargs["extra_body"] = _extra
                        response = await client.chat.completions.create(**create_kwargs)
                    except Exception as e_first:
                        msg = str(e_first).lower()
                        if "enable_thinking" in msg and "not support" in msg:
                            print(f"{PREFIX} 发现 enable_thinking 不被模型支持，移除后重试 | 模型:{model}")
                            create_kwargs.pop("extra_body", None)
                            response = await client.chat.completions.create(**create_kwargs)
                        elif ("response_format" in msg and ("unknown" in msg or "not support" in msg)) or (
                            "stream" in msg and ("not support" in msg or "unsupported" in msg)
                        ):
                            # 去除不被支持的参数并关闭流式重试一次
                            create_kwargs.pop("response_format", None)
                            create_kwargs["stream"] = False
                            response = await client.chat.completions.create(**create_kwargs)
                        elif "max_tokens" in msg and ("unknown" in msg or "invalid" in msg):
                            # 少数聚合网关可能要求 max_output_tokens
                            create_kwargs.pop("max_tokens", None)
                            create_kwargs["max_output_tokens"] = max_tokens
                            response = await client.chat.completions.create(**create_kwargs)
                        else:
                            raise
                    
                    # 请求成功，跳出重试循环
                    break
                    
                except Exception as e:
                    # 检查是否为连接错误
                    error_msg = str(e).lower()
                    is_connection_error = any(keyword in error_msg for keyword in [
                        'connection', 'connect', 'timeout', 'timed out', 
                        'network', 'unreachable', 'refused'
                    ])
                    
                    # 如果是最后一次尝试，或者不是连接错误，则抛出异常
                    if attempt == max_retries - 1 or not is_connection_error:
                        raise
                    
                    # 否则等待后重试（使用指数退避策略）
                    wait_time = retry_delay * (2 ** attempt)
                    from ..server import WARN_PREFIX
                    print(f"{WARN_PREFIX} 视觉模型API连接失败 | 尝试:{attempt + 1}/{max_retries} | 错误:{str(e)[:100]} | {wait_time:.1f}秒后重试")
                    await asyncio.sleep(wait_time)
                    continue
            
            try:

                full_content = ""
                async for chunk in response:
                    # 兼容部分第三方网关返回空 choices 的异常片段，做健壮性判断
                    choices = getattr(chunk, "choices", None) or []
                    for ch in choices:
                        delta = getattr(ch, "delta", None)
                        if not delta:
                            continue
                        content = getattr(delta, "content", None)
                        if content:
                            full_content += content
                            if stream_callback:
                                stream_callback(content)

                # 输出结构化成功日志
                elapsed_ms = int((time.perf_counter() - start_time) * 1000)
                # 根据request_id前缀判断节点类型
                if request_id.startswith('image_caption_'):
                    success_msg = "图像反推完成"
                elif request_id.startswith('kontext_preset_'):
                    success_msg = "Kontext预设完成"
                else:
                    success_msg = "图像反推成功"
                print(f"{PREFIX} {success_msg} | 服务:{provider_display_name} | 请求ID:{request_id} | 结果字符数:{len(full_content)} | 耗时:{elapsed_ms}ms")

                # Ollama自动释放显存
                if provider == 'ollama':
                    # 构建配置字典用于释放
                    provider_config = {
                        'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                        'base_url': base_url if custom_provider_config else config.get('base_url', 'http://localhost:11434')
                    }
                    await VisionService._unload_ollama_model(model, provider_config)

                return {
                    "success": True,
                    "data": {
                        "description": full_content
                    }
                }
            except asyncio.CancelledError:
                print(f"{PREFIX} 视觉模型分析任务在服务层被取消 | ID:{request_id}")
                return {"success": False, "error": "请求已取消", "cancelled": True}
            except Exception as e:
                return {"success": False, "error": format_api_error(e, provider_display_name)}

        except asyncio.CancelledError:
            print(f"{PREFIX} 视觉分析任务在服务层被取消 | ID:{request_id}")
            return {"success": False, "error": "请求已取消", "cancelled": True}
        except Exception as e:
            print(f"{ERROR_PREFIX} 视觉分析过程异常 | 错误:{str(e)}")
            return {"success": False, "error": str(e)}