"""
视频帧提取工具模块
提供基于帧索引的精确帧提取功能
"""

import cv2
import base64
import os
from io import BytesIO


# ---帧提取核心功能---

def extract_frame_by_index(video_path, frame_index, force_rate=0):
    """
    从视频中提取指定帧索引的图像
    
    Args:
        video_path: 视频文件路径
        frame_index: 目标帧索引（基于 force_rate 后的帧序列）
        force_rate: 强制帧率，0 表示使用原始帧率
    
    Returns:
        dict: {success, data (base64 JPEG), width, height} 或 {success, error}
    """
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"success": False, "error": "无法打开视频文件"}
        
        # 获取原始视频属性
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        total_original_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        if original_fps <= 0:
            cap.release()
            return {"success": False, "error": "无法获取视频帧率"}
        
        # 计算实际要读取的原始帧位置
        if force_rate > 0 and force_rate != original_fps:
            # force_rate 会改变帧采样：从原始帧中按比例抽取
            # 帧索引 i 对应的原始帧位置 = i * (original_fps / force_rate)
            actual_frame_pos = int(frame_index * (original_fps / force_rate))
        else:
            actual_frame_pos = frame_index
        
        # 边界检查
        if actual_frame_pos >= total_original_frames:
            actual_frame_pos = total_original_frames - 1
        if actual_frame_pos < 0:
            actual_frame_pos = 0
            
        # 定位并读取帧
        cap.set(cv2.CAP_PROP_POS_FRAMES, actual_frame_pos)
        ret, frame = cap.read()
        cap.release()
        
        if not ret or frame is None:
            return {"success": False, "error": f"无法读取帧 {frame_index}"}
        
        # BGR 转 RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # 编码为 JPEG（降低质量加快传输）
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 60]
        _, buffer = cv2.imencode('.jpg', cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR), encode_param)
        
        # Base64 编码
        base64_data = base64.b64encode(buffer).decode('utf-8')
        
        return {
            "success": True,
            "data": base64_data,
            "width": frame.shape[1],
            "height": frame.shape[0],
            "frame_index": frame_index,
            "actual_frame_pos": actual_frame_pos
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_video_frame_info(video_path, force_rate=0):
    """
    获取视频帧相关信息
    
    Args:
        video_path: 视频文件路径
        force_rate: 强制帧率
    
    Returns:
        dict: {success, original_fps, force_fps, total_frames, duration}
    """
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"success": False, "error": "无法打开视频文件"}
        
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        total_original_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        
        if original_fps <= 0:
            return {"success": False, "error": "无法获取视频帧率"}
        
        duration = total_original_frames / original_fps
        
        # 计算 force_rate 后的实际帧数
        if force_rate > 0:
            actual_fps = force_rate
            actual_total_frames = int(duration * force_rate)
        else:
            actual_fps = original_fps
            actual_total_frames = total_original_frames
        
        return {
            "success": True,
            "original_fps": original_fps,
            "actual_fps": actual_fps,
            "original_total_frames": total_original_frames,
            "actual_total_frames": actual_total_frames,
            "duration": duration
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}
