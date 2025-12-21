"""
图像处理工具模块
提供图像tensor转换、哈希计算等通用图像处理方法
"""

import base64
import hashlib
from io import BytesIO
from typing import Optional

import numpy as np
import torch
from PIL import Image


def tensor_to_base64(image_tensor: torch.Tensor, quality: int = 95) -> str:
    """
    将图像tensor转换为base64编码的data URL
    
    参数:
        image_tensor: 图像tensor,形状为 [H, W, C] 或 [B, H, W, C]
        quality: JPEG压缩质量 (1-100),默认95
    
    返回:
        base64编码的data URL,格式: "data:image/jpeg;base64,..."
    """
    # 如果是4D tensor,取第一张图片
    if len(image_tensor.shape) == 4:
        image_tensor = image_tensor[0]
    
    # 转换为numpy数组并缩放到0-255范围
    image_np = (image_tensor.cpu().numpy() * 255).astype(np.uint8)
    
    # 创建PIL图像
    image = Image.fromarray(image_np)
    
    # 转换为JPEG格式的字节流
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    
    # 转换为base64编码
    encoded_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    # 返回带有MIME类型的data URL
    return f"data:image/jpeg;base64,{encoded_image}"


def compute_image_hash(image_tensor: Optional[torch.Tensor]) -> str:
    """
    计算图像tensor的哈希值,用于 IS_CHANGED 检测
    
    算法: 只使用第一帧的中心区域作为哈希计算依据,避免计算量过大
    
    参数:
        image_tensor: 图像tensor,形状为 [B, H, W, C] 或 None
    
    返回:
        MD5哈希值的十六进制字符串,如果输入为None或计算失败则返回 "0"
    """
    if image_tensor is None:
        return "0"
    
    try:
        if len(image_tensor.shape) == 4:
            # 取第一帧的中心区域作为哈希计算依据
            h, w = image_tensor.shape[1:3]
            center_h, center_w = h // 2, w // 2
            size = min(100, h // 4, w // 4)  # 限制计算区域大小
            
            img_data = image_tensor[0,
                                   max(0, center_h - size):min(h, center_h + size),
                                   max(0, center_w - size):min(w, center_w + size),
                                   0].cpu().numpy().tobytes()
            return hashlib.md5(img_data).hexdigest()
        else:
            # 如果不是4D tensor,使用整个tensor的哈希
            img_data = image_tensor.cpu().numpy().tobytes()
            return hashlib.md5(img_data).hexdigest()
    except Exception:
        return "0"
