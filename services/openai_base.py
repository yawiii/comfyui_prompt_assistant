"""
OpenAI兼容服务基类
为LLM和VLM服务提供统一的OpenAI兼容API处理逻辑
"""

import json
import time
import asyncio
import os
import httpx
from typing import Optional, Dict, Any, List, Callable
from pathlib import Path
from datetime import datetime
from .core import BaseAPIService, HTTPClientPool
from ..utils.common import (
    format_api_error, ProgressBar, log_complete, log_error,
    PREFIX, PROCESS_PREFIX, WARN_PREFIX, ERROR_PREFIX, format_elapsed_time
)
from .thinking_control import build_thinking_suppression
import re


# ==================== 思维链输出过滤 ====================

def filter_thinking_content(text: str) -> str:
    """
    过滤模型输出中的思维链内容
    支持多种标签格式：<think>, <reasoning>, <thoughts>
    
    参数:
        text: 原始模型输出文本
    
    返回:
        str: 过滤后的文本
    """
    if not text:
        return text
    
    # 1. 优先匹配成对的思维链标签
    # 匹配 <think>...</think> 等成对结构
    pattern_pair = r'<(think|thinking|reasoning|thoughts?)\b[^>]*>[\s\S]*?</\1\s*>'
    text = re.sub(pattern_pair, '', text, flags=re.IGNORECASE)
    
    # 2. 兜底处理：如果存在未闭合的开头标签（通常出现在最开头），移除从该标签起的全部内容
    pattern_leading_open = r'^\s*<(think|thinking|reasoning|thoughts?)\b[^>]*>[\s\S]*$'
    text = re.sub(pattern_leading_open, '', text, flags=re.IGNORECASE)
    
    # 3. 移除残留的孤立标签本身（避免误删正文内容）
    pattern_orphan_tags = r'</?(think|thinking|reasoning|thoughts?)\b[^>]*>'
    text = re.sub(pattern_orphan_tags, '', text, flags=re.IGNORECASE)
    
    return text.strip()


