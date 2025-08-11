import asyncio
import random
import time
import threading
import copy
from typing import Dict, Any, List, Optional
import base64
from io import BytesIO
import os
import json

import torch
import numpy as np
from PIL import Image

from server import PromptServer
from ..server import send_toast_notification
from ..services.vlm import VisionService
from ..services.error_util import format_api_error
from comfy.model_management import InterruptProcessingException

# 定义ANSI颜色代码常量
GREEN = "\033[92m"
RESET = "\033[0m"


def run_async_vision_analysis(image_data, prompt_template, request_id, result_container, provider=None, provider_config=None, client_id=None):
    """
    在一个新的事件循环中运行异步图像分析任务
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            VisionService.analyze_image(image_data, request_id, "zh", None, prompt_template, provider, provider_config)
        )
        result_container['result'] = result
    finally:
        loop.close()


class ImageCaptionNode:
    """
    图像反推提示词节点
    分析输入图像并生成描述性提示词
    """
    # 定义日志前缀（带绿色）
    LOG_PREFIX = f"{GREEN}[PromptAssistant]{RESET}"
    
    @classmethod
    def INPUT_TYPES(cls):
        # 从config_manager获取系统提示词配置
        from ..config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()
        
        # 获取所有vision_prompts作为选项
        vision_prompts = {}
        if system_prompts and 'vision_prompts' in system_prompts:
            vision_prompts = system_prompts['vision_prompts']
        
        # 构建提示词模板选项
        prompt_template_options = []
        for key, value in vision_prompts.items():
            name = value.get('name', key)
            prompt_template_options.append(name)
        
        # 如果没有选项，添加一个默认选项
        if not prompt_template_options:
            prompt_template_options = ["默认中文反推提示词"]
        
        return {
            "required": {
                "图像": ("IMAGE",),
                "规则类型": (["规则模板", "手动输入"], {"default": "规则模板"}),
                "规则模板": (prompt_template_options, {"default": prompt_template_options[0] if prompt_template_options else "默认中文反推提示词"}),
                "临时规则内容": ("STRING", {"multiline": True, "default": "", "placeholder": "规则类型设置为\"手动输入\"后，输入框内容才会生效"}),
                "视觉服务": (["智谱", "硅基流动", "自定义"], {"default": "智谱"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "client_id": "CLIENT_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("提示词输出",)
    FUNCTION = "analyze_image"
    CATEGORY = "✨提示词小助手"
    OUTPUT_NODE = True
    
    @classmethod
    def IS_CHANGED(cls, 图像, 规则类型, 规则模板, 临时规则内容, 视觉服务, unique_id=None, extra_pnginfo=None, client_id=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 计算图像的哈希值（只使用第一帧的部分数据，避免计算量过大）
        if 图像 is not None:
            if len(图像.shape) == 4:
                # 取第一帧的中心区域作为哈希计算依据
                h, w = 图像.shape[1:3]
                center_h, center_w = h // 2, w // 2
                size = min(100, h // 4, w // 4)  # 限制计算区域大小
                img_hash = hash(图像[0, 
                                  max(0, center_h - size):min(h, center_h + size),
                                  max(0, center_w - size):min(w, center_w + size), 
                                  0].cpu().numpy().tobytes())
            else:
                # 如果不是4D张量，使用整个张量的哈希
                img_hash = hash(图像.cpu().numpy().tobytes())
        else:
            img_hash = 0
            
        # 组合所有输入的哈希值
        input_hash = hash((
            img_hash,
            规则类型,
            规则模板,
            临时规则内容,
            视觉服务
        ))
        
        return input_hash
    
    def analyze_image(self, 图像, 规则类型, 规则模板, 临时规则内容, 视觉服务, unique_id=None, extra_pnginfo=None, client_id=None):
        """
        分析图像并生成提示词
        
        Args:
            图像: 输入的图像数据
            规则类型: 选择使用模板还是手动输入
            规则模板: 选择的提示词模板
            临时规则内容: 临时规则的内容
            视觉服务: 选择的视觉服务
            unique_id: 节点的唯一ID
            extra_pnginfo: 额外的PNG信息
            client_id: 客户端ID
            
        Returns:
            dict: 包含UI显示和分析结果
        """
        try:
            # 创建请求ID
            request_id = f"image_caption_{int(time.time())}_{random.randint(1000, 9999)}"
            
            # 将图像转换为base64编码
            image_data = self._image_to_base64(图像)
            
            # 获取提示词模板内容
            prompt_template = None
            
            if 规则类型 == "手动输入" and 临时规则内容:
                prompt_template = 临时规则内容
                print(f"{self.LOG_PREFIX} 图像反推: 使用手动输入规则")
            else:
                # 从config_manager获取系统提示词配置
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()
                
                # 获取vision_prompts
                vision_prompts = {}
                if system_prompts and 'vision_prompts' in system_prompts:
                    vision_prompts = system_prompts['vision_prompts']
                
                # 查找选定的提示词模板
                template_found = False
                for key, value in vision_prompts.items():
                    if value.get('name') == 规则模板:
                        prompt_template = value.get('content')
                        template_found = True
                        print(f"{self.LOG_PREFIX} 图像反推: 使用模板 '{规则模板}'")
                        break
                
                if not template_found:
                    print(f"{self.LOG_PREFIX} 图像反推: 未找到模板 '{规则模板}'，尝试直接匹配键名")
                    # 尝试直接匹配键名
                    for key, value in vision_prompts.items():
                        if key == 规则模板:
                            prompt_template = value.get('content')
                            template_found = True
                            print(f"{self.LOG_PREFIX} 图像反推: 使用模板 '{规则模板}'")
                            break
            
            # 如果没有找到提示词模板，使用默认值
            if not prompt_template:
                prompt_template = "请详细描述这张图片的内容，包括主体、场景、风格、色彩等要素。"
                print(f"{self.LOG_PREFIX} 图像反推: 未找到模板 '{规则模板}'，使用默认提示词")
            
            result_container = {}
            
            # 从config_manager获取配置
            from ..config_manager import config_manager
            import nodes

            # 映射视觉服务选项到provider
            provider_map = {
                "智谱": "zhipu",
                "硅基流动": "siliconflow",
                "自定义": "custom"
            }
            
            # 获取选定的provider
            selected_provider = provider_map.get(视觉服务)
            if not selected_provider:
                error_text = f"[分析错误] 不支持的视觉服务: {视觉服务}"
                # 发送toast通知
                send_toast_notification(client_id, "error", "[✨图像反推] 分析错误", f"不支持的视觉服务: {视觉服务}")
                return {"ui": {"提示词输出": error_text}, "result": (error_text,)}
            
            # 获取对应provider的配置
            provider_config = self._get_provider_config(config_manager, selected_provider)
            if not provider_config:
                error_text = f"[分析错误] 未找到{视觉服务}的配置"
                # 发送toast通知
                send_toast_notification(client_id, "error", "[✨图像反推] 分析错误", f"未找到{视觉服务}的配置，请先完成API配置")
                return {"ui": {"提示词输出": error_text}, "result": (error_text,)}
            
            print(f"{self.LOG_PREFIX} 图像反推: 使用{视觉服务}服务, API: {provider_config.get('model')}")
            
            # 在独立线程中运行图像分析
            thread = threading.Thread(
                target=run_async_vision_analysis,
                args=(image_data, prompt_template, request_id, result_container, selected_provider, provider_config, client_id)
            )
            thread.start()

            # 非阻塞等待并检查中断
            while thread.is_alive():
                nodes.before_node_execution()
                time.sleep(0.1)

            result = result_container.get('result')

            # 检查分析结果
            if result and result.get('success'):
                description = result.get('data', {}).get('description', '')
                
                # 更新节点的widgets_values
                try:
                    if unique_id is not None and extra_pnginfo is not None:
                        # 更安全的方式处理extra_pnginfo
                        if isinstance(extra_pnginfo, list) and len(extra_pnginfo) > 0:
                            if isinstance(extra_pnginfo[0], dict) and "workflow" in extra_pnginfo[0]:
                                workflow = extra_pnginfo[0]["workflow"]
                                node = next(
                                    (x for x in workflow["nodes"] if str(x["id"]) == str(unique_id)),
                                    None,
                                )
                                if node:
                                    node["widgets_values"] = [规则类型, 规则模板, 临时规则内容, 视觉服务]
                except Exception as e:
                    print(f"{self.LOG_PREFIX} 更新节点widgets_values时出错: {str(e)}")
                
                return {"ui": {"提示词输出": description}, "result": (description,)}
            else:
                error_msg = result.get('error', '分析失败，未知错误') if result else '分析线程未返回结果'
                print(f"{self.LOG_PREFIX} 图像反推节点错误: {error_msg}")
                error_text = f"[分析错误] {error_msg}"
                # 发送toast通知
                send_toast_notification(client_id, "error", "[✨图像反推] 分析失败", error_msg)
                return {"ui": {"提示词输出": error_text}, "result": (error_text,)}
                
        except InterruptProcessingException:
            # 用户取消任务时，静默处理
            print(f"{self.LOG_PREFIX} 用户取消了图像反推任务。")
            return {"ui": {"提示词输出": "[任务已取消]"}, "result": ("[任务已取消]",)}
        except Exception as e:
            error_msg = format_api_error(e, 视觉服务)
            print(f"{self.LOG_PREFIX} 图像反推节点异常: {error_msg}")
            error_text = f"[分析异常] {error_msg}"
            # 发送toast通知
            send_toast_notification(client_id, "error", "[✨图像反推] 分析异常", error_msg)
            return {"ui": {"提示词输出": error_text}, "result": (error_text,)}
    
    def _get_provider_config(self, config_manager, provider):
        """获取指定provider的配置"""
        vision_config = config_manager.get_vision_config()
        if 'providers' in vision_config and provider in vision_config['providers']:
            return vision_config['providers'][provider]
        return None
    
    def _image_to_base64(self, image_tensor):
        """将图像张量转换为base64编码"""
        # 确保图像是正确的形状 [batch, height, width, channels]
        if len(image_tensor.shape) == 4:
            # 取第一张图片
            image_tensor = image_tensor[0]
        
        # 将图像转换为numpy数组并缩放到0-255范围
        image_np = (image_tensor.cpu().numpy() * 255).astype(np.uint8)
        
        # 创建PIL图像
        image = Image.fromarray(image_np)
        
        # 将图像转换为JPEG格式的字节流
        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=95)
        
        # 将字节流转换为base64编码
        encoded_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        # 返回带有MIME类型的data URL
        return f"data:image/jpeg;base64,{encoded_image}"

# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "ImageCaptionNode": ImageCaptionNode,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageCaptionNode": "✨图像反推提示词",
} 