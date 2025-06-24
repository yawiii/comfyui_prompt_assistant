
import os
import re
from server import PromptServer
from . import server

# ANSI颜色常量
GREEN = "\033[92m"
RESET = "\033[0m"

# 模块常量定义
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

def get_version():
    """
    从pyproject.toml文件中读取版本号
    
    Returns:
        str: 版本号字符串
    
    Raises:
        ValueError: 当无法找到版本号时抛出
    """
    try:
        toml_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
        with open(toml_path, "r", encoding='utf-8') as f:
            content = f.read()
            version_match = re.search(r'version\s*=\s*"([^"]+)"', content)
            if version_match:
                return version_match.group(1)
            raise ValueError("未在pyproject.toml中找到版本号")
    except Exception as e:
        print(f"读取版本号失败: {str(e)}")
        raise

def inject_version_to_frontend():
    """
    将版本号注入到前端全局变量
    """
    js_code = f"""
window.PromptAssistant_Version = "{VERSION}";
    """
    
    js_dir = os.path.join(os.path.dirname(__file__), "js")
    if not os.path.exists(js_dir):
        os.makedirs(js_dir)
    
    version_file = os.path.join(js_dir, "version.js")
    with open(version_file, "w", encoding='utf-8') as f:
        f.write(js_code)

# 初始化版本号
VERSION = get_version()

# 执行初始化操作
inject_version_to_frontend()

# 打印初始化信息
print(f"✨提示词小助手 V{VERSION} {GREEN}已启动{RESET}")



