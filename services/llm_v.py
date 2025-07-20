import aiohttp
import json
import os
import base64
from io import BytesIO
from PIL import Image

class LLMVisionService:
    @staticmethod
    async def _make_request(url, headers, json_data):
        """
        统一处理异步请求
        """
        async with aiohttp.ClientSession(trust_env=True) as session:
            try:
                # 默认使用系统代理 (trust_env=True)
                async with session.post(url, headers=headers, json=json_data, timeout=30) as response:
                    response.raise_for_status()
                    return await response.json()
            except aiohttp.ClientProxyConnectionError as e:
                # 代理连接错误时，可以添加更明确的日志或处理
                print(f"代理连接错误: {str(e)}。请检查您的系统代理设置。")
                raise e # 重新抛出异常，让上层处理
            except Exception as e:
                raise e
    
    @staticmethod
    async def analyze_image(image_data, request_id=None, lang='zh'):
        """
        使用GLM-4V分析图像 (异步)
        """
        try:
            # 获取配置
            from ..config_manager import config_manager
            config = config_manager.get_llm_config()
            
            api_key = config.get('api_key')
            base_url = config.get('base_url')
            vision_model = config.get('vision_model')

            if not api_key:
                return {"success": False, "error": "请先配置LLM API密钥"}
            if not base_url or not vision_model:
                return {"success": False, "error": "LLM配置不完整 (base_url 或 vision_model 未配置)"}
            
            # 加载系统提示词
            def load_system_prompts():
                # 获取当前目录
                current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                # 构建提示词文件路径
                prompts_path = os.path.join(current_dir, "js", "config", "system_prompts.json")
                
                if not os.path.exists(prompts_path):
                    raise Exception(f"系统提示词配置文件不存在: {prompts_path}")
                
                # 从文件加载提示词
                with open(prompts_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            
            # 获取系统提示词
            system_prompts = load_system_prompts()
            if not system_prompts or 'vision_prompts' not in system_prompts:
                return {"success": False, "error": "视觉系统提示词加载失败"}
            
            # 获取对应语言的提示词
            lang_key = lang.upper()
            if lang_key not in system_prompts['vision_prompts']:
                return {"success": False, "error": f"未找到语言 {lang} 的提示词配置"}
            
            prompt_text = system_prompts['vision_prompts'][lang_key]['content']
            
            # 处理图像数据
            try:
                if isinstance(image_data, str):
                    if image_data.startswith('data:image'):
                        # 处理Base64字符串
                        image_base64 = image_data.split(',')[1]
                    else:
                        # 如果是普通字符串，假设它已经是base64编码
                        image_base64 = image_data
                elif isinstance(image_data, bytes):
                    # 处理字节数据
                    image_base64 = base64.b64encode(image_data).decode('utf-8')
                elif isinstance(image_data, Image.Image):
                    # 处理PIL图像对象
                    buffer = BytesIO()
                    image_data.save(buffer, format="JPEG")
                    image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                elif hasattr(image_data, 'read'):
                    # 处理文件对象
                    image_base64 = base64.b64encode(image_data.read()).decode('utf-8')
                else:
                    return {"success": False, "error": f"不支持的图像数据格式: {type(image_data).__name__}"}
                
                # 验证Base64数据
                if not image_base64:
                    return {"success": False, "error": "Base64数据为空"}
                
                # 尝试解码Base64数据以验证其有效性
                try:
                    base64.b64decode(image_base64)
                except Exception as e:
                    return {"success": False, "error": f"无效的Base64数据: {str(e)}"}
                
            except Exception as e:
                return {"success": False, "error": f"图像数据处理失败: {str(e)}"}
            
            # 构建请求
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            }
            
            messages = [{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt_text
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_base64}"
                        }
                    }
                ]
            }]
            
            data = {
                "model": vision_model,
                "messages": messages,
                "request_id": request_id or f"vision_{hash(image_base64[:100])}"
            }
            
            result = await LLMVisionService._make_request(base_url, headers, data)
            
            # 检查错误
            if 'error' in result:
                return {"success": False, "error": result['error'].get('message', '图像分析请求失败')}
            
            # 处理结果
            if 'choices' not in result or not result['choices'] or 'message' not in result['choices'][0]:
                return {"success": False, "error": "GLM-4V响应格式错误: 缺少choices/message字段"}
                
            description = result['choices'][0]['message']['content']
            
            return {
                "success": True,
                "data": {
                    "description": description
                }
            }
            
        except Exception as e:
            return {"success": False, "error": f"图像分析过程异常: {str(e)}"} 