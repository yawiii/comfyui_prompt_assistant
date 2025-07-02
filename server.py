from aiohttp import web
from server import PromptServer
from .config_manager import config_manager
from .services.baidu import BaiduTranslateService
from .services.llm import LLMService
from .services.llm_v import LLMVisionService
import base64
import json
import traceback

# 定义颜色常量
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
RESET = "\033[0m"
PREFIX = f"{GREEN}[PromptAssistant]{RESET}"
ERROR_PREFIX = f"{RED}[PromptAssistant-错误]{RESET}"
WARN_PREFIX = f"{YELLOW}[PromptAssistant-警告]{RESET}"

# 定义路由前缀，确保与前端请求匹配
API_PREFIX = '/prompt_assistant/api'

# 不再使用RouteTableDef
# routes = web.RouteTableDef()

def get_result_text(result):
    """
    智能提取接口返回中的文本内容，用于字符统计。
    优先级：data.translated > data.expanded > data.description > data.result > data.text > result > data（str）
    """
    if not isinstance(result, dict):
        return str(result) if result is not None else ''
    data = result.get('data')
    if isinstance(data, dict):
        for key in ['translated', 'expanded', 'description', 'result', 'text']:
            if key in data and isinstance(data[key], str):
                return data[key]
    if isinstance(data, str):
        return data
    if 'result' in result and isinstance(result['result'], str):
        return result['result']
    if 'text' in result and isinstance(result['text'], str):
        return result['text']
    return ''

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/baidu_translate')
async def get_baidu_translate_config(request):
    """获取百度翻译配置"""
    config = config_manager.get_baidu_translate_config()
    return web.json_response(config)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/llm')
async def get_llm_config(request):
    """获取LLM配置"""
    config = config_manager.get_llm_config()
    return web.json_response(config)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/baidu_translate')
async def update_baidu_translate_config(request):
    """更新百度翻译配置"""
    try:
        data = await request.json()
        app_id = data.get('app_id')
        secret_key = data.get('secret_key')
        
        # 获取当前配置
        current_config = config_manager.get_baidu_translate_config()
        
        # 如果提供了 app_id，则更新 app_id
        if app_id is not None:
            current_config['app_id'] = app_id
            
        # 如果提供了 secret_key，则更新 secret_key
        if secret_key is not None:
            current_config['secret_key'] = secret_key
            
        # 更新配置
        success = config_manager.update_baidu_translate_config(
            current_config['app_id'],
            current_config['secret_key']
        )
        
        if success:
            return web.json_response({'message': '配置已更新'})
        else:
            return web.json_response({'error': '配置更新失败'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/llm')
async def update_llm_config(request):
    """更新LLM配置"""
    try:
        data = await request.json()
        api_key = data.get('api_key')
        
        if not api_key:
            return web.json_response({'error': '参数不完整'}, status=400)
            
        success = config_manager.update_llm_config(api_key)
        if success:
            return web.json_response({'message': '配置已更新'})
        else:
            return web.json_response({'error': '配置更新失败'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500) 

# 新增API路由

@PromptServer.instance.routes.post(f'{API_PREFIX}/baidu/translate')
async def baidu_translate(request):
    """
    百度翻译API
    注意：所有的格式处理（包括序号"1."格式保护等）均由前端的promptFormatter.js负责，
    后端只负责原始文本的翻译，不进行格式预处理或后处理。
    """
    try:
        data = await request.json()
        text = data.get("text")
        from_lang = data.get("from", "auto")
        to_lang = data.get("to", "zh")
        request_id = data.get("request_id")
        
        print(f"{PREFIX} 百度翻译请求 | 请求ID:{request_id} | 语言方向:{from_lang}->{to_lang}")
        
        # 调用服务
        result = BaiduTranslateService.translate(text, from_lang, to_lang, request_id)

        # 输出结构化成功日志
        result_text = get_result_text(result)
        result_length = len(result_text.encode('utf-8'))
        print(f"{PREFIX} 百度翻译成功 | 请求ID:{request_id} | 结果字符数:{result_length}")
        
        return web.json_response(result)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} 百度翻译请求失败 | 错误:{error_msg}")
        return web.json_response({"success": False, "error": error_msg})

@PromptServer.instance.routes.post(f'{API_PREFIX}/llm/expand')
async def llm_expand(request):
    """LLM扩写API"""
    try:
        data = await request.json()
        prompt = data.get("prompt")
        request_id = data.get("request_id")
        
        print(f"{PREFIX} LLM扩写请求 | ID:{request_id} | 内容:{prompt[:30]}...")
        
        result = LLMService.expand_prompt(prompt, request_id)

        # 输出结构化成功日志
        result_text = get_result_text(result)
        result_length = len(result_text.encode('utf-8'))
        print(f"{PREFIX} LLM扩写成功 | 请求ID:{request_id} | 结果字符数:{result_length}")
        
        return web.json_response(result)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} LLM扩写请求失败 | 错误:{error_msg}")
        print(f"{ERROR_PREFIX} 错误堆栈:\n{traceback.format_exc()}")
        return web.json_response({"success": False, "error": error_msg})

@PromptServer.instance.routes.post(f'{API_PREFIX}/llm/translate')
async def llm_translate(request):
    """LLM翻译API"""
    try:
        data = await request.json()
        text = data.get("text")
        from_lang = data.get("from", "auto")
        to_lang = data.get("to", "zh")
        request_id = data.get("request_id")
        
        print(f"{PREFIX} LLM翻译请求 | 请求ID:{request_id} | 语言方向:{from_lang}->{to_lang}")
        
        # 调用服务
        result = LLMService.translate(text, from_lang, to_lang, request_id)

        # 输出结构化成功日志
        result_text = get_result_text(result)
        result_length = len(result_text.encode('utf-8'))
        print(f"{PREFIX} LLM翻译成功 | 请求ID:{request_id} | 结果字符数:{result_length}")
        
        return web.json_response(result)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} LLM翻译请求失败 | 错误:{error_msg}")
        print(f"{ERROR_PREFIX} 错误堆栈:\n{traceback.format_exc()}")
        return web.json_response({"success": False, "error": error_msg})

