/**
 * 智谱AI GLM-4 API调用服务
 * 文档：https://www.bigmodel.cn/dev/api/normal-model/glm-4
 */

import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import { PromptFormatter } from "../utils/promptFormatter.js";

class LLMService {
    // API 配置
    static API_CONFIG = {
        BASE_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        MODEL: 'glm-4-flash-250414',
        TRANSLATE_SYSTEM_MESSAGE: {
            TO_EN: null, // 翻译成英文的系统提示词
            TO_ZH: null  // 翻译成中文的系统提示词
        },
        EXPAND_SYSTEM_MESSAGE: {
            // 扩写提示词的系统提示词，将根据语言选择
            ZH: null, // 中文扩写提示词
            EN: null  // 英文扩写提示词
        }
    };

    // 错误码映射
    static ERROR_CODES = {
        '401': '认证失败，请检查API密钥是否正确',
        '429': '请求超过频率限制',
        '500': '服务器内部错误',
        '503': '服务不可用',
    };

    constructor() {
        this.API_URL = LLMService.API_CONFIG.BASE_URL;
        this.MODEL = LLMService.API_CONFIG.MODEL;
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
    async generateHeaders() {
        const apiKey = await LLMService.getApiKey();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };
    }

    /**
     * 构建请求体
     */
    async buildRequestBody({
        messages,
        temperature = 0.7,
        top_p = 0.7,
        max_tokens = 1500,
        tools = null,
        tool_choice = "auto",
        operation_type = 'expand' // 新增参数，用于区分操作类型：expand/translate
    }) {
        // 根据操作类型加载对应的系统提示词
        if (operation_type === 'expand') {
            // 加载扩写系统提示词
            if (!LLMService.API_CONFIG.EXPAND_SYSTEM_MESSAGE.ZH || !LLMService.API_CONFIG.EXPAND_SYSTEM_MESSAGE.EN) {
                const systemPrompts = await ResourceManager.loadSystemPrompts();
                if (!systemPrompts?.expand_prompts) {
                    throw new Error('扩写系统提示词加载失败');
                }
                // 加载分语言的扩写提示词
                LLMService.API_CONFIG.EXPAND_SYSTEM_MESSAGE = systemPrompts.expand_prompts;
            }
        } else if (operation_type === 'translate') {
            // 翻译操作加载翻译系统提示词
            if (!LLMService.API_CONFIG.TRANSLATE_SYSTEM_MESSAGE.TO_EN || !LLMService.API_CONFIG.TRANSLATE_SYSTEM_MESSAGE.TO_ZH) {
                const systemPrompts = await ResourceManager.loadSystemPrompts();
                if (!systemPrompts?.translate_prompts) {
                    throw new Error('翻译系统提示词加载失败');
                }
                LLMService.API_CONFIG.TRANSLATE_SYSTEM_MESSAGE = systemPrompts.translate_prompts;
            }
        }

        // 根据操作类型选择系统提示词
        let systemMessage;
        if (operation_type === 'expand') {
            // 从消息中获取源语言
            const sourceLang = messages[0]?.targetLang || 'zh';

            // 选择对应语言的扩写提示词
            systemMessage = sourceLang === 'en'
                ? LLMService.API_CONFIG.EXPAND_SYSTEM_MESSAGE.EN
                : LLMService.API_CONFIG.EXPAND_SYSTEM_MESSAGE.ZH;
        } else if (operation_type === 'translate') {
            // 从消息中获取目标语言
            const targetLang = messages[0]?.targetLang || 'zh';
            systemMessage = targetLang === 'en'
                ? LLMService.API_CONFIG.TRANSLATE_SYSTEM_MESSAGE.TO_EN
                : LLMService.API_CONFIG.TRANSLATE_SYSTEM_MESSAGE.TO_ZH;
        }

        if (!systemMessage) {
            throw new Error(`系统提示词未找到，操作类型: ${operation_type}`);
        }

        // 处理消息数组
        const processedMessages = messages.map(msg => {
            // 创建新的消息对象，只保留必要的字段
            const { role, content } = msg;
            return { role, content };
        });

        // 添加系统提示词到消息开头
        const messagesWithSystem = [
            systemMessage,
            ...processedMessages
        ];

        const body = {
            model: this.MODEL,
            messages: messagesWithSystem,
            temperature,
            top_p,
            max_tokens
        };

        if (tools) {
            body.tools = tools;
            body.tool_choice = tool_choice;
        }

        return body;
    }

