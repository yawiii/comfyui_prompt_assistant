import json
import os
import base64
from io import BytesIO
from PIL import Image
from typing import Optional, Dict, Any, List, Callable
import asyncio
from openai import AsyncOpenAI
import httpx
from .error_util import format_api_error

class VisionService:
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
            config = config_manager.get_vision_config()
            if 'providers' in config and 'custom' in config['providers']:
                base_url = config['providers']['custom'].get('base_url')
                # 确保base_url不以/chat/completions结尾，避免路径重复
                if base_url and base_url.endswith('/chat/completions'):
                    base_url = base_url.rstrip('/chat/completions')
        else:
            base_url = cls._provider_base_urls.get(provider)
        
        # 创建简化的httpx客户端，不使用HTTP/2，避免额外依赖
        # 视觉模型需要较长的超时时间
        http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0)  # 视觉模型需要更长的超时时间
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
                'api_key': provider_config.get('api_key', '')
            }
        else:
            # 兼容旧版配置格式
            return config

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
        from ..server import PREFIX
        
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
                
                # 记录日志
                print(f"{PREFIX} 图像预处理 | 请求ID:{request_id} | 原始尺寸:{original_size} | "
                      f"处理后尺寸:{img.size} | 压缩率:{compression_ratio:.1f}% | "
                      f"原始大小:{original_bytes/1024:.1f}KB | 压缩后:{compressed_size/1024:.1f}KB")
                
                return processed_image_data
            
            # 如果不是base64编码的图像数据，直接返回
            return image_data
            
        except Exception as e:
            from ..server import WARN_PREFIX
            print(f"{WARN_PREFIX} 图像预处理失败 | 请求ID:{request_id} | 错误:{str(e)}")
            # 预处理失败时返回原始图像数据
            return image_data

    @staticmethod
    async def analyze_image(image_data: str, request_id: Optional[str] = None, lang: str = 'zh', 
                          stream_callback: Optional[Callable[[str], None]] = None,
                          custom_prompt: Optional[str] = None,
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
            else:
                # 使用默认配置
                config = VisionService._get_config()
                api_key = config.get('api_key')
                model = config.get('model')
                provider = config.get('provider', 'unknown')
            
            if not api_key:
                return {"success": False, "error": "请先配置视觉模型API密钥"}
            if not model:
                return {"success": False, "error": "未配置视觉模型名称"}
                
            # 检查图片数据格式
            if not image_data:
                return {"success": False, "error": "未提供图像数据"}
                
            # 处理图像数据格式
            if not image_data.startswith('data:image'):
                # 尝试添加前缀
                image_data = f"data:image/jpeg;base64,{image_data}"
            
            # 预处理图像数据（压缩和调整大小）
            image_data = VisionService.preprocess_image(image_data, request_id)
                
            # 获取提供商显示名称
            provider_display_name = {
                'zhipu': '智谱',
                'siliconflow': '硅基流动',
                'openai': 'OpenAI',
                'custom': '自定义'
            }.get(provider, provider)
            
            # 获取系统提示词
            system_prompt = None
            
            # 如果提供了自定义提示词，直接使用
            if custom_prompt:
                system_prompt = custom_prompt
                print(f"{PREFIX} 使用自定义反推提示词")
            else:
                # 否则从配置中获取
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()
                
                if not system_prompts or 'vision_prompts' not in system_prompts:
                    return {"success": False, "error": "视觉系统提示词加载失败"}
                
                # 根据语言选择相应的激活提示词ID
                active_prompt_key = 'vision_zh' if lang == 'zh' else 'vision_en'
                active_prompt_id = system_prompts.get('active_prompts', {}).get(active_prompt_key)
                
                # 如果没有找到激活的提示词ID，使用默认值
                if not active_prompt_id:
                    active_prompt_id = f"{active_prompt_key}_default"
                
                # 获取对应的提示词
                if active_prompt_id in system_prompts['vision_prompts']:
                    prompt_data = system_prompts['vision_prompts'][active_prompt_id]
                    system_prompt = prompt_data['content']
                    prompt_name = prompt_data.get('name', active_prompt_id)
                    print(f"{PREFIX} 使用{lang}反推提示词: {prompt_name} | ID:{active_prompt_id}")
                else:
                    # 如果找不到激活的提示词，尝试使用任何可用的提示词
                    available_prompts = {k: v for k, v in system_prompts['vision_prompts'].items() 
                                        if k.startswith(f"vision_{lang}")}
                    
                    if available_prompts:
                        first_key = list(available_prompts.keys())[0]
                        prompt_data = available_prompts[first_key]
                        system_prompt = prompt_data['content']
                        prompt_name = prompt_data.get('name', first_key)
                        print(f"{PREFIX} 使用备选{lang}反推提示词: {prompt_name} | ID:{first_key}")
                    else:
                        # 实在没有合适的提示词，使用默认提示词
                        system_prompt = "请详细描述这张图片的内容" if lang == 'zh' else "Please describe this image in detail."
                        print(f"{PREFIX} 未找到合适的{lang}反推提示词，使用默认提示词")
            
            # 发送请求
            print(f"{PREFIX} 调用视觉模型 | 服务:{provider_display_name} | 请求ID:{request_id} | 模型:{model}")
            
            # 使用OpenAI SDK
            client = VisionService.get_openai_client(api_key, provider)
            try:
                # 添加调试信息
                print(f"{PREFIX} 调用视觉模型API | 服务:{provider_display_name} | 模型:{model}")
                
                # 设置优化参数
                response = await client.chat.completions.create(
                    model=model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": system_prompt},
                            {"type": "image_url", "image_url": {"url": image_data}}
                        ]
                    }],
                    max_tokens=1000,
                    temperature=0.2,
                    stream=True,
                    # 添加响应格式参数，减少不必要的token
                    response_format={"type": "text"}
                )
                
                full_content = ""
                async for chunk in response:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_content += content
                        if stream_callback:
                            stream_callback(content)
                
                # 输出结构化成功日志
                print(f"{PREFIX} 视觉模型分析成功 | 服务:{provider_display_name} | 请求ID:{request_id} | 结果字符数:{len(full_content)}")
                
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