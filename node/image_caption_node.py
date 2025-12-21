import asyncio
import random
import time
import threading
import hashlib
import base64
from io import BytesIO
import os
import json

import torch
import numpy as np
from PIL import Image
from comfy.model_management import InterruptProcessingException

from ..services.vlm import VisionService
from ..utils.common import format_api_error, format_model_with_thinking, generate_request_id, log_prepare, log_error, TASK_IMAGE_CAPTION, SOURCE_NODE
from ..services.thinking_control import build_thinking_suppression
from .base import VLMNodeBase


class ImageCaptionNode(VLMNodeBase):
    """
    图像反推提示词节点
    分析输入图像并生成描述性提示词
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        # 从config_manager获取系统提示词配置
        from ..config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()

        # 获取所有vision_prompts作为选项
        vision_prompts = {}
        if system_prompts and 'vision_prompts' in system_prompts:
            vision_prompts = system_prompts['vision_prompts']

        # 构建提示词模板选项（支持分类格式：类别/规则名称）
        prompt_template_options = []
        for key, value in vision_prompts.items():
            # 过滤掉不在后端显示的规则
            show_in = value.get('showIn', ["frontend", "node"])
            if 'node' not in show_in:
                continue

            name = value.get('name', key)
            category = value.get('category', '')
            # 如果有分类，显示为 "类别/规则名称"，否则直接显示规则名称
            display_name = f"{category}/{name}" if category else name
            prompt_template_options.append(display_name)

        # 如果没有选项，添加一个默认选项
        if not prompt_template_options:
            prompt_template_options = ["默认中文反推提示词"]
        
        # ---动态获取VLM服务/模型列表---
        service_options = cls.get_vlm_service_options()
        default_service = service_options[0] if service_options else "智谱"

        return {
            "required": {
                "image": ("IMAGE",),
                "rule": (prompt_template_options, {"default": prompt_template_options[0] if prompt_template_options else "默认中文反推提示词", "tooltip": "Choose a preset rule for image captioning"}),
                "custom_rule": ("BOOLEAN", {"default": False, "label_on": "Enable", "label_off": "Disable", "tooltip": "Enable to use custom rule content below"}),
                "custom_rule_content": ("STRING", {"multiline": True, "default": "", "placeholder": "在此输入临时规则，仅在启用'临时规则'时生效"}),
                "user_prompt": ("STRING", {"multiline": True, "default": "", "placeholder": "输入额外的具体要求，将与规则一起发送给模型"}),
                "vlm_service": (service_options, {"default": default_service, "tooltip": "Select VLM service and model"}),
                # Ollama Automatic VRAM Unload
                "ollama_auto_unload": ("BOOLEAN", {"default": True, "label_on": "Enable", "label_off": "Disable", "tooltip": "Auto unload Ollama model after generation"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt_output",)
    FUNCTION = "analyze_image"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False
    
    @classmethod
    def IS_CHANGED(cls, image=None, rule=None, custom_rule=None, custom_rule_content=None, user_prompt=None, vlm_service=None, ollama_auto_unload=None, unique_id=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 导入图像哈希工具函数
        from ..utils.image import compute_image_hash
        
        # 计算图像的哈希值
        img_hash = compute_image_hash(image)

        # 组合所有输入的哈希值
        input_hash = hash((
            img_hash,
            rule,
            bool(custom_rule),
            custom_rule_content,
            user_prompt,
            vlm_service,
            bool(ollama_auto_unload)
        ))

        return input_hash
    
    def analyze_image(self, image, rule, custom_rule, custom_rule_content, user_prompt, vlm_service, ollama_auto_unload, unique_id=None):
        """
        分析图像并生成提示词

        Args:
            图像: 输入的图像数据
            规则模板: 选择的提示词模板
            临时规则: 是否启用临时规则
            临时规则内容: 临时规则的内容
            用户提示词: 用户补充的提示词
            视觉服务: 选择的视觉服务

        Returns:
            tuple: 分析结果
        """
        try:
            # 检查输入
            if image is None:
                raise ValueError("输入图像不能为空")

            # 将图像转换为base64编码
            image_data = self._image_to_base64(image)

            # 获取提示词模板内容
            prompt_template = None

            # 确定使用的规则
            rule_name = "Custom Rule" if (custom_rule and custom_rule_content) else rule
            
            if custom_rule and custom_rule_content:
                prompt_template = custom_rule_content
            else:
                # 从config_manager获取系统提示词配置
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()

                # 获取vision_prompts
                vision_prompts = {}
                if system_prompts and 'vision_prompts' in system_prompts:
                    vision_prompts = system_prompts['vision_prompts']

                # 查找选定的提示词模板（按显示名称匹配）
                # 显示名称格式：有分类时为 "类别/规则名称"，无分类时为 "规则名称"
                template_found = False
                for key, value in vision_prompts.items():
                    name = value.get('name', key)
                    category = value.get('category', '')
                    # 构建与下拉列表一致的显示名称
                    display_name = f"{category}/{name}" if category else name
                    if display_name == rule:
                        prompt_template = value.get('content')
                        template_found = True
                        break

                if not template_found:
                    # 允许用规则名称或键名直接匹配（兼容旧格式）
                    for key, value in vision_prompts.items():
                        if value.get('name') == rule or key == rule:
                            prompt_template = value.get('content')
                            template_found = True
                            break

                # 如果没有找到提示词模板，使用默认值
                if not template_found or not prompt_template:
                    prompt_template = "请详细描述这张图片的内容，包括主体、场景、风格、色彩等要素。"
                    rule_name = "Default Rule"

            # 拼接用户提示词
            if user_prompt and user_prompt.strip():
                prompt_template = f"{prompt_template}\n\n用户补充要求：\n{user_prompt}"

            # ---解析服务/模型字符串---
            service_id, model_name = self.parse_service_model(vlm_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {vlm_service}")
            
            # ---获取服务配置---
            from ..config_manager import config_manager
            service = config_manager.get_service(service_id)
            if not service:
                raise ValueError(f"Service config not found: {vlm_service}")
            
            # ---构建provider_config---
            # 查找指定的模型或默认模型
            vlm_models = service.get('vlm_models', [])
            target_model = None
            
            if model_name:
                # 查找指定的模型
                target_model = next((m for m in vlm_models if m.get('name') == model_name), None)
            
            if not target_model:
                # 使用默认模型或第一个模型
                target_model = next((m for m in vlm_models if m.get('is_default')), 
                                    vlm_models[0] if vlm_models else None)
            
            if not target_model:
                raise ValueError(f"Service {vlm_service} has no available models")
            
            # 构建配置对象
            provider_config = {
                'provider': service_id,
                'model': target_model.get('name', ''),
                'base_url': service.get('base_url', ''),
                'api_key': service.get('api_key', ''),
                'temperature': target_model.get('temperature', 0.7),
                'max_tokens': target_model.get('max_tokens', 500),
                'top_p': target_model.get('top_p', 0.9),
            }
            
            # Ollama特殊处理:添加auto_unload配置
            if service.get('type') == 'ollama':
                provider_config['auto_unload'] = ollama_auto_unload

            # 创建请求ID
            request_id = generate_request_id("icap", None, unique_id)
            
            # 检查是否关闭思维链
            model_full_name = provider_config.get('model')
            disable_thinking_enabled = service.get('disable_thinking', True)
            thinking_extra = build_thinking_suppression(service_id, model_full_name) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))
            
            # 获取服务显示名称
            service_display_name = service.get('name', service_id)
            
            # 准备阶段日志
            log_prepare(TASK_IMAGE_CAPTION, request_id, SOURCE_NODE, service_display_name, model_display, rule_name)

            # 执行图像分析
            result = self._run_vision_task(
                VisionService.analyze_image,
                service_id,
                image_data=image_data,
                request_id=request_id,
                stream_callback=None,
                prompt_content=prompt_template,
                custom_provider=service_id,
                custom_provider_config=provider_config,
                task_type=TASK_IMAGE_CAPTION,
                source=SOURCE_NODE
            )

            if result and result.get('success'):
                description = result.get('data', {}).get('description', '').strip()
                if not description:
                    error_msg = 'API返回结果为空，请检查API密钥、模型配置或网络连接'
                    log_error(TASK_IMAGE_CAPTION, request_id, error_msg, source=SOURCE_NODE)
                    raise RuntimeError(f"分析失败: {error_msg}")

                # 服务层已经打印了完成日志，这里不再重复
                return (description,)
            else:
                error_msg = result.get('error', '分析失败，未知错误') if result else '分析服务未返回结果'
                # 如果是中断错误,直接抛出InterruptProcessingException,不打印日志(由基类打印)
                if error_msg == "任务被中断":
                    raise InterruptProcessingException()
                log_error(TASK_IMAGE_CAPTION, request_id, error_msg, source=SOURCE_NODE)
                raise RuntimeError(f"分析失败: {error_msg}")

        except InterruptProcessingException:
            # 不打印日志,由基类统一打印
            raise
        except Exception as e:
            error_msg = format_api_error(e, vlm_service)
            log_error(TASK_IMAGE_CAPTION, request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"分析异常: {error_msg}")


# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "ImageCaptionNode": ImageCaptionNode,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageCaptionNode": "✨图像反推提示词",
} 