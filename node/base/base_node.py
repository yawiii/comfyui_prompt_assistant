"""
节点抽象基类
提供所有节点的通用基础能力,包括线程管理、中断检测、Provider配置等
"""

import asyncio
import threading
import time
from typing import Any, Callable, Dict, Optional, Tuple

from comfy.model_management import InterruptProcessingException

from ...utils.common import PREFIX as LOG_PREFIX, REQUEST_PREFIX, PROCESS_PREFIX


class BaseNode:
    """
    所有节点的抽象基类
    
    提供通用功能:
    - 线程执行与中断管理
    - Provider配置覆盖
    - 规则模板获取
    """
    
    # 子类应该覆盖这些常量
    LOG_PREFIX = LOG_PREFIX
    REQUEST_PREFIX = REQUEST_PREFIX
    PROCESS_PREFIX = PROCESS_PREFIX
    
    @staticmethod
    def _check_is_changed_bypass(*args, **kwargs):
        """
        检查输入中是否包含绕过 IS_CHANGED 限制的专用符号 [R] (不区分大小写)
        如果包含，返回 True。
        """
        # 遍历所有位置参数和关键字参数
        for v in list(args) + list(kwargs.values()):
            if isinstance(v, str) and "[R]" in v.upper():
                return True
        return False

    
    def _run_thread_with_interrupt(
        self,
        target_func: Callable,
        args: Tuple,
        task_name: str = "任务"
    ) -> Dict[str, Any]:
        """
        在独立线程中运行任务,并支持中断检测
        
        参数:
            target_func: 要在线程中执行的函数
            args: 传递给函数的参数元组
            task_name: 任务名称,用于日志输出(已废弃,保留参数以兼容旧代码)
        
        返回:
            result_container中的'result'字段内容
        
        异常:
            InterruptProcessingException: 当检测到用户中断时
        """
        result_container = {}
        
        # 启动线程
        thread = threading.Thread(target=target_func, args=args)
        thread.start()
        
        # 等待完成,同时检查中断
        while thread.is_alive():
            try:
                import nodes
                nodes.before_node_execution()
            except:
                # 检测到中断,立即抛出异常
                raise InterruptProcessingException()
            time.sleep(0.1)
        
        return result_container.get('result')
    
    def _run_async_in_thread(
        self,
        async_func: Callable,
        result_container: Dict[str, Any],
        *args,
        **kwargs
    ) -> None:
        """
        在独立线程中运行异步任务的辅助方法
        
        这个方法会:
        1. 创建新的事件循环
        2. 运行异步函数
        3. 将结果存入result_container
        4. 正确处理中断异常
        
        参数:
            async_func: 异步函数
            result_container: 结果容器字典
            *args, **kwargs: 传递给async_func的参数
        
        结果:
            result_container['result'] = 函数返回值或错误信息
        """
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(async_func(*args, **kwargs))
            result_container['result'] = result
        except (asyncio.CancelledError, KeyboardInterrupt):
            # 捕获中断异常,不格式化错误
            print(f"{self.LOG_PREFIX} 检测到异步任务被取消")
            result_container['result'] = {"success": False, "error": "任务被中断"}
        except Exception as e:
            # 捕获其他异常,让子类处理格式化
            result_container['result'] = {"success": False, "error": str(e)}
        finally:
            loop.close()
    
    def _execute_with_interrupt(
        self,
        thread_func: Callable,
        thread_args: Tuple,
        cancel_event: Optional[Any] = None
    ) -> Any:
        """
        执行带中断检测的线程任务(通用封装)
        
        参数:
            thread_func: 线程中执行的函数(通常是包含异步逻辑的函数)
            thread_args: 传递给thread_func的参数
            cancel_event: 可选的取消事件,用于通知异步任务中断
        
        返回:
            result_container['result']的内容
        
        异常:
            InterruptProcessingException: 当检测到用户中断时
        """
        result_container = {}
        
        # 如果提供了cancel_event,将其传递给thread_func
        if cancel_event is not None:
            thread = threading.Thread(target=thread_func, args=(result_container, cancel_event) + thread_args)
        else:
            thread = threading.Thread(target=thread_func, args=(result_container,) + thread_args)
        thread.start()
        
        # 等待完成,同时检查中断
        while thread.is_alive():
            is_interrupted = False
            try:
                import nodes
                nodes.before_node_execution()
                
                # 双重检查：额外检查 PromptServer 的全局中断状态
                # 某些情况下 nodes.before_node_execution() 可能不会抛出异常
                from server import PromptServer
                if hasattr(PromptServer.instance, 'execution_interrupted') and PromptServer.instance.execution_interrupted:
                    is_interrupted = True
            except:
                is_interrupted = True

            if is_interrupted:
                # 检测到中断,设置取消事件(如果提供)
                if cancel_event is not None:
                    try:
                        cancel_event.set()
                    except:
                        pass
                raise InterruptProcessingException()
            time.sleep(0.1)
        
        return result_container.get('result')
    
    def _override_ollama_config(
        self,
        provider_config: Dict[str, Any],
        auto_unload: bool
    ) -> Dict[str, Any]:
        """
        覆盖Ollama配置中的auto_unload参数
        
        参数:
            provider_config: 原始Provider配置
            auto_unload: 节点级别的自动释放设置
        
        返回:
            新的配置字典(不修改原始配置)
        """
        config_copy = provider_config.copy()
        config_copy['auto_unload'] = auto_unload
        return config_copy
    
    def _get_prompt_template(
        self,
        template_name: str,
        prompt_type: str,
        use_temp_rule: bool,
        temp_rule_content: str,
        default_content: str
    ) -> Tuple[str, str]:
        """
        获取提示词模板内容
        
        参数:
            template_name: 模板名称
            prompt_type: 模板类型('expand_prompts', 'vision_prompts'等)
            use_temp_rule: 是否使用临时规则
            temp_rule_content: 临时规则内容
            default_content: 默认提示词内容
        
        返回:
            (prompt_content, rule_name) 元组
        """
        # 使用临时规则
        if use_temp_rule and temp_rule_content:
            return temp_rule_content, "临时规则"
        
        # 从配置获取模板
        from ...config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()
        
        if not system_prompts:
            return default_content, "默认规则"
        
        prompts = system_prompts.get(prompt_type, {})
        if not prompts:
            return default_content, "默认规则"
        
        # 按显示名称匹配
        for key, value in prompts.items():
            if value.get('name') == template_name:
                content = value.get('content', '')
                if content:
                    return content, template_name
        
        # 按键名匹配
        for key, value in prompts.items():
            if key == template_name:
                content = value.get('content', '')
                if content:
                    return content, template_name
        
        # 未找到,使用默认
        return default_content, "默认规则"
