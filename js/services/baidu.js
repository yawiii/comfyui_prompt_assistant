/**
 * 百度翻译 API 服务
 * 提供与百度翻译 API 的交互功能
 */

import { logger } from '../utils/logger.js';
import { MD5 } from "../utils/md5.js";

class BaiduTranslateService {
    // API 配置
    static API_CONFIG = {
        BASE_URL: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
        FROM_LANG: 'auto', // 源语言，auto为自动检测
        TO_LANG: 'zh', // 目标语言，默认翻译为中文
    };

    // 错误码映射
    static ERROR_CODES = {
        '52001': '请求超时，请重试',
        '52002': '系统错误，请重试',
        '52003': '未授权用户，请检查appid是否正确或服务是否开通',
        '54000': '必填参数为空，请检查是否少传参数',
        '54001': '签名错误，请检查您的签名生成方法',
        '54003': '访问频率受限，请降低您的调用频率，或进行身份认证后切换为高级版/尊享版',
        '54004': '账户余额不足，请前往管理控制台充值',
        '54005': '长query请求频繁，请降低长query的发送频率，3s后再试',
        '58000': '客户端IP非法，检查个人资料里填写的IP地址是否正确，可前往开发者信息-基本信息修改',
        '58001': '译文语言方向不支持，检查译文语言是否在语言列表里',
        '58002': '服务当前已关闭，请前往百度管理控制台开启服务',
        '58003': '此IP已被封禁',
        '90107': '认证未通过或未生效，请前往我的认证查看认证进度',
        '20003': '请求内容存在安全风险',
    };

    /**
     * 获取错误信息
     */
    static getErrorMessage(code) {
        return this.ERROR_CODES[code] || `未知错误(错误码:${code})`;
    }

