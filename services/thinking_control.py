"""
思维链控制模块 - 重构版
统一管理各模型的思维链/推理模式关闭参数

设计原则:
- 只认模型特征,不认服务商(Ollama除外,因其使用原生API)
- 按参数类型分组,而非按服务商分组
- 支持主流平台:智谱/Qwen/DeepSeek/Gemini/Grok/Ollama
- 保留400错误自动降级机制(在openai_base.py中)
"""

import re
from typing import Dict, Any, List


# ==================== 一级:通用模型规则(与服务商无关) ====================
# 按参数类型分组,遍历匹配

THINKING_CONTROL_RULES: List[Dict[str, Any]] = [
    {
        "name": "zhipu_glm",
        "description": "智谱GLM-4.5/4.6系列",
        "patterns": [r"glm[-_/.]?4\.(5|6)"],
        "params": {"thinking": {"type": "disabled"}},
        "sources": ["智谱官方API", "各聚合平台"]
    },
    {
        "name": "qwen3_enable_thinking",
        "description": "Qwen3系列(支持enable_thinking平台)",
        "patterns": [
            r"qwen[-_/.]?3(?!.*thinking)(?!.*r1)",  # Qwen3非thinking/r1变体
            r"qwen.*[-_/.]?vl",  # Qwen-VL系列(包括qwen2/qwen3-vl)
        ],
        "params": {"enable_thinking": False},
        "sources": ["魔搭", "阿里百炼", "硅基流动"]
    },
    {
        "name": "qwen_deepseek_reasoning",
        "description": "Qwen/DeepSeek推理模型(R1系列)",
        "patterns": [
            r"qwen.*[-_/.]?(r1|thinking)",  # Qwen推理模型
            r"deepseek.*[-_/.]?(r1|reason)",  # DeepSeek R1系列
        ],
        "params": {"reasoning": {"effort": "none"}},
        "sources": ["OpenRouter", "302.ai", "其他聚合平台"]
    },
    {
        "name": "deepseek_v3_thinking",
        "description": "DeepSeek V3/V3.2官方API",
        "patterns": [
            r"deepseek[-_/.]?v3(\.1|\.2)?(?!.*r1)",  # V3系列非R1
            r"deepseek[-_/.]?chat",  # DeepSeek Chat
        ],
        "params": {"thinking": {"type": "disabled"}},
        "sources": ["DeepSeek官方API"],
        "notes": "也可通过模型名加/thinking控制"
    },
    {
        "name": "gemini2_reasoning",
        "description": "Gemini 2.0/2.5 Flash/Lite",
        "patterns": [r"gemini[-_/.]?2\.(0|5)[-_/.]?(flash|lite)"],
        "params": {"reasoning_effort": "none"},
        "sources": ["Google官方API", "OpenAI兼容接口"]
    },
    {
        "name": "gemini3_thinking",
        "description": "Gemini 3.0系列(只能low,无法完全关闭)",
        "patterns": [r"gemini[-_/.]?3"],
        "params": {"thinking_level": "low"},
        "sources": ["Google官方API"],
        "notes": "⚠️ 无法完全关闭推理,只能设置low/high"
    },
    {
        "name": "grok3_mini_reasoning",
        "description": "Grok-3-mini(支持reasoning_effort)",
        "patterns": [r"grok[-_/.]?3[-_/.]?mini"],
        "params": {"reasoning_effort": "low"},
        "sources": ["xAI官方API"]
    },
    # 注意:Grok-4系列是内置推理模型,不支持reasoning_effort参数,已在排除规则中处理
]


# ==================== 二级:Ollama特殊规则(原生API专用) ====================
# Ollama使用/api/chat原生接口,参数格式不同
# 
# ⚠️ 重要发现：think 参数行为与直觉相反
# - think: true  → 关闭思考（不输出 <think> 标签）
# - think: false → 启用思考（输出 <think> 标签）
# - 不发送      → 默认关闭思考（Ollama 默认行为）

OLLAMA_NATIVE_RULES = {
    "parameter_name": "think",
    "disable_value": True,   # disable_thinking=True 时发送此值（关闭思考）
    "enable_value": False,   # disable_thinking=False 时发送此值（启用思考）
    "supported_patterns": [
        # r"qwen",  # 移除：太宽泛，会误伤qwen-instruct等普通模型
        r"deepseek.*r1",  # DeepSeek R1系列
        r"qwen.*r1",      # Qwen R1变体
        r".*thinking",    # 任何名称包含thinking的模型
    ],
    "notes": "Ollama原生API /api/chat 顶层参数"
}


# ==================== 三级:排除规则(明确不支持关闭的模型) ====================
# 这些模型要么不支持关闭推理,要么是内置推理模型

