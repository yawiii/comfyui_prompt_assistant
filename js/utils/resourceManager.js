/**
 * 资源管理器
 * 统一管理所有资源的加载、缓存和访问
 */

import { logger } from './logger.js';
import { APIService } from '../services/api.js';

class ResourceManager {
    // 资源缓存
    static #iconCache = new Map();
    static #styleCache = new Map();
    static #scriptCache = new Map();
    static #tagCache = null;  // 修改为单一变量存储
    static #userTagCache = null;  // 用户自定义标签缓存

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
            this.#loadUserTagData();

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

    /**
     * 获取库文件的URL
     */
    static getLibUrl(libFileName) {
        return this.getResourceUrl(`../lib/${libFileName}`);
    }

    // ====================== 图标管理 ======================

    /**
     * 加载所有图标
     * @private
     */
    static #loadIcons() {
        // 所有需要加载的图标列表
        const iconsToLoad = [
            'icon-main.svg',
            'icon-history.svg',
            'icon-undo.svg',
            'icon-redo.svg',
            'icon-tag.svg',
            'icon-expand.svg',
            'icon-translate.svg',
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
            { id: 'prompt-assistant-popup-styles', file: 'popup.css' },
            { id: 'prompt-assistant-ui-components-styles', file: 'uiComponents.css' }
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
        // 使用API路由获取标签数据
        return APIService.getApiUrl('/config/tags');
    }

