from aiohttp import web
from .config_manager import config_manager

routes = web.RouteTableDef()

@routes.get('/prompt_assistant/api/config/baidu_translate')
async def get_baidu_translate_config(request):
    """获取百度翻译配置"""
    config = config_manager.get_baidu_translate_config()
    return web.json_response(config)

@routes.get('/prompt_assistant/api/config/llm')
async def get_llm_config(request):
    """获取LLM配置"""
    config = config_manager.get_llm_config()
    return web.json_response(config)

@routes.post('/prompt_assistant/api/config/baidu_translate')
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

@routes.post('/prompt_assistant/api/config/llm')
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