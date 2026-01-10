"""
视频帧提取工具模块
提供基于帧索引的精确帧提取功能
使用 imageio 替代 cv2 以减少依赖冲突并提高兼容性
"""

import imageio
import base64
import os
from io import BytesIO
from PIL import Image
import numpy as np


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
    reader = None
    try:
        # 使用 imageio 读取视频
        reader = imageio.get_reader(video_path, 'ffmpeg')
        meta = reader.get_meta_data()
        
        # 获取原始视频属性
        original_fps = meta.get('fps', 0)
        total_original_frames = 0
        try:
            total_original_frames = reader.count_frames()
        except Exception:
            # 如果无法获取帧数，尝试从时长和帧率计算
            duration = meta.get('duration', 0)
            if duration > 0 and original_fps > 0:
                total_original_frames = int(duration * original_fps)
        
        if original_fps <= 0:
            if reader: reader.close()
            return {"success": False, "error": "无法获取视频帧率"}
        
        # 计算实际要读取的原始帧位置
        if force_rate > 0 and abs(force_rate - original_fps) > 0.1:
            # force_rate 会改变帧采样：从原始帧中按比例抽取
            # 帧索引 i 对应的原始帧位置 = i * (original_fps / force_rate)
            actual_frame_pos = int(frame_index * (original_fps / force_rate))
        else:
            actual_frame_pos = frame_index
        
        # 边界检查
        if total_original_frames > 0:
            if actual_frame_pos >= total_original_frames:
                actual_frame_pos = total_original_frames - 1
        if actual_frame_pos < 0:
            actual_frame_pos = 0
            
        # 读取帧
        try:
            frame = reader.get_data(actual_frame_pos)
        except (IndexError, ValueError):
            # 如果超出范围，尝试读取最后一帧
            try:
                frame = reader.get_data(0)  # 兜底
            except Exception:
                if reader: reader.close()
                return {"success": False, "error": f"无法读取帧 {actual_frame_pos}"}
        
        if frame is None:
            if reader: reader.close()
            return {"success": False, "error": f"读取到的帧为空 {actual_frame_pos}"}
        
        # imageio 返回的 frame 是 RGB 格式的 numpy 数组
        # 转换为 PIL Image 进行处理
        img = Image.fromarray(frame)
        
        # 编码为 JPEG
        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=60)
        
        # Base64 编码
        base64_data = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        width, height = img.size
        
        return {
            "success": True,
            "data": base64_data,
            "width": width,
            "height": height,
            "frame_index": frame_index,
            "actual_frame_pos": actual_frame_pos
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if reader:
            try:
                reader.close()
            except Exception:
                pass


def get_video_frame_info(video_path, force_rate=0):
    """
    获取视频帧相关信息
    
    Args:
        video_path: 视频文件路径
        force_rate: 强制帧率
    
    Returns:
        dict: {success, original_fps, force_fps, total_frames, duration}
    """
    reader = None
    try:
        reader = imageio.get_reader(video_path, 'ffmpeg')
        meta = reader.get_meta_data()
        
        original_fps = meta.get('fps', 0)
        duration = meta.get('duration', 0)
        
        try:
            total_original_frames = reader.count_frames()
        except Exception:
            if duration > 0 and original_fps > 0:
                total_original_frames = int(duration * original_fps)
            else:
                total_original_frames = 0
        
        if original_fps <= 0:
            # 某些格式可能没有 fps，尝试从时长和总帧数反推
            if duration > 0 and total_original_frames > 0:
                original_fps = total_original_frames / duration
            else:
                if reader: reader.close()
                return {"success": False, "error": "无法获取视频帧率"}
        
        if duration <= 0:
            if original_fps > 0 and total_original_frames > 0:
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
    finally:
        if reader:
            try:
                reader.close()
            except Exception:
                pass
