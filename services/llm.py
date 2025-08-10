import json
import os
import sys
from typing import Optional, Dict, Any, List, Callable
import asyncio
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion
import httpx
from .error_util import format_api_error

class LLMService:
    _provider_base_urls = {
        'openai': None,  # 使用默认
        'siliconflow': 'https://api.siliconflow.cn/v1',
        'zhipu': 'https://open.bigmodel.cn/api/paas/v4',
        'custom': None  # 使用配置中的自定义URL
    }

    @classmethod
    def get_openai_client(cls, api_key: str, provider: str) -> AsyncOpenAI:
        """获取OpenAI客户端"""
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
                    base_url = base_url.rstrip('/chat/completions')
        else:
            base_url = cls._provider_base_urls.get(provider)
        
        # 创建简化的httpx客户端，不使用HTTP/2，避免额外依赖
        http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0)  # 设置超时时间，稍微增加以适应网络延迟
        )
        
        kwargs = {
            "api_key": api_key,
            "http_client": http_client,
            "max_retries": 2  # 设置最大重试次数
        }
        if base_url:
            # 确保base_url末尾没有斜杠
            base_url = base_url.rstrip('/')
            kwargs["base_url"] = base_url
            
            # 添加调试日志
            from ..server import PREFIX
            print(f"{PREFIX} 创建OpenAI客户端 | 提供商:{provider} | 基础URL:{base_url}")
            
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
                'api_key': provider_config.get('api_key', '')
            }
        else:
            # 兼容旧版配置格式
            return config
    
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
            
            if not api_key:
                return {"success": False, "error": "请先配置大语言模型 API密钥"}
            if not model:
                return {"success": False, "error": "未配置模型名称"}

            # 从server.py导入颜色常量和前缀
            from ..server import PREFIX, ERROR_PREFIX
            
            # 获取提供商显示名称
            provider_display_name = {
                'zhipu': '智谱',
                'siliconflow': '硅基流动',
                'openai': 'OpenAI',
                'custom': '自定义'
            }.get(provider, provider)
            
            print(f"{PREFIX} LLM扩写请求 | 服务:{provider_display_name} | ID:{request_id} | 内容:{prompt[:30]}...")

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
            print(f"{PREFIX} 使用扩写提示词: {prompt_name} | ID:{active_prompt_id}")

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
            try:
                # 添加调试信息
                print(f"{PREFIX} 调用LLM API | 服务:{provider_display_name} | 模型:{model}")
                
                # 设置优化参数
                stream = await client.chat.completions.create(
                    model=model,
                    messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                    temperature=0.3,
                    top_p=0.5,
                    max_tokens=1500,
                    stream=True,
                    # 添加响应格式参数，减少不必要的token
                    response_format={"type": "text"}
                )
                
                full_content = ""
                async for chunk in stream:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_content += content
                        if stream_callback:
                            stream_callback(content)
                
                # 输出结构化成功日志
                print(f"{PREFIX} LLM扩写成功 | 服务:{provider_display_name} | 请求ID:{request_id} | 结果字符数:{len(full_content)}")
                
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
            
            if not api_key:
                return {"success": False, "error": "请先配置大语言模型 API密钥"}
            if not model:
                return {"success": False, "error": "未配置模型名称"}

            # 从server.py导入颜色常量和前缀
            from ..server import PREFIX, AUTO_TRANSLATE_PREFIX
            
            # 获取提供商显示名称
            provider_display_name = {
                'zhipu': '智谱',
                'siliconflow': '硅基流动',
                'openai': 'OpenAI',
                'custom': '自定义'
            }.get(provider, provider)
            
            # 使用统一的前缀
            prefix = AUTO_TRANSLATE_PREFIX if is_auto else PREFIX
            print(f"{prefix} {'工作流自动翻译' if is_auto else '翻译请求'} | 服务:{provider_display_name}翻译 | 请求ID:{request_id} | 原文长度:{len(text)} | 方向:{from_lang}->{to_lang}")

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
            try:
                # 添加调试信息
                print(f"{PREFIX} 调用LLM API | 服务:{provider_display_name} | 模型:{model}")
                
                # 设置优化参数
                stream = await client.chat.completions.create(
                    model=model,
                    messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                    temperature=0.5,
                    top_p=0.5,
                    max_tokens=1500,
                    stream=True,
                    # 添加响应格式参数，减少不必要的token
                    response_format={"type": "text"}
                )
                
                full_content = ""
                async for chunk in stream:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_content += content
                        if stream_callback:
                            stream_callback(content)
                
                # 输出结构化成功日志
                prefix = AUTO_TRANSLATE_PREFIX if is_auto else PREFIX
                print(f"{prefix} {'工作流翻译完成' if is_auto else '翻译完成'} | 服务:{provider_display_name}翻译 | 请求ID:{request_id} | 结果字符数:{len(full_content)}")
                
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