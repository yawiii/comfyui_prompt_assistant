"""
核心基础设施模块
提供HTTP客户端池管理
"""

import httpx
import os
from typing import Dict, Optional, Any
import re


class HTTPClientPool:
    """
    HTTP客户端池
    管理持久化的 httpx.AsyncClient，支持连接复用
    """
    _clients: Dict[str, httpx.AsyncClient] = {}
    _loop_id: Optional[int] = None  # 记录创建客户端时的事件循环ID
    
    @classmethod
    def _check_loop_change(cls) -> bool:
        """
        检测事件循环是否发生变化
        返回: True = 循环已变化，需要清理旧客户端
        """
        try:
            import asyncio
            current_loop = asyncio.get_running_loop()
            current_loop_id = id(current_loop)
            
            if cls._loop_id is None:
                cls._loop_id = current_loop_id
                return False
            
            if cls._loop_id != current_loop_id:
                # 事件循环已变化，清理所有旧客户端
                cls._loop_id = current_loop_id
                # 不能 await close，直接丢弃引用（让 GC 处理）
                cls._clients.clear()
                return True
            
            return False
        except RuntimeError:
            # 没有运行中的事件循环，保守处理
            return False
    
    @classmethod
    def get_client(
        cls,
        provider: str,
        base_url: Optional[str] = None,
        timeout: float = 60.0,
        proxy: Optional[str] = None,
        verify_ssl: bool = True,
        **kwargs
    ) -> httpx.AsyncClient:
        """
        获取或创建HTTP客户端（支持连接复用）
        
        参数:
            provider: 服务商标识（用于日志）
            base_url: API基础URL，作为缓存的Key
            timeout: 超时时间（秒）
            proxy: 代理设置
            verify_ssl: 是否验证SSL证书
        """
        # 检测事件循环变化，必要时清理旧客户端
        cls._check_loop_change()
        
        # 使用 base_url 作为唯一标识进行缓存
        cache_key = base_url or provider
        
        if cache_key in cls._clients:
            client = cls._clients[cache_key]
            if not client.is_closed:
                return client

        # 创建新客户端
        client_kwargs = {
            'timeout': httpx.Timeout(timeout, connect=10.0, read=timeout, write=60.0),
            'verify': verify_ssl,
            'follow_redirects': True,
            'http2': False,
            # 设置连接池保持连接
            'limits': httpx.Limits(max_keepalive_connections=10, max_connections=20, keepalive_expiry=60.0)
        }
        
        if proxy:
            client_kwargs['proxies'] = proxy
        
        client_kwargs.update(kwargs)
        
        client = httpx.AsyncClient(**client_kwargs)
        cls._clients[cache_key] = client
        
        return client

    
    @classmethod
    async def close_all(cls):
        """关闭所有已创建的客户端，彻底释放资源"""
        for key in list(cls._clients.keys()):
            client = cls._clients.pop(key)
            try:
                await client.aclose()
            except:
                pass


# Logger 类已移除，请直接从 ..utils.common 导入 log_prepare, log_complete, log_error 等函数使用。



class BaseAPIService:
    """
    API服务抽象基类
    所有服务（LLM, VLM, Baidu）的基础
    """
    
    def __init__(self, http_client_pool: HTTPClientPool = None):
        """
        初始化基类
        
        参数:
            http_client_pool: HTTP客户端池（可选，默认使用全局池）
        """
        self.http_client_pool = http_client_pool or HTTPClientPool
    
    def get_config(self) -> Dict[str, Any]:
        """
        获取服务配置（子类必须实现）
        
        返回:
            Dict: 配置字典
        """
        raise NotImplementedError("子类必须实现 get_config 方法")
    
    async def handle_error(self, error: Exception, provider: str) -> Dict[str, Any]:
        """
        统一错误处理
        
        参数:
            error: 异常对象
            provider: 服务商标识
        
        返回:
            Dict: 错误响应
        """
        from ..utils.common import format_api_error
        error_message = format_api_error(error, provider)
        return {
            "success": False,
            "error": error_message
        }
