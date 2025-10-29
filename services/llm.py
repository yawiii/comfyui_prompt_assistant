import json
import os
import sys
from typing import Optional, Dict, Any, List, Callable
import asyncio
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion
import httpx
import time
from .error_util import format_api_error
from .thinking_control import build_thinking_suppression


class LLMService:
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
            # 关闭 OpenAI SDK 的调试HTTP日志（环境变量优先生效）
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
            config = config_manager.get_llm_config()
            if 'providers' in config and 'custom' in config['providers']:
                base_url = config['providers']['custom'].get('base_url')
                # 确保base_url不以/chat/completions结尾，避免路径重复
                if base_url and base_url.endswith('/chat/completions'):
                    # 注意: str.rstrip 参数是字符集合，这里不能用来移除子串，否则可能把域名尾部的字母也删掉
                    # 正确做法是按长度切片移除精确后缀
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
        # 仅在"发起请求"阶段打印一条请求日志，避免重复
        from ..server import PROCESS_PREFIX

        async def _on_request(request: httpx.Request):
            try:
                print(f"{PROCESS_PREFIX} HTTP Request: {request.method} {request.url}")
            except Exception:
                pass

        # 使用细粒度的超时配置，提高网络波动下的稳定性
        # connect: 建立连接的超时时间
        # read: 等待服务器响应的超时时间
        # write: 发送请求数据的超时时间
        # pool: 从连接池获取连接的超时时间
        http_client_kwargs = {
            'timeout': httpx.Timeout(
                connect=10.0,  # 连接超时：10秒
                read=60.0,     # 读取超时：60秒（流式响应需要较长时间）
                write=10.0,    # 写入超时：10秒
                pool=5.0       # 连接池超时：5秒
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


        # 创建客户端并缓存
        client = AsyncOpenAI(**kwargs)
        return client

    @staticmethod
    def _get_config() -> Dict[str, Any]:
        """获取LLM配置"""
        from ..config_manager import config_manager
        config = config_manager.get_llm_config()
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
    async def _unload_ollama_model(model: str, config: Dict[str, Any]):
        """
        卸载Ollama模型以释放显存和内存
        
        参数:
            model: 模型名称
            config: 配置字典
        """
        try:
            # 检查是否启用自动释放
            auto_unload = config.get('auto_unload', True)
            if not auto_unload:
                return
            
            # 获取base_url
            base_url = config.get('base_url', 'http://localhost:11434')
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
            
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json=payload)
                
        except Exception as e:
            # 释放失败不影响主流程，只记录警告
            from ..server import WARN_PREFIX
            print(f"{WARN_PREFIX} Ollama模型释放失败（不影响结果） | 模型:{model} | 错误:{str(e)[:50]}")

    @staticmethod
    async def expand_prompt(prompt: str, request_id: Optional[str] = None, stream_callback: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
        """
        使用大语言模型扩写提示词，自动判断用户输入语言，并设置大语言模型回答语言。
        支持流式输出以提高响应速度。

        参数:
            prompt: 要扩写的提示词
            request_id: 请求ID
            stream_callback: 流式输出的回调函数

        返回:
            包含扩写结果的字典
        """
        try:
            # 获取配置
            config = LLMService._get_config()
            api_key = config.get('api_key')
            model = config.get('model')
            provider = config.get('provider', 'unknown')
            temperature = config.get('temperature', 0.7)
            top_p = config.get('top_p', 0.9)
            max_tokens = config.get('max_tokens', 2000)

            if not api_key:
                return {"success": False, "error": "请先配置大语言模型 API密钥"}
            if not model:
                return {"success": False, "error": "未配置模型名称"}

            # 从server.py导入颜色常量和前缀
            from ..server import PREFIX, ERROR_PREFIX

            # 获取提供商显示名称
            provider_display_name = LLMService._provider_display_names.get(provider, provider)

            # 检查是否启用直连模式
            bypass_proxy = False
            try:
                from ..config_manager import config_manager as cm
                settings = cm.get_settings()
                bypass_proxy = settings.get('PromptAssistant.Settings.BypassProxy', False)
            except Exception:
                pass
            
            direct_mode_tag = "(直连)" if bypass_proxy else ""

            from ..server import REQUEST_PREFIX
            print(f"{REQUEST_PREFIX} LLM扩写请求{direct_mode_tag} | 服务:{provider_display_name} | ID:{request_id} | 内容:{prompt[:30]}...")

            # 加载系统提示词
            from ..config_manager import config_manager
            system_prompts = config_manager.get_system_prompts()

            if not system_prompts or 'expand_prompts' not in system_prompts:
                return {"success": False, "error": "扩写系统提示词加载失败"}

            # 获取激活的提示词ID
            active_prompt_id = system_prompts.get('active_prompts', {}).get('expand', 'expand_default')

            # 获取对应的提示词
            if active_prompt_id not in system_prompts['expand_prompts']:
                # 如果找不到激活的提示词，尝试使用第一个可用的提示词
                if len(system_prompts['expand_prompts']) > 0:
                    active_prompt_id = list(system_prompts['expand_prompts'].keys())[0]
                else:
                    return {"success": False, "error": "未找到可用的扩写系统提示词"}

            system_message = system_prompts['expand_prompts'][active_prompt_id]

            # 输出使用的提示词名称
            prompt_name = system_message.get('name', active_prompt_id)
            from ..server import REQUEST_PREFIX
            print(f"{REQUEST_PREFIX} 使用扩写规则：{prompt_name}")

            # 判断用户输入语言
            def is_chinese(text):
                return any('\u4e00' <= char <= '\u9fff' for char in text)
            if is_chinese(prompt):
                lang_message = {"role": "system", "content": "请用中文回答"}
            else:
                lang_message = {"role": "system", "content": "Please answer in English."}

            # 构建消息
            messages = [
                lang_message,
                system_message,
                {"role": "user", "content": prompt}
            ]

            # 使用OpenAI SDK
            client = LLMService.get_openai_client(api_key, provider)
            
            # 添加手动重试机制，处理连接错误
            max_retries = 3
            retry_delay = 1.0  # 初始重试延迟（秒）
            
            for attempt in range(max_retries):
                try:
                    # 添加调试信息
                    _thinking_extra = build_thinking_suppression(provider, model)
                    _thinking_tag = "（已关闭思维链）" if _thinking_extra else ""
                    from ..server import PROCESS_PREFIX
                    if attempt > 0:
                        print(f"{PROCESS_PREFIX} 重试LLM API调用{direct_mode_tag} | 尝试:{attempt + 1}/{max_retries} | 服务:{provider_display_name} | 模型:{model}{_thinking_tag}")
                    else:
                        print(f"{PROCESS_PREFIX} 调用LLM API{direct_mode_tag} | 服务:{provider_display_name} | 模型:{model}{_thinking_tag}")
                    start_time = time.perf_counter()

                    # 兼容不同提供商：将 reasoning_effort 放到顶层，其它参数放入 extra_body
                    extra_args = {}
                    if _thinking_extra:
                        _extra_copy = dict(_thinking_extra)
                        if "reasoning_effort" in _extra_copy:
                            extra_args["reasoning_effort"] = _extra_copy.pop("reasoning_effort")
                        if _extra_copy:
                            extra_args["extra_body"] = _extra_copy

                    # 使用配置中的参数
                    try:
                        stream = await client.chat.completions.create(
                            model=model,
                            messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                            temperature=temperature,
                            top_p=top_p,
                            max_tokens=max_tokens,
                            stream=True,
                            response_format={"type": "text"},
                            **extra_args
                        )
                    except Exception as e_first:
                        # 针对硅基流动返回 "enable_thinking 不支持" 的场景做一次性回退
                        msg = str(e_first).lower()
                        if "enable_thinking" in msg and "not support" in msg:
                            print(f"{PREFIX} 发现 enable_thinking 不被模型支持，移除后重试 | 模型:{model}")
                            stream = await client.chat.completions.create(
                                model=model,
                                messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                                temperature=temperature,
                                top_p=top_p,
                                max_tokens=max_tokens,
                                stream=True,
                                response_format={"type": "text"}
                            )
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
                    print(f"{WARN_PREFIX} LLM API连接失败 | 尝试:{attempt + 1}/{max_retries} | 错误:{str(e)[:100]} | {wait_time:.1f}秒后重试")
                    await asyncio.sleep(wait_time)
                    continue
            
            try:

                full_content = ""
                async for chunk in stream:
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
                print(f"{PREFIX} LLM扩写成功 | 服务:{provider_display_name} | 请求ID:{request_id} | 结果字符数:{len(full_content)} | 耗时:{elapsed_ms}ms")

                # Ollama自动释放显存
                if provider == 'ollama':
                    await LLMService._unload_ollama_model(model, config)

                return {
                    "success": True,
                    "data": {
                        "original": prompt,
                        "expanded": full_content
                    }
                }
            except asyncio.CancelledError:
                print(f"{PREFIX} LLM扩写任务在服务层被取消 | ID:{request_id}")
                return {"success": False, "error": "请求已取消", "cancelled": True}
            except Exception as e:
                return {"success": False, "error": format_api_error(e, provider_display_name)}

        except asyncio.CancelledError:
            from ..server import PREFIX
            print(f"{PREFIX} LLM扩写任务在服务层被取消 | ID:{request_id}")
            return {"success": False, "error": "请求已取消", "cancelled": True}
        except Exception as e:
            # 从server.py导入颜色常量和前缀
            from ..server import ERROR_PREFIX
            print(f"{ERROR_PREFIX} LLM扩写请求失败 | 错误:{str(e)}")
            return {"success": False, "error": str(e)}

    @staticmethod
    async def translate(text: str, from_lang: str = 'auto', to_lang: str = 'zh', request_id: Optional[str] = None, is_auto: bool = False, stream_callback: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
        """
        使用大语言模型翻译文本，自动设置提示词语言和输出语言。
        支持流式输出以提高响应速度。

        参数:
            text: 要翻译的文本
            from_lang: 源语言 (默认为auto自动检测)
            to_lang: 目标语言 (默认为zh中文)
            request_id: 请求ID
            is_auto: 是否为工作流自动翻译
            stream_callback: 流式输出的回调函数

        返回:
            包含翻译结果的字典
        """
        try:
            # 获取配置
            config = LLMService._get_config()
            api_key = config.get('api_key')
            model = config.get('model')
            provider = config.get('provider', 'unknown')
            temperature = config.get('temperature', 0.7)
            top_p = config.get('top_p', 0.9)
            max_tokens = config.get('max_tokens', 2000)

            if not api_key:
                return {"success": False, "error": "请先配置大语言模型 API密钥"}
            if not model:
                return {"success": False, "error": "未配置模型名称"}

            # 从server.py导入颜色常量和前缀
            from ..server import PREFIX, AUTO_TRANSLATE_PREFIX

            # 获取提供商显示名称
            provider_display_name = LLMService._provider_display_names.get(provider, provider)

            # 检查是否启用直连模式
            bypass_proxy = False
            try:
                from ..config_manager import config_manager as cm
                settings = cm.get_settings()
                bypass_proxy = settings.get('PromptAssistant.Settings.BypassProxy', False)
            except Exception:
                pass
            
            direct_mode_tag = "(直连)" if bypass_proxy else ""

            # 使用统一的前缀（请求阶段使用蓝色）
            from ..server import AUTO_TRANSLATE_REQUEST_PREFIX, REQUEST_PREFIX
            prefix = AUTO_TRANSLATE_REQUEST_PREFIX if is_auto else REQUEST_PREFIX
            print(f"{prefix} {'工作流自动翻译' if is_auto else '翻译请求'}{direct_mode_tag} | 服务:{provider_display_name}翻译 | 请求ID:{request_id} | 原文长度:{len(text)} | 方向:{from_lang}->{to_lang}")

            # 加载系统提示词
            from ..config_manager import config_manager
            system_prompts = config_manager.get_system_prompts()

            if not system_prompts or 'translate_prompts' not in system_prompts or 'ZH' not in system_prompts['translate_prompts']:
                return {"success": False, "error": "翻译系统提示词加载失败"}

            system_message = system_prompts['translate_prompts']['ZH']

            # 动态替换提示词中的{src_lang}和{dst_lang}
            lang_map = {'zh': '中文', 'en': '英文', 'auto': '原文'}
            src_lang = lang_map.get(from_lang, from_lang)
            dst_lang = lang_map.get(to_lang, to_lang)
            sys_msg_content = system_message['content'].replace('{src_lang}', src_lang).replace('{dst_lang}', dst_lang)
            sys_msg = {"role": "system", "content": sys_msg_content}

            # 设置输出语言
            if to_lang == 'en':
                lang_message = {"role": "system", "content": "Please answer in English."}
            else:
                lang_message = {"role": "system", "content": "请用中文回答"}

            # 构建消息
            messages = [
                lang_message,
                sys_msg,
                {"role": "user", "content": text}
            ]

            # 使用OpenAI SDK
            client = LLMService.get_openai_client(api_key, provider)
            
            # 添加手动重试机制，处理连接错误
            max_retries = 3
            retry_delay = 1.0  # 初始重试延迟（秒）
            
            for attempt in range(max_retries):
                try:
                    # 添加调试信息
                    _thinking_extra = build_thinking_suppression(provider, model)
                    _thinking_tag = "（已关闭思维链）" if _thinking_extra else ""
                    from ..server import PROCESS_PREFIX
                    if attempt > 0:
                        print(f"{PROCESS_PREFIX} 重试LLM API调用{direct_mode_tag} | 尝试:{attempt + 1}/{max_retries} | 服务:{provider_display_name} | 模型:{model}{_thinking_tag}")
                    else:
                        print(f"{PROCESS_PREFIX} 调用LLM API{direct_mode_tag} | 服务:{provider_display_name} | 模型:{model}{_thinking_tag}")
                    start_time = time.perf_counter()

                    # 兼容不同提供商：将 reasoning_effort 放到顶层，其它参数放入 extra_body
                    extra_args = {}
                    if _thinking_extra:
                        _extra_copy = dict(_thinking_extra)
                        if "reasoning_effort" in _extra_copy:
                            extra_args["reasoning_effort"] = _extra_copy.pop("reasoning_effort")
                        if _extra_copy:
                            extra_args["extra_body"] = _extra_copy

                    # 使用配置中的参数
                    try:
                        stream = await client.chat.completions.create(
                            model=model,
                            messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                            temperature=temperature,
                            top_p=top_p,
                            max_tokens=max_tokens,
                            stream=True,
                            response_format={"type": "text"},
                            **extra_args
                        )
                    except Exception as e_first:
                        msg = str(e_first).lower()
                        if "enable_thinking" in msg and "not support" in msg:
                            print(f"{PREFIX} 发现 enable_thinking 不被模型支持，移除后重试 | 模型:{model}")
                            stream = await client.chat.completions.create(
                                model=model,
                                messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                                temperature=temperature,
                                top_p=top_p,
                                max_tokens=max_tokens,
                                stream=True,
                                response_format={"type": "text"}
                            )
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
                    print(f"{WARN_PREFIX} LLM API连接失败 | 尝试:{attempt + 1}/{max_retries} | 错误:{str(e)[:100]} | {wait_time:.1f}秒后重试")
                    await asyncio.sleep(wait_time)
                    continue
            
            try:

                full_content = ""
                async for chunk in stream:
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
                prefix = AUTO_TRANSLATE_PREFIX if is_auto else PREFIX
                elapsed_ms = int((time.perf_counter() - start_time) * 1000)
                print(f"{prefix} {'工作流翻译完成' if is_auto else '翻译完成'} | 服务:{provider_display_name}翻译 | 请求ID:{request_id} | 结果字符数:{len(full_content)} | 耗时:{elapsed_ms}ms")

                # Ollama自动释放显存
                if provider == 'ollama':
                    await LLMService._unload_ollama_model(model, config)

                return {
                    "success": True,
                    "data": {
                        "from": from_lang,
                        "to": to_lang,
                        "original": text,
                        "translated": full_content
                    }
                }
            except asyncio.CancelledError:
                print(f"{prefix} {'工作流翻译' if is_auto else '翻译'}任务在服务层被取消 | ID:{request_id}")
                return {"success": False, "error": "请求已取消", "cancelled": True}
            except Exception as e:
                return {"success": False, "error": format_api_error(e, provider_display_name)}

        except asyncio.CancelledError:
            from ..server import PREFIX, AUTO_TRANSLATE_PREFIX
            prefix = AUTO_TRANSLATE_PREFIX if is_auto else PREFIX
            print(f"{prefix} {'工作流翻译' if is_auto else '翻译'}任务在服务层被取消 | ID:{request_id}")
            return {"success": False, "error": "请求已取消", "cancelled": True}
        except Exception as e:
            return {"success": False, "error": str(e)}