EXCLUDE_PATTERNS = [
    r"gemini[-_/.]?2\.5[-_/.]?pro",  # Gemini 2.5 Pro官方明确不支持关闭
    r"grok[-_/.]?4",  # Grok-4系列是内置推理模型,无reasoning_effort参数
    r".*speciale",  # DeepSeek Speciale仅thinking模式
]


# ==================== 核心匹配函数 ====================

def build_thinking_suppression(provider: str, model: str, disable_thinking: bool = True) -> Dict[str, Any]:
    """
    根据模型特征返回思维链控制参数
    
    匹配优先级:
    1. 检查排除规则 → 返回空字典(明确不支持的模型)
    2. Ollama特殊处理 → 原生API参数格式
    3. 遍历通用规则 → 返回第一个匹配的参数
    4. 无匹配 → 返回空字典
    
    参数:
        provider: 服务商标识(仅用于Ollama判断,其他服务商忽略)
        model: 模型名称
        disable_thinking: True=关闭思考, False=启用思考
    
    返回:
        Dict: 思维链控制参数字典,或空字典
        
    示例:
        >>> build_thinking_suppression("ollama", "qwen3-thinking", disable_thinking=True)
        {"think": True}  # 关闭思考
        
        >>> build_thinking_suppression("ollama", "qwen3-thinking", disable_thinking=False)
        {"think": False}  # 启用思考
        
        >>> build_thinking_suppression("zhipu", "glm-4.5")
        {"thinking": {"type": "disabled"}}
        
        >>> build_ thinking_suppression("custom", "gemini-2.5-pro")
        {}  # 不支持关闭
    """
    if not model:
        return {}
    
    model_lower = model.strip().lower()
    provider_lower = provider.strip().lower() if provider else ""
    
    # 1. 检查排除规则
    for exclude_pattern in EXCLUDE_PATTERNS:
        if re.search(exclude_pattern, model_lower):
            return {}  # 明确不支持的模型,返回空字典
    
    # 2. Ollama特殊处理(原生API)
    if provider_lower == "ollama":
        for pattern in OLLAMA_NATIVE_RULES["supported_patterns"]:
            if re.search(pattern, model_lower):
                # 根据 disable_thinking 参数选择值
                think_value = OLLAMA_NATIVE_RULES["disable_value"] if disable_thinking else OLLAMA_NATIVE_RULES["enable_value"]
                return {
                    OLLAMA_NATIVE_RULES["parameter_name"]: think_value
                }
        return {}  # Ollama但不在白名单
    
    # 3. 遍历通用规则,返回第一个匹配项
    for rule in THINKING_CONTROL_RULES:
        for pattern in rule["patterns"]:
            if re.search(pattern, model_lower):
                # 返回副本,避免修改原始数据
                return rule["params"].copy()
    
    # 4. 无匹配,返回空字典
    return {}


# ==================== 辅助函数(用于调试) ====================

def get_rule_info(provider: str, model: str) -> Dict[str, Any]:
    """
    获取匹配规则的详细信息(用于调试)
    
    返回:
        Dict: {
            "matched": bool,
            "rule_name": str,
            "description": str,
            "params": Dict,
            "sources": List[str]
        }
    """
    if not model:
        return {"matched": False}
    
    model_lower = model.strip().lower()
    provider_lower = provider.strip().lower() if provider else ""
    
    # 检查排除规则
    for exclude_pattern in EXCLUDE_PATTERNS:
        if re.search(exclude_pattern, model_lower):
            return {
                "matched": True,
                "rule_name": "EXCLUDED",
                "description": "明确不支持关闭思维链的模型",
                "params": {},
                "sources": []
            }
    
    # Ollama特殊处理
    if provider_lower == "ollama":
        for pattern in OLLAMA_NATIVE_RULES["supported_patterns"]:
            if re.search(pattern, model_lower):
                return {
                    "matched": True,
                    "rule_name": "ollama_native",
                    "description": "Ollama原生API",
                    "params": {
                        OLLAMA_NATIVE_RULES["parameter_name"]: 
                        OLLAMA_NATIVE_RULES["parameter_value"]
                    },
                    "sources": ["Ollama /api/chat"]
                }
        return {"matched": False}
    
    # 通用规则
    for rule in THINKING_CONTROL_RULES:
        for pattern in rule["patterns"]:
            if re.search(pattern, model_lower):
                return {
                    "matched": True,
                    "rule_name": rule["name"],
                    "description": rule["description"],
                    "params": rule["params"].copy(),
                    "sources": rule.get("sources", [])
                }
    
    return {"matched": False}
