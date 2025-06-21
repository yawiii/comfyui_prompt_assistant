import os
import re
from server import PromptServer
from .server import routes

# 读取版本号
def get_version():
    try:
        toml_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
        with open(toml_path, "r", encoding='utf-8') as f:
            content = f.read()
            # 使用正则表达式匹配版本号
            version_match = re.search(r'version\s*=\s*"([^"]+)"', content)
            if version_match:
                return version_match.group(1)
            raise ValueError("未在pyproject.toml中找到版本号")
    except Exception as e:
        print(f"读取版本号失败: {str(e)}")
        raise  # 直接抛出异常，不提供保底值

# 声明版本号变量
VERSION = get_version()

# 注册节点
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# 设置Web目录
WEB_DIRECTORY = "./js"

# 注册API路由
PromptServer.instance.app.add_routes(routes)

# 将版本号注入到前端全局变量
def inject_version_to_frontend():
    # 创建包含版本号的JavaScript代码
    js_code = f"""
window.PromptAssistant_Version = "{VERSION}";
    """
    
    # 确保js目录存在
    js_dir = os.path.join(os.path.dirname(__file__), "js")
    if not os.path.exists(js_dir):
        os.makedirs(js_dir)
    
    # 写入版本号文件
    version_file = os.path.join(js_dir, "version.js")
    with open(version_file, "w", encoding='utf-8') as f:
        f.write(js_code)

# 执行版本号注入
inject_version_to_frontend()

# ANSI颜色代码
GREEN = "\033[92m"  # 绿色
RESET = "\033[0m"   # 重置颜色
# 打印启动信息，将"已启动"设为绿色
print(f"✨提示词小助手 V{VERSION} {GREEN}已启动{RESET}")



