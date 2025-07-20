import aiohttp
import json
import os
import sys

class LLMService:
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
    async def expand_prompt(prompt, request_id=None):
        """
        使用GLM-4扩写提示词（异步）
        """
        try:
            # 校验输入
            if not prompt or not prompt.strip():
                return {"success": False, "error": "扩写内容不能为空"}

            # 获取配置
            from ..config_manager import config_manager
            config = config_manager.get_llm_config()
            api_key = config.get('api_key')
            base_url = config.get('base_url')
            model = config.get('model')

            if not api_key:
                return {"success": False, "error": "请先配置LLM API密钥"}
            if not base_url or not model:
                return {"success": False, "error": "LLM配置不完整 (base_url 或 model 未配置)"}

            # 加载系统提示词
            def load_system_prompts():
                current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                prompts_path = os.path.join(current_dir, "js", "config", "system_prompts.json")
                if not os.path.exists(prompts_path):
                    raise Exception(f"系统提示词配置文件不存在: {prompts_path}")
                with open(prompts_path, "r", encoding="utf-8") as f:
                    return json.load(f)

            # 获取系统提示词（只保留ZH）
            system_prompts = load_system_prompts()
            if not system_prompts or 'expand_prompts' not in system_prompts or 'ZH' not in system_prompts['expand_prompts']:
                return {"success": False, "error": "扩写系统提示词加载失败"}
            system_message = system_prompts['expand_prompts']['ZH']

            # 判断用户输入语言
            def is_chinese(text):
                return any('\u4e00' <= char <= '\u9fff' for char in text)
            if is_chinese(prompt):
                lang_message = {"role": "system", "content": "请用中文回答"}
            else:
                lang_message = {"role": "system", "content": "Please answer in English."}

            # 构建请求
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            }
            messages = [
                lang_message,
                system_message,
                {"role": "user", "content": prompt}
            ]
            data = {
                "model": model,
                "messages": messages,
                "temperature": 0.3,
                "top_p": 0.5,
                "max_tokens": 1500
            }
            
            result = await LLMService._make_request(base_url, headers, data)
            
            if 'error' in result:
                return {"success": False, "error": result['error'].get('message', '扩写请求失败')}
            
            expanded_text = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()

            if not expanded_text:
                return {"success": False, "error": "模型返回了空内容，请检查输入或更换模型"}

            return {
                "success": True,
                "data": {
                    "original": prompt,
                    "expanded": expanded_text
                }
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @staticmethod
    async def translate(text, from_lang='auto', to_lang='zh', request_id=None):
        """
        使用GLM-4翻译文本（异步）
        """
        try:
            # 校验输入
            if not text or not text.strip():
                return {"success": False, "error": "翻译内容不能为空"}

            # 获取配置
            from ..config_manager import config_manager
            config = config_manager.get_llm_config()
            api_key = config.get('api_key')
            base_url = config.get('base_url')
            model = config.get('model')

            if not api_key:
                return {"success": False, "error": "请先配置LLM API密钥"}
            if not base_url or not model:
                return {"success": False, "error": "LLM配置不完整 (base_url 或 model 未配置)"}

            # 加载系统提示词
            def load_system_prompts():
                current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                prompts_path = os.path.join(current_dir, "js", "config", "system_prompts.json")
                if not os.path.exists(prompts_path):
                    raise Exception(f"系统提示词配置文件不存在: {prompts_path}")
                with open(prompts_path, "r", encoding="utf-8") as f:
                    return json.load(f)

            # 获取系统提示词（只保留ZH）
            system_prompts = load_system_prompts()
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

            # 构建请求
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            }
            messages = [
                lang_message,
                sys_msg,
                {"role": "user", "content": text}
            ]
            data = {
                "model": model,
                "messages": messages,
                "temperature": 0.5,
                "top_p": 0.5,
                "max_tokens": 1500
            }
            
            result = await LLMService._make_request(base_url, headers, data)
            
            if 'error' in result:
                return {"success": False, "error": result['error'].get('message', '翻译请求失败')}
            
            translated_text = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()

            if not translated_text:
                return {"success": False, "error": "模型返回了空内容，请检查输入或更换模型"}

            return {
                "success": True,
                "data": {
                    "from": from_lang,
                    "to": to_lang,
                    "original": text,
                    "translated": translated_text
                }
            }
        except Exception as e:
            return {"success": False, "error": str(e)} 