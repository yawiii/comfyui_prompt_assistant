/**
 * 智谱AI GLM-4V API调用服务
 * 文档：https://open.bigmodel.cn/dev/api/normal-model/glm-4v
 */

import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";

class LLMVisionService {
    // API 配置
    static API_CONFIG = {
        BASE_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        MODEL: 'glm-4v-flash',
        PROMPTS: null // 将从配置文件加载
    };

    // 错误码映射
    static ERROR_CODES = {
        '401': '认证失败，请检查API密钥是否正确',
        '429': '请求超过频率限制',
        '500': '服务器内部错误',
        '503': '服务不可用',
        '1210': 'API调用参数有误，请检查文档',
        '1214': '消息格式错误',
        '1000': '请求ID格式错误'
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

            // 从配置文件加载
            const systemPrompts = await ResourceManager.loadSystemPrompts();
            if (!systemPrompts?.vision_prompts) {
                throw new Error('视觉系统提示词配置不存在');
            }

            LLMVisionService.API_CONFIG.PROMPTS = systemPrompts.vision_prompts;
            logger.debug('视觉系统提示词从配置文件加载成功');
            return systemPrompts.vision_prompts;

        } catch (error) {
            logger.error(`视觉系统提示词加载失败: ${error.message}`);
            throw new Error(`视觉系统提示词加载失败: ${error.message}`);
        }
    }

    /**
     * 获取错误信息
     */
    static getErrorMessage(code) {
        return this.ERROR_CODES[code] || `未知错误(错误码:${code})`;
    }

    /**
     * 获取API密钥
     */
    static async getApiKey() {
        try {
            const response = await fetch('/prompt_assistant/api/config/llm');
            if (!response.ok) {
                throw new Error('获取配置失败');
            }
            const config = await response.json();
            return config.api_key;
        } catch (error) {
            logger.error(`获取LLM配置失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 生成API请求头
     */
    async generateHeaders(apiKey = null) {
        const key = apiKey || await LLMVisionService.getApiKey();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        };
    }

    /**
     * 将图片转换为Base64格式
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
     * 生成符合智谱AI文档要求的请求ID
     */
    generateRequestId() {
        // 使用时间戳+随机数的组合方式，确保唯一性
        return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    }

    /**
     * 发送API请求
     */
    async sendRequest(params, apiKey = null) {
        try {
            // 确保请求ID存在
            if (!params.request_id) {
                params.request_id = this.generateRequestId();
                logger.debug(`自动生成请求ID: ${params.request_id}`);
            }

            logger.debug(`发起LLM视觉请求 | 请求ID:${params.request_id}`);

            const headers = await this.generateHeaders(apiKey);

            // 创建符合API要求的请求体
            const requestData = {
                model: this.MODEL,
                messages: params.messages,
                request_id: params.request_id
            };

            // 打印请求体，方便调试
            logger.debug(`请求体: ${JSON.stringify(requestData, null, 2)}`);

            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestData)
            });

            // 获取响应文本，方便调试
            const responseText = await response.text();
            logger.debug(`响应内容: ${responseText}`);

            // 检查是否为JSON格式响应
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                throw new Error(`响应格式错误: ${responseText}`);
            }

            // 检查API错误
            if (result.error) {
                const errorCode = result.error.code;
                const errorMsg = result.error.message || '未知错误';
                const errorMessage = LLMVisionService.getErrorMessage(errorCode) || errorMsg;
                throw new Error(`API调用失败: ${errorMessage}`);
            }

            // 检查HTTP错误
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
            }

            logger.debug(`LLM视觉请求成功 | 请求ID:${params.request_id}`);

            return {
                success: true,
                data: result
            };

        } catch (error) {
            logger.error(`LLM视觉请求失败 | 请求ID:${params.request_id || 'unknown'} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 分析图片
     */
    async analyzeImage(image, request_id, lang = 'zh') {
        try {
            logger.debug(`发起图像分析请求 | 请求ID:${request_id} | 语言:${lang}`);

            // 验证API密钥
            const apiKey = await LLMVisionService.getApiKey();
            if (!apiKey) {
                throw new Error('请先配置 LLM API 密钥');
            }

            // 确保请求ID不为空
            if (!request_id) {
                request_id = this.generateRequestId();
                logger.debug(`请求ID为空，自动生成请求ID: ${request_id}`);
            }

            // 将图片转换为Base64
            const imageBase64 = await this.imageToBase64(image);
            logger.debug(`图片转换为Base64成功 | 长度:${imageBase64.length}`);

            // 加载提示词配置
            const systemPrompts = await ResourceManager.loadSystemPrompts();
            if (!systemPrompts?.vision_prompts) {
                throw new Error('视觉系统提示词加载失败');
            }

            // 获取对应语言的提示词
            const langKey = lang.toUpperCase();
            if (!systemPrompts.vision_prompts[langKey]) {
                throw new Error(`未找到语言 ${lang} 的提示词配置`);
            }

            // 获取提示词内容
            const promptText = systemPrompts.vision_prompts[langKey].content;
            logger.debug(`使用${langKey}语言提示词: ${promptText}`);

            // 构建消息内容 - 严格按照智谱AI GLM-4V-Flash的API文档
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

            // 发送请求
            const result = await this.sendRequest({
                messages,
                request_id
            });

            if (!result.success) {
                throw new Error(result.error || '图像分析请求失败');
            }

            // 检查响应格式
            if (!result.data?.choices?.[0]?.message?.content) {
                throw new Error('图像分析结果格式错误');
            }

            const description = result.data.choices[0].message.content;
            logger.debug(`图像分析请求成功 | 请求ID:${request_id} | 结果长度:${description.length}`);

            return {
                success: true,
                data: {
                    description
                }
            };
        } catch (error) {
            logger.error(`图像分析请求失败 | 请求ID:${request_id || 'unknown'} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 设置 API 配置
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
     */
    static getConfig() {
        return { ...this.API_CONFIG };
    }
}

// 导出LLM视觉服务实例
export const llmVisionService = new LLMVisionService();