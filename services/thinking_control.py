import re
from typing import Dict, Any

"""
一级注释（模块级）：
该模块用于统一管理各服务商与模型的“思维链/思考模式”关闭参数，
基于白名单匹配规则，在调用 OpenAI 兼容的 /chat/completions 接口时
通过 extra_body 传递相应字段，以减少推理 token、提升响应速度，避免不必要的思维链输出。

设计目标：
- 只在明确支持关闭思维链的“服务商+模型”组合上生效（白名单策略）
- 统一对外暴露 build_thinking_suppression(provider, model) -> Dict[str, Any]
- 方便后续拓展（例如新增 Gemini、ChatGPT 具体控制方式）
"""

# 二级注释（子模块/数据）：白名单规则定义
# 说明：使用尽量稳健的模式匹配，避免误伤其它模型
_ZHIPU_PATTERNS = [
    # GLM-4.5 系列（文本/多模态）支持 thinking.type: disabled
    # 官方文档示例：https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8
    r"glm-4\.5",      # 如 glm-4.5、glm-4.5-XXX
    r"glm-4\.5v"      # GLM-4.5V（视觉）
]

_SILICONFLOW_PATTERNS = [
    # 文档：https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions
    # enable_thinking 适用以下模型（列举核心关键词以适配大小写和路径差异）：
    # 注意：排除显式的 "thinking" 变体（这些通常固定为思考模型，不支持该参数）
    r"qwen3(?!.*thinking)",          # Qwen/Qwen3-* 非 Thinking 变体（包含 qwen3-vl）
    r"qwen.*vl",                      # Qwen-VL 系列（明确匹配视觉模型）
    r"deepseek-v3\.1|deepseek-v3",  # deepseek-ai/DeepSeek-V3.1 等
    r"hunyuan-a13b-instruct",        # tencent/Hunyuan-A13B-Instruct
    r"glm-4\.5v"                     # zai-org/GLM-4.5V
]

_GEMINI_PATTERNS = [
    # Google Gemini（OpenAI 兼容层）：支持 reasoning_effort='none' 来禁用思考
    # 参考：https://ai.google.dev/gemini-api/docs/openai?hl=zh-cn
    r"gemini"
]

# Gemini 2.5 Pro：官方说明推理功能无法关闭，避免下发 reasoning_effort='none'
_GEMINI_25_PRO_CANNOT_DISABLE = [
    r"gemini[-_/. ]?2\.5[-_/. ]?pro"
]

# 自定义（custom）提供商下，常见"推理/思维链模型"识别规则
# 三级注释（流程/逻辑）：这些多为 OpenAI 兼容网关汇聚的模型，通常接受
# extra_body={"reasoning":{"effort":"none"}} 来抑制思维链。
# 为避免误伤，仅针对明确包含以下关键词的"推理模型"生效。
_ALI_REASONING_PATTERNS = [
    r"qwen[-_/. ]?r1",                 # 如 qwen2.5-r1, qwen-r1
    r"qwen.*thinking",                 # Qwen Thinking 变体
    r"qwen3.*vl|qwen.*vl",             # Qwen3-VL 系列（视觉理解模型，支持关闭思维链）
    r"qwen[-_/. ]?vl"                  # Qwen-VL 通用匹配（兼容各种命名格式）
]

_DEEPSEEK_REASONING_PATTERNS = [
    r"deepseek[-_/. ]?r1",             # deepseek-r1 / r1-distill 等
    r"deepseek.*reason"                # 其它显式带 reason 的变体
]

# Ollama 服务支持的模型模式
# 文档：Ollama 支持通过 think: false 参数关闭思维链
# 参考：https://www.53ai.com/news/LargeLanguageModel/2025070537250.html
_OLLAMA_PATTERNS = [
    r"qwen3",                          # Qwen3 系列（包含 qwen3-vl）
    r"qwen.*vl",                       # Qwen-VL 系列（明确匹配视觉模型）
    r"deepseek.*r1",                   # DeepSeek R1 系列
    r".*thinking"                      # 任何包含 thinking 的模型
]




def _match_any(patterns, text_lower: str) -> bool:
    """三级注释（流程）：在给定文本（小写）中匹配任意一个白名单模式"""
    for pat in patterns:
        if re.search(pat, text_lower):
            return True
    return False


def build_thinking_suppression(provider: str, model: str) -> Dict[str, Any]:
    """
    二级注释（对外接口）：根据服务商与模型名称，返回放入 extra_body 的关闭“思维链/Thinking”请求参数。

    参数：
    - provider: 当前服务商（zhipu/siliconflow/openai/custom 等）
    - model:    模型名称（原样传入，以便做模式匹配）

    返回：
    - 返回应放入 chat.completions.create(extra_body=...) 的字段字典；若不适用则返回空字典。

    说明：
    - 仅在白名单内返回参数；未知服务商或不在白名单的模型不做处理（返回 {}）。
    - 使用 extra_body 以确保 OpenAI Python SDK 不因未知参数报错。
    """
    if not provider or not model:
        return {}

    prov = provider.strip().lower()
    mdl_lower = model.strip().lower()

    # --- 智谱（Zhipu / BigModel） ---
    # GLM-4.5/GLM-4.5V：thinking.type = disabled
    if prov == "zhipu":
        if _match_any(_ZHIPU_PATTERNS, mdl_lower):
            return {"thinking": {"type": "disabled"}}
        return {}

    # --- 硅基流动（SiliconFlow） ---
    # 支持 enable_thinking=false 的模型白名单
    if prov == "siliconflow":
        if _match_any(_SILICONFLOW_PATTERNS, mdl_lower):
            return {"enable_thinking": False}
        return {}

    # --- 自定义/302.AI（OpenAI 兼容聚合网关） ---
    # 将 302.AI 与 custom 保持同样的关闭思维链规则
    if prov in ("custom", "302ai"):
        # 1) Google Gemini 兼容层：顶层参数 reasoning_effort
        if _match_any(_GEMINI_PATTERNS, mdl_lower):
            # Pro 版本官方不允许关闭推理：避免返回 none，交由模型默认策略处理
            if _match_any(_GEMINI_25_PRO_CANNOT_DISABLE, mdl_lower):
                return {}
            return {"reasoning_effort": "none"}

        # 2) 阿里/Qwen 推理模型：常见 R1/Thinking 系列，使用通用 reasoning.effort=none
        if _match_any(_ALI_REASONING_PATTERNS, mdl_lower):
            return {"reasoning": {"effort": "none"}}

        # 3) DeepSeek 推理模型：R1/Distill 等
        if _match_any(_DEEPSEEK_REASONING_PATTERNS, mdl_lower):
            return {"reasoning": {"effort": "none"}}

        # 注意：Qwen3-VL 系列已通过 _ALI_REASONING_PATTERNS 在第 2 步匹配，无需重复处理

        # 默认：未知模型不返回以避免误伤
        return {}

    # --- Ollama 服务 ---
    # 支持通过 think: false 关闭思维链
    # 注意：Ollama 的 OpenAI 兼容接口可能不支持 extra_body，需要在原生 API 中处理
    if prov == "ollama":
        if _match_any(_OLLAMA_PATTERNS, mdl_lower):
            return {"think": False}

    # 其它服务商默认逻辑
    return {}

