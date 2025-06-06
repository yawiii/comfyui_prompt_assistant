/**
 * 智谱AI GLM-4V API调用服务
 * 文档：https://www.bigmodel.cn/dev/api/normal-model/glm-4v
 */

import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";

class LLMVisionService {
    // API 配置
    static API_CONFIG = {
        BASE_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        MODEL: 'glm-4v',
        PROMPTS: null // 将从配置文件加载
    };

    // 错误码映射
    static ERROR_CODES = {
        '401': '认证失败，请检查API密钥是否正确',
        '429': '请求超过频率限制',
        '500': '服务器内部错误',
        '503': '服务不可用',
    };

    constructor() {
        this.API_URL = LLMVisionService.API_CONFIG.BASE_URL;
        this.MODEL = LLMVisionService.API_CONFIG.MODEL;
        this.loadPrompts(); // 初始化时加载提示词
    }

    /**
     * 加载系统提示词
     */
    async loadPrompts() {
        try {
            // 如果已经加载过配置，直接返回
            if (LLMVisionService.API_CONFIG.PROMPTS) {
                return LLMVisionService.API_CONFIG.PROMPTS;
            }

            // 设置默认提示词配置
            const defaultPrompts = {
                ZH: {
                    role: "system",
                    content: "请描述这张图片的内容，关注视觉元素和风格。请提供详细的描述，包括主体、场景、颜色、构图等关键元素。"
                },
                EN: {
                    role: "system",
                    content: "Please describe this image in detail, focusing on visual elements and style. Include key elements such as subject, scene, colors, composition, and other notable features."
                }
            };

            try {
                // 尝试从配置文件加载
                const systemPrompts = await ResourceManager.loadSystemPrompts();
                if (systemPrompts?.vision_prompts) {
                    LLMVisionService.API_CONFIG.PROMPTS = systemPrompts.vision_prompts;
                    logger.debug('视觉系统提示词从配置文件加载成功');
                    return systemPrompts.vision_prompts;
                }
            } catch (error) {
                logger.warn(`视觉系统提示词配置加载失败，使用默认配置: ${error.message}`);
            }

            // 如果加载失败，使用默认配置
            LLMVisionService.API_CONFIG.PROMPTS = defaultPrompts;
            logger.debug('使用默认视觉系统提示词配置');
            return defaultPrompts;

        } catch (error) {
            logger.error(`视觉系统提示词加载失败: ${error.message}`);
            // 确保即使在错误情况下也返回可用的配置
            const fallbackPrompts = {
                ZH: {
                    role: "system",
                    content: "请描述这张图片的内容。"
                },
                EN: {
                    role: "system",
                    content: "Please describe this image."
                }
            };
            LLMVisionService.API_CONFIG.PROMPTS = fallbackPrompts;
            return fallbackPrompts;
        }
    }

    /**
     * 获取错误信息
     * @param {string} code 错误码
     * @returns {string} 错误信息
     */
    static getErrorMessage(code) {
        return this.ERROR_CODES[code] || `未知错误(错误码:${code})`;
    }

    /**
     * 获取API密钥
     * @returns {string} API密钥
     */
    static getApiKey() {
        return localStorage.getItem("PromptAssistant_Settings_llm_api_key") || '';
    }

