"""
模型列表服务
负责从不同的服务提供商获取可用的模型列表
"""

import logging
import requests
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class ModelListService:
    """模型列表服务类"""
    
    # 智谱官方模型列表（手动维护）
    # 注意：智谱官方不提供模型列表API，需要手动维护
    # 来源：https://docs.bigmodel.cn/
    ZHIPU_MODELS = {
        'llm': [
            # GLM-4 系列
            'glm-4-flash-250414',
            'glm-4-flash',
            'glm-4-plus',
            'glm-4-air-250414',
            # GLM-4.5 系列（新）
            'GLM-4.5-Flash',
            'GLM-4.5-AirX',
            'glm-4.5',
            'glm-4.6',
        ],
        'vision': [
            # GLM-4V 系列
            'GLM-4V-Flash',
            'GLM-4V',
            'glm-4v-plus-0111',
            # GLM-4.xV 系列（新）
            'GLM-4.5V',
            'glm-4.1v-thinking-flash',
        ]
    }
    
    # 推荐模型列表（精选的常用模型）
    RECOMMENDED_MODELS = {
        'zhipu': {
            'llm': [
                'GLM-4.5-Flash',
                'glm-4-flash-250414'
            ],
            'vision': [
                'glm-4v-flash',
                'GLM-4.5V'
            ]
        },
        'siliconflow': {
            'llm': [
                'Qwen/Qwen3-8B',
                'Qwen/Qwen2.5-7B-Instruct',
                'Qwen/Qwen2-7B-Instruct',
                'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
                'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B'
            ],
            'vision': [
                'THUDM/GLM-4.1V-9B-Thinking',
                'Qwen/Qwen3-VL-30B-A3B-Instruct',
                'Pro/Qwen/Qwen2.5-VL-7B-Instruct'
            ]
        },
        '302ai': {
            'llm': [
                'gpt-5-pro',
                'gpt-5-nano-2025-08-07',
                'gemini-2.5-flash-nothink',
                'gemini-2.5-pro',
                'doubao-seed-1-6-250615'
            ],
            'vision': [
                'grok-2-vision-1212',
                'grok-4-fast-non-reasoning',
                'gemini-2.5-flash-nothink',
                'gemini-2.5-pro'
            ]
        }
    }
    
    # 各服务提供商的API端点
    ENDPOINTS = {
        'zhipu': {
            'base_url': 'https://open.bigmodel.cn/api/paas/v4',
            'models_path': '/models'
        },
        'siliconflow': {
            'base_url': 'https://api.siliconflow.cn/v1',
            'models_path': '/models'
        },
        '302ai': {
            'base_url': 'https://api.302.ai/v1',
            'models_path': '/models'
        }
    }
    
    @staticmethod
    def get_recommended_models(provider: str, model_type: str = 'llm') -> Dict:
        """
        获取推荐模型列表（静态预设）
        
        Args:
            provider: 服务提供商 (zhipu, siliconflow, 302ai)
            model_type: 模型类型 ('llm' 或 'vision')
            
        Returns:
            包含推荐模型列表的字典
        """
        try:
            if provider not in ModelListService.RECOMMENDED_MODELS:
                return {
                    'success': False,
                    'error': f'提供商 {provider} 暂无推荐模型列表'
                }
            
            model_ids = ModelListService.RECOMMENDED_MODELS.get(provider, {}).get(model_type, [])
            models = [{'id': model_id, 'name': model_id} for model_id in model_ids]
            
            return {
                'success': True,
                'models': models
            }
        except Exception as e:
            logger.error(f"获取推荐模型列表失败: {str(e)}")
            return {
                'success': False,
                'error': f'获取推荐模型列表失败: {str(e)}'
            }
    
    @staticmethod
    def get_models(provider: str, api_key: str, model_type: str = 'llm', base_url: str = None) -> Dict:
        """
        获取指定服务提供商的模型列表
        
        Args:
            provider: 服务提供商 (zhipu, siliconflow, 302ai, custom)
            api_key: API密钥
            model_type: 模型类型 ('llm' 或 'vision')
            base_url: 自定义服务的base_url（仅用于custom）
            
        Returns:
            包含模型列表的字典
        """
        if provider == 'ollama':
            return ModelListService._get_ollama_models(model_type)
        
        # 自定义服务：使用OpenAI标准接口
        if provider == 'custom':
            return ModelListService._get_custom_models(api_key, base_url, model_type)
        
        # 智谱官方不提供模型列表API，使用静态列表
        if provider == 'zhipu':
            return ModelListService._get_zhipu_static_models(model_type)
        
        if provider not in ModelListService.ENDPOINTS:
            return {
                'success': False,
                'error': f'不支持的服务提供商: {provider}'
            }
        
        if not api_key or api_key.strip() == '':
            return {
                'success': False,
                'error': 'API Key为空，无法获取模型列表'
            }
        
        endpoint = ModelListService.ENDPOINTS[provider]
        url = f"{endpoint['base_url']}{endpoint['models_path']}"
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        params = {}
        
        # 根据不同的服务提供商和模型类型设置参数
        if provider == 'siliconflow':
            if model_type == 'llm':
                params['sub_type'] = 'chat'
            elif model_type == 'vision':
                # 硅基流动的视觉模型需要通过chat类型过滤，后续手动筛选支持图像的模型
                params['sub_type'] = 'chat'
        elif provider == '302ai':
            if model_type == 'llm':
                params['llm'] = '1'
            elif model_type == 'vision':
                params['vision'] = '1'
        
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                models = ModelListService._parse_models(data, provider, model_type)
                return {
                    'success': True,
                    'models': models
                }
            else:
                error_msg = f'获取模型列表失败: HTTP {response.status_code}'
                try:
                    error_data = response.json()
                    if 'error' in error_data:
                        error_msg = error_data['error'].get('message', error_msg)
                    elif 'message' in error_data:
                        error_msg = error_data['message']
                except:
                    pass
                
                logger.error(f"获取{provider}模型列表失败: {error_msg}")
                return {
                    'success': False,
                    'error': error_msg
                }
                
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'error': '请求超时，请检查网络连接'
            }
        except requests.exceptions.RequestException as e:
            logger.error(f"获取{provider}模型列表异常: {str(e)}")
            return {
                'success': False,
                'error': f'网络请求失败: {str(e)}'
            }
        except Exception as e:
            logger.error(f"获取{provider}模型列表时发生未知错误: {str(e)}")
            return {
                'success': False,
                'error': f'未知错误: {str(e)}'
            }
    
    @staticmethod
    def _get_custom_models(api_key: str, base_url: str, model_type: str = 'llm') -> Dict:
        """
        获取自定义服务的模型列表（OpenAI标准）
        
        Args:
            api_key: API密钥
            base_url: 自定义服务的base_url
            model_type: 模型类型 ('llm' 或 'vision')
            
        Returns:
            包含模型列表的字典
        """
        if not base_url or base_url.strip() == '':
            return {
                'success': False,
                'error': '自定义服务需要配置Base URL才能获取模型列表'
            }
        
        # 确保base_url不以/结尾
        base_url = base_url.rstrip('/')
        
        # 构建完整的URL（OpenAI标准）
        url = f"{base_url}/models"
        
        headers = {
            'Content-Type': 'application/json'
        }
        
        # 只有在API Key存在时才添加认证头
        if api_key and api_key.strip():
            headers['Authorization'] = f'Bearer {api_key}'
        
        try:
            response = requests.get(url, headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                models = ModelListService._parse_models(data, 'custom', model_type)
                return {
                    'success': True,
                    'models': models
                }
            else:
                error_msg = f'获取模型列表失败: HTTP {response.status_code}'
                try:
                    error_data = response.json()
                    if 'error' in error_data:
                        error_msg = error_data['error'].get('message', error_msg)
                    elif 'message' in error_data:
                        error_msg = error_data['message']
                except:
                    pass
                
                logger.error(f"获取自定义服务模型列表失败: {error_msg}")
                return {
                    'success': False,
                    'error': error_msg
                }
                
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'error': '请求超时，请检查Base URL是否正确'
            }
        except requests.exceptions.ConnectionError:
            return {
                'success': False,
                'error': '连接失败，请检查Base URL和网络连接'
            }
        except requests.exceptions.RequestException as e:
            logger.error(f"获取自定义服务模型列表异常: {str(e)}")
            return {
                'success': False,
                'error': f'网络请求失败: {str(e)}'
            }
        except Exception as e:
            logger.error(f"获取自定义服务模型列表时发生未知错误: {str(e)}")
            return {
                'success': False,
                'error': f'未知错误: {str(e)}'
            }
    
    @staticmethod
    def _get_zhipu_static_models(model_type: str = 'llm') -> Dict:
        """
        获取智谱静态模型列表
        注意：智谱官方不提供模型列表API，这里使用手动维护的静态列表
        
        Args:
            model_type: 模型类型 ('llm' 或 'vision')
            
        Returns:
            包含模型列表的字典
        """
        try:
            model_ids = ModelListService.ZHIPU_MODELS.get(model_type, [])
            models = [{'id': model_id, 'name': model_id} for model_id in model_ids]
            
            return {
                'success': True,
                'models': models
            }
        except Exception as e:
            logger.error(f"获取智谱静态模型列表失败: {str(e)}")
            return {
                'success': False,
                'error': f'获取智谱模型列表失败: {str(e)}'
            }
    
    @staticmethod
    def _get_ollama_models(model_type: str = 'llm') -> Dict:
        """
        获取Ollama本地模型列表
        
        Args:
            model_type: 模型类型 ('llm' 或 'vision')
            
        Returns:
            包含模型列表的字典
        """
        try:
            url = 'http://localhost:11434/api/tags'
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                models = []
                
                if 'models' in data:
                    for model in data['models']:
                        model_name = model.get('name', '')
                        # 不做筛选，返回所有模型
                        models.append({
                            'id': model_name,
                            'name': model_name
                        })
                
                return {
                    'success': True,
                    'models': models
                }
            else:
                return {
                    'success': False,
                    'error': 'Ollama服务未运行或无法连接'
                }
                
        except requests.exceptions.ConnectionError:
            return {
                'success': False,
                'error': 'Ollama服务未运行，请先启动Ollama'
            }
        except Exception as e:
            logger.error(f"获取Ollama模型列表失败: {str(e)}")
            return {
                'success': False,
                'error': f'获取Ollama模型列表失败: {str(e)}'
            }
    
    @staticmethod
    def _parse_models(data: Dict, provider: str, model_type: str) -> List[Dict]:
        """
        解析不同服务提供商的模型列表数据
        不做任何筛选，API返回什么就显示什么
        
        Args:
            data: API返回的原始数据
            provider: 服务提供商
            model_type: 模型类型
            
        Returns:
            标准化的模型列表
        """
        models = []
        
        if 'data' not in data:
            return models
        
        for model in data['data']:
            model_id = model.get('id', '')
            
            # 跳过非模型项
            if not model_id:
                continue
            
            # 直接添加到模型列表，不做任何筛选
            models.append({
                'id': model_id,
                'name': model_id
            })
        
        return models

