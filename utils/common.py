"""
工具函数模块
整合错误处理、图像处理、常量定义等通用工具
"""

import json
import base64
import sys
import os
import shutil
import re
import io
from io import BytesIO
from PIL import Image
from typing import Optional, Dict, Any
import time
import random
import threading

# 修复 Windows 终端编码问题
# 解决 GBK 编码导致的 emoji 和特殊字符输出错误
if sys.platform == 'win32' and sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass  # 静默失败，保持原有编码


# ==================== 统一显示宽度计算 ====================

def get_display_width(text: str) -> int:
    """
    计算字符串在终端中的显示宽度（中文及部分 emoji 占2格，ASCII 占1格）
    """
    width = 0
    for char in text:
        # 常见的中文字符编码范围
        if ord(char) > 0x7F:
            width += 2
        else:
            width += 1
    return width


# ==================== 统一日志前缀常量 ====================
# 所有模块从此处导入，确保日志格式一致

PREFIX = "✨"
ERROR_PREFIX = "✨-❌"
PROCESS_PREFIX = "✨"
REQUEST_PREFIX = "✨"
WARN_PREFIX = "✨-⚠️"


# ==================== 任务类型常量 ====================
TASK_TRANSLATE = "翻译"
TASK_EXPAND = "提示词优化"
TASK_IMAGE_CAPTION = "图像反推"
TASK_VIDEO_CAPTION = "视频反推"


# ==================== 请求来源常量 ====================
SOURCE_NODE = "节点-"
SOURCE_FRONTEND = "前端-"


# ==================== 统一日志消息函数 ====================

def log_prepare(
    task_type: str,
    request_id: str,
    source: str,
    service_name: str,
    model_name: str = None,
    rule_name: str = None,
    extra: dict = None
) -> None:
    """
    输出统一格式的准备日志（换行输出）
    
    格式: ✨ 🟡 {来源}{任务}准备 | 服务:{service} | 模型:{model} | 规则:{rule} | ID:{id}
    """
    # 强制回到行首并清除当前行，确保不与之前的 progress 冲突
    print(f"\r{_ANSI_CLEAR_EOL}", end="")
    
    parts = [f"{PREFIX} 🟡 {source}{task_type}准备"]
    parts.append(f"服务:{service_name}")
    
    if model_name:
        parts.append(f"模型:{model_name}")
    if rule_name:
        parts.append(f"规则:{rule_name}")
    
    parts.append(f"ID:{request_id}")
    
    # 处理额外字段
    if extra:
        for key, value in extra.items():
            parts.append(f"{key}:{value}")
    
    print(f"{parts[0]} | {' | '.join(parts[1:])}", flush=True)


def log_complete(
    task_type: str,
    request_id: str,
    service_name: str,
    char_count: int,
    elapsed_ms: int,
    model_unloaded: bool = None,
    source: str = None
) -> None:
    """
    输出统一格式的完成日志（换行输出）
    
    格式: ✨ ✅ {来源}{任务}完成 | 服务:{service} | ID:{id} | 字符:{count} | 耗时:{time}
    """
    # 强制回到行首且不换行清空当前行，然后输出新消息
    print(f"\r{_ANSI_CLEAR_EOL}", end="")
    
    elapsed_str = format_elapsed_time(elapsed_ms)
    source_str = source if source else ""
    parts = [f"{PREFIX} ✅ {source_str}{task_type}完成"]
    parts.append(f"服务:{service_name}")
    parts.append(f"ID:{request_id}")
    parts.append(f"字符:{char_count}")
    parts.append(f"耗时:{elapsed_str}")
    
    # Ollama 模型卸载状态
    if model_unloaded is not None:
        unload_text = "模型已卸载" if model_unloaded else "模型保留"
        parts.append(unload_text)
    
    print(f"{parts[0]} | {' | '.join(parts[1:])}", flush=True)


def log_error(
    task_type: str,
    request_id: str,
    error_msg: str,
    source: str = None
) -> None:
    """
    输出统一格式的错误日志（换行输出）
    """
    # 强制回到行首并清除当前行
    print(f"\r{_ANSI_CLEAR_EOL}", end="")
    source_str = source if source else ""
    print(f"{PREFIX} ❌ {source_str}{task_type}失败 | ID:{request_id} | 错误:{error_msg}", flush=True)


