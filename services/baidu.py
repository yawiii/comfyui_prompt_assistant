import random
import aiohttp
from hashlib import md5
import json
import time
import re
from typing import Optional, Dict, Any, List
import asyncio
from .error_util import BAIDU_ERROR_CODE_MESSAGES

class BaiduTranslateService:
    @staticmethod
    def split_text_by_paragraphs(text, max_length=2000):
        """
        按段落分割文本，处理长文本翻译
        使用正则表达式匹配连续的换行符，与JavaScript版本保持一致
        """
        if not text:
            return []

        # 保留原始的换行符，用于后续恢复格式
        # 先将文本按换行符分割为行
        lines = text.split('\n')
        chunks = []
        current_chunk = ""
        
        for line in lines:
            # 如果当前行本身超过最大长度，需要再次分割
            if len(line) > max_length:
                # 如果current_chunk不为空，先添加到chunks
                if current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = ""
                
                # 分割长行
                remaining_text = line
                while len(remaining_text) > 0:
                    chunk_text = remaining_text[:max_length]
                    chunks.append(chunk_text)
                    remaining_text = remaining_text[max_length:]
            # 如果添加当前行会超出长度限制，先保存当前chunk
            elif current_chunk and (len(current_chunk) + len(line) + 1 > max_length):
                chunks.append(current_chunk)
                current_chunk = line
            # 否则，添加到当前chunk
            else:
                if current_chunk:
                    current_chunk += "\n" + line
                else:
                    current_chunk = line
        
        # 添加最后一个chunk
        if current_chunk:
            chunks.append(current_chunk)
        
        return chunks

    @staticmethod
    async def translate_chunk(session, chunk, app_id, secret_key, from_lang, to_lang, retry_count=1):
        """
        异步翻译单个文本块，带重试机制
        """
        for attempt in range(retry_count):
            try:
                # 生成签名
                salt = random.randint(32768, 65536)
                sign = md5((app_id + chunk + str(salt) + secret_key).encode('utf-8')).hexdigest()
                
                # 构建请求
                url = 'https://fanyi-api.baidu.com/api/trans/vip/translate'
                params = {
                    'q': chunk,
                    'from': from_lang,
                    'to': to_lang,
                    'appid': app_id,
                    'salt': salt,
                    'sign': sign
                }
                
                # 发送异步请求
                async with session.post(url, data=params, timeout=10) as response:
                    if response.status != 200:
                        if attempt < retry_count - 1:
                            await asyncio.sleep(1)
                            continue
                        raise Exception(f"百度: HTTP请求失败，状态码: {response.status}")

                    result = await response.json()
                
                    # 检查错误
                    if 'error_code' in result:
                        error_code = result['error_code']
                        error_message = BAIDU_ERROR_CODE_MESSAGES.get(
                            error_code, 
                            f"未知错误(错误码:{error_code})"
                        )
                        
                        # 某些错误码可以重试
                        if error_code in ['54003', '52001', '52002'] and attempt < retry_count - 1:
                            await asyncio.sleep(1)
                            continue
                            
                        raise Exception(f"百度: {error_message}")

                    # 处理翻译结果
                    if 'trans_result' in result and result['trans_result']:
                        translated_parts = [item['dst'] for item in result['trans_result']]
                        return '\n'.join(translated_parts)
                    else:
                        raise Exception("百度: 翻译结果为空")
                        
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if attempt < retry_count - 1:
                    print(f"百度翻译请求遇到网络错误，尝试重试 ({attempt+1}/{retry_count}): {e}")
                    await asyncio.sleep(1)
                else:
                    raise Exception(f"百度: 网络请求失败，请检查网络连接或稍后再试 ({type(e).__name__})")
            except Exception as e:
                if attempt < retry_count - 1:
                    await asyncio.sleep(1)
                else:
                    if str(e).startswith("百度:"):
                        raise e
                    else:
                        raise Exception(f"百度: 翻译过程中发生未知错误 ({type(e).__name__})")
                    
        raise Exception("百度: 超过最大重试次数")

    @staticmethod
    async def translate(text, from_lang='auto', to_lang='zh', request_id=None, is_auto=False):
        """
        异步调用百度翻译API进行翻译
        """
        try:
            request_id = request_id or f"baidu_trans_{int(time.time())}_{random.randint(1000, 9999)}"
            
            if not text or text.strip() == '':
                return {"success": False, "error": "百度: 待翻译文本不能为空"}
            
            from ..config_manager import config_manager
            config = config_manager.get_baidu_translate_config()
            
            app_id = config.get('app_id')
            secret_key = config.get('secret_key')
            
            if not app_id or not secret_key:
                return {"success": False, "error": "百度: 请先配置百度翻译API的APP_ID和SECRET_KEY"}

            from ..server import PREFIX, AUTO_TRANSLATE_PREFIX

            # 请求阶段：蓝色
            # 百度翻译始终使用直连模式（trust_env=False）
            from ..server import AUTO_TRANSLATE_REQUEST_PREFIX, REQUEST_PREFIX
            prefix = AUTO_TRANSLATE_REQUEST_PREFIX if is_auto else REQUEST_PREFIX
            print(f"{prefix} {'工作流自动翻译' if is_auto else '翻译请求'}(直连) | 服务:百度翻译 | 请求ID:{request_id} | 原文长度:{len(text)} | 方向:{from_lang}->{to_lang}")

            text_chunks = BaiduTranslateService.split_text_by_paragraphs(text)
            if not text_chunks:
                text_chunks = [text]

            translated_parts = []
            
            # 创建一个禁用SSL证书验证的连接器
            connector = aiohttp.TCPConnector(ssl=False)
            # 创建 aiohttp.ClientSession，并禁用代理和SSL验证
            async with aiohttp.ClientSession(connector=connector, trust_env=False) as session:
                for i, chunk in enumerate(text_chunks):
                    try:
                        chunk_translation = await BaiduTranslateService.translate_chunk(
                            session, chunk, app_id, secret_key, from_lang, to_lang
                        )
                        translated_parts.append(chunk_translation)

                        if i < len(text_chunks) - 1:
                            await asyncio.sleep(1)

                    except Exception as chunk_error:
                        return {"success": False, "error": str(chunk_error)}
            
            translated_text = '\n'.join(translated_parts)
            # 结果阶段：绿色
            prefix = AUTO_TRANSLATE_PREFIX if is_auto else PREFIX
            print(f"{prefix} {'工作流翻译完成' if is_auto else '翻译完成'} | 服务:百度翻译 | 请求ID:{request_id} | 结果字符数:{len(translated_text)}")

            return {
                "success": True,
                "data": {
                    "translated": translated_text,
                    "from": from_lang,
                    "to": to_lang,
                    "original": text
                }
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @staticmethod
    async def batch_translate(texts, from_lang='auto', to_lang='zh'):
        """
        异步批量翻译文本
        """
        tasks = [BaiduTranslateService.translate(text, from_lang, to_lang) for text in texts]
        return await asyncio.gather(*tasks) 