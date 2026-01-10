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
from ..utils.common import format_api_error, log_prepare, log_error, SOURCE_NODE, generate_request_id
from .base import VLMNodeBase


class KontextPresetNode(VLMNodeBase):
    """
    Kontext预设助手节点
    使用Kontext预设分析图像并生成创意转换指令
    """
    
    # 缓存配置数据，避免重复从文件系统读取
    _kontext_config = None
    
    @classmethod
    def _load_kontext_config(cls):
        """加载Kontext配置，使用缓存避免重复读取文件"""
        if cls._kontext_config is None:
            try:
                from ..config_manager import config_manager
                # 使用 config_manager 的 kontext_presets_path (指向 rules 目录)
                kontext_presets_path = config_manager.kontext_presets_path
                
                if os.path.exists(kontext_presets_path):
                    with open(kontext_presets_path, "r", encoding="utf-8") as f:
                        cls._kontext_config = json.load(f)
                else:
                    cls._kontext_config = {}
            except Exception as e:
                print(f"{cls.LOG_PREFIX} 加载Kontext配置失败: {str(e)}")
                cls._kontext_config = {}
        return cls._kontext_config

    
    @classmethod
    def INPUT_TYPES(cls):
        # 获取kontext_presets
        kontext_presets = {}
        config_data = cls._load_kontext_config()
        if 'kontext_presets' in config_data:
            kontext_presets = config_data['kontext_presets']

        # 构建提示词模板选项
        prompt_template_options = []
        for key, value in kontext_presets.items():
            name = value.get('name', key)
            prompt_template_options.append(name)

        # 如果没有选项，添加一个默认选项
        if not prompt_template_options:
            prompt_template_options = ["情境深度融合"]
        
        # ---动态获取VLM服务/模型列表---
        service_options = cls.get_vlm_service_options()
        default_service = service_options[0] if service_options else "智谱"

        return {
            "required": {
                "image": ("IMAGE",),
                "kontext_preset": (prompt_template_options, {"default": prompt_template_options[0] if prompt_template_options else "情境深度融合"}),
                "user_prompt": ("STRING", {"multiline": True, "default": "", "placeholder": "输入额外的具体要求,将与预设一起发送给模型"}),
                "vlm_service": (service_options, {"default": default_service, "tooltip": "Select VLM service and model"}),
                # Ollama Automatic VRAM Unload
                "ollama_auto_unload": ("BOOLEAN", {"default": True, "label_on": "Enable", "label_off": "Disable", "tooltip": "Auto unload Ollama model after generation"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("creative_instruction",)
    FUNCTION = "analyze_image"
    CATEGORY = "✨Prompt Assistant"
    OUTPUT_NODE = False
    
    @classmethod
    def IS_CHANGED(cls, image=None, kontext_preset=None, user_prompt=None, vlm_service=None, ollama_auto_unload=None):
        """
        只在输入内容真正变化时才触发重新执行
        使用输入参数的哈希值作为判断依据
        """
        # 检查是否包含强制刷新符号 [R]
        if cls._check_is_changed_bypass(kontext_preset, user_prompt):
            return float("nan")

        # 导入图像哈希工具函数
        from ..utils.image import compute_image_hash
        
        # 计算图像的哈希值
        img_hash = compute_image_hash(image)

        # 组合所有输入的哈希值
        input_hash = hash((
            img_hash,
            kontext_preset,
            user_prompt,
            vlm_service,
            bool(ollama_auto_unload)
        ))

        return input_hash
    
    def analyze_image(self, image, kontext_preset, user_prompt, vlm_service, ollama_auto_unload):
        """
        使用Kontext预设分析图像并生成创意转换指令

        Args:
            image: 输入的图像数据
            kontext_preset: 选择的Kontext预设
            user_prompt: 用户补充的提示词
            vlm_service: 选择的视觉服务

        Returns:
            tuple: 分析结果
        """
        try:
            # 检查输入
            if image is None:
                raise ValueError("输入图像不能为空")

            # 将图像转换为base64编码
            image_data = self._image_to_base64(image)

            # 获取kontext配置
            config_data = self.__class__._load_kontext_config()
            kontext_prefix = config_data.get('kontext_prefix', "")
            kontext_suffix = config_data.get('kontext_suffix', "")
            kontext_presets = config_data.get('kontext_presets', {})
            
            # 获取提示词模板内容
            prompt_template = None

            # 查找选定的提示词模板
            preset_name = kontext_preset
            template_found = False
            for key, value in kontext_presets.items():
                if value.get('name') == kontext_preset:
                    prompt_template = value.get('content')
                    template_found = True
                    break

            if not template_found:
                # 尝试直接匹配键名
                for key, value in kontext_presets.items():
                    if key == kontext_preset or key == f"kontext_{kontext_preset}":
                        prompt_template = value.get('content')
                        template_found = True
                        break

            # 如果没有找到提示词模板，使用默认值
            if not prompt_template:
                prompt_template = "Transform the image into a detailed pencil sketch with fine lines and careful shading."
                preset_name = "默认预设"

            # 构建最终提示词，添加前缀和后缀
            final_prompt = prompt_template
            if kontext_prefix and kontext_suffix:
                final_prompt = f"{kontext_prefix}\n\nThe Brief: {prompt_template}\n\n{kontext_suffix}"
            
            # 拼接用户提示词
            if user_prompt and user_prompt.strip():
                final_prompt = f"{final_prompt}\n\n用户补充要求：\n{user_prompt}"

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
            request_id = f"kontext_preset_{int(time.time())}_{random.randint(1000, 9999)}"
            
            # 获取服务显示名称
            service_display_name = service.get('name', service_id)
            
            # 准备阶段日志
            log_prepare("Kontext预设", request_id, SOURCE_NODE, service_display_name, provider_config.get('model'), preset_name)

            # 执行图像分析
            result = self._run_vision_task(
                VisionService.analyze_image,
                service_id,
                image_data=image_data,
                request_id=request_id,
                stream_callback=None,
                prompt_content=final_prompt,
                custom_provider=service_id,
                custom_provider_config=provider_config,
                task_type="Kontext预设",
                source=SOURCE_NODE
            )

            if result and result.get('success'):
                description = result.get('data', {}).get('description', '').strip()
                if not description:
                    error_msg = 'API returned empty result'
                    log_error("Kontext预设", request_id, error_msg, source=SOURCE_NODE)
                    raise RuntimeError(f"Analysis failed: {error_msg}")

                # 服务层已经打印了完成日志，这里不再重复
                return (description,)
            else:
                error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
                # 如果是中断错误,直接打印日志并抛出InterruptProcessingException
                if error_msg == "任务被中断":
                    print(f"{self.LOG_PREFIX} ⛔️Task cancelled by user | RequestID:{request_id}")
                    raise InterruptProcessingException()
                log_error("Kontext预设", request_id, error_msg, source=SOURCE_NODE)
                raise RuntimeError(f"Analysis failed: {error_msg}")

        except InterruptProcessingException:
            print(f"{self.LOG_PREFIX} ⛔️Task cancelled by user | RequestID:{request_id}")
            raise
        except Exception as e:
            error_msg = format_api_error(e, vlm_service)
            log_error("Kontext预设", request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"Analysis error: {error_msg}")


# 节点映射，用于向ComfyUI注册节点
NODE_CLASS_MAPPINGS = {
    "KontextPresetNode": KontextPresetNode,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "KontextPresetNode": "✨Kontext Preset",
} 