@PromptServer.instance.routes.post(f'{API_PREFIX}/llm/vision')
async def llm_vision(request):
    """LLM视觉分析API"""
    request_id = None
    try:
        data = await request.json()
        image_data = data.get("image")
        lang = data.get("lang", "zh")
        request_id = data.get("request_id", "未知ID")

        # 处理图像数据
        if not image_data:
            error_msg = "未提供图像数据"
            print(f"{ERROR_PREFIX} LLM视觉分析失败 | 请求ID:{request_id} | 错误:{error_msg}")
            return web.json_response({"success": False, "error": error_msg})

        # 记录图像数据类型和长度
        data_type = type(image_data).__name__
        data_length = len(image_data) if isinstance(image_data, str) else "non-string"
        print(f"{PREFIX} LLM视觉分析请求 | 请求ID:{request_id} | 语言:{lang} | 图像数据类型:{data_type} | 长度:{data_length}")

        # 检查图像数据格式
        if isinstance(image_data, str):
            if not image_data.startswith("data:image"):
                # 检查是否是Base64编码但缺少前缀
                try:
                    # 尝试解码前20个字符看是否是有效的Base64
                    import base64
                    base64.b64decode(image_data[:20])
                    # 如果成功，添加前缀
                    print(f"{PREFIX} 检测到Base64数据但缺少前缀，自动添加 | 请求ID:{request_id}")
                    image_data = f"data:image/jpeg;base64,{image_data}"
                except Exception as e:
                    print(f"{WARN_PREFIX} Base64检测失败 | 请求ID:{request_id} | 错误:{str(e)}")

        # 调用服务
        print(f"{PREFIX} 调用LLMVisionService.analyze_image | 请求ID:{request_id} | 语言:{lang}")
        try:
            result = LLMVisionService.analyze_image(image_data, request_id, lang)
        except Exception as service_error:
            error_msg = str(service_error)
            print(f"{ERROR_PREFIX} LLMVisionService调用异常 | 请求ID:{request_id} | 错误:{error_msg}")
            print(f"{ERROR_PREFIX} 异常堆栈:\n{traceback.format_exc()}")
            return web.json_response({"success": False, "error": f"服务调用异常: {error_msg}"})

        # 打印调试信息
        if not result.get('success'):
            error_msg = result.get('error', '未知错误')
            print(f"{ERROR_PREFIX} LLM视觉分析失败 | 请求ID:{request_id} | 错误:{error_msg}")
        else:
            desc_length = len(result.get('data', {}).get('description', ''))
            print(f"{PREFIX} LLM视觉分析成功 | 请求ID:{request_id} | 描述长度：{desc_length}")

        return web.json_response(result)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} LLM视觉分析请求异常 | 请求ID:{request_id} | 错误:{error_msg}")
        print(f"{ERROR_PREFIX} 异常堆栈:\n{traceback.format_exc()}")
        return web.json_response({"success": False, "error": error_msg}) 