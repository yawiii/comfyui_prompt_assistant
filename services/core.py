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
    HTTP客户端池单例
    管理httpx.AsyncClient的创建（不跨事件循环缓存）
    """
    
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
        创建HTTP客户端（每次都创建新实例，避免事件循环问题）
        
        参数:
            provider: 服务商标识（用于日志）
            base_url: API基础URL
            timeout: 超时时间（秒）
            proxy: 代理设置
            verify_ssl: 是否验证SSL证书
            **kwargs: 其他httpx参数
        
        返回:
            httpx.AsyncClient: 新创建的客户端
        """
        # 创建新客户端（不缓存，避免跨事件循环复用）
        client_kwargs = {
            'timeout': httpx.Timeout(timeout, connect=10.0),
            'verify': verify_ssl,
            'follow_redirects': True,
            'http2': False,  # 禁用HTTP/2避免兼容性问题
        }
        
        # 设置代理（优先使用参数，其次环境变量）
        if proxy:
            client_kwargs['proxies'] = proxy
        elif os.environ.get('HTTP_PROXY') or os.environ.get('HTTPS_PROXY'):
            # httpx会自动读取环境变量，无需手动设置
            pass
        
        # 合并额外参数
        client_kwargs.update(kwargs)
        
        # 创建客户端
        client = httpx.AsyncClient(**client_kwargs)
        
        return client
    
    @classmethod
    async def close_all(cls):
        """占位方法（已不再缓存客户端）"""
        pass
    
    @classmethod
    def get_pool_size(cls) -> int:
        """获取当前池中的客户端数量"""
        return len(cls._clients)


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