def generate_request_id(req_type: str, service_type: Optional[str] = None, node_id: str = "0") -> str:
    """
    生成统一格式的请求ID
    格式: 请求类型_服务类型(可选)_NodeID_四位时间戳
    示例: trans_llm_12_3456
    """
    timestamp = str(int(time.time()))[-4:]
    parts = [req_type]
    if service_type:
        parts.append(service_type)
    parts.append(str(node_id))
    parts.append(timestamp)
    return "_".join(parts)


# ---日志格式化辅助函数---

def simplify_model_name(model: str) -> str:
    """
    简化模型名称显示
    
    示例:
        huihui_ai/qwen3-vl-abliterated:8b -> qwen3-vl-8b
        huihui_ai/qwen3-abliterated:14b -> qwen3-14b
    
    参数:
        model: 完整模型名称
    
    返回:
        简化后的模型名称
    """
    if '/' in model:
        model = model.split('/')[-1]
    if ':' in model:
        name, size = model.split(':')
        # 移除常见后缀
        name = name.replace('-abliterated', '').replace('-instruct', '').replace('-chat', '')
        return f"{name}-{size}"
    return model

def format_model_with_thinking(model: str, thinking_disabled: bool = False) -> str:
    """
    格式化模型名称，如果关闭思维链则添加🗯标识
    
    参数:
        model: 模型名称
        thinking_disabled: 是否关闭思维链
    
    返回:
        格式化后的模型名称
    """
    simplified = simplify_model_name(model)
    if thinking_disabled:
        return f"{simplified}💭"
    return simplified

def format_elapsed_time(elapsed_ms: int) -> str:
    """
    格式化耗时显示
    
    参数:
        elapsed_ms: 毫秒数
    
    返回:
        格式化后的时间字符串（如 "6.5s"）
    """
    return f"{elapsed_ms/1000:.1f}s"


# ====================进度日志系统====================
# 统一的进度条管理器，支持单行覆盖刷新

# ---ANSI 控制序列---
_ANSI_CLEAR_EOL = "\033[K"  # 清除从光标位置到行末的内容

# ---全局状态：追踪上一次输出长度（使用锁保护以支持并发）---
_global_last_output_len = 0
_progress_lock = threading.Lock()


# ---Windows 虚拟终端初始化---
def _enable_windows_vt():
    """
    启用 Windows 虚拟终端处理
    解决 Windows CMD/PowerShell 中 ANSI 转义序列兼容性问题
    """
    if os.name == 'nt':
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            mode = ctypes.c_ulong()
            kernel32.GetConsoleMode(handle, ctypes.byref(mode))
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        except Exception:
            pass

_enable_windows_vt()


