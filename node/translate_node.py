import asyncio
import random
import re
import time
import threading
import hashlib

import torch
from comfy.model_management import InterruptProcessingException

from ..services.llm import LLMService
from ..services.baidu import BaiduTranslateService
from ..services.error_util import format_api_error


# 定义ANSI颜色代码常量
GREEN = "\033[92m"
RESET = "\033[0m"


class PromptTranslate:
    """
    文本翻译节点
    自动识别输入语言并翻译成目标语言，支持多种翻译服务
    """
    # 定义日志前缀（带绿色）
    LOG_PREFIX = f"{GREEN}[PromptAssistant]{RESET}"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "原文": ("STRING", {"forceInput": True, "default": "", "multiline": True, "placeholder": "输入要翻译的文本..."}),
                "目标语言": (["英文", "中文"], {"default": "英文"}),
                "翻译服务": (["百度翻译", "智谱翻译", "硅基流动翻译", "302.AI翻译", "Ollama翻译", "自定义翻译"], {"default": "百度翻译"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("翻译输出",)
    FUNCTION = "translate"
    CATEGORY = "✨提示词小助手"
    OUTPUT_NODE = False
    
    @classmethod
    def IS_CHANGED(cls, 原文, 目标语言, 翻译服务):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 计算文本的哈希值
        text_hash = ""
        if 原文:
            # 使用hashlib计算文本的哈希值，更安全和一致
            text_hash = hashlib.md5(原文.encode('utf-8')).hexdigest()

        # 组合所有输入的哈希值
        input_hash = hash((
            text_hash,
            目标语言,
            翻译服务
        ))

        return input_hash

    def _contains_chinese(self, text: str) -> bool:
        """检查文本是否包含中文字符"""
        if not text:
            return False
        return bool(re.search('[\u4e00-\u9fa5]', text))

    def _detect_language(self, text: str) -> str:
        """自动检测文本语言"""
        if not text:
            return "auto"

        # 检查是否为纯英文 (只包含ASCII可打印字符)
        is_pure_english = bool(re.fullmatch(r'[ -~]+', text))
        # 检查是否包含中文字符
        contains_chinese = self._contains_chinese(text)

        if contains_chinese:
            return "zh"
        elif is_pure_english:
            return "en"
        else:
            return "auto"
    
    def translate(self, 原文, 目标语言, 翻译服务):
        """
        翻译文本函数

        Args:
            原文: 输入的文本
            目标语言: 目标语言 ("英文", "中文")
            翻译服务: 翻译服务 ("百度翻译", "智谱翻译")

        Returns:
            tuple: 翻译结果
        """
        try:
            # 检查输入
            if not 原文 or not 原文.strip():
                return ("",)

            # 自动检测源语言
            detected_lang = self._detect_language(原文)
            to_lang = "en" if 目标语言 == "英文" else "zh"

            # 智能跳过翻译逻辑
            skip_translation = False
            if to_lang == 'en' and detected_lang == 'en':
                print(f"{self.LOG_PREFIX} 检测到英文输入，目标为英文，无需翻译。")
                skip_translation = True
            elif to_lang == 'zh' and detected_lang == 'zh':
                print(f"{self.LOG_PREFIX} 检测到中文输入，目标为中文，无需翻译。")
                skip_translation = True

            if skip_translation:
                return (原文,)

            # 执行翻译
            print(f"{self.LOG_PREFIX} 开始翻译: {detected_lang} -> {to_lang}, 服务: {翻译服务}")

            if 翻译服务 == "百度翻译":
                result = self._translate_with_baidu(原文, detected_lang, to_lang)
            elif 翻译服务 == "智谱翻译":
                result = self._translate_with_llm(原文, detected_lang, to_lang, "zhipu")
            elif 翻译服务 == "硅基流动翻译":
                result = self._translate_with_llm(原文, detected_lang, to_lang, "siliconflow")
            elif 翻译服务 == "302.AI翻译":
                result = self._translate_with_llm(原文, detected_lang, to_lang, "302ai")
            elif 翻译服务 == "Ollama翻译":
                result = self._translate_with_llm(原文, detected_lang, to_lang, "ollama")
            elif 翻译服务 == "自定义翻译":
                result = self._translate_with_llm(原文, detected_lang, to_lang, "custom")
            else:
                raise ValueError(f"不支持的翻译服务: {翻译服务}")

            if result and result.get('success'):
                translated_text = result.get('data', {}).get('translated', '').strip()
                if not translated_text:
                    error_msg = 'API返回结果为空，请检查API密钥、模型配置或网络连接'
                    print(f"{self.LOG_PREFIX} 翻译失败: {error_msg}")
                    raise RuntimeError(f"翻译失败: {error_msg}")

                print(f"{self.LOG_PREFIX} 翻译完成，结果长度: {len(translated_text)}")
                return (translated_text,)
            else:
                error_msg = result.get('error', '翻译失败，未知错误') if result else '翻译服务未返回结果'
                print(f"{self.LOG_PREFIX} 翻译失败: {error_msg}")
                raise RuntimeError(f"翻译失败: {error_msg}")

        except InterruptProcessingException:
            print(f"{self.LOG_PREFIX} 翻译任务被用户取消")
            raise
        except Exception as e:
            error_msg = format_api_error(e, 翻译服务)
            print(f"{self.LOG_PREFIX} 翻译异常: {error_msg}")
            raise RuntimeError(f"翻译异常: {error_msg}")

    def _translate_with_baidu(self, text, from_lang, to_lang):
        """使用百度翻译服务"""
        try:
            # 创建请求ID
            request_id = f"translate_{int(time.time())}_{random.randint(1000, 9999)}"
            result_container = {}

            # 在独立线程中运行异步翻译
            thread = threading.Thread(
                target=self._run_async_translation,
                args=(BaiduTranslateService.translate, text, from_lang, to_lang, request_id, result_container)
            )
            thread.start()

            # 等待翻译完成，同时检查中断
            while thread.is_alive():
                # 检查是否被中断 - 这会抛出 InterruptProcessingException
                try:
                    import nodes
                    nodes.before_node_execution()
                except:
                    # 如果检查中断时出现异常，说明被中断了
                    print(f"{self.LOG_PREFIX} 检测到中断信号，正在终止翻译任务...")
                    # 设置结果容器为中断状态，让线程知道要停止
                    result_container['interrupted'] = True
                    # 等待线程结束或超时
                    thread.join(timeout=1.0)
                    if thread.is_alive():
                        print(f"{self.LOG_PREFIX} 翻译线程未能及时响应中断")
                    raise InterruptProcessingException()

                time.sleep(0.1)

            return result_container.get('result')

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _translate_with_llm(self, text, from_lang, to_lang, provider):
        """使用LLM翻译服务"""
        try:
            # 获取配置
            from ..config_manager import config_manager
            provider_config = self._get_provider_config(config_manager, provider)

            if not provider_config:
                provider_display_map = {
                    "zhipu": "智谱翻译",
                    "siliconflow": "硅基流动翻译",
                    "302ai": "302.AI翻译",
                    "ollama": "Ollama翻译",
                    "custom": "自定义翻译"
                }
                provider_display_name = provider_display_map.get(provider, provider)
                return {"success": False, "error": f"未找到{provider_display_name}的配置，请先完成API配置"}

            # 创建请求ID
            request_id = f"translate_{int(time.time())}_{random.randint(1000, 9999)}"
            result_container = {}

            # 在独立线程中运行LLM翻译
            thread = threading.Thread(
                target=self._run_llm_translation,
                args=(text, from_lang, to_lang, request_id, result_container, provider, provider_config)
            )
            thread.start()

            # 等待翻译完成，同时检查中断
            while thread.is_alive():
                # 检查是否被中断 - 这会抛出 InterruptProcessingException
                try:
                    import nodes
                    nodes.before_node_execution()
                except:
                    # 如果检查中断时出现异常，说明被中断了
                    print(f"{self.LOG_PREFIX} 检测到中断信号，正在终止翻译任务...")
                    # 设置结果容器为中断状态，让线程知道要停止
                    result_container['interrupted'] = True
                    # 等待线程结束或超时
                    thread.join(timeout=1.0)
                    if thread.is_alive():
                        print(f"{self.LOG_PREFIX} 翻译线程未能及时响应中断")
                    raise InterruptProcessingException()

                time.sleep(0.1)

            return result_container.get('result')

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _run_async_translation(self, service_func, text, from_lang, to_lang, request_id, result_container, **kwargs):
        """在独立线程中运行异步翻译任务"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            # 检查是否在开始前就被中断了
            if result_container.get('interrupted'):
                result_container['result'] = {"success": False, "error": "任务被中断"}
                return

            result = loop.run_until_complete(
                service_func(text, from_lang, to_lang, request_id, **kwargs)
            )

            # 检查是否在执行过程中被中断了
            if result_container.get('interrupted'):
                result_container['result'] = {"success": False, "error": "任务被中断"}
                return

            result_container['result'] = result
        except Exception as e:
            if result_container.get('interrupted'):
                result_container['result'] = {"success": False, "error": "任务被中断"}
            else:
                result_container['result'] = {"success": False, "error": str(e)}
        finally:
            loop.close()
    
    def _get_provider_config(self, config_manager, provider):
        """获取指定provider的配置"""
        llm_config = config_manager.get_llm_config()
        if 'providers' in llm_config and provider in llm_config['providers']:
            return llm_config['providers'][provider]
        return None

    def _run_llm_translation(self, text, from_lang, to_lang, request_id, result_container, provider, provider_config):
        """在独立线程中运行LLM翻译"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            # 检查是否在开始前就被中断了
            if result_container.get('interrupted'):
                result_container['result'] = {"success": False, "error": "任务被中断"}
                return

            # 获取API密钥和模型
            api_key = provider_config.get('api_key', '')
            model = provider_config.get('model', '')

            if not api_key or not model:
                result_container['result'] = {
                    "success": False,
                    "error": f"请先配置{provider}的API密钥和模型"
                }
                return

            # 创建临时客户端
            client = LLMService.get_openai_client(api_key, provider)

            # 加载系统提示词
            from ..config_manager import config_manager
            system_prompts = config_manager.get_system_prompts()

            if not system_prompts or 'translate_prompts' not in system_prompts or 'ZH' not in system_prompts['translate_prompts']:
                result_container['result'] = {
                    "success": False,
                    "error": "翻译系统提示词加载失败"
                }
                return

            system_message = system_prompts['translate_prompts']['ZH']

            # 动态替换提示词
            lang_map = {'zh': '中文', 'en': '英文', 'auto': '原文'}
            src_lang = lang_map.get(from_lang, from_lang)
            dst_lang = lang_map.get(to_lang, to_lang)
            sys_msg_content = system_message['content'].replace('{src_lang}', src_lang).replace('{dst_lang}', dst_lang)
            sys_msg = {"role": "system", "content": sys_msg_content}

            # 设置输出语言
            lang_message = {"role": "system", "content": "Please answer in English."} if to_lang == 'en' else {"role": "system", "content": "请用中文回答"}

            # 构建消息
            messages = [
                lang_message,
                sys_msg,
                {"role": "user", "content": text}
            ]

            print(f"{PromptTranslate.LOG_PREFIX} 调用{provider}翻译API | 模型:{model}")

            # 调用API
            stream = loop.run_until_complete(client.chat.completions.create(
                model=model,
                messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                temperature=0.5,
                top_p=0.5,
                max_tokens=1500,
                stream=True,
                response_format={"type": "text"}
            ))

            full_content = ""
            async def process_stream():
                nonlocal full_content
                async for chunk in stream:
                    # 检查是否被中断
                    if result_container.get('interrupted'):
                        break
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_content += content

            loop.run_until_complete(process_stream())

            # 检查是否在执行过程中被中断了
            if result_container.get('interrupted'):
                result_container['result'] = {"success": False, "error": "任务被中断"}
                return

            result_container['result'] = {
                "success": True,
                "data": {
                    "from": from_lang,
                    "to": to_lang,
                    "original": text,
                    "translated": full_content
                }
            }
            print(f"{PromptTranslate.LOG_PREFIX} 翻译完成 | 服务:{provider} | 结果字符数:{len(full_content)}")

        except Exception as e:
            # 格式化错误信息
            provider_display_map = {
                "zhipu": "智谱翻译",
                "siliconflow": "硅基流动翻译",
                "302ai": "302.AI翻译",
                "ollama": "Ollama翻译",
                "custom": "自定义翻译"
            }
            provider_display_name = provider_display_map.get(provider, provider)
            error_message = format_api_error(e, provider_display_name)

            result_container['result'] = {
                "success": False,
                "error": error_message
            }
            print(f"{PromptTranslate.LOG_PREFIX} 翻译失败 | 服务:{provider} | 错误:{error_message}")
        finally:
            loop.close()

# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "PromptTranslate": PromptTranslate,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptTranslate": "✨提示词翻译",
}