    /**
     * 获取配置信息
     */
    static async getConfig() {
        try {
            const response = await fetch('/prompt_assistant/api/config/baidu_translate');
            if (!response.ok) {
                throw new Error('获取配置失败');
            }
            const config = await response.json();
            return config;
        } catch (error) {
            logger.error(`获取百度翻译配置失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 生成签名
     */
    static async generateSign(query, salt) {
        try {
            const config = await this.getConfig();
            // 拼接字符串
            const str = config.app_id + query + salt + config.secret_key;
            // 计算 MD5
            return MD5(str);
        } catch (error) {
            logger.error(`签名生成失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 处理长文本 - 按段落分割文本
     * 解决JSONP请求时长文本被截断的问题
     */
    static splitTextByParagraphs(text, maxLength = 2000) {
        if (!text) return [];

        // 按段落分割
        const paragraphs = text.split(/\n+/);
        const chunks = [];
        let currentChunk = "";

        for (const paragraph of paragraphs) {
            // 如果当前段落本身超过最大长度，需要再次分割
            if (paragraph.length > maxLength) {
                // 如果currentChunk不为空，先添加到chunks
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = "";
                }

                // 分割长段落
                let remainingText = paragraph;
                while (remainingText.length > 0) {
                    const chunkText = remainingText.slice(0, maxLength);
                    chunks.push(chunkText);
                    remainingText = remainingText.slice(maxLength);
                }
            }
            // 如果添加当前段落会超出长度限制，先保存当前chunk
            else if (currentChunk && (currentChunk.length + paragraph.length + 1 > maxLength)) {
                chunks.push(currentChunk);
                currentChunk = paragraph;
            }
            // 否则，添加到当前chunk
            else {
                if (currentChunk) {
                    currentChunk += "\n" + paragraph;
                } else {
                    currentChunk = paragraph;
                }
            }
        }

        // 添加最后一个chunk
        if (currentChunk) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    /**
     * 使用 JSONP 方式发送请求
     */
    static jsonp(params) {
        return new Promise((resolve, reject) => {
            // 创建唯一的回调函数名
            const callbackName = 'baiduTranslateCallback_' + Date.now();

            // 创建script标签
            const script = document.createElement('script');

            // 构建URL
            const queryString = Object.keys(params)
                .map(key => `${key}=${encodeURIComponent(params[key])}`)
                .join('&');

            // 设置全局回调函数
            window[callbackName] = (response) => {
                // 清理工作
                delete window[callbackName];
                document.body.removeChild(script);

                if (response.error_code) {
                    const errorMessage = this.getErrorMessage(response.error_code);
                    reject(new Error(`错误：${errorMessage}`));
                } else {
                    resolve(response);
                }
            };

            // 设置script标签的src
            script.src = `${this.API_CONFIG.BASE_URL}?${queryString}&callback=${callbackName}`;

            // 处理加载错误
            script.onerror = () => {
                delete window[callbackName];
                document.body.removeChild(script);
                reject(new Error('错误：网络请求失败'));
            };

            // 添加script标签到页面
            document.body.appendChild(script);
        });
    }

    /**
     * 发送翻译请求
     */
    static async translate(text, from = this.API_CONFIG.FROM_LANG, to = this.API_CONFIG.TO_LANG, request_id = null) {
        // 使用外部传入的request_id，如果没有则自动生成
        request_id = request_id || `baidu_trans_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        try {
            // 参数验证
            if (!text || text.trim() === '') {
                throw new Error('错误：待翻译文本不能为空');
            }

            // 获取配置
            let config;
            try {
                config = await this.getConfig();
                if (!config || !config.app_id || !config.secret_key) {
                    throw new Error('配置无效');
                }
            } catch (error) {
                logger.error(`获取配置失败: ${error.message}`);
                throw new Error('错误：请先配置百度翻译 API 的 APP_ID 和 SECRET_KEY');
            }

            // 记录请求开始
            logger.debug(`发起百度API请求 | 请求ID:${request_id} | API:baidu_translate | 参数:${JSON.stringify({ text, from, to })}`);

            // 处理长文本 - 按段落分割
            const textChunks = this.splitTextByParagraphs(text);
            let translatedText = '';

            // 如果文本被分割成多个段落，依次翻译
            if (textChunks.length > 1) {
                logger.debug(`文本分段处理 | 请求ID:${request_id} | 总段数:${textChunks.length}`);

                for (let i = 0; i < textChunks.length; i++) {
                    const chunk = textChunks[i];
                    const salt = Date.now();
                    const sign = await this.generateSign(chunk, salt);

                    const params = {
                        q: chunk,
                        from,
                        to,
                        appid: config.app_id,
                        salt: salt,
                        sign: sign
                    };

                    const response = await this.jsonp(params);
                    translatedText += response.trans_result[0].dst + (i < textChunks.length - 1 ? '\n' : '');

                    // 如果还有更多段落，等待一段时间再继续
                    if (i < textChunks.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            } else {
                const chunk = textChunks[0] || text;
                const salt = Date.now();
                const sign = await this.generateSign(chunk, salt);

                const params = {
                    q: chunk,
                    from,
                    to,
                    appid: config.app_id,
                    salt: salt,
                    sign: sign
                };

                const response = await this.jsonp(params);
                translatedText = response.trans_result[0].dst;
            }

            // 记录请求完成
            logger.debug(`百度API请求完成 | 请求ID:${request_id}`);

            // 返回统一格式的结果
            return {
                success: true,
                data: {
                    translated: translatedText,
                    from: from,
                    to: to,
                    original: text
                }
            };

        } catch (error) {
            logger.error(`百度API请求失败 | 请求ID:${request_id} | 错误:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 批量翻译
     */
    static async batchTranslate(texts, from = this.API_CONFIG.FROM_LANG, to = this.API_CONFIG.TO_LANG) {
        try {
            if (!Array.isArray(texts) || texts.length === 0) {
                throw new Error('待翻译文本数组不能为空');
            }

            // 串行处理每个文本的翻译
            const results = [];
            for (const text of texts) {
                const result = await this.translate(text, from, to);
                results.push(result);
            }

            return results;

        } catch (error) {
            logger.error(`批量翻译 | 结果:失败 | 错误:${error.message}`);
            return [];
        }
    }

    /**
     * 设置 API 配置
     */
    static setConfig(config) {
        try {
            // 验证必要的配置项
            if (config.app_id && config.secret_key) {
                this.API_CONFIG = {
                    ...this.API_CONFIG,
                    app_id: config.app_id,
                    secret_key: config.secret_key
                };
                logger.debug('API配置更新成功');
                return true;
            } else {
                throw new Error('app_id 和 secret_key 是必需的配置项');
            }
        } catch (error) {
            logger.error(`API配置更新失败 | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 获取当前 API 配置
     */
    static getAPIConfig() {
        return { ...this.API_CONFIG };
    }
}

export { BaiduTranslateService };