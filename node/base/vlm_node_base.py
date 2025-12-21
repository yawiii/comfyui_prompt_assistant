"""
VLM节点基类
为VLM类节点(图像反推、视频反推等)提供专用基础能力
"""

import asyncio
import threading
from typing import Any, Callable, Dict, Optional

import torch
from comfy.model_management import InterruptProcessingException

from .base_node import BaseNode
from ...utils.image import tensor_to_base64, compute_image_hash
from ...utils.common import format_api_error


class VLMNodeBase(BaseNode):
    """
    VLM节点基类
    
    提供VLM节点专用功能:
    - VLM Provider配置获取
    - 图像处理工具方法
    - 图像哈希计算
    - 统一的异步任务执行与中断处理
    - 动态服务/模型列表生成
    """
    
    @staticmethod
    def get_vlm_service_options():
        """
        获取所有可用的VLM服务/模型选项列表
        
        返回格式: ["智谱/glm-4v-flash", "Ollama/llava:Q6_K", ...]
        所有服务显示为"服务名/模型名"格式
        
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
            
            # 百度翻译没有vlm_models,跳过
            if service_type == 'baidu':
                continue
            
            # 遍历vlm_models
            vlm_models = service.get('vlm_models', [])
            for model in vlm_models:
                model_name = model.get('name', '')
                if model_name:
                    # 格式: "服务名/模型名"
                    options.append(f"{service_name}/{model_name}")
        
        # 如果没有任何选项,返回默认值避免ComfyUI报错
        if not options:
            options = ["智谱"]
        
        return options
    
    @staticmethod
    def parse_service_model(service_model_str: str):
        """
        解析"服务名/模型名"格式的字符串
        
        参数:
            service_model_str: 服务/模型字符串,例如 "智谱/glm-4v-flash"
        
        返回:
            Tuple[str, Optional[str]]: (service_id, model_name)
            - service_id: 服务ID (如 'zhipu', 'ollama')
            - model_name: 模型名称,如果没有则为None
        """
        from ...config_manager import config_manager
        
        # 分割字符串
        if '/' in service_model_str:
            service_name, model_name = service_model_str.split('/', 1)
        else:
            service_name = service_model_str
            model_name = None
        
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
        获取指定VLM Provider的配置
        
        参数:
            config_manager: 配置管理器实例
            provider: Provider标识符(如 'zhipu', 'ollama'等)
        
        返回:
            Provider配置字典,如果未找到则返回 None
        """
        vision_config = config_manager.get_vision_config()
        
        if 'providers' in vision_config and provider in vision_config['providers']:
            return vision_config['providers'][provider]
        
        return None
    
    def _image_to_base64(self, image_tensor: torch.Tensor, quality: int = 95) -> str:
        """
        将图像tensor转换为base64编码
        
        参数:
            image_tensor: 图像tensor
            quality: JPEG压缩质量(1-100)
        
        返回:
            base64编码的data URL
        """
        return tensor_to_base64(image_tensor, quality)
    
    def _compute_image_hash(self, image_tensor: Optional[torch.Tensor]) -> str:
        """
        计算图像tensor的哈希值(用于IS_CHANGED)
        
        参数:
            image_tensor: 图像tensor或None
        
        返回:
            MD5哈希值的十六进制字符串
        """
        return compute_image_hash(image_tensor)
    
    def _run_async_task(
        self,
        async_func: Callable,
        provider: str,
        *args,
        **kwargs
    ) -> Dict[str, Any]:
        """
        在独立线程中运行异步任务,并处理中断
        
        这个方法封装了:
        1. 异步事件循环的创建和清理
        2. 中断异常的捕获和处理
        3. 普通异常的格式化
        
        参数:
            async_func: 异步函数(coroutine function)
            provider: Provider名称(用于错误格式化)
            *args, **kwargs: 传递给async_func的参数
        
        返回:
            {"success": bool, "data": dict, "error": str} 格式的结果
        
        示例:
            result = self._run_async_task(
                VisionService.analyze_image,
                "zhipu",
                image_data=data,
                request_id=req_id,
                ...
            )
        """
        result_container = {}
        
        def thread_target():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # 执行异步任务
                result = loop.run_until_complete(async_func(*args, **kwargs))
                result_container['result'] = result
            except (asyncio.CancelledError, KeyboardInterrupt):
                # 捕获中断异常,不格式化错误
                print(f"{self.LOG_PREFIX} 检测到异步任务被取消")
                result_container['result'] = {"success": False, "error": "任务被中断"}
            except Exception as e:
                # 捕获其他异常,格式化错误信息
                error_message = format_api_error(e, provider)
                result_container['result'] = {"success": False, "error": error_message}
            finally:
                loop.close()
        
        # 使用基类的线程中断检测方法
        self._run_thread_with_interrupt(
            thread_target,
            (),
            task_name="异步任务"
        )
        
    def _run_vision_task(
        self,
        vision_service_func: Callable,
        provider: str,
        *args,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行视觉任务(图像/视频分析)的统一方法
        
        封装了:
        1. 异步任务的线程执行
        2. 中断异常的捕获和处理
        3. API异常的格式化
        
        参数:
            vision_service_func: VisionService的异步方法(如analyze_image, analyze_images)
            provider: Provider名称(用于错误格式化,如"zhipu")
            *args, **kwargs: 传递给vision_service_func的参数
        
        返回:
            {"success": bool, "data": dict, "error": str} 格式的结果
        
        异常:
            InterruptProcessingException: 当检测到用户中断时
        
        示例:
            result = self._run_vision_task(
                VisionService.analyze_image,
                "zhipu",
                image_data=data,
                request_id=req_id,
                prompt_content=prompt,
                custom_provider="zhipu",
                custom_provider_config=config
            )
        """
        def thread_task(result_container, cancel_event):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # 将cancel_event传递给服务函数
                kwargs['cancel_event'] = cancel_event
                result = loop.run_until_complete(vision_service_func(*args, **kwargs))
                result_container['result'] = result
            except (asyncio.CancelledError, KeyboardInterrupt):
                # 捕获中断异常,不格式化错误
                print(f"{self.LOG_PREFIX} 检测到异步任务被取消")
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
        
        # 使用基类的中断检测执行
        return self._execute_with_interrupt(thread_task, (), cancel_event)