    /**
     * 发送API请求
     */
    async sendRequest(params, apiKey = null) {
        if (!params.request_id) {
            throw new Error('请求ID不能为空');
        }

        try {
            // 获取提示词类型和操作类型
            const operationType = params.operation_type || 'expand';
            let promptType;
            let logPrefix;

            if (operationType === 'translate') {
                promptType = params.messages[0]?.targetLang === 'en' ? 'TO_EN' : 'TO_ZH';
                logPrefix = 'LLM翻译请求';
            } else if (operationType === 'expand') {
                promptType = params.messages[0]?.targetLang === 'en' ? 'EXPAND_EN' : 'EXPAND_ZH';
                logPrefix = 'LLM扩写请求';
            } else {
                promptType = 'unknown';
                logPrefix = 'LLM请求';
            }

            logger.debug(`发起${logPrefix} | 请求ID:${params.request_id} | 类型:${promptType} | 参数:${JSON.stringify({ operation_type: operationType })}`);

            const headers = await this.generateHeaders();
            const body = await this.buildRequestBody(params);

            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorMessage = LLMService.getErrorMessage(response.status);
                throw new Error(errorMessage);
            }

            const result = await response.json();
            logger.debug(`${logPrefix}成功 | 请求ID:${params.request_id} | 结果:${JSON.stringify(result)}`);

            return {
                success: true,
                data: result
            };

        } catch (error) {
            const operationType = params.operation_type || 'expand';
            const logPrefix = operationType === 'translate' ? 'LLM翻译请求' : 'LLM扩写请求';

            logger.error(`${logPrefix}失败 | 请求ID:${params.request_id} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 扩写提示词
     */
    async expandPrompt(prompt, request_id) {
        try {
            // 使用PromptFormatter检测输入语言
            const langResult = PromptFormatter.detectLanguage(prompt);
            logger.debug(`发起LLM扩写请求 | 请求ID:${request_id} | 原文:${prompt} | 检测语言:${langResult.from}`);

            const params = {
                messages: [
                    {
                        role: "user",
                        content: prompt,
                        targetLang: langResult.from // 添加源语言标记，让大模型使用相同语言回复
                    }
                ],
                operation_type: 'expand',
                request_id
            };

            const result = await this.sendRequest(params);

            if (result.success) {
                const expandedText = result.data.choices[0].message.content;
                logger.debug(`LLM扩写请求成功 | 请求ID:${request_id} | 结果:${expandedText}`);

                return {
                    success: true,
                    data: {
                        original: prompt,
                        expanded: expandedText
                    }
                };
            } else {
                throw new Error(result.error || '扩写请求失败');
            }
        } catch (error) {
            logger.error(`LLM 扩写请求失败 | 请求ID:${request_id} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 翻译文本
     */
    async translate(text, from = 'auto', to = 'zh', request_id) {
        try {
            logger.debug(`发起翻译请求 | 请求ID:${request_id} | 原文:${text} | 方向:${from}->${to}`);

            // 验证API密钥
            const apiKey = await LLMService.getApiKey();
            if (!apiKey) {
                throw new Error('请先配置 LLM API 密钥');
            }

            const params = {
                messages: [
                    {
                        role: "user",
                        content: text,
                        targetLang: to // 添加目标语言标记
                    }
                ],
                operation_type: 'translate',
                request_id
            };

            const result = await this.sendRequest(params);

            if (!result.success) {
                throw new Error(result.error || '翻译请求失败');
            }

            if (!result.data?.choices?.[0]?.message?.content) {
                throw new Error('翻译结果格式错误');
            }

            const translatedText = result.data.choices[0].message.content;
            logger.debug(`翻译请求成功 | 请求ID:${request_id} | 结果:${translatedText}`);

            return {
                success: true,
                data: {
                    from: from,
                    to: to,
                    original: text,
                    translated: translatedText
                }
            };
        } catch (error) {
            logger.error(`翻译请求失败  | 请求ID:${request_id} | 错误:${error.message}`);
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
     * 设置系统提示词
     */
    static setSystemMessage(systemMessage) {
        try {
            if (typeof systemMessage !== 'string' || !systemMessage.trim()) {
                throw new Error('系统提示词不能为空');
            }

            this.API_CONFIG.SYSTEM_MESSAGE = {
                role: "system",
                content: systemMessage
            };

            logger.debug('系统提示词更新成功');
            return true;
        } catch (error) {
            logger.error(`系统提示词更新失败 | 错误:${error.message}`);
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

// 导出LLM服务实例
export const llmService = new LLMService();