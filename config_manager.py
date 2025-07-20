import os
import json

class ConfigManager:
    def __init__(self):
        # 插件目录和配置文件路径
        self.dir_path = os.path.dirname(os.path.abspath(__file__))
        self.config_path = os.path.join(self.dir_path, "config.json")
        
        # 默认配置
        self.default_config = {
            "__comment": "请在下方配置百度翻译和智谱AI的API密钥",
            "baidu_translate": {
                "app_id": "",
                "secret_key": ""
            },
            "llm": {
                "api_key": "",
                "base_url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                "model": "glm-4-flash",
                "vision_model": "glm-4v-flash"
            }
        }
        
        # 确保配置文件存在
        self.ensure_config_exists()
    
    def ensure_config_exists(self):
        """确保配置文件存在，不存在则创建默认配置"""
        if not os.path.exists(self.config_path):
            print("[PromptAssistant] 配置文件不存在，创建默认配置文件...")
            self.save_config(self.default_config)
    
    def load_config(self):
        """加载配置文件"""
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[PromptAssistant] 加载配置文件失败: {str(e)}")
            return self.default_config
    
    def save_config(self, config):
        """保存配置文件"""
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"[PromptAssistant] 保存配置文件失败: {str(e)}")
            return False
    
    def get_baidu_translate_config(self):
        """获取百度翻译配置"""
        config = self.load_config()
        return config.get("baidu_translate", self.default_config["baidu_translate"])
    
    def get_llm_config(self):
        """
        获取LLM配置。如果未配置，则提供默认值。
        """
        config = self.load_config()
        llm_config = config.get('llm', {})
        
        # 从self.default_config中获取默认值，避免重复定义
        defaults = self.default_config.get('llm', {})
        
        # 合并默认值和用户配置
        return {**defaults, **llm_config}

    def update_baidu_translate_config(self, app_id, secret_key):
        """更新百度翻译配置"""
        config = self.load_config()
        config["baidu_translate"] = {
            "app_id": app_id,
            "secret_key": secret_key
        }
        return self.save_config(config)
    
    def update_llm_config(self, api_key=None, base_url=None, model=None, vision_model=None):
        """
        更新LLM配置
        """
        config = self.load_config()
        if 'llm' not in config:
            config['llm'] = {}

        if api_key is not None:
            config['llm']['api_key'] = api_key
        if base_url is not None:
            config['llm']['base_url'] = base_url
        if model is not None:
            config['llm']['model'] = model
        if vision_model is not None:
            config['llm']['vision_model'] = vision_model
            
        return self.save_config(config)

# 创建全局配置管理器实例
config_manager = ConfigManager() 