    /**
     * 获取用户自定义标签数据文件的URL
     */
    static getUserTagUrl() {
        // 使用API路由获取用户自定义标签数据
        return APIService.getApiUrl('/config/tags_user');
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
                    // 检查是否有错误信息
                    if (data.error) {
                        throw new Error(`API返回错误: ${data.error}`);
                    }

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
     * 刷新用户自定义标签数据
     */
    static refreshUserTagData() {
        return new Promise((resolve, reject) => {
            const userTagUrl = this.getUserTagUrl();
            logger.debug("开始重新加载用户自定义标签数据...");

            fetch(userTagUrl + '?t=' + new Date().getTime())  // 添加时间戳防止缓存
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    // 检查是否有错误信息
                    if (data.error) {
                        throw new Error(`API返回错误: ${data.error}`);
                    }

                    this.#userTagCache = data;
                    const stats = this.#getTagStats(data);
                    logger.log(`用户标签数据刷新完成 | 分类数量: ${stats.categories} | 标签数量: ${stats.tags}`);
                    resolve(data);
                })
                .catch(error => {
                    logger.error(`用户标签数据刷新失败 | ${error.message}`);
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
     * 加载用户自定义标签数据
     */
    static #loadUserTagData() {
        return this.refreshUserTagData();
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
     * 获取用户自定义标签数据
     */
    static async getUserTagData(refresh = false) {
        if (refresh || !this.#userTagCache) {
            try {
                await this.refreshUserTagData();
            } catch (error) {
                logger.error(`获取用户标签数据失败 | ${error.message}`);
                return {};
            }
        }
        return this.#userTagCache || {};
    }

    /**
     * 获取标签统计数据
     */
    static async getTagStats() {
        const tagData = await this.getTagData();
        const stats = this.#getTagStats(tagData);
        return stats.tags;
    }

    // ---CSV标签系统---

    /**
     * 获取CSV文件列表
     */
    static async getTagFileList() {
        try {
            const response = await fetch(APIService.getApiUrl('/config/tags_files'));
            const result = await response.json();
            if (result.success) {
                return result.files || [];
            }
            logger.error(`获取标签文件列表失败 | ${result.error}`);
            return [];
        } catch (error) {
            logger.error(`获取标签文件列表失败 | ${error.message}`);
            return [];
        }
    }

    /**
     * 获取用户选择的标签文件
     */
    static async getSelectedTagFile() {
        try {
            const response = await fetch(APIService.getApiUrl('/config/tags_selection'));
            const result = await response.json();
            if (result.success) {
                return result.selection?.selected_file || 'default.csv';
            }
            return 'default.csv';
        } catch (error) {
            logger.error(`获取标签选择失败 | ${error.message}`);
            return 'default.csv';
        }
    }

    /**
     * 保存用户选择的标签文件
     */
    static async setSelectedTagFile(filename) {
        try {
            const response = await fetch(APIService.getApiUrl('/config/tags_selection'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selected_file: filename })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            logger.error(`保存标签选择失败 | ${error.message}`);
            return false;
        }
    }

    /**
     * 加载CSV标签数据
     * @param {string} filename - CSV文件名
     * @param {boolean} forceReload - 是否强制重新加载(当前总是重新加载)
     */
    static async loadTagsCsv(filename, forceReload = false) {
        try {
            const response = await fetch(APIService.getApiUrl(`/config/tags_csv/${filename}`));
            const result = await response.json();
            if (result.success) {
                this.#tagCache = result.data;
                const stats = this.#getTagStats(result.data);
                logger.log(`CSV标签加载完成 | 文件:${filename} | 分类:${stats.categories} | 标签:${stats.tags}`);
                return result.data;
            }
            logger.error(`加载CSV标签失败 | ${result.error}`);
            return {};
        } catch (error) {
            logger.error(`加载CSV标签失败 | ${error.message}`);
            return {};
        }
    }

    /**
     * 保存CSV标签数据
     */
    static async saveTagsCsv(filename, data) {
        try {
            const response = await fetch(APIService.getApiUrl(`/config/tags_csv/${filename}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            });
            const result = await response.json();
            if (result.success) {
                logger.log(`CSV标签保存成功 | 文件:${filename}`);
                return true;
            }
            logger.error(`保存CSV标签失败 | ${result.error}`);
            return false;
        } catch (error) {
            logger.error(`保存CSV标签失败 | ${error.message}`);
            return false;
        }
    }

    /**
     * 获取收藏列表
     */
    static async getFavorites() {
        try {
            const response = await fetch(APIService.getApiUrl('/config/favorites'));
            const result = await response.json();
            if (result.success) {
                return result.favorites || [];
            }
            return [];
        } catch (error) {
            logger.error(`获取收藏列表失败 | ${error.message}`);
            return [];
        }
    }

    /**
     * 添加收藏
     */
    static async addFavorite(tagValue, tagName = null, category = null) {
        try {
            const body = { tag_value: tagValue };
            if (tagName) {
                body.tag_name = tagName;
            }
            if (category) {
                body.category = category;
            }
            const response = await fetch(APIService.getApiUrl('/config/favorites/add'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            logger.error(`添加收藏失败 | ${error.message}`);
            return false;
        }
    }

    /**
     * 移除收藏
     */
    static async removeFavorite(tagValue, category = null) {
        try {
            const body = { tag_value: tagValue };
            if (category) {
                body.category = category;
            }
            const response = await fetch(APIService.getApiUrl('/config/favorites/remove'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            logger.error(`移除收藏失败 | ${error.message}`);
            return false;
        }
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

        // 清理脚本缓存
        this.#scriptCache.clear();

        // 清理标签数据
        this.#tagCache = null;
        this.#userTagCache = null;

        // 重置状态
        this.#initialized = false;
        this.#initializing = false;

        // 重新初始化资源
        await this.init();

        logger.log("资源管理器 | 资源已清理并重新初始化");
    }

    /**
     * 保存用户自定义标签数据
     */
    static async saveUserTags(data) {
        try {
            const response = await fetch(APIService.getApiUrl('/config/tags_user'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                logger.log("用户标签数据保存成功");
                this.#userTagCache = data; // 更新缓存
                return true;
            }
            logger.error(`保存用户标签数据失败 | ${result.error}`);
            return false;
        } catch (error) {
            logger.error(`保存用户标签数据失败 | ${error.message}`);
            return false;
        }
    }

    /**
     * 加载外部脚本
     */
    static async loadScript(url) {
        try {
            if (this.#scriptCache.has(url)) {
                return this.#scriptCache.get(url);
            }

            const promise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = url;
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
                document.head.appendChild(script);
            });

            this.#scriptCache.set(url, promise);
            await promise;
            logger.debug(`脚本加载成功 | URL:${url}`);
            return promise;
        } catch (error) {
            logger.error(`脚本加载失败 | URL:${url} | 错误:${error.message}`);
            throw error;
        }
    }

    /**
     * 获取 SortableJS 实例
     */
    static async getSortable() {
        try {
            if (window.Sortable) {
                return window.Sortable;
            }

            const sortableUrl = this.getLibUrl('Sortable.min.js');
            await this.loadScript(sortableUrl);

            if (!window.Sortable) {
                throw new Error('Sortable.js 加载后，window.Sortable 未定义');
            }

            logger.debug('Sortable.js 加载成功');
            return window.Sortable;
        } catch (error) {
            logger.error(`Sortable.js 获取失败 | 错误:${error.message}`);
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