    /**
     * 生成API请求头
     * @param {string} apiKey - API密钥，如果不传则使用默认配置
     * @returns {Object} 请求头对象
     */
    generateHeaders(apiKey = null) {
        const key = apiKey || LLMVisionService.getApiKey();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        };
    }

    /**
     * 将图片转换为Base64格式
     * @param {HTMLImageElement} img - 图片元素
     * @returns {Promise<string>} Base64格式的图片数据
     */
    async imageToBase64(img) {
        return new Promise((resolve, reject) => {
            try {
                // 创建canvas
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;

                // 将图片绘制到canvas
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // 获取base64数据（去掉前缀）
                const base64 = canvas.toDataURL('image/jpeg').split(',')[1];
                resolve(base64);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 构建请求体
     * @param {Object} params - 请求参数
     * @returns {Object} 格式化的请求体
     */
    buildRequestBody({
        messages,
        temperature = 0.7,
        top_p = 0.7,
        max_tokens = 1500,
        request_id
    }) {
        return {
            model: this.MODEL,
            messages,
            temperature,
            top_p,
            max_tokens,
            request_id
        };
    }

    /**
     * 发送API请求
     * @param {Object} params - 请求参数
     * @param {string} apiKey - API密钥，可选
     * @returns {Promise} API响应
     */
    async sendRequest(params, apiKey = null) {
        if (!params.request_id) {
            throw new Error('请求ID不能为空');
        }

        try {
            logger.debug(`发起LLM视觉请求 | 请求ID:${params.request_id}`);

            const headers = this.generateHeaders(apiKey);
            const body = this.buildRequestBody(params);

            // 打印请求体，方便调试
            logger.debug(`请求体: ${JSON.stringify(body, null, 2)}`);

            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            // 获取响应文本，方便调试
            const responseText = await response.text();
            logger.debug(`响应内容: ${responseText}`);

            if (!response.ok) {
                const errorMessage = LLMVisionService.getErrorMessage(response.status);
                throw new Error(`${errorMessage} | 响应内容: ${responseText}`);
            }

            const result = JSON.parse(responseText);
            logger.debug(`LLM视觉请求成功 | 请求ID:${params.request_id} | 结果:${JSON.stringify(result)}`);

            return {
                success: true,
                data: result
            };

        } catch (error) {
            logger.error(`LLM视觉请求失败 | 请求ID:${params.request_id} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 分析图片
     * @param {HTMLImageElement} image - 图片元素
     * @param {string} request_id - 请求ID
     * @param {string} lang - 语言类型，'zh' 或 'en'
     * @returns {Promise<Object>} 分析结果
     */
    async analyzeImage(image, request_id, lang = 'zh') {
        try {
            logger.debug(`发起图像分析请求 | 请求ID:${request_id} | 语言:${lang}`);

            // 验证API密钥
            const apiKey = LLMVisionService.getApiKey();
            if (!apiKey) {
                throw new Error('请先配置 LLM API 密钥');
            }

            // 将图片转换为Base64
            const imageBase64 = await this.imageToBase64(image);
            logger.debug(`图片转换为Base64成功 | 长度:${imageBase64.length}`);

            // 直接从配置文件加载提示词
            logger.debug(`开始加载系统提示词配置...`);
            const systemPromptsUrl = ResourceManager.getSystemPromptsUrl();
            logger.debug(`系统提示词配置URL: ${systemPromptsUrl}`);

            const systemPrompts = await ResourceManager.loadSystemPrompts();
            logger.debug(`系统提示词配置加载结果: ${JSON.stringify(systemPrompts ? '成功' : '失败')}`);

            if (!systemPrompts) {
                throw new Error('系统提示词配置加载失败');
            }

            if (!systemPrompts.vision_prompts) {
                logger.error(`视觉提示词不存在，配置内容: ${JSON.stringify(systemPrompts)}`);
                throw new Error('视觉系统提示词加载失败');
            }

            // 获取对应语言的提示词
            const langKey = lang.toUpperCase();
            logger.debug(`尝试获取${langKey}语言提示词，可用语言: ${Object.keys(systemPrompts.vision_prompts).join(', ')}`);

            if (!systemPrompts.vision_prompts[langKey]) {
                throw new Error(`未找到语言 ${lang} 的提示词配置`);
            }

            // 获取提示词内容
            const promptText = systemPrompts.vision_prompts[langKey].content;
            logger.debug(`使用${langKey}语言提示词: ${promptText}`);

            // 构建消息内容
            const messages = [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: promptText
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpeg;base64,${imageBase64}`
                        }
                    }
                ]
            }];

            const params = {
                messages,
                request_id
            };

            logger.debug(`准备发送API请求...`);
            const result = await this.sendRequest(params);

            if (!result.success) {
                throw new Error(result.error || '图像分析请求失败');
            }

            if (!result.data?.choices?.[0]?.message?.content) {
                throw new Error('图像分析结果格式错误');
            }

            const description = result.data.choices[0].message.content;
            logger.debug(`图像分析请求成功 | 请求ID:${request_id} | 结果:${description.substring(0, 100)}...`);

            return {
                success: true,
                data: {
                    description
                }
            };
        } catch (error) {
            logger.error(`图像分析请求失败 | 请求ID:${request_id} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 设置 API 配置
     * @param {Object} config 配置对象
     */
    static setConfig(config) {
        try {
            // 验证必要的配置项
            if (config.API_KEY) {
                this.API_CONFIG = {
                    ...this.API_CONFIG,
                    ...config
                };
                logger.debug('API配置更新成功');
                return true;
            } else {
                throw new Error('API_KEY 是必需的配置项');
            }
        } catch (error) {
            logger.error(`API配置更新失败 | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 获取当前 API 配置
     * @returns {Object} API 配置对象
     */
    static getConfig() {
        return { ...this.API_CONFIG };
    }
}

// 导出LLM视觉服务实例
export const llmVisionService = new LLMVisionService(); 