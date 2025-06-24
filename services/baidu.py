import random
import requests
from hashlib import md5
import json
import time
import re

class BaiduTranslateService:
    # 错误码映射
    ERROR_CODES = {
        '52001': '请求超时，请重试',
        '52002': '系统错误，请重试',
        '52003': '未授权用户，请检查appid是否正确或服务是否开通',
        '54000': '必填参数为空，请检查是否少传参数',
        '54001': '签名错误，请检查您的签名生成方法',
        '54003': '访问频率受限，请降低您的调用频率，或进行身份认证后切换为高级版/尊享版',
        '54004': '账户余额不足，请前往管理控制台充值',
        '54005': '长query请求频繁，请降低长query的发送频率，3s后再试',
        '58000': '客户端IP非法，检查个人资料里填写的IP地址是否正确，可前往开发者信息-基本信息修改',
        '58001': '译文语言方向不支持，检查译文语言是否在语言列表里',
        '58002': '服务当前已关闭，请前往百度管理控制台开启服务',
        '58003': '此IP已被封禁',
        '90107': '认证未通过或未生效，请前往我的认证查看认证进度',
        '20003': '请求内容存在安全风险',
    }

    _session = None  # 类级别的session对象

    @classmethod
    def get_session(cls):
        """获取或创建会话对象"""
        if cls._session is None:
            cls._session = requests.Session()
        return cls._session

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
    def translate_chunk(chunk, app_id, secret_key, from_lang, to_lang, retry_count=3):
        """
        翻译单个文本块，带重试机制
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
                
                # 发送请求
                response = BaiduTranslateService.get_session().post(url, data=params, timeout=10)
                
                if response.status_code != 200:
                    if attempt < retry_count - 1:
                        delay = (attempt + 1) * 2
                        time.sleep(delay)
                        continue
                    raise Exception(f"HTTP请求失败，状态码: {response.status_code}")

                result = response.json()
                
                # 检查错误
                if 'error_code' in result:
                    error_code = result['error_code']
                    error_message = BaiduTranslateService.ERROR_CODES.get(
                        error_code, 
                        f"未知错误(错误码:{error_code})"
                    )
                    
                    # 某些错误码可以重试
                    if error_code in ['54003', '52001', '52002'] and attempt < retry_count - 1:
                        delay = (attempt + 1) * 2
                        time.sleep(delay)
                        continue
                        
                    raise Exception(error_message)

                # 处理翻译结果
                if 'trans_result' in result and result['trans_result']:
                    translated_parts = []
                    for trans_item in result['trans_result']:
                        translated_parts.append(trans_item['dst'])
                    
                    # 合并翻译结果，保持原文的换行格式
                    return '\n'.join(translated_parts)
                else:
                    raise Exception("翻译结果为空")
                    
            except Exception as e:
                if attempt < retry_count - 1:
                    delay = (attempt + 1) * 2
                    time.sleep(delay)
                else:
                    raise e
                    
        raise Exception("超过最大重试次数")

    @staticmethod
    def translate(text, from_lang='auto', to_lang='zh', request_id=None):
        """
        调用百度翻译API进行翻译
        注意：所有的格式处理（包括序号"1."格式保护等）均由前端的promptFormatter.js负责，
        后端只负责原始文本的翻译，不进行格式预处理或后处理。
        """
        try:
            # 使用外部传入的request_id，如果没有则自动生成
            request_id = request_id or f"baidu_trans_{int(time.time())}_{random.randint(1000, 9999)}"
            
            if not text or text.strip() == '':
                return {"success": False, "error": "待翻译文本不能为空"}
            
            # 获取配置
            from ..config_manager import config_manager
            config = config_manager.get_baidu_translate_config()
            
            app_id = config.get('app_id')
            secret_key = config.get('secret_key')
            
            if not app_id or not secret_key:
                return {"success": False, "error": "请先配置百度翻译API的APP_ID和SECRET_KEY"}

            # 处理长文本 - 按段落分割
            text_chunks = BaiduTranslateService.split_text_by_paragraphs(text)
            if not text_chunks:
                text_chunks = [text]

            translated_text = ''
            total_chunks = len(text_chunks)

            # 翻译所有文本块
            for i, chunk in enumerate(text_chunks):
                try:
                    chunk_translation = BaiduTranslateService.translate_chunk(
                        chunk, app_id, secret_key, from_lang, to_lang
                    )
                    translated_text += chunk_translation

                    # 如果不是最后一个块，添加换行符并等待
                    if i < total_chunks - 1:
                        translated_text += '\n'
                        time.sleep(1)  # 避免请求过于频繁

                except Exception as chunk_error:
                    return {"success": False, "error": str(chunk_error)}
            
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
    def batch_translate(texts, from_lang='auto', to_lang='zh'):
        """
        批量翻译文本
        """
        results = []
        for text in texts:
            result = BaiduTranslateService.translate(text, from_lang, to_lang)
            results.append(result)
        return results 