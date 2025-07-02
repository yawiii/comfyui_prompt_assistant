/**
 * 资源管理器
 * 统一管理所有资源的加载、缓存和访问
 */

import { logger } from './logger.js';

class ResourceManager {
    // 资源缓存
    static #styleCache = new Map();
    static #tagCache = null;  // 修改为单一变量存储

    // 初始化状态
    static #initialized = false;
    static #initializing = false;

    // ---图标管理相关---
    static #iconLoadingPromise = null;  // 图标加载Promise
    static #iconLoadAttempts = 0;       // 图标加载尝试次数
    static #maxIconLoadAttempts = 2;    // 最大重试次数
    static #iconLoadDelay = 1000;       // 重试延迟（毫秒）

    /**
     * 初始化资源管理器
     */
    static init() {
        // 已经初始化过，直接返回
        if (this.#initialized) {
            return true;
        }

        // 正在初始化中，避免重复
        if (this.#initializing) {
            return false;
        }

        this.#initializing = true;

        try {
            // 加载所有资源
            this.#loadStyles();
            this.#loadTagData();

            this.#initialized = true;
            this.#initializing = false;

            logger.log("资源管理器 | 初始化完成");
            return true;
        } catch (error) {
            logger.error(`资源管理器 | 初始化失败 | ${error.message}`);
            this.#initializing = false;
            return false;
        }
    }

    /**
     * 获取资源的绝对URL
     */
    static getResourceUrl(relativePath) {
        return new URL(relativePath, import.meta.url).href;
    }

    /**
     * 获取CSS文件的绝对URL
     */
    static getCssUrl(cssFileName) {
        return this.getResourceUrl(`../css/${cssFileName}`);
    }

    /**
     * 加载所有样式表
     */
    static #loadStyles() {
        const stylesToLoad = [
            { id: 'prompt-assistant-common-styles', file: 'common.css' },
            { id: 'prompt-assistant-styles', file: 'assistant.css' },
            { id: 'prompt-assistant-popup-styles', file: 'popup.css' },
            { id: 'prompt-assistant-icon-styles', file: 'icon.css' }  // 添加icon.css
        ];

