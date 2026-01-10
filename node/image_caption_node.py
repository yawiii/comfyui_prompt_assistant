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

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt_output", "prompt_list")
    OUTPUT_IS_LIST = (False, True)
    FUNCTION = "analyze_image"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False
    
    @classmethod
    def IS_CHANGED(cls, image=None, rule=None, custom_rule=None, custom_rule_content=None, user_prompt=None, vlm_service=None, ollama_auto_unload=None, unique_id=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 检查是否包含强制刷新符号 [R]
        if cls._check_is_changed_bypass(rule, custom_rule_content, user_prompt):
            return float("nan")

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
    
    def _analyze_single_image(self, image_data, prompt_template, rule_name, service_id, service, provider_config, unique_id, frame_index=None):
        """
        分析单张图像（内部方法）
        
        Args:
            image_data: base64编码的图像数据
            prompt_template: 提示词模板
            rule_name: 规则名称
            service_id: 服务ID
            service: 服务配置
            provider_config: Provider配置
            unique_id: 节点唯一ID
            frame_index: 批次中的帧索引（用于日志标识）
        
        Returns:
            str: 图像描述结果
        """
        # 创建请求ID（包含帧索引信息）
        frame_suffix = f"_f{frame_index}" if frame_index is not None else ""
        request_id = generate_request_id("icap", None, unique_id) + frame_suffix
        
        # 检查是否关闭思维链
        model_full_name = provider_config.get('model')
        disable_thinking_enabled = service.get('disable_thinking', True)
        thinking_extra = build_thinking_suppression(service_id, model_full_name) if disable_thinking_enabled else None
        model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))
        
        # 获取服务显示名称
        service_display_name = service.get('name', service_id)
        
        # 准备阶段日志（包含帧信息）
        frame_info = f" [帧 {frame_index + 1}]" if frame_index is not None else ""
        log_prepare(TASK_IMAGE_CAPTION, request_id, SOURCE_NODE, service_display_name, model_display, rule_name + frame_info)

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
            return description
        else:
            error_msg = result.get('error', '分析失败，未知错误') if result else '分析服务未返回结果'
            if error_msg == "任务被中断":
                raise InterruptProcessingException()
            log_error(TASK_IMAGE_CAPTION, request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"分析失败: {error_msg}")

    def analyze_image(self, image, rule, custom_rule, custom_rule_content, user_prompt, vlm_service, ollama_auto_unload, unique_id=None):
        """
        分析图像并生成提示词（支持 batch 遍历）

        Args:
            image: 输入的图像数据，支持单张或 batch
            rule: 选择的提示词模板
            custom_rule: 是否启用临时规则
            custom_rule_content: 临时规则的内容
            user_prompt: 用户补充的提示词
            vlm_service: 选择的视觉服务
            ollama_auto_unload: Ollama 自动卸载开关
            unique_id: 节点唯一ID

        Returns:
            tuple: 分析结果，batch 输入时结果用换行符分隔
        """
        request_id = None  # 初始化，用于异常处理
        
        try:
            # 检查输入
            if image is None:
                raise ValueError("输入图像不能为空")

            # ---准备提示词模板---
            prompt_template = None
            rule_name = "Custom Rule" if (custom_rule and custom_rule_content) else rule
            
            if custom_rule and custom_rule_content:
                prompt_template = custom_rule_content
            else:
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()

                vision_prompts = {}
                if system_prompts and 'vision_prompts' in system_prompts:
                    vision_prompts = system_prompts['vision_prompts']

                # 按显示名称匹配
                template_found = False
                for key, value in vision_prompts.items():
                    name = value.get('name', key)
                    category = value.get('category', '')
                    display_name = f"{category}/{name}" if category else name
                    if display_name == rule:
                        prompt_template = value.get('content')
                        template_found = True
                        break

                if not template_found:
                    # 兼容旧格式
                    for key, value in vision_prompts.items():
                        if value.get('name') == rule or key == rule:
                            prompt_template = value.get('content')
                            template_found = True
                            break

                if not template_found or not prompt_template:
                    prompt_template = "请详细描述这张图片的内容，包括主体、场景、风格、色彩等要素。"
                    rule_name = "Default Rule"

            # 拼接用户提示词
            if user_prompt and user_prompt.strip():
                prompt_template = f"{prompt_template}\n\n用户补充要求：\n{user_prompt}"

            # ---解析服务配置---
            service_id, model_name = self.parse_service_model(vlm_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {vlm_service}")
            
            from ..config_manager import config_manager
            service = config_manager.get_service(service_id)
            if not service:
                raise ValueError(f"Service config not found: {vlm_service}")
            
            # 构建 provider_config
            vlm_models = service.get('vlm_models', [])
            target_model = None
            
            if model_name:
                target_model = next((m for m in vlm_models if m.get('name') == model_name), None)
            
            if not target_model:
                target_model = next((m for m in vlm_models if m.get('is_default')), 
                                    vlm_models[0] if vlm_models else None)
            
            if not target_model:
                raise ValueError(f"Service {vlm_service} has no available models")
            
            provider_config = {
                'provider': service_id,
                'model': target_model.get('name', ''),
                'base_url': service.get('base_url', ''),
                'api_key': service.get('api_key', ''),
                'temperature': target_model.get('temperature', 0.7),
                'max_tokens': target_model.get('max_tokens', 500),
                'top_p': target_model.get('top_p', 0.9),
            }
            
            if service.get('type') == 'ollama':
                provider_config['auto_unload'] = ollama_auto_unload

            # ---处理 batch 输入---
            # 检查是否为 4D tensor（batch 格式）
            if len(image.shape) == 4 and image.shape[0] > 1:
                # Batch 模式：逐帧处理
                batch_size = image.shape[0]
                results = []
                
                for i in range(batch_size):
                    # 提取单帧并转换为 base64
                    single_frame = image[i:i+1]  # 保持 4D 形状 [1, H, W, C]
                    image_data = self._image_to_base64(single_frame)
                    
                    # 分析单张图像
                    description = self._analyze_single_image(
                        image_data=image_data,
                        prompt_template=prompt_template,
                        rule_name=rule_name,
                        service_id=service_id,
                        service=service,
                        provider_config=provider_config,
                        unique_id=unique_id,
                        frame_index=i
                    )
                    results.append(description)
                
                # 输出：合并结果 + 列表
                combined_result = "\n---\n".join(results)
                return (combined_result, results)
            else:
                # 单张模式
                image_data = self._image_to_base64(image)
                description = self._analyze_single_image(
                    image_data=image_data,
                    prompt_template=prompt_template,
                    rule_name=rule_name,
                    service_id=service_id,
                    service=service,
                    provider_config=provider_config,
                    unique_id=unique_id,
                    frame_index=None
                )
                return (description, [description])

        except InterruptProcessingException:
            raise
        except Exception as e:
            error_msg = format_api_error(e, vlm_service)
            if request_id:
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