class OpenAICompatibleService(BaseAPIService):
    """
    OpenAI兼容API服务基类
    处理所有OpenAI格式的API请求（智谱、硅基流动、302.ai、Ollama等）
    """
    
    # ---已知的API端点路径（用于智能检测）---
    _known_endpoints = ['/chat/completions', '/v1/messages', '/completions']

    @staticmethod
    def _sanitize_filename_part(value: str) -> str:
        if value is None:
            return "none"
        s = str(value).strip()
        if not s:
            return "empty"
        s = re.sub(r'[^a-zA-Z0-9._-]+', '_', s)
        return s[:120] or "empty"

    @classmethod
    def _get_debug_log_file(cls, provider_display_name: str, request_id: Optional[str]) -> Path:
        base_dir = Path(__file__).resolve().parent.parent
        log_dir = base_dir / "debug_logs"
        log_dir.mkdir(parents=True, exist_ok=True)

        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
        provider_part = cls._sanitize_filename_part(provider_display_name)
        req_part = cls._sanitize_filename_part(request_id) if request_id else "no_request_id"
        pid_part = str(os.getpid())
        return log_dir / f"api_debug_{ts}_{provider_part}_{req_part}_{pid_part}.log"

    @staticmethod
    def _append_debug_log(path: Optional[Path], title: str, data: Any = None) -> None:
        if not path:
            return
        try:
            ts = datetime.now().isoformat(timespec="milliseconds")
            with path.open("a", encoding="utf-8", newline="\n") as f:
                f.write(f"\n[{ts}] {title}\n")
                if data is None:
                    return
                if isinstance(data, str):
                    f.write(data)
                    if not data.endswith("\n"):
                        f.write("\n")
                    return
                f.write(json.dumps(data, ensure_ascii=False, indent=2))
                f.write("\n")
        except Exception:
            return
    
    @staticmethod
    def parse_api_url(raw_url: str) -> str:
        """
        智能解析 base_url，生成最终请求地址
        
        规则：
        1. '#' 结尾 → 强制使用完整地址（移除#）
        2. 已包含已知端点路径 → 直接使用，不再拼接
        3. 其他 → 正常拼接 /chat/completions
        
        参数:
            raw_url: 用户输入的原始URL
            
        返回:
            str: 最终请求地址
        """
        if not raw_url:
            return ''
        
        url = raw_url.strip()
        
        # 规则1：井号强制模式 - 用户明确要求使用完整地址
        if url.endswith('#'):
            return url[:-1].rstrip('/')
        
        # 规则2：智能检测 - 检查URL中是否已包含已知的API端点
        for endpoint in OpenAICompatibleService._known_endpoints:
            if endpoint in url:
                # 已包含完整端点，直接返回（移除末尾斜杠）
                return url.rstrip('/')
        
        # 规则3：常规模式 - 需要拼接 /chat/completions
        return url.rstrip('/') + '/chat/completions'
    
    # _provider_base_urls 和 _provider_display_names 已移除，相关逻辑改由 config_manager 统一管理
    
    @staticmethod
    def _filter_payload(payload: Dict[str, Any], level: int) -> Dict[str, Any]:
        """
        根据重试级别清洗请求体 (简化的三级降级策略)
        
        Level 0: 完整请求 (按用户设置发送)
        Level 1: 移除思维链参数 (thinking, enable_thinking, reasoning_effort, 等)
        Level 2: 最小可用集 (仅 model, messages, stream)
        """
        if level <= 0:
            return payload.copy()
            
        filtered = payload.copy()
        
        # Level 1: 移除思维链参数
        thinking_keys = [
            "thinking", "enable_thinking", "reasoning_effort", 
            "reasoning", "thinking_level", "think"
        ]
        for k in thinking_keys:
            filtered.pop(k, None)
            
        if level >= 2:
            # Level 2: 最小可用集 - 仅保留必选参数
            core_keys = ["model", "messages", "stream"]
            filtered = {k: filtered[k] for k in core_keys if k in filtered}
            
        return filtered

    @staticmethod
    def _merge_system_prompts(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        合并多条System Message为单一条目
        并将System Message置于列表首位
        解决部分服务商不支持多条System Message的问题
        """
        system_contents = []
        other_messages = []
        
        for msg in messages:
            if msg.get('role') == 'system':
                content = msg.get('content', '')
                if content:
                    system_contents.append(content)
            else:
                other_messages.append(msg)
        
        if not system_contents:
            return messages
            
        # 合并内容
        merged_system = "\n\n".join(system_contents)
        
        # 构建新列表：System在首位 + 其他消息
        return [{"role": "system", "content": merged_system}] + other_messages

    @classmethod
    async def _http_request_chat_completions(
        cls,
        base_url: str,
        api_key: str,
        model: str,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        top_p: float = 0.9,
        max_tokens: int = 2000,
        send_temperature: bool = True,
        send_top_p: bool = True,
        send_max_tokens: bool = True,
        thinking_extra: Optional[Dict[str, Any]] = None,
        enable_advanced_params: bool = False,
        stream_callback: Optional[Callable[[str], None]] = None,
        request_id: Optional[str] = None,
        provider_display_name: str = "未知服务",
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: str = None,
        debug_mode: bool = False,
        custom_request_params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        使用HTTP直连调用/chat/completions接口
        统一处理所有OpenAI兼容的服务商 (支持三级降级重试)
        
        参数:
            enable_advanced_params: 是否发送高级参数(temperature/top_p/max_tokens)
        """
        from ..server import is_streaming_progress_enabled
        
        try:
            debug_enabled = bool(debug_mode)
            debug_log_file = cls._get_debug_log_file(provider_display_name, request_id) if debug_enabled else None
            if debug_enabled:
                cls._append_debug_log(
                    debug_log_file,
                    "debug_start",
                    {
                        "provider": provider_display_name,
                        "base_url": base_url,
                        "model": model,
                        "request_id": request_id
                    }
                )
            # 构建请求URL
            url = cls.parse_api_url(base_url)
            
            # 预处理：合并System Prompts (Level 0 默认应用)
            merged_messages = cls._merge_system_prompts(messages)
            
            # 构建基础请求体 (仅必选参数)
            initial_payload = {
                "model": model,
                "messages": merged_messages,
                "stream": True
            }
            
            # 仅在用户开启"启用高级参数"时才发送 temperature、top_p、max_tokens
            if enable_advanced_params:
                if send_temperature:
                    initial_payload["temperature"] = temperature
                if send_top_p:
                    initial_payload["top_p"] = top_p
                if send_max_tokens:
                    initial_payload["max_tokens"] = max_tokens
            
            # 添加思维链控制参数
            if thinking_extra:
                initial_payload.update(thinking_extra)
            
            if custom_request_params:
                for k, v in custom_request_params.items():
                    if k in {"model", "messages", "stream"}:
                        continue
                    initial_payload[k] = v
            
            # 构建请求头
            headers = {"Content-Type": "application/json"}
            if api_key and api_key.strip():
                headers["Authorization"] = f"Bearer {api_key}"
            
            # 获取HTTP客户端
            client = HTTPClientPool.get_client(
                provider=provider_display_name,
                base_url=base_url,
                timeout=60.0
            )

            # 前置中断检查：如果 ComfyUI 已经中断了，不启动请求
            from server import PromptServer
            if hasattr(PromptServer.instance, 'execution_interrupted') and PromptServer.instance.execution_interrupted:
                return {"success": False, "error": "任务被中断", "interrupted": True}
            
            # 创建统一进度条（自动处理等待→生成→完成的完整生命周期）
            pbar = ProgressBar(
                request_id=request_id,
                service_name=provider_display_name,
                streaming=is_streaming_progress_enabled(),
                task_type=task_type,
                source=source
            )
            
            start_time = time.perf_counter()
            last_error_msg = ""
            
            # 三级降级重试循环 (Level 0 -> Level 2)
            for retry_level in range(3):
                current_payload = cls._filter_payload(initial_payload, retry_level)
                
                if debug_enabled:
                    try:
                        cls._append_debug_log(
                            debug_log_file,
                            f"request_json level={retry_level} url={url}",
                            current_payload
                        )
                    except Exception:
                        pass
                
                # 如果不是Level 0，打印降级重试警告（换行输出）
                if retry_level > 0:
                    removed_keys = set(initial_payload.keys()) - set(current_payload.keys())
                    removed_str = ", ".join(removed_keys) if removed_keys else "无参数变动"
                    print(f"\n{WARN_PREFIX} ⚠️ HTTP 400错误, 触发Level-{retry_level}降级重试 | 服务:{provider_display_name} | 移除参数:[{removed_str}]", flush=True)
                    
                    # 关键修复：停止旧的进度条后再创建新的，防止线程泄漏
                    if pbar:
                        try:
                            pbar.error(f"Retry Level {retry_level}...") # 标记前一个进度条为错误/重试状态
                        except:
                            pbar._stop_timer()

                    
                    # 重新创建进度条用于新一轮重试
                    pbar = ProgressBar(
                        request_id=request_id,
                        service_name=provider_display_name,
                        extra_info=f"Retry-{retry_level}",
                        streaming=is_streaming_progress_enabled(),
                        task_type=task_type,
                        source=source
                    )
                
                async def _do_stream_request():
                    nonlocal pbar
                    debug_response_chunks = [] if debug_enabled else None
                    
                    # 定义请求核心逻辑
                    async def _request_core():
                        async with client.stream('POST', url, headers=headers, json=current_payload, follow_redirects=True) as response:
                            if response.status_code != 200:
                                error_text = await response.aread()
                                try:
                                    error_data = json.loads(error_text)
                                    msg = error_data.get('error', {}).get('message', f'HTTP {response.status_code}')
                                except:
                                    msg = f'HTTP {response.status_code}: {error_text.decode("utf-8", errors="ignore")[:200]}'
                                
                                # 智能识别认证错误
                                from ..utils.common import _is_auth_error
                                if response.status_code == 401 or _is_auth_error(msg.lower()):
                                    msg = "API Key无效或缺失"
                                
                                debug_info = None
                                if debug_enabled:
                                    try:
                                        debug_info = {
                                            "request": current_payload,
                                            "response": {
                                                "status_code": response.status_code,
                                                "body": error_text.decode("utf-8", errors="ignore")
                                            }
                                        }
                                        cls._append_debug_log(
                                            debug_log_file,
                                            f"response_error status={response.status_code}",
                                            debug_info
                                        )
                                    except Exception:
                                        pass
                                
                                error_msg = msg
                                if debug_enabled and debug_info is not None:
                                    try:
                                        error_msg = f"{msg}\n\n[DEBUG]\n{json.dumps(debug_info, ensure_ascii=False, indent=2)}"
                                    except Exception:
                                        error_msg = msg
                                
                                return {
                                    "success": False, 
                                    "error": error_msg,
                                    "status_code": response.status_code,
                                    "should_retry": response.status_code == 400,
                                    "debug": debug_info
                                }
                            
                            full_content = ""
                            reasoning_content = ""
                            
                            async for line in response.aiter_lines():
                                # 此处的循环检查依然保留，作为双重保险
                                if cancel_event is not None and cancel_event.is_set():
                                    raise asyncio.CancelledError()
                                
                                if not line or line == "data: [DONE]" or line == "data:[DONE]": continue
                                if line.startswith("data: "): line = line[6:]
                                elif line.startswith("data:"): line = line[5:]
                                
                                try:
                                    chunk = json.loads(line)
                                    if debug_enabled and debug_response_chunks is not None:
                                        debug_response_chunks.append(chunk)
                                    # --- 调试日志 (2级): 输出原始流式数据 ---
                                    # print(f"[DEBUG-2] Chunk: {line[:200]}...", flush=True)
                                    
                                    if chunk.get('choices'):
                                        choice0 = chunk['choices'][0] or {}
                                        delta = choice0.get('delta') or {}
                                        message = choice0.get('message') or {}
                                        
                                        content = delta.get('content', '') or delta.get('text', '') or ''
                                        if not content and message:
                                            content = message.get('content', '') or message.get('text', '') or ''
                                        if not content:
                                            content = choice0.get('text', '') or ''
                                        
                                        if isinstance(content, list):
                                            merged = []
                                            for part in content:
                                                if isinstance(part, dict):
                                                    merged.append(part.get('text', '') or '')
                                                else:
                                                    merged.append(str(part))
                                            content = "".join(merged)
                                        
                                        # 针对不同厂商的推理字段进行广谱捕获
                                        reasoning = (
                                            delta.get('reasoning_content', '') or 
                                            delta.get('reasoning', '') or 
                                            delta.get('thinking', '') or 
                                            delta.get('thinking_process', '') or  # 备选
                                            ''
                                        )
                                        if not reasoning and message:
                                            reasoning = (
                                                message.get('reasoning_content', '') or
                                                message.get('reasoning', '') or
                                                message.get('thinking', '') or
                                                message.get('thinking_process', '') or
                                                ''
                                            )
                                        if reasoning: reasoning_content += reasoning
                                        if content:
                                            full_content += content
                                            if stream_callback: stream_callback(content)
                                            pbar.set_generating(len(full_content))
                                            pbar.update(len(full_content))
                                except:
                                    if debug_enabled and debug_response_chunks is not None:
                                        debug_response_chunks.append({"_raw": line})
                                    continue
                            
                            final_content = full_content
                            if reasoning_content:
                                final_content = f"<think>{reasoning_content}</think>\n{full_content}"
                            
                            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
                            if not final_content.strip():
                                pbar.error("响应内容为空")
                                debug_info = None
                                if debug_enabled:
                                    try:
                                        debug_info = {
                                            "request": current_payload,
                                            "response": {
                                                "status_code": 200,
                                                "chunks": debug_response_chunks or [],
                                                "aggregated": {
                                                    "reasoning": reasoning_content,
                                                    "content": full_content
                                                }
                                            }
                                        }
                                        cls._append_debug_log(
                                            debug_log_file,
                                            "response_empty_content",
                                            debug_info
                                        )
                                    except Exception:
                                        pass
                                
                                error_msg = "API返回内容为空"
                                if debug_enabled and debug_info is not None:
                                    try:
                                        error_msg = f"{error_msg}\n\n[DEBUG]\n{json.dumps(debug_info, ensure_ascii=False, indent=2)}"
                                    except Exception:
                                        pass
                                
                                return {"success": False, "error": error_msg, "debug": debug_info}
                            
                            pbar.done(char_count=len(final_content), elapsed_ms=elapsed_ms)
                            
                            debug_info = None
                            if debug_enabled:
                                try:
                                    debug_info = {
                                        "request": current_payload,
                                        "response": {
                                            "status_code": 200,
                                            "chunks": debug_response_chunks or [],
                                            "aggregated": {
                                                "reasoning": reasoning_content,
                                                "content": full_content
                                            }
                                        }
                                    }
                                    cls._append_debug_log(
                                        debug_log_file,
                                        "response_success_aggregated",
                                        debug_info
                                    )
                                except Exception:
                                    pass
                            
                            return {"success": True, "content": final_content, "debug": debug_info}

                    # 定义监视器逻辑：每100ms检查一次中断信号
                    async def _monitor_interrupts(target_task):
                        while not target_task.done():
                            is_interrupted = False
                            if cancel_event is not None and cancel_event.is_set():
                                is_interrupted = True
                            else:
                                try:
                                    from server import PromptServer
                                    if hasattr(PromptServer.instance, 'execution_interrupted') and PromptServer.instance.execution_interrupted:
                                        is_interrupted = True
                                except:
                                    pass
                            
                            if is_interrupted:
                                target_task.cancel()
                                return True
                            await asyncio.sleep(0.1)
                        return False

                    # 并发运行请求和监视器
                    req_task = asyncio.create_task(_request_core())
                    monitor_task = asyncio.create_task(_monitor_interrupts(req_task))
                    
                    try:
                        result = await req_task
                        # 关键修复：API 返回错误时，确保进度条被停止
                        if not result.get("success") and not result.get("interrupted"):
                            if not getattr(pbar, '_closed', False):
                                pbar.error(result.get("error", "API 错误"))
                        return result
                    except asyncio.CancelledError:
                        pbar.cancel(f"{WARN_PREFIX} 任务被中断 | 服务:{provider_display_name}")
                        return {"success": False, "error": "中断", "interrupted": True}
                    finally:
                        if not monitor_task.done():
                            monitor_task.cancel()

                # 执行请求
                try:
                    result = await _do_stream_request()
                except Exception as req_err:
                    if 'pbar' in locals() and pbar:
                        pbar.error(f"网络请求异常: {req_err}")
                    
                    debug_info = None
                    error_msg = f"网络请求异常: {req_err}"
                    if debug_enabled:
                        try:
                            debug_info = {
                                "request": current_payload,
                                "error": str(req_err)
                            }
                            cls._append_debug_log(
                                debug_log_file,
                                "network_exception",
                                debug_info
                            )
                            error_msg = f"{error_msg}\n\n[DEBUG]\n{json.dumps(debug_info, ensure_ascii=False, indent=2)}"
                        except Exception:
                            pass
                    
                    return {"success": False, "error": error_msg, "debug": debug_info}

                # 检查结果
                if result["success"]:
                    # Ollama 服务成功后尝试卸载模型
                    if provider_display_name.lower().find("ollama") != -1:
                        try:
                            from ..config_manager import config_manager
                            service_config = config_manager.get_service(provider_display_name) or {}
                            await cls._unload_ollama_model(model, service_config)
                        except:
                            pass
                    return result
                
                if result.get("interrupted"):
                    return result

                last_error_msg = result["error"]
                
                # 只有 should_retry 为 True (HTTP 400) 且还有重试机会时，才继续循环
                if not result.get("should_retry"):
                    break # 非400错误（如401, 500等），不进行降级重试，直接返回错误
            
            # 所有重试耗尽或非可重试错误
            if 'pbar' in locals() and pbar:
                pbar.error(last_error_msg)
            return {"success": False, "error": last_error_msg}
        
        # 关键修复：单独捕获 CancelledError，确保进度条被正确停止
        except asyncio.CancelledError:
            if 'pbar' in locals() and pbar:
                pbar.cancel(f"{WARN_PREFIX} 任务被外部取消 | 服务:{provider_display_name}")
            return {"success": False, "error": "任务被取消", "interrupted": True}
                    
        except Exception as e:
            if 'pbar' in locals() and pbar:
                pbar.error(format_api_error(e, provider_display_name))
            return {"success": False, "error": format_api_error(e, provider_display_name)}
    
    @staticmethod
    async def _unload_ollama_model(model: str, provider_config: Dict[str, Any]):
        """
        卸载Ollama模型以释放显存和内存
        
        参数:
            model: 模型名称
            provider_config: 提供商配置字典
        """
        try:
            # 检查是否启用自动释放
            auto_unload = provider_config.get('auto_unload', True)
            if not auto_unload:
                from ..utils.common import PROCESS_PREFIX
                print(f"{PROCESS_PREFIX} Ollama模型已保留 | 模型:{model}")
                return
            
            # 获取base_url
            base_url = provider_config.get('base_url', 'http://localhost:11434')
            if base_url.endswith('/v1'):
                base_url = base_url[:-3]
            
            # 调用Ollama API卸载模型
            url = f"{base_url}/api/generate"
            payload = {
                "model": model,
                "keep_alive": 0
            }
            
            # 创建临时客户端（卸载操作不需要复用）
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    from ..utils.common import PROCESS_PREFIX
                    print(f"{PROCESS_PREFIX} Ollama模型已释放 | 模型:{model}")
                
        except Exception as e:
            from ..utils.common import WARN_PREFIX
            print(f"{WARN_PREFIX} Ollama模型释放失败（不影响结果） | 模型:{model} | 错误:{str(e)[:50]}")
    
    @classmethod
    def get_provider_display_name(cls, provider: str) -> str:
        """
        获取提供商显示名称
        优先从config_manager获取服务的真实名称，兜底使用provider key
        """
        # 优先尝试从config_manager获取服务名称
        try:
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            if service and 'name' in service:
                return service['name']
        except Exception:
            pass
        
        # 兜底直接返回key
        return provider
    
    @classmethod
    def get_provider_base_url(cls, provider: str, config: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """
        获取提供商的base_url
        仅用于custom provider的逻辑，其他情况应直接从config获取
        """
        if provider == 'custom' and config:
            base_url = config.get('base_url')
            # 确保base_url不以/chat/completions结尾
            if base_url and base_url.endswith('/chat/completions'):
                base_url = base_url[:-len('/chat/completions')]
            return base_url
        
        return None