class ProgressBar:
    """
    统一进度条管理器
    
    管理请求的完整生命周期：等待 → 生成 → 完成
    通过 streaming 参数控制刷新频率：
    - streaming=True: 高频刷新（每次更新都刷新）
    - streaming=False: 仅在状态变化时刷新（等待→生成→完成）
    
    两种模式都使用单行覆盖（\r），区别仅在于刷新频率
    """
    
    # 状态常量
    STATE_WAITING = "waiting"
    STATE_GENERATING = "generating"
    STATE_DONE = "done"
    def __init__(
        self,
        request_id: str,
        service_name: str,
        extra_info: str = None,
        streaming: bool = True,
        task_type: str = None,
        source: str = None
    ):
        """
        创建进度条
        
        参数:
            request_id: 请求ID
            service_name: 服务名称（如 Ollama, OpenAI）
            extra_info: 额外信息（如 Context:2048 | Timeout:60s）
            streaming: True=高频刷新，False=仅状态变化时刷新
            task_type: 任务类型（用于统一日志）
            source: 来源（前端/节点）
        """
        self._request_id = request_id
        self._service_name = service_name
        self._extra_info = extra_info
        self._streaming = streaming
        self._task_type = task_type
        self._source = source
        
        self._state = self.STATE_WAITING
        self._char_count = 0
        self._start_time = time.perf_counter()
        self._closed = False
        self._stop_event = threading.Event()
        self._timer_thread = None
        
        # 1. 重置全局长度，开始新一轮进度跟踪
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0
        
        # 立即显示"等待响应"
        self._refresh()
        
        # 仅在流式模式下启动定时刷新线程（非流式模式采用静态日志，无需跳秒刷新）
        if self._streaming:
            self._timer_thread = threading.Thread(target=self._timer_loop, daemon=True)
            self._timer_thread.start()
    
    def _format_elapsed(self) -> str:
        """格式化耗时"""
        elapsed_sec = time.perf_counter() - self._start_time
        if elapsed_sec < 60:
            return f"{elapsed_sec:.1f}s"
        else:
            minutes = int(elapsed_sec // 60)
            seconds = int(elapsed_sec % 60)
            return f"{minutes}m{seconds}s"
    
    def _render(self) -> str:
        """渲染当前进度条内容"""
        elapsed = self._format_elapsed()
        
        if self._state == self.STATE_WAITING:
            # 等待响应：✨ 🟠 等待Ollama响应...
            # 流式模式下添加计时，非流式模式保持静态
            base = f"{PREFIX} 🟠 等待{self._service_name}响应..."
            if not self._streaming:
                return base
            
            if self._extra_info:
                return f"{base} | {self._extra_info} | {elapsed}"
            else:
                return f"{base} | {elapsed}"
        
        elif self._state == self.STATE_GENERATING:
            # 流式模式：显示字符数和时间
            # 静态模式：只显示简单的 "生成中..."
            if self._streaming:
                return f"{PREFIX} 🔵 生成中 | {self._char_count}字符 | {elapsed}"
            else:
                return f"{PREFIX} 🔵 生成中..."
        
        else:
            return ""
    
    def _refresh(self) -> None:
        """内部刷新方法：单行覆盖输出"""
        if self._closed:
            return
        
        output = self._render()
        if not output:
            return
        
        with _progress_lock:
            global _global_last_output_len
            # 计算当前内容的显示宽度（解决中文/emoji 导致的 len() 不准问题）
            current_width = get_display_width(output)
            
            # 用空格填充以覆盖上一次更长的输出（兜底方案，应对 ANSI 失效）
            padding = ""
            if _global_last_output_len > current_width:
                padding = " " * (_global_last_output_len - current_width)
            
            # 使用 \r 回到行首，先发一次 ANSI 清行（如果环境支持，瞬间清空）
            # 再输出内容 + 空格填充（应对 ANSI 失效）+ 再次清行（防止尾部残留）
            # 增加 2 个空格缓冲避免与其他日志粘连
            print(f"\r{_ANSI_CLEAR_EOL}{output}{padding}{_ANSI_CLEAR_EOL}  ", end='', flush=True)
            
            # 记录本次显示的宽度（包含缓冲空格）
            _global_last_output_len = current_width + len(padding)

    def _stop_timer(self):
        """停止计时器线程"""
        self._stop_event.set()
        # 强制将状态标为已关闭，防止重入
        self._closed = True

    def _timer_loop(self):
        """后台线程：仅在流式模式下定期刷新计时"""
        try:
            while not self._stop_event.is_set() and not self._closed:
                # 定时刷新当前内容（主要用于更新 WAITING 阶段的时间）
                self._refresh()
                
                # 每 0.1 秒刷新一次
                if self._stop_event.wait(0.1):
                    break
        except Exception:
            pass # 守护线程异常不应影响主流程
    
    def set_generating(self, char_count: int = 0) -> None:
        """
        切换到"生成中"状态
        
        参数:
            char_count: 当前字符数
        """
        if self._closed or self._state == self.STATE_GENERATING:
            return
        
        self._state = self.STATE_GENERATING
        self._char_count = char_count
        self._refresh()  # 状态变化时总是刷新
    
    def update(self, char_count: int) -> None:
        """
        更新字符数
        
        流式模式：每次调用都刷新
        静态模式：不刷新（避免刷屏）
        
        参数:
            char_count: 当前字符数
        """
        if self._closed:
            return
        
        self._char_count = char_count
        
        # 流式模式：高频刷新
        if self._streaming:
            self._refresh()
        # 静态模式：不在这里刷新，只有状态变化时才刷新
    
    def done(self, message: str = None, char_count: int = None, elapsed_ms: int = None) -> None:
        """
        完成请求
        
        参数:
            message: 自定义完成消息（可选）
            char_count: 最终字符数（可选）
            elapsed_ms: 耗时毫秒（可选，不传则自动计算）
        """
        if self._closed:
            return
        
        self._stop_timer()
        self._state = self.STATE_DONE

        
        # 重置全局长度
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0

        # 如果提供了 task_type，则使用统一日志
        if hasattr(self, '_task_type') and self._task_type:
            log_complete(
                self._task_type or "任务", 
                self._request_id, 
                self._service_name, 
                char_count if char_count is not None else self._char_count,
                elapsed_ms if elapsed_ms is not None else int((time.perf_counter() - self._start_time) * 1000),
                source=getattr(self, '_source', None)
            )
            return

        # 降级兼容：原始 done 逻辑
        # 计算耗时
        if elapsed_ms is not None:
            elapsed = format_elapsed_time(elapsed_ms)
        else:
            elapsed = self._format_elapsed()
        
        # 使用传入的字符数或当前记录的字符数
        final_count = char_count if char_count is not None else self._char_count
        
        # 生成完成消息
        if message:
            final_msg = message
        else:
            final_msg = f"{PREFIX} ✅ 完成 | 服务:{self._service_name} | ID:{self._request_id} | 字符:{final_count} | 耗时:{elapsed}"
        
        # 直接调用 log_complete 的思想：换行输出，不覆盖之前的内容
        print(f"\r{_ANSI_CLEAR_EOL}{final_msg}", flush=True)
    
    def error(self, message: str) -> None:
        """
        输出错误消息（换行输出，不覆盖）
        
        参数:
            message: 错误消息
        """
        if self._closed:
            return
        
        self._stop_timer()

        
        # 重置全局长度
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0
            
        # 如果提供了 task_type，则使用统一日志
        if hasattr(self, '_task_type') and self._task_type:
            log_error(self._task_type or "任务", self._request_id, message, source=getattr(self, '_source', None))
            return

        # 降级模式
        print(f"\r{_ANSI_CLEAR_EOL}{message}", flush=True)
    
    def cancel(self, message: str = None) -> None:
        """
        取消请求（换行输出，不覆盖）
        
        参数:
            message: 自定义取消消息（可选）
        """
        if self._closed:
            return
        
        self._stop_timer()

        
        # 重置全局长度
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0
            
        cancel_msg = message or "任务被取消"
        
        # 如果提供了 task_type，则使用统一日志
        if hasattr(self, '_task_type') and self._task_type:
            log_error(self._task_type or "任务", self._request_id, cancel_msg, source=getattr(self, '_source', None))
            return

        # 降级模式
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} {cancel_msg} | ID:{self._request_id}", flush=True)
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        if not self._closed:
            # 退出上下文时，如果没有显式调用 done/error，则视为成功完成
            self.done()

    def __del__(self):
        """析构函数：确保对象被回收时停止计时器"""
        try:
            # 仅在计时器还在运行时尝试停止
            if hasattr(self, '_stop_event') and not self._stop_event.is_set():
                self._stop_timer()
        except:
            pass








