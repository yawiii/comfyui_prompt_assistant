
import os
import re
from server import PromptServer
from . import server
from .node.translate_node import NODE_CLASS_MAPPINGS as TRANSLATE_NODE_CLASS_MAPPINGS
from .node.translate_node import NODE_DISPLAY_NAME_MAPPINGS as TRANSLATE_NODE_DISPLAY_NAME_MAPPINGS
from .node.image_caption_node import NODE_CLASS_MAPPINGS as IMAGE_CAPTION_NODE_CLASS_MAPPINGS
from .node.image_caption_node import NODE_DISPLAY_NAME_MAPPINGS as IMAGE_CAPTION_NODE_DISPLAY_NAME_MAPPINGS
from .node.kontext_preset_node import NODE_CLASS_MAPPINGS as KONTEXT_PRESET_NODE_CLASS_MAPPINGS
from .node.kontext_preset_node import NODE_DISPLAY_NAME_MAPPINGS as KONTEXT_PRESET_NODE_DISPLAY_NAME_MAPPINGS
from .node.expand_node import NODE_CLASS_MAPPINGS as EXPAND_NODE_CLASS_MAPPINGS
from .node.expand_node import NODE_DISPLAY_NAME_MAPPINGS as EXPAND_NODE_DISPLAY_NAME_MAPPINGS
from .node.video_caption_node import NODE_CLASS_MAPPINGS as VIDEO_CAPTION_NODE_CLASS_MAPPINGS
from .node.video_caption_node import NODE_DISPLAY_NAME_MAPPINGS as VIDEO_CAPTION_NODE_DISPLAY_NAME_MAPPINGS

# 模块常量定义
NODE_CLASS_MAPPINGS = {
    **IMAGE_CAPTION_NODE_CLASS_MAPPINGS,
    **KONTEXT_PRESET_NODE_CLASS_MAPPINGS,
    **TRANSLATE_NODE_CLASS_MAPPINGS,
    **EXPAND_NODE_CLASS_MAPPINGS,
    **VIDEO_CAPTION_NODE_CLASS_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **IMAGE_CAPTION_NODE_DISPLAY_NAME_MAPPINGS,
    **KONTEXT_PRESET_NODE_DISPLAY_NAME_MAPPINGS,
    **TRANSLATE_NODE_DISPLAY_NAME_MAPPINGS,
    **EXPAND_NODE_DISPLAY_NAME_MAPPINGS,
    **VIDEO_CAPTION_NODE_DISPLAY_NAME_MAPPINGS,
}
WEB_DIRECTORY = "./js"

# 更新节点映射
NODE_CLASS_MAPPINGS.update(TRANSLATE_NODE_CLASS_MAPPINGS)
NODE_DISPLAY_NAME_MAPPINGS.update(TRANSLATE_NODE_DISPLAY_NAME_MAPPINGS)

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

# 禁用httpx的详细日志，避免打断单行动态显示
import logging
logging.getLogger("httpx").setLevel(logging.WARNING)

# 打印初始化信息
print(f"✨提示词小助手 V{VERSION} 已启动")



