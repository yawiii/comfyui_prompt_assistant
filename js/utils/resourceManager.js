/**
 * 资源管理器
 * 统一管理所有资源的加载、缓存和访问
 */

import { logger } from './logger.js';

class ResourceManager {
    // 资源缓存
    static #iconCache = new Map();
    static #styleCache = new Map();
    static #tagCache = null;  // 修改为单一变量存储

    // 初始化状态
    static #initialized = false;
    static #initializing = false;

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
            this.#loadIcons();
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
     * 获取CSS文件的URL
     */
    static getCssUrl(cssFileName) {
        return this.getResourceUrl(`../css/${cssFileName}`);
    }

    /**
     * 获取资源目录中的资源URL
     */
    static getAssetUrl(assetFileName) {
        return this.getResourceUrl(`../assets/${assetFileName}`);
    }

    // ====================== 图标管理 ======================

    /**
     * 加载所有图标
     * @private
     */
    static #loadIcons() {
        // 所有需要加载的图标列表
        const iconsToLoad = [
            'icon-history.svg',
            'icon-undo.svg',
            'icon-redo.svg',
            'icon-tag.svg',
            'icon-expand.svg',
            'icon-translate.svg',
            'icon-movedown.svg',
            'icon-close.svg',
            'icon-refresh.svg',
            'icon-caption-zh.svg',
            'icon-caption-en.svg',
            'icon-remove.svg',
            'icon-resize-handle.svg',
        ];

        let loaded = 0;
        let failed = 0;

        // 逐个加载图标
        iconsToLoad.forEach(iconName => {
            const iconUrl = this.getAssetUrl(iconName);

            // 使用fetch加载SVG内容
            fetch(iconUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.text();
                })
                .then(svgContent => {
                    // 缓存SVG内容
                    this.#iconCache.set(iconName, svgContent);
                    loaded++;

                    // 所有图标加载完成后输出日志
                    if (loaded + failed === iconsToLoad.length) {
                        logger.debug(`图标加载完成 | 成功:${loaded}个 | 失败:${failed}个`);
                    }
                })
                .catch(error => {
                    failed++;
                    logger.warn(`图标加载失败 | ${iconName} | ${error.message}`);

                    // 所有图标加载完成后输出日志
                    if (loaded + failed === iconsToLoad.length) {
                        logger.debug(`图标加载完成 | 成功:${loaded}个 | 失败:${failed}个`);
                    }
                });
        });
    }

    /**
     * 获取缓存的图标
     */
    static getIcon(iconName) {
        const svgContent = this.#iconCache.get(iconName);
        if (!svgContent) {
            return null;
        }

        // 创建一个包含SVG的span元素
        const iconContainer = document.createElement('span');
        iconContainer.className = 'svg-icon';
        iconContainer.innerHTML = svgContent;

        // 获取SVG元素并添加样式
        const svgElement = iconContainer.querySelector('svg');
        if (svgElement) {
            // 添加样式以确保SVG可以通过color属性控制颜色
            svgElement.style.width = '100%';
            svgElement.style.height = '100%';
            svgElement.style.fill = 'currentColor';

            // 移除可能存在的固定颜色属性
            svgElement.querySelectorAll('*').forEach(el => {
                if (el.hasAttribute('fill') && el.getAttribute('fill') !== 'none') {
                    el.setAttribute('fill', 'currentColor');
                }
                if (el.hasAttribute('stroke') && el.getAttribute('stroke') !== 'none') {
                    el.setAttribute('stroke', 'currentColor');
                }
            });
        }

        return iconContainer;
    }

    // ====================== 样式管理 ======================

    /**
     * 加载所有样式表
     * @private
     */
    static #loadStyles() {
        const stylesToLoad = [
            { id: 'prompt-assistant-common-styles', file: 'common.css' },
            { id: 'prompt-assistant-styles', file: 'assistant.css' },
            { id: 'prompt-assistant-popup-styles', file: 'popup.css' }
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
        return this.refreshTagData();
    }

    /**
     * 获取标签数据
     */
    static async getTagData(refresh = false) {
        if (refresh || !this.#tagCache) {
            try {
                await this.refreshTagData();
            } catch (error) {
                logger.error(`获取标签数据失败 | ${error.message}`);
                return {};
            }
        }
        return this.#tagCache || {};
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
        // 清理图标缓存
        this.#iconCache.clear();

        // 移除样式表
        this.#styleCache.forEach((style) => {
            if (style && style.parentNode) {
                style.parentNode.removeChild(style);
            }
        });
        this.#styleCache.clear();

        // 清理标签数据
        this.#tagCache = null;

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
            if (this.resources.has(url)) {
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

                this.resources.set(url, promise);
            await promise;
            logger.debug(`脚本加载成功 | URL:${url}`);
            return promise;
        } catch (error) {
            logger.error(`脚本加载失败 | URL:${url} | 错误:${error.message}`);
            throw error;
        }
    }

    /**
     * 获取 CryptoJS 实例
     */
    static async getCryptoJS() {
        try {
            // 如果已经加载过，直接返回
            if (window.CryptoJS) {
                return window.CryptoJS;
            }

            // 加载 CryptoJS
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js');

            if (!window.CryptoJS) {
                throw new Error('CryptoJS 加载失败');
            }

            logger.debug('CryptoJS 加载成功');
                return window.CryptoJS;
        } catch (error) {
            logger.error(`CryptoJS 获取失败 | 错误:${error.message}`);
            throw error;
        }
    }

    /**
     * 获取系统提示词配置文件的URL
     */
    static getSystemPromptsUrl() {
        return this.getResourceUrl('../config/system_prompts.json');
    }

    /**
     * 加载系统提示词配置
     */
    static async loadSystemPrompts(forceRefresh = true) {
        try {
            const url = this.getSystemPromptsUrl();
            // 添加时间戳或随机参数以防止缓存
            const finalUrl = forceRefresh ? `${url}?t=${Date.now()}` : url;

            logger.debug(`加载系统提示词配置 | URL: ${finalUrl}`);
            
            const response = await fetch(finalUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            logger.debug(`系统提示词配置加载成功`);

            // 验证数据结构
            if (!data.vision_prompts) {
                logger.warn(`系统提示词配置中缺少vision_prompts字段`);
            } else {
                logger.debug(`视觉提示词配置: ${Object.keys(data.vision_prompts).join(', ')}`);
            }

            return data;
        } catch (error) {
            logger.error(`系统提示词配置加载失败 | ${error.message}`);
            return null;
        }
    }
}

export { ResourceManager };