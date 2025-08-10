import asyncio
import random
import re
import time
import threading
import copy
from typing import Dict, Any, List
import hashlib

from server import PromptServer
from ..server import send_toast_notification
from ..services.llm import LLMService
from ..services.baidu import BaiduTranslateService
from ..services.error_util import format_api_error, format_baidu_translate_error
from comfy.model_management import InterruptProcessingException


# 定义ANSI颜色代码常量
GREEN = "\033[92m"
RESET = "\033[0m"


def run_async_translation(service_func, text, from_lang, to_lang, request_id, result_container, **kwargs):
    """
    在一个新的事件循环中运行异步翻译任务
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            service_func(text, from_lang, to_lang, request_id, **kwargs)
        )
        result_container['result'] = result
    finally:
        loop.close()


class PromptTranslate:
    """
    文本翻译节点
    将输入的文本翻译成英文，支持多种翻译服务
    """
    # 定义日志前缀（带绿色）
    LOG_PREFIX = f"{GREEN}[PromptAssistant]{RESET}"
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "原文": ("STRING", {"forceInput": True, "default": ""}),
                "翻译服务": (["百度翻译", "智谱翻译", "硅基流动翻译", "自定义"], {}),
                "输出语言": (["英文", "中文"], {"default": "英文"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "client_id": "CLIENT_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("翻译输出",)
    FUNCTION = "translate"
    CATEGORY = "✨提示词小助手"
    OUTPUT_NODE = True
    
    def _contains_chinese(self, text: str) -> bool:
        """检查文本是否包含中文字符"""
        if not text:
            return False
        return bool(re.search('[\u4e00-\u9fa5]', text))
        
    @classmethod
    def IS_CHANGED(cls, 原文, 翻译服务, 输出语言, unique_id=None, extra_pnginfo=None, client_id=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 计算文本的哈希值
        text_hash = 0
        if 原文:
            # 使用hashlib计算文本的哈希值，更安全和一致
            text_hash = hashlib.md5(原文.encode('utf-8')).hexdigest()
        
        # 组合所有输入的哈希值
        input_hash = hash((
            text_hash,
            翻译服务,
            输出语言
        ))
        
        return input_hash
    
    def translate(self, 原文, 翻译服务, 输出语言, unique_id=None, extra_pnginfo=None, client_id=None):
        """
        翻翻译输出本函数
        
        Args:
            原文: 输入的文本
            翻译服务: 选择的翻译器 ("百度翻译", "智谱翻译", "硅基流动翻译", "自定义")
            输出语言: 目标翻译语言 ("英文", "中文")
            unique_id: 节点的唯一ID
            extra_pnginfo: 额外的PNG信息
            client_id: 客户端ID
            
        Returns:
            dict: 包含UI显示和翻译结果
        """
        # 根据选择设置翻译方向
        from_lang = "auto"
        to_lang = "en" if 输出语言 == "英文" else "zh"
        
        # 检查输入
        if not 原文:
            return {"ui": {"翻译输出": ""}, "result": ("",)}
            
        # --- 智能跳过翻译逻辑 ---
        # 检查是否为纯英文 (只包含ASCII可打印字符)
        is_pure_english = bool(re.fullmatch(r'[ -~]+', 原文))
        # 检查是否为纯中文 (包含中文字符且不包含英文字母)
        is_pure_chinese = self._contains_chinese(原文) and not re.search(r'[a-zA-Z]', 原文)

        skip_translation = False
        if to_lang == 'en' and is_pure_english:
            print(f"{self.LOG_PREFIX} 原文为纯英文，目标为英文，无需翻译。")
            skip_translation = True
        elif to_lang == 'zh' and is_pure_chinese:
            print(f"{self.LOG_PREFIX} 原文为纯中文，目标为中文，无需翻译。")
            skip_translation = True

        if skip_translation:
            # 如果跳过翻译，直接返回原文并更新UI
            try:
                if unique_id is not None and extra_pnginfo is not None:
                    # 更安全的方式处理extra_pnginfo
                    if isinstance(extra_pnginfo, list) and len(extra_pnginfo) > 0:
                        if isinstance(extra_pnginfo[0], dict) and "workflow" in extra_pnginfo[0]:
                            workflow = extra_pnginfo[0]["workflow"]
                            node = next(
                                (x for x in workflow["nodes"] if str(x["id"]) == str(unique_id)),
                                None,
                            )
                            if node:
                                node["widgets_values"] = [原文, 翻译服务, 输出语言]
            except Exception as e:
                print(f"{self.LOG_PREFIX} 更新节点widgets_values时出错: {str(e)}")
                
            return {"ui": {"翻译输出": 原文}, "result": (原文,)}
            
        try:
            # 创建请求ID
            request_id = f"translate_{int(time.time())}_{random.randint(1000, 9999)}"
            
            result_container = {}
            
            # 从config_manager获取配置
            from ..config_manager import config_manager
            import nodes

            # 根据选择的翻译服务调用不同的翻译API
            if 翻译服务 == "百度翻译":
                print(f"{self.LOG_PREFIX} 提示词翻译: 使用百度翻译服务")
                thread = threading.Thread(
                    target=run_async_translation,
                    args=(BaiduTranslateService.translate, 原文, from_lang, to_lang, request_id, result_container)
                )
                thread.start()
            else:
                # 对应其他翻译服务，直接使用对应的配置
                # 获取llm配置的副本，避免修改全局配置
                llm_config = copy.deepcopy(config_manager.get_llm_config())
                
                # 映射翻译服务选项到provider
                provider_map = {
                    "智谱翻译": "zhipu",
                    "硅基流动翻译": "siliconflow",
                    "自定义": "custom"
                }
                
                # 获取选定的provider
                selected_provider = provider_map.get(翻译服务)
                if not selected_provider:
                    error_text = f"[翻译错误] 不支持的翻译服务: {翻译服务}"
                    # 发送toast通知
                    send_toast_notification(client_id, "error", "[✨提示词翻译] 翻译错误", f"不支持的翻译服务: {翻译服务}")
                    return {"ui": {"翻译输出": error_text}, "result": (error_text,)}
                
                # 获取对应provider的配置
                provider_config = self._get_provider_config(config_manager, selected_provider)
                if not provider_config:
                    error_text = f"[翻译错误] 未找到{翻译服务}的配置"
                    # 发送toast通知
                    send_toast_notification(client_id, "error", "[✨提示词翻译] 翻译错误", f"未找到{翻译服务}的配置，请先完成API配置")
                    return {"ui": {"翻译输出": error_text}, "result": (error_text,)}
                
                print(f"{self.LOG_PREFIX} 提示词翻译: 使用{翻译服务}服务, API: {provider_config.get('model')}")
                
                # 使用特定provider的配置直接翻译
                thread = threading.Thread(
                    target=self._run_llm_translation,
                    args=(原文, from_lang, to_lang, request_id, result_container, selected_provider, provider_config, client_id)
                )
                thread.start()

            # 非阻塞等待并检查中断
            while thread.is_alive():
                nodes.before_node_execution()
                time.sleep(0.1)

            result = result_container.get('result')

            # 检查翻译结果
            if result and result.get('success'):
                translated_text = result.get('data', {}).get('translated', '')
                
                # 更新节点的widgets_values（参考show_text.py的实现）
                try:
                    if unique_id is not None and extra_pnginfo is not None:
                        # 更安全的方式处理extra_pnginfo
                        if isinstance(extra_pnginfo, list) and len(extra_pnginfo) > 0:
                            if isinstance(extra_pnginfo[0], dict) and "workflow" in extra_pnginfo[0]:
                                workflow = extra_pnginfo[0]["workflow"]
                                node = next(
                                    (x for x in workflow["nodes"] if str(x["id"]) == str(unique_id)),
                                    None,
                                )
                                if node:
                                    node["widgets_values"] = [translated_text, 翻译服务, 输出语言]
                except Exception as e:
                    print(f"{self.LOG_PREFIX} 更新节点widgets_values时出错: {str(e)}")
                
                return {"ui": {"翻译输出": translated_text}, "result": (translated_text,)}
            else:
                error_msg = result.get('error', '翻译失败，未知错误') if result else '翻译线程未返回结果'
                # 如果是百度翻译的错误，使用专用格式化函数
                if 翻译服务 == "百度翻译" and isinstance(result.get('error'), dict):
                    error_msg = format_baidu_translate_error(result.get('error'))
                
                print(f"{self.LOG_PREFIX} 翻译节点错误: {error_msg}")
                error_text = f"[翻译错误] {error_msg}"
                # 发送toast通知
                send_toast_notification(client_id, "error", "[✨提示词翻译] 翻译失败", error_msg)
                return {"ui": {"翻译输出": error_text}, "result": (error_text,)}
                
        except InterruptProcessingException:
            # 用户取消任务时，静默处理
            print(f"{self.LOG_PREFIX} 用户取消了翻译任务。")
            return {"ui": {"翻译输出": "[任务已取消]"}, "result": ("[任务已取消]",)}
        except Exception as e:
            error_msg = format_api_error(e, 翻译服务)
            print(f"{self.LOG_PREFIX} 翻译节点异常: {error_msg}")
            error_text = f"[翻译异常] {error_msg}"
            # 发送toast通知
            send_toast_notification(client_id, "error", "[✨提示词翻译] 翻译异常", error_msg)
            return {"ui": {"翻译输出": error_text}, "result": (error_text,)}
    
    def _get_provider_config(self, config_manager, provider):
        """获取指定provider的配置"""
        llm_config = config_manager.get_llm_config()
        if 'providers' in llm_config and provider in llm_config['providers']:
            return llm_config['providers'][provider]
        return None
    
    def _run_llm_translation(self, text, from_lang, to_lang, request_id, result_container, provider, provider_config, client_id=None):
        """在独立线程中运行LLM翻译"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            # 获取API密钥和模型
            api_key = provider_config.get('api_key', '')
            model = provider_config.get('model', '')
            base_url = provider_config.get('base_url', '')
            
            if not api_key or not model:
                result_container['result'] = {
                    "success": False, 
                    "error": f"请先配置{provider}的API密钥和模型"
                }
                # 不在这里发送toast通知，由主函数统一处理
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
                # 不在这里发送toast通知，由主函数统一处理
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
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_content += content
            
            loop.run_until_complete(process_stream())
            
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
            provider_display_name = next((k for k, v in {"智谱翻译": "zhipu", "硅基流动翻译": "siliconflow", "自定义": "custom"}.items() if v == provider), provider)
            error_message = format_api_error(e, provider_display_name)
            
            result_container['result'] = {
                "success": False,
                "error": error_message
            }
            print(f"{PromptTranslate.LOG_PREFIX} 翻译失败 | 服务:{provider} | 错误:{error_message}")
            # 不在这里发送toast通知，由主函数统一处理
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