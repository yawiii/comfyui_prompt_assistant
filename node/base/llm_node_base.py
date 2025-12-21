"""
LLM节点基类
为LLM类节点(扩写、翻译等)提供专用基础能力
"""

from typing import Any, Callable, Dict, Optional
import asyncio

from .base_node import BaseNode
from ...utils.common import format_api_error


class LLMNodeBase(BaseNode):
    """
    LLM节点基类
    
    提供LLM节点专用功能:
    - LLM Provider配置获取
    - LLM相关的通用逻辑
    - 动态服务/模型列表生成
    """
    
    @staticmethod
    def get_llm_service_options():
        """
        获取所有可用的LLM服务/模型选项列表
        
        返回格式: ["百度翻译", "智谱/glm-4-flash", "Ollama/qwen3:14b", ...]
        百度翻译服务无模型概念,仅显示服务名
        其他服务显示为"服务名/模型名"格式
        
        返回:
            List[str]: 服务/模型选项列表
        """
        from ...config_manager import config_manager
        
        options = []
        services = config_manager.get_all_services()
        
        for service in services:
            service_name = service.get('name', '')
            service_id = service.get('id', '')
            service_type = service.get('type', '')
            
            # 百度翻译特殊处理:仅显示服务名
            if service_type == 'baidu':
                options.append(service_name)
                continue
            
            # 其他服务:遍历llm_models
            llm_models = service.get('llm_models', [])
            for model in llm_models:
                model_name = model.get('name', '')
                if model_name:
                    # 格式: "服务名/模型名"
                    options.append(f"{service_name}/{model_name}")
        
        # 如果没有任何选项,返回默认值避免ComfyUI报错
        if not options:
            options = ["智谱"]
        
        return options
    
    @staticmethod
    def get_translate_service_options():
        """
        获取翻译服务专用的服务/模型选项列表
        
        与get_llm_service_options的区别:
        - 硬编码添加"百度翻译"选项(百度翻译使用独立配置,不在model_services中)
        - 专门用于翻译节点和翻译按钮
        
        返回格式: ["百度翻译", "智谱/glm-4-flash", "Ollama/qwen3:14b", ...]
        
        返回:
            List[str]: 服务/模型选项列表(包含百度翻译)
        """
        from ...config_manager import config_manager
        
        options = []
        
        # ---硬编码添加百度翻译---
        # 百度翻译使用独立的baidu_translate配置,不在model_services列表中
        baidu_config = config_manager.load_config().get('baidu_translate', {})
        # 即使没有配置app_id,也要显示百度选项
        options.append("百度翻译")
        
        # ---动态获取其他LLM服务---
        services = config_manager.get_all_services()
        
        for service in services:
            service_name = service.get('name', '')
            service_type = service.get('type', '')
            
            # 遍历llm_models
            llm_models = service.get('llm_models', [])
            for model in llm_models:
                model_name = model.get('name', '')
                if model_name:
                    # 格式: "服务名/模型名"
                    options.append(f"{service_name}/{model_name}")
        
        return options
    
    @staticmethod
    def parse_service_model(service_model_str: str):
        """
        解析"服务名/模型名"格式的字符串
        
        特殊处理:
        - "百度翻译": 返回 ('baidu', None) - 百度翻译使用独立配置
        
        参数:
            service_model_str: 服务/模型字符串,例如 "智谱/glm-4-flash" 或 "百度翻译"
        
        返回:
            Tuple[str, Optional[str]]: (service_id, model_name)
            - service_id: 服务ID (如 'zhipu', 'baidu')
            - model_name: 模型名称,如果没有则为None
        """
        from ...config_manager import config_manager
        
        # 分割字符串
        if '/' in service_model_str:
            service_name, model_name = service_model_str.split('/', 1)
        else:
            service_name = service_model_str
            model_name = None
        
        # ---特殊处理:百度翻译---
        if service_name in ['百度翻译', '百度', 'baidu']:
            return 'baidu', None
        
        # 查找对应的service_id
        services = config_manager.get_all_services()
        for service in services:
            if service.get('name') == service_name:
                return service.get('id'), model_name
        
        # 未找到,返回None
        return None, None
    
    def _get_provider_config(
        self,
        config_manager: Any,
        provider: str
    ) -> Optional[Dict[str, Any]]:
        """
        获取指定LLM Provider的配置
        
        参数:
            config_manager: 配置管理器实例
            provider: Provider标识符(如 'zhipu', 'ollama'等)
        
        返回:
            Provider配置字典,如果未找到则返回 None
        """
        llm_config = config_manager.get_llm_config()
        
        if 'providers' in llm_config and provider in llm_config['providers']:
            return llm_config['providers'][provider]
        
        return None

    def _run_llm_task(
        self,
        llm_service_func: Callable,
        provider: str,
        *args,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行LLM任务(扩写/翻译)的统一方法
        
        封装了:
        1. 异步任务的线程执行
        2. 中断异常的捕获和处理
        3. API异常的格式化
        
        参数:
            llm_service_func: LLMService的异步方法
            provider: Provider名称(用于错误格式化)
            *args, **kwargs: 传递给llm_service_func的参数
        
        返回:
            {"success": bool, "data": dict, "error": str} 格式的结果
        """
        def thread_task(result_container, cancel_event):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # 将cancel_event传递给服务函数
                kwargs['cancel_event'] = cancel_event
                result = loop.run_until_complete(llm_service_func(*args, **kwargs))
                result_container['result'] = result
            except (asyncio.CancelledError, KeyboardInterrupt):
                print(f"{self.LOG_PREFIX} 异步任务被取消")
                result_container['result'] = {"success": False, "error": "任务被中断"}
            except Exception as e:
                # 捕获其他异常,格式化错误信息
                error_message = format_api_error(e, provider)
                result_container['result'] = {"success": False, "error": error_message}
            finally:
                # 清理所有未完成的任务，消除 "Task was destroyed but it is pending" 警告
                try:
                    pending = asyncio.all_tasks(loop)
                    if pending:
                        for task in pending:
                            task.cancel()
                        # 等待任务取消完成，忽略取消错误
                        loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                except Exception:
                    pass
                finally:
                    loop.close()
        
        # 创建取消事件
        import threading
        cancel_event = threading.Event()
        
        return self._execute_with_interrupt(thread_task, (), cancel_event)
