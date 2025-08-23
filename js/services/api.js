/**
 * API服务
 * 通过后端API代理调用第三方服务，保护API密钥安全
 */

import { logger } from '../utils/logger.js';

// 用于存储进行中的请求的AbortController
const runningRequests = new Map();

class APIService {
    /**
     * 构建完整的API URL
     */
    static getApiUrl(path) {
        // 获取当前域名和端口
        const baseUrl = window.location.origin;
        // 确保路径格式正确
        const formattedPath = path.startsWith('/') ? path : `/${path}`;
        const url = `${baseUrl}${formattedPath}`;
        logger.debug(`构建API URL: ${url}`);
        return url;
    }

    /**
     * 生成唯一请求ID
     */
    static generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    }

    /**
     * 取消一个正在进行的请求
     */
    static async cancelRequest(requestId) {
        if (!requestId) return { success: false, error: "缺少requestId" };

        const controller = runningRequests.get(requestId);

        if (controller) {
            // 1. 中止前端的fetch请求
            controller.abort();
            runningRequests.delete(requestId);
            logger.debug(`前端请求已中止 | ID: ${requestId}`);
        }

        // 2. 通知后端取消任务
        try {
            const apiUrl = this.getApiUrl('/prompt_assistant/api/request/cancel');
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request_id: requestId })
            });
            const result = await response.json();
            logger.debug(`后端任务取消请求已发送 | ID: ${requestId} | 结果: ${JSON.stringify(result)}`);
            return result;
        } catch (error) {
            logger.error(`后端任务取消请求失败 | ID: ${requestId} | 错误: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 百度翻译API
     */
    static async baiduTranslate(text, from = 'auto', to = 'zh', request_id = null, is_auto = false) {
        // 生成请求ID
        if (!request_id) {
            request_id = `baidu_trans_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!text || text.trim() === '') {
                throw new Error('待翻译文本不能为空');
            }

            // 获取API URL
            const apiUrl = this.getApiUrl('/prompt_assistant/api/baidu/translate');

            // 调用后端API
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text,
                    from,
                    to,
                    request_id,
                    is_auto
                }),
                signal // 传递signal
            });

            const result = await response.json();
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`百度翻译请求被用户中止 | ID: ${request_id}`);
                return { success: false, error: '请求已取消', cancelled: true };
            }
            return {
                success: false,
                error: error.message
            };
        } finally {
            // 请求完成后从Map中移除
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * 批量翻译
     */
    static async batchBaiduTranslate(texts, from = 'auto', to = 'zh') {
        try {
            if (!Array.isArray(texts) || texts.length === 0) {
                throw new Error('待翻译文本数组不能为空');
            }

            // 串行处理每个文本的翻译
            const results = [];
            for (const text of texts) {
                const result = await this.baiduTranslate(text, from, to);
                results.push(result);
            }

            return results;
        } catch (error) {
            logger.error(`批量翻译 | 结果:失败 | 错误:${error.message}`);
            return [];
        }
    }

    /**
     * LLM扩写提示词
     */
    static async llmExpandPrompt(prompt, request_id = null) {
        // 生成请求ID
        if (!request_id) {
            request_id = `glm4_expand_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!prompt || prompt.trim() === '') {
                throw new Error('请输入要扩写的内容');
            }

            logger.debug(`发起LLM扩写请求 | 请求ID:${request_id} | 原文:${prompt}`);

            // 调用后端API
            const apiUrl = this.getApiUrl('/prompt_assistant/api/llm/expand');
            logger.debug('LLM扩写API URL:', apiUrl);

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt,
                    request_id
                }),
                signal // 传递signal
            });

            const result = await response.json();
            logger.debug(`LLM扩写请求成功 | 请求ID:${request_id} | 结果:${JSON.stringify(result)}`);

            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`LLM扩写请求被用户中止 | ID: ${request_id}`);
                return { success: false, error: '请求已取消', cancelled: true };
            }
            logger.error(`LLM扩写请求失败 | 请求ID:${request_id || 'unknown'} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        } finally {
            // 请求完成后从Map中移除
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * LLM翻译文本
     */
    static async llmTranslate(text, from = 'auto', to = 'zh', request_id = null, is_auto = false) {
        // 生成请求ID
        if (!request_id) {
            request_id = `llm_trans_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!text || text.trim() === '') {
                throw new Error('请输入要翻译的内容');
            }

            // 调用后端API
            const apiUrl = this.getApiUrl('/prompt_assistant/api/llm/translate');

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text,
                    from,
                    to,
                    request_id,
                    is_auto
                }),
                signal // 传递signal
            });

            const result = await response.json();
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`LLM翻译请求被用户中止 | ID: ${request_id}`);
                return { success: false, error: '请求已取消', cancelled: true };
            }
            return {
                success: false,
                error: error.message
            };
        } finally {
            // 请求完成后从Map中移除
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * 调用视觉模型分析图像
     */
    static async llmAnalyzeImage(imageData, prompt, request_id = null) {
        // 生成请求ID
        if (!request_id) {
            request_id = this.generateRequestId();
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!imageData) {
                throw new Error('未找到有效的图像');
            }

            logger.debug(`发起视觉分析请求 | 请求ID:${request_id}`);

            // 构建API URL
            const apiUrl = this.getApiUrl('/prompt_assistant/api/vlm/analyze');
            logger.debug('视觉分析API URL:', apiUrl);

            // 构建请求数据
            const requestData = {
                image: imageData,
                prompt: prompt, // 添加prompt
                request_id: request_id
            };

            // 发送请求
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData),
                signal // 传递signal
            });

            // 解析响应
            const result = await response.json();
            logger.debug(`视觉分析请求完成 | 请求ID:${request_id}`);

            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`视觉分析请求被用户中止 | ID: ${request_id}`);
                return { success: false, error: '请求已取消', cancelled: true };
            }
            logger.error(`视觉分析请求失败 | 请求ID:${request_id || 'unknown'} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message || '请求失败'
            };
        } finally {
            // 请求完成后从Map中移除
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * 将图像转换为Base64
     */
    static async imageToBase64(img) {
        return new Promise((resolve, reject) => {
            try {
                if (!img) {
                    reject('无效的图像');
                    return;
                }

                // 如果已经是base64字符串，直接返回
                if (typeof img === 'string' && img.startsWith('data:image')) {
                    resolve(img);
                    return;
                }

                // 如果是Blob对象
                if (img instanceof Blob) {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(img);
                    return;
                }

                // 如果是URL
                if (typeof img === 'string' && (img.startsWith('http') || img.startsWith('/'))) {
                    const image = new Image();
                    image.crossOrigin = 'Anonymous';
                    image.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(image, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                    };
                    image.onerror = () => reject('图像加载失败');
                    image.src = img;
                    return;
                }

                // 处理ComfyUI图像对象
                if (img && typeof img === 'object' && img.src) {
                    // 如果图像对象有src属性，使用它
                    const image = new Image();
                    image.crossOrigin = 'Anonymous';
                    image.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(image, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                    };
                    image.onerror = (e) => {
                        console.error('图像加载失败:', e);
                        reject('图像加载失败');
                    };
                    image.src = img.src;
                    return;
                }

                // 处理HTMLImageElement或类似的对象
                if (img && (img instanceof HTMLImageElement || (img.width && img.height && img.complete))) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                        return;
                    } catch (e) {
                        console.warn('使用canvas转换图像失败:', e);
                        // 继续尝试其他方法
                    }
                }

                // 处理ComfyUI的特殊格式 (dataURL缓存在node中)
                if (img && img.dataURL) {
                    resolve(img.dataURL);
                    return;
                }

                // 处理ComfyUI特殊的图像数据格式
                if (img && img.data && img.width && img.height) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        const imageData = new ImageData(
                            new Uint8ClampedArray(img.data.buffer || img.data),
                            img.width,
                            img.height
                        );
                        ctx.putImageData(imageData, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                        return;
                    } catch (e) {
                        console.error('处理图像数据失败:', e);
                    }
                }

                console.error('不支持的图像格式', img);
                reject('不支持的图像格式');
            } catch (error) {
                console.error('转换图像出错:', error);
                reject(error);
            }
        });
    }
}

export { APIService }; 