        stylesToLoad.forEach(style => {
            this.#loadStyle(style.id, style.file);
        });
    }

    /**
     * 加载单个样式表
     */
    static #loadStyle(id, file) {
        // 检查是否已存在
        if (document.getElementById(id)) {
            return;
        }

        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = this.getCssUrl(file);

        link.onload = () => {
            this.#styleCache.set(id, link);
        };

        link.onerror = () => {
            logger.error(`样式表加载失败 | ${id}`);
        };

        document.head.appendChild(link);
    }

    // ====================== 图标管理 ======================

    /**
     * 确保图标CSS已加载并可用
     * @returns {Promise<boolean>} 图标是否可用
     */
    static async ensureIconsLoaded() {
        // 如果已经有加载Promise在进行中，直接返回
        if (this.#iconLoadingPromise) {
            return await this.#iconLoadingPromise;
        }

        // 创建新的加载Promise
        this.#iconLoadingPromise = this.#loadIconsWithRetry();
        return await this.#iconLoadingPromise;
    }

    /**
     * 带重试的图标加载
     * @returns {Promise<boolean>}
     */
    static async #loadIconsWithRetry() {
        for (let attempt = 1; attempt <= this.#maxIconLoadAttempts; attempt++) {
            this.#iconLoadAttempts = attempt;
            
            try {
                logger.debug(`图标加载 | 尝试:${attempt}/${this.#maxIconLoadAttempts}`);
                
                // 检查CSS是否已加载
                const cssLoaded = await this.#waitForCSSLoad('prompt-assistant-icon-styles');
                if (!cssLoaded) {
                    throw new Error('CSS文件加载超时');
                }

                // 验证图标样式是否可用
                const iconsAvailable = await this.#verifyIconsAvailable();
                if (!iconsAvailable) {
                    throw new Error('图标样式验证失败');
                }

                logger.log(`图标加载 | 结果:成功 | 尝试次数:${attempt}`);
                return true;

            } catch (error) {
                logger.warn(`图标加载 | 尝试:${attempt} | 失败:${error.message}`);
                
                // 如果不是最后一次尝试，等待后重试
                if (attempt < this.#maxIconLoadAttempts) {
                    const delay = this.#iconLoadDelay * attempt; // 指数退避
                    logger.debug(`图标加载 | 等待:${delay}ms | 后重试`);
                    await this.#delay(delay);
                    
                    // 重新加载CSS
                    this.#reloadIconCSS();
                } else {
                    logger.error(`图标加载 | 最终失败 | 尝试次数:${attempt}`);
                }
            }
        }

        return false;
    }

    /**
     * 等待CSS文件加载完成
     * @param {string} styleId 样式表ID
     * @param {number} timeout 超时时间（毫秒）
     * @returns {Promise<boolean>}
     */
    static async #waitForCSSLoad(styleId, timeout = 10000) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            
            const checkCSS = () => {
                // 检查超时
                if (Date.now() - startTime > timeout) {
                    logger.warn(`CSS加载 | 超时 | ID:${styleId} | 超时时间:${timeout}ms`);
                    resolve(false);
                    return;
                }

                // 检查link元素是否存在
                const linkElement = document.getElementById(styleId);
                if (!linkElement) {
                    logger.debug(`CSS加载 | 等待元素 | ID:${styleId}`);
                    setTimeout(checkCSS, 100);
                    return;
                }

                // 检查CSS是否在document.styleSheets中
                const styleSheets = Array.from(document.styleSheets);
                const targetSheet = styleSheets.find(sheet => {
                    try {
                        return sheet.ownerNode === linkElement;
                    } catch (e) {
                        return false;
                    }
                });

                if (!targetSheet) {
                    logger.debug(`CSS加载 | 等待样式表 | ID:${styleId}`);
                    setTimeout(checkCSS, 100);
                    return;
                }

                // 检查样式表是否有规则
                try {
                    const rules = targetSheet.cssRules || targetSheet.rules;
                    if (!rules || rules.length === 0) {
                        logger.debug(`CSS加载 | 等待规则 | ID:${styleId}`);
                        setTimeout(checkCSS, 100);
                        return;
                    }

                    logger.debug(`CSS加载 | 完成 | ID:${styleId} | 规则数:${rules.length}`);
                    resolve(true);
                } catch (error) {
                    // 跨域或其他安全限制
                    logger.debug(`CSS加载 | 安全限制,假设已加载 | ID:${styleId}`);
                    resolve(true);
                }
            };

            checkCSS();
        });
    }

    /**
     * 验证图标样式是否可用
     * @returns {Promise<boolean>}
     */
    static async #verifyIconsAvailable() {
        return new Promise((resolve) => {
            // 创建测试元素
            const testElement = document.createElement('div');
            testElement.className = 'icon-caption-en'; // 使用一个已知的图标类
            testElement.style.position = 'absolute';
            testElement.style.left = '-9999px';
            testElement.style.top = '-9999px';
            testElement.style.visibility = 'hidden';
            testElement.style.width = '20px';
            testElement.style.height = '20px';
            
            document.body.appendChild(testElement);

            // 等待一帧后检查样式
            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        const computedStyle = window.getComputedStyle(testElement);
                        const maskImage = computedStyle.getPropertyValue('mask-image') || 
                                         computedStyle.getPropertyValue('-webkit-mask-image');
                        
                        // 检查是否有mask-image样式
                        const hasIcon = maskImage && maskImage !== 'none' && maskImage.includes('data:image/svg+xml');
                        
                        logger.debug(`图标验证 | 结果:${hasIcon ? '成功' : '失败'} | mask-image:${maskImage ? '存在' : '无'}`);
                        
                        document.body.removeChild(testElement);
                        resolve(hasIcon);
                    } catch (error) {
                        logger.warn(`图标验证 | 错误:${error.message}`);
                        document.body.removeChild(testElement);
                        resolve(false);
                    }
                }, 100);
            });
        });
    }

    /**
     * 重新加载图标CSS
     */
    static #reloadIconCSS() {
        try {
            // 移除旧的CSS
            const oldLink = document.getElementById('prompt-assistant-icon-styles');
            if (oldLink && oldLink.parentNode) {
                oldLink.parentNode.removeChild(oldLink);
                this.#styleCache.delete('prompt-assistant-icon-styles');
            }

            // 重新加载CSS，添加时间戳防止缓存
            const link = document.createElement("link");
            link.id = 'prompt-assistant-icon-styles';
            link.rel = "stylesheet";
            link.type = "text/css";
            link.href = this.getCssUrl('icon.css') + '?t=' + Date.now();

            document.head.appendChild(link);
            
            logger.debug('图标CSS | 重新加载');
        } catch (error) {
            logger.error(`图标CSS重新加载失败: ${error.message}`);
        }
    }

    /**
     * 检查特定图标是否可用
     * @param {string} iconClass 图标类名（如 'icon-caption-en'）
     * @returns {Promise<boolean>}
     */
    static async isIconAvailable(iconClass) {
        // 先确保图标CSS已加载
        const iconsLoaded = await this.ensureIconsLoaded();
        if (!iconsLoaded) {
            return false;
        }

        return new Promise((resolve) => {
            const testElement = document.createElement('div');
            testElement.className = iconClass;
            testElement.style.position = 'absolute';
            testElement.style.left = '-9999px';
            testElement.style.top = '-9999px';
            testElement.style.visibility = 'hidden';
            testElement.style.width = '20px';
            testElement.style.height = '20px';
            
            document.body.appendChild(testElement);

            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        const computedStyle = window.getComputedStyle(testElement);
                        const maskImage = computedStyle.getPropertyValue('mask-image') || 
                                         computedStyle.getPropertyValue('-webkit-mask-image');
                        
                        const hasIcon = maskImage && maskImage !== 'none' && maskImage.includes('data:image/svg+xml');
                        
                        document.body.removeChild(testElement);
                        resolve(hasIcon);
                    } catch (error) {
                        document.body.removeChild(testElement);
                        resolve(false);
                    }
                }, 50);
            });
        });
    }

    /**
     * 获取图标加载状态
     * @returns {Object} 加载状态信息
     */
    static getIconLoadStatus() {
        return {
            attempts: this.#iconLoadAttempts,
            maxAttempts: this.#maxIconLoadAttempts,
            isLoading: !!this.#iconLoadingPromise,
            cssExists: !!document.getElementById('prompt-assistant-icon-styles')
        };
    }

    /**
     * 延迟函数
     * @param {number} ms 延迟毫秒数
     * @returns {Promise}
     */
    static #delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ====================== 标签数据管理 ======================

    /**
     * 获取标签数据文件的URL
     */
    static getTagUrl() {
        return this.getResourceUrl('../config/tags.json');
    }

    /**
     * 统计标签数据
     */
    static #getTagStats(data) {
        const stats = {
            categories: 0,  // 所有分类数量（包括所有层级）
            tags: 0        // 叶子节点数量（实际标签数）
        };

        /**
         * 递归统计标签数据
         */
        const countRecursively = (obj) => {
            // 遍历当前层级的所有键
            for (const key in obj) {
                const value = obj[key];

                // 如果值是字符串，说明这是一个标签（叶子节点）
                if (typeof value === 'string') {
                    stats.tags++;
                }
                // 如果值是对象，说明这是一个分类，需要继续递归
                else if (typeof value === 'object' && value !== null) {
                    stats.categories++;
                    countRecursively(value);
                }
            }
        };

        // 开始递归统计
        countRecursively(data);

        return stats;
    }

    /**
     * 刷新标签数据
     */
    static refreshTagData() {
        return new Promise((resolve, reject) => {
            const tagUrl = this.getTagUrl();
            logger.debug("开始重新加载标签数据...");

            fetch(tagUrl + '?t=' + new Date().getTime())  // 添加时间戳防止缓存
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    this.#tagCache = data;
                    const stats = this.#getTagStats(data);
                    logger.log(`标签数据刷新完成 | 分类数量: ${stats.categories} | 标签数量: ${stats.tags}`);
                    resolve(data);
                })
                .catch(error => {
                    logger.error(`标签数据刷新失败 | ${error.message}`);
                    reject(error);
                });
        });
    }

    /**
     * 加载标签数据
     */
    static #loadTagData() {
        // 标签数据使用懒加载，在需要时才加载
    }

    /**
     * 获取标签数据
     */
    static async getTagData(refresh = false) {
        if (refresh || !this.#tagCache) {
            return await this.refreshTagData();
        }
        return this.#tagCache;
    }

    /**
     * 获取标签统计数据
     */
    static async getTagStats() {
        const tagData = await this.getTagData();
        const stats = this.#getTagStats(tagData);
        return stats.tags;
    }

    /**
     * 检查是否已初始化
     */
    static isInitialized() {
        return this.#initialized;
    }

    // ====================== 资源清理 ======================

    /**
     * 清理所有资源
     */
    static async cleanup() {
        logger.log("资源管理器 | 开始清理资源");

        // 移除样式表
        this.#styleCache.forEach((style) => {
            if (style && style.parentNode) {
                style.parentNode.removeChild(style);
            }
        });
        this.#styleCache.clear();

        // 清理标签数据
        this.#tagCache = null;

        // 重置图标加载状态
        this.#iconLoadingPromise = null;
        this.#iconLoadAttempts = 0;

        // 重置状态
        this.#initialized = false;
        this.#initializing = false;

        // 重新初始化资源
        await this.init();

        logger.log("资源管理器 | 资源已清理并重新初始化");
    }

    /**
     * 加载外部脚本
     */
    static async loadScript(url) {
        try {
            if (this.resources && this.resources.has(url)) {
                return this.resources.get(url);
            }

            const promise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = url;
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
                document.head.appendChild(script);
            });

            if (this.resources) {
                this.resources.set(url, promise);
            }
            await promise;
            logger.debug(`脚本加载成功 | URL:${url}`);
            return promise;
        } catch (error) {
            logger.error(`脚本加载失败 | URL:${url} | 错误:${error.message}`);
            throw error;
        }
    }

    /**
     * 加载和获取CryptoJS
     */
    static async getCryptoJS() {
        try {
            // 检查是否已经存在CryptoJS
            if (window.CryptoJS) {
                return window.CryptoJS;
            }

            // 使用CDN加载CryptoJS
            const cryptoJSUrl = 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js';
            await this.loadScript(cryptoJSUrl);

            if (window.CryptoJS) {
                logger.debug('CryptoJS加载成功');
                return window.CryptoJS;
            } else {
                throw new Error('CryptoJS加载后未找到');
            }
        } catch (error) {
            logger.error(`CryptoJS加载失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取系统提示词文件的URL
     */
    static getSystemPromptsUrl() {
        return this.getResourceUrl('../config/system_prompts.json');
    }

    /**
     * 加载系统提示词
     */
    static async loadSystemPrompts(forceRefresh = true) {
        try {
            const url = this.getSystemPromptsUrl();
            const finalUrl = forceRefresh ? `${url}?t=${Date.now()}` : url;
            
            const response = await fetch(finalUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            logger.debug('系统提示词加载成功');
            return data;
        } catch (error) {
            logger.error(`系统提示词加载失败: ${error.message}`);
            throw error;
        }
    }
}

export { ResourceManager };