# HTTP状态码到中文错误信息的映射
HTTP_STATUS_CODE_MESSAGES = {
    400: "请求无效",
    401: "身份验证失败-请检查您的API Key是否正确。",
    403: "无权限访问-您没有权限访问此资源。",
    404: "请求的资源不存在",
    429: "请求频率过高-您已超出速率限制，请稍后再试。",
    500: "服务器内部错误- 服务提供商端发生未知问题。",
    502: "网关错误",
    503: "服务不可用- 服务器当前无法处理请求，请稍后重试。",
    504: "网关超时",
}

# 百度翻译API的错误码映射
BAIDU_ERROR_CODE_MESSAGES = {
    '52001': '请求超时，请重试',
    '52002': '系统错误，请重试',
    '52003': '未授权用户，请检查appid是否正确或服务是否开通',
    '54000': '必填参数为空，请检查是否少传参数',
    '54001': '签名错误，请检查appid和secret_key是否正确',
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


# ---错误处理函数---

def _is_auth_error(error_text: str) -> bool:
    """
    检查错误信息是否为认证相关错误
    
    参数:
        error_text: 错误文本（小写）
    
    返回:
        bool: 是否为认证错误
    """
    auth_keywords = [
        'invalid token',
        'authorization',
        'authenticate',
        'api key',
        'api_key',
        'unauthorized',
        'auth failed',
        'invalid key',
        'missing key',
        'invalid credentials',
        '身份验证',
        '认证失败',
        'token'
    ]
    return any(keyword in error_text for keyword in auth_keywords)

def format_api_error(e: Exception, provider_display_name: str) -> str:
    """
    格式化来自API的错误信息
    纯httpx实现，不依赖openai库
    
    参数:
        e: 异常对象
        provider_display_name: 服务商显示名称
    
    返回:
        str: 格式化后的错误信息
    """
    # 处理httpx的HTTP错误
    try:
        import httpx
        if isinstance(e, httpx.HTTPStatusError):
            status_code = e.response.status_code
            message = HTTP_STATUS_CODE_MESSAGES.get(status_code, "未知HTTP错误")
            
            error_details_str = ""
            detail_msg = ""
            
            try:
                error_details = e.response.json()
                detail_msg = error_details.get("message", "")
                if isinstance(error_details.get("error"), dict):
                    detail_msg = error_details["error"].get("message", detail_msg)
                
                if detail_msg:
                    error_details_str = f" | 详情: {detail_msg}"
            except (json.JSONDecodeError, AttributeError):
                try:
                    if hasattr(e.response, 'text') and e.response.text:
                        detail_msg = e.response.text[:200]
                        error_details_str = f" | 原始响应: {detail_msg}"
                except Exception:
                    pass
            
            # ---智能识别认证错误并提供友好提示---
            combined_error_text = f"{message} {detail_msg}".lower()
            if status_code == 401 or _is_auth_error(combined_error_text):
                return f"{provider_display_name} 认证失败: 未配置API Key或API Key无效，请在服务商配置中填写正确的API Key"
                    
            return f"{provider_display_name} API错误: {message} (状态码: {status_code}){error_details_str}"
    except Exception:
        pass
        
    # 对于其他类型的异常，返回其类型和基本信息
    return f"{provider_display_name} 服务请求异常: ({type(e).__name__}) {str(e)}"


def format_baidu_translate_error(error_data: dict) -> str:
    """
    格式化百度翻译API的错误信息
    
    参数:
        error_data: 百度API返回的错误数据
    
    返回:
        str: 格式化后的错误信息
    """
    if not isinstance(error_data, dict):
        return "未知的百度翻译错误格式"
        
    error_code = str(error_data.get('error_code'))
    if error_code in BAIDU_ERROR_CODE_MESSAGES:
        return f"百度翻译错误: {BAIDU_ERROR_CODE_MESSAGES[error_code]} (代码: {error_code})"
    
    error_msg = error_data.get('error_msg', '未知错误')
    return f"百度翻译错误: {error_msg} (代码: {error_code})"


# ---图像处理函数---

def get_optimal_image_params(image_count: int = 1) -> tuple:
    """
    根据图像数量智能计算最佳的分辨率和质量参数
    目标：保证API能返回完整结果，同时尽可能保持图像质量
    
    参数:
        image_count: 图像数量 (1-32)
    
    返回:
        tuple: (max_size: tuple, quality: int, compression_level: str)
    """
    if image_count <= 1:
        # 单图：使用中等质量
        return (1024, 1024), 75, "中等"
    elif image_count <= 3:
        # 1-3帧：保持较高质量
        return (1024, 1024), 70, "较高"
    elif image_count <= 6:
        # 4-6帧：降低分辨率，保持中等质量
        return (768, 768), 70, "中等"
    elif image_count <= 10:
        # 7-10帧：进一步降低分辨率和质量
        return (640, 640), 65, "较低"
    elif image_count <= 16:
        # 11-16帧：使用低分辨率
        return (512, 512), 60, "低"
    else:
        # 17-32帧：最大压缩，保证能处理
        return (480, 480), 55, "极低"


def preprocess_image(
    image_data: str,
    max_size: tuple = None,  # 改为可选，支持自动计算
    quality: int = None,  # 改为可选，支持自动计算
    request_id: Optional[str] = None,
    silent: bool = False,
    image_count: int = 1  # 新增：总图像数量，用于动态调整
) -> str:
    """
    预处理图像数据（压缩和调整大小）
    
    参数:
        image_data: Base64编码的图像数据
        max_size: 最大尺寸，默认为None（自动计算）
        quality: JPEG压缩质量 (1-100)，默认为None（自动计算）
        request_id: 请求ID，用于日志输出
        silent: 是否静默模式（不输出日志）
        image_count: 总图像数量，用于多图场景的智能优化
    
    返回:
        str: 处理后的图像数据
    """
    try:
        # 智能计算最佳参数
        if max_size is None or quality is None:
            optimal_size, optimal_quality, compression_level = get_optimal_image_params(image_count)
            max_size = max_size or optimal_size
            quality = quality or optimal_quality
        else:
            compression_level = "自定义"
        
        # 检查是否为base64编码的图像数据
        if image_data.startswith('data:image'):
            # 提取base64数据
            header, encoded = image_data.split(",", 1)
            image_bytes = base64.b64decode(encoded)
            original_bytes = len(image_bytes)
            
            # 打开图像
            img = Image.open(BytesIO(image_bytes))
            original_size = img.size
            
            # 计算缩放比例
            if img.size[0] > max_size[0] or img.size[1] > max_size[1]:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # 转换为RGB（如果是RGBA）
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = background
            
            # 压缩图像
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            compressed_bytes = buffer.getvalue()
            compressed_size = len(compressed_bytes)
            
            # 编码为base64
            compressed_b64 = base64.b64encode(compressed_bytes).decode('utf-8')
            processed_image_data = f"data:image/jpeg;base64,{compressed_b64}"
            
            # 输出日志
            if not silent:
                compression_ratio = (1 - compressed_size / original_bytes) * 100 if original_bytes > 0 else 0
                
                # 多图场景显示压缩等级
                if image_count > 1:
                    print(
                        f"{REQUEST_PREFIX} 🟡 图像预处理 | "
                        f"尺寸:{original_size}→{img.size} | "
                        f"大小:{original_bytes/1024:.1f}KB→{compressed_size/1024:.1f}KB | "
                        f"压缩率:{compression_ratio:.1f}% | "
                        f"等级:{compression_level} ({image_count}帧)"
                    )
                else:
                    print(
                        f"{REQUEST_PREFIX} 🟡 图像预处理完成 | "
                        f"尺寸:{original_size}→{img.size} | "
                        f"大小:{original_bytes/1024:.1f}KB→{compressed_size/1024:.1f}KB | "
                        f"压缩率:{compression_ratio:.1f}%"
                    )
            
            return processed_image_data
        
        # 如果不是base64编码的图像数据，直接返回
        return image_data
    
    except Exception as e:
        if not silent:
            print(f"{WARN_PREFIX} ❌图像预处理失败 | 请求ID:{request_id} | 错误:{str(e)}")
        # 预处理失败时返回原始图像数据
        return image_data


def check_multi_image_support(provider: str, model: str) -> tuple:
    """
    检查服务商是否支持多图像分析
    
    参数:
        provider: 服务商标识
        model: 模型名称
        
    返回:
        tuple: (支持多图像: bool, 最大图像数: int)
    """
    model_lower = (model or "").lower()
    
    # Gemini系列：支持多图像
    if "gemini" in model_lower or "google" in model_lower:
        return (True, 3000)
    
    # 智谱GLM系列视觉模型
    # GLM-4.6V系列：128K上下文，支持大量多图（无官方硬限制）
    if "glm" in model_lower and "4.6v" in model_lower:
        return (True, 100)
    
    # GLM-4V系列（4V-Plus等）：16K上下文，最多5张
    if "glm" in model_lower and ("4v" in model_lower or "vision" in model_lower):
        return (True, 5)
    
    # Qwen系列：支持多图像
    if "qwen" in model_lower and ("vl" in model_lower or "vision" in model_lower):
        return (True, 100)
    
    # OpenAI GPT-4V及兼容模型：支持多图像
    if "gpt-4" in model_lower and ("vision" in model_lower or "v" in model_lower or "turbo" in model_lower):
        return (True, 100)
    
    # 其他OpenAI兼容的视觉模型
    if any(keyword in model_lower for keyword in ["vision", "visual", "vl", "multimodal"]):
        return (True, 10)
    
    # 默认：不支持多图像
    return (False, 0)
