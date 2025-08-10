import json
from openai import APIStatusError

# 定义HTTP状态码到中文错误信息的映射
HTTP_STATUS_CODE_MESSAGES = {
    400: "请求无效",
    401: "身份验证失败-请检查您的API Key是否正确。",
    403: "无权限访问-您没有权限访问此资源。",
    404: "请求的资源不存",
    429: "请求频率过高-您已超出速率限制，请稍后再试。",
    500: "服务器内部错误- 服务提供商端发生未知问题。",
    502: "网关错误",
    503: "服务不可用- 服务器当前无法处理请求，请稍后重试。",
    504: "网关超时",
}

# 定义百度翻译API的错误码映射
BAIDU_ERROR_CODE_MESSAGES = {
    '52001': '请求超时，请重试',
    '52002': '系统错误，请重试',
    '52003': '未授权用户，请检查appid是否正确或服务是否开通',
    '54000': '必填参数为空，请检查是否少传参数',
    '54001': '签名错误，请检查appid和secret_key是否正确',
    '54003': '访问频率受限，请降低您的调用频率，或进行身份认证后切换为高级版/尊享版',
    '54004': '账户余额不足，请前往管理控制台充值',
    '54005': '长query请求频繁，请降低长query的发送频率，3s后再试',
    '58000': '客户端IP非法，检查个人资料里填写的IP地址是否正确，可前往开发者信息-基本信息修改',
    '58001': '译文语言方向不支持，检查译文语言是否在语言列表里',
    '58002': '服务当前已关闭，请前往百度管理控制台开启服务',
    '58003': '此IP已被封禁',
    '90107': '认证未通过或未生效，请前往我的认证查看认证进度',
    '20003': '请求内容存在安全风险',
}


def format_api_error(e: Exception, provider_display_name: str) -> str:
    """
    格式化来自API的错误信息，提供更详细的上下文。
    """
    # 优先处理openai的API状态错误
    if isinstance(e, APIStatusError):
        status_code = e.status_code
        message = HTTP_STATUS_CODE_MESSAGES.get(status_code, f"未知HTTP错误")
        
        error_details_str = ""
        try:
            # 尝试解析响应体中的详细错误信息
            error_details = e.response.json()
            # 提取关键信息，兼容不同服务商的格式
            # 常见格式: {"error": {"message": "...", "type": "...", "code": "..."}}
            # 或: {"message": "..."}
            detail_msg = error_details.get("message", "")
            if isinstance(error_details.get("error"), dict):
                detail_msg = error_details["error"].get("message", detail_msg)
            
            if detail_msg:
                error_details_str = f" | 详情: {detail_msg}"
        except (json.JSONDecodeError, AttributeError):
            # 如果解析失败或没有响应体，使用原始响应文本
            try:
                if e.response and hasattr(e.response, 'text') and e.response.text:
                    error_details_str = f" | 原始响应: {e.response.text}"
            except Exception:
                pass # 忽略获取原始响应的错误
            
        return f"{provider_display_name} API错误: {message} (状态码: {status_code}){error_details_str}"
        
    # 对于其他类型的异常，例如网络连接错误，返回其类型和基本信息
    return f"{provider_display_name} 服务请求异常: ({type(e).__name__}) {str(e)}"

def format_baidu_translate_error(error_data: dict) -> str:
    """
    格式化百度翻译API的错误信息。
    """
    if not isinstance(error_data, dict):
        return "未知的百度翻译错误格式"
        
    error_code = str(error_data.get('error_code'))
    if error_code in BAIDU_ERROR_CODE_MESSAGES:
        return f"百度翻译错误: {BAIDU_ERROR_CODE_MESSAGES[error_code]} (代码: {error_code})"
    
    error_msg = error_data.get('error_msg', '未知错误')
    return f"百度翻译错误: {error_msg} (代码: {error_code})" 