/**
 * 节点挂载服务 (NodeMountService)
 * 统一管理小助手在不同渲染模式下的创建和挂载
 * 
 * 支持两种渲染模式：
 * - litegraph.js: 传统Canvas渲染 + DOM Widget覆盖层
 * - Vue node2.0: 纯Vue组件渲染
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { EventManager } from '../utils/eventManager.js';

// ---渲染模式枚举---
export const RENDER_MODE = {
    LITEGRAPH: 'litegraph',
    VUE_NODES: 'vue_nodes',
    UNKNOWN: 'unknown'
};

/**
 * 节点挂载服务类
 * 提供渲染模式检测、容器查找、挂载管理等功能
 */
class NodeMountService {
    constructor() {
        // 当前渲染模式
        this.currentMode = RENDER_MODE.UNKNOWN;
        // 模式切换回调列表
        this._modeChangeCallbacks = [];
        // 是否已初始化
        this._initialized = false;
        // 设置监听清理函数
        this._cleanupFunctions = [];
        // 模式检测缓存，避免频繁检测
        this._modeCache = null;
        this._modeCacheTime = 0;
        this._modeCacheTTL = 1000; // 缓存有效期1秒

        // 挂载观察者映射 { nodeId: observer }
        this._observers = new Map();
    }

    // ---初始化与生命周期---

    /**
     * 初始化服务并设置模式监听
     */
    initialize() {
        if (this._initialized) {
            logger.debug('[NodeMountService] 已初始化，跳过');
            return;
        }

        // 检测初始渲染模式
        this.currentMode = this.detectRenderMode();

        // 设置模式变更监听
        this._setupModeWatcher();

        this._initialized = true;
        logger.log(`[NodeMountService] 初始化完成 | 渲染模式: ${this.currentMode}`);
    }

    /**
     * 清理服务资源
     */
    cleanup() {
        // 清理所有观察者
        this._observers.forEach(observer => observer.disconnect());
        this._observers.clear();

        // 执行所有清理函数
        this._cleanupFunctions.forEach(fn => {
            try {
                if (typeof fn === 'function') fn();
            } catch (e) {
                logger.debug(`[NodeMountService] 清理函数执行失败: ${e.message}`);
            }
        });
        this._cleanupFunctions = [];
        this._modeChangeCallbacks = [];
        this._initialized = false;
        this._modeCache = null;
        logger.debug('[NodeMountService] 资源清理完成');
    }

    // ---节点类型检测工具---

    /**
     * 检查节点是否为使用comfy-markdown的节点
     * 包括 Note、MarkdownNote、PreviewTextNode 等
     * @param {object} node - 节点对象
     * @returns {boolean}
     */
    _isMarkdownNode(node) {
        if (!node || !node.type) return false;

        // 已知的使用comfy-markdown的节点类型
        const markdownNodeTypes = ['Note', 'MarkdownNote', 'PreviewAny', 'PreviewTextNode'];
        if (markdownNodeTypes.includes(node.type)) {
            return true;
        }

        // 检查节点类型名称是否包含相关关键词
        const typeLower = node.type.toLowerCase();
        return typeLower.includes('markdown') ||
            (typeLower.includes('preview') && typeLower.includes('text'));
    }

    // ---渲染模式检测---

    /**
     * 检测当前渲染模式
     * @param {boolean} forceRefresh - 是否强制刷新缓存
     * @returns {string} 渲染模式枚举值
     */
    detectRenderMode(forceRefresh = false) {
        // 检查缓存
        const now = Date.now();
        if (!forceRefresh && this._modeCache && (now - this._modeCacheTime) < this._modeCacheTTL) {
            return this._modeCache;
        }

        let mode = RENDER_MODE.LITEGRAPH;

        try {
            // 方法1: 检查 LiteGraph 全局标志（最可靠）
            if (typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true) {
                mode = RENDER_MODE.VUE_NODES;
            }
            // 方法2: 检查设置项
            else if (app.ui?.settings) {
                const vueNodesEnabled = app.ui.settings.getSettingValue('Comfy.VueNodes.Enabled');
                if (vueNodesEnabled === true) {
                    mode = RENDER_MODE.VUE_NODES;
                }
            }
            // 方法3: 检查DOM特征（备用方案）
            else {
                const vueNodeContainer = document.querySelector('[data-node-id]');
                const domWidget = document.querySelector('.dom-widget');
                if (vueNodeContainer && !domWidget) {
                    mode = RENDER_MODE.VUE_NODES;
                }
            }
        } catch (e) {
            logger.debug(`[NodeMountService] 模式检测异常: ${e.message}`);
            mode = RENDER_MODE.LITEGRAPH; // 默认回退到传统模式
        }

        // 更新缓存
        this._modeCache = mode;
        this._modeCacheTime = now;

        return mode;
    }

    /**
     * 检查是否为 Vue node2.0 模式
     * @returns {boolean}
     */
    isVueNodesMode() {
        return this.detectRenderMode() === RENDER_MODE.VUE_NODES;
    }

    /**
     * 检查是否为 litegraph.js 模式
     * @returns {boolean}
     */
    isLitegraphMode() {
        return this.detectRenderMode() === RENDER_MODE.LITEGRAPH;
    }

    // ---模式切换监听---

    /**
     * 注册模式切换回调
     * @param {Function} callback - 回调函数，接收 (newMode, oldMode) 参数
     */
    onModeChange(callback) {
        if (typeof callback === 'function') {
            this._modeChangeCallbacks.push(callback);
        }
    }

    /**
     * 移除模式切换回调
     * @param {Function} callback - 要移除的回调函数
     */
    offModeChange(callback) {
        const index = this._modeChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this._modeChangeCallbacks.splice(index, 1);
        }
    }

    /**
     * 触发模式切换事件
     * @param {string} newMode - 新模式
     * @param {string} oldMode - 旧模式
     */
    _triggerModeChange(newMode, oldMode) {
        logger.log(`[NodeMountService] 渲染模式切换 | ${oldMode} -> ${newMode}`);

        // 清除缓存
        this._modeCache = null;

        // 执行所有回调
        this._modeChangeCallbacks.forEach(callback => {
            try {
                callback(newMode, oldMode);
            } catch (e) {
                logger.error(`[NodeMountService] 模式切换回调执行失败: ${e.message}`);
            }
        });
    }

    /**
     * 设置模式变更监听器
     */
    _setupModeWatcher() {
        // 监听 LiteGraph.vueNodesMode 变化（通过定期检测）
        let lastMode = this.currentMode;

        const checkModeChange = () => {
            const currentMode = this.detectRenderMode(true);
            if (currentMode !== lastMode) {
                const oldMode = lastMode;
                lastMode = currentMode;
                this.currentMode = currentMode;
                this._triggerModeChange(currentMode, oldMode);
            }
        };

        // 设置定期检测（每500ms检测一次）
        const intervalId = setInterval(checkModeChange, 500);
        this._cleanupFunctions.push(() => clearInterval(intervalId));

        // 监听设置变更事件（如果可用）
        try {
            if (app.ui?.settings) {
                // 尝试监听设置变更
                const originalSettingValue = app.ui.settings.setSettingValue;
                if (originalSettingValue) {
                    app.ui.settings.setSettingValue = function (id, value) {
                        const result = originalSettingValue.apply(this, arguments);
                        if (id === 'Comfy.VueNodes.Enabled') {
                            // 延迟检测，等待设置生效
                            setTimeout(checkModeChange, 100);
                        }
                        return result;
                    };

                    this._cleanupFunctions.push(() => {
                        app.ui.settings.setSettingValue = originalSettingValue;
                    });
                }
            }
        } catch (e) {
            logger.debug(`[NodeMountService] 设置监听器设置失败: ${e.message}`);
        }
    }

    // ---容器查找---

    /**
     * 为节点的输入控件查找挂载容器
     * @param {object} node - LiteGraph节点对象
     * @param {object} widget - 输入控件对象
     * @returns {object|null} 容器信息对象或null
     */
    findMountContainer(node, widget) {
        if (!node || !widget) {
            logger.debug('[NodeMountService] findMountContainer: 参数无效');
            return null;
        }

        const mode = this.detectRenderMode();

        if (mode === RENDER_MODE.VUE_NODES) {
            return this._findVueNodeContainer(node, widget);
        } else {
            return this._findDomWidgetContainer(node, widget);
        }
    }

    /**
     * Vue node2.0 模式下查找容器
     * @param {object} node - LiteGraph节点对象
     * @param {object} widget - 输入控件对象
     * @returns {object|null} 容器信息
     */
    /**
     * 判断一个 widget 是否应该被渲染为 Textarea
     * @param {object} widget 
     */
    _isTextareaWidget(widget) {
        if (!widget) return false;
        // 1. 明确的 customtext 类型
        if (widget.type === 'customtext') return true;
        // 2. STRING 类型且 multiline: true
        if (widget.type === 'STRING' && widget.options?.multiline) return true;
        // 3. 已经绑定了 textarea 元素
        if (widget.element && widget.element.tagName === 'TEXTAREA') return true;

        return false;
    }

    /**
     * Vue node2.0 模式下查找容器
     * @param {object} node - LiteGraph节点对象
     * @param {object} widget - 输入控件对象
     * @returns {object|null} 容器信息
     */
    _findVueNodeContainer(node, widget) {
        try {
            // 查找带有 data-node-id 的 Vue 节点容器
            const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
            if (!nodeContainer) {
                logger.debug(`[NodeMountService] Vue模式: 未找到节点容器 | ID: ${node.id}`);
                return null;
            }

            // 获取widget名称用于查找对应的textarea
            const widgetName = widget.name || widget.id;
            let textarea = null;

            // --- 策略1: 优先使用 widget.inputEl (如果已绑定) ---
            if (widget.inputEl && widget.inputEl.tagName === 'TEXTAREA') {
                if (nodeContainer.contains(widget.inputEl)) {
                    textarea = widget.inputEl;
                    // logger.debug(`[NodeMountService] Vue模式: 直接使用 widget.inputEl | Widget: ${widgetName}`);
                }
            }

            // --- 策略2: 计算索引位置匹配 (最稳健的方法) ---
            // 适用于多个同类型输入框的情况 (如 VideoCaptionNode, CLIPTextEncodeSDXL 等)
            if (!textarea && node.widgets) {
                // 1. 计算当前 widget 在所有 Textarea 类 widget 中的索引
                let targetIndex = -1;
                let currentIndex = 0;

                for (const w of node.widgets) {
                    if (this._isTextareaWidget(w)) {
                        if (w === widget || w.name === widget.name) { // 兼容对象引用或名称匹配
                            targetIndex = currentIndex;
                            break;
                        }
                        currentIndex++;
                    }
                }

                if (targetIndex !== -1) {
                    // 2. 获取 DOM 中所有的 textarea
                    // 注意：querySelectorAll 返回的顺序通常遵循文档流顺序，这与 Vue 渲染顺序一致
                    const textareas = Array.from(nodeContainer.querySelectorAll('textarea'));

                    // 3. 按索引匹配
                    if (targetIndex < textareas.length) {
                        textarea = textareas[targetIndex];
                        logger.debug(`[NodeMountService] Vue模式: 索引匹配成功 [${targetIndex}] | Widget: ${widgetName}`);
                    } else {
                        logger.debug(`[NodeMountService] Vue模式: 索引匹配越界 [${targetIndex}/${textareas.length}] | Widget: ${widgetName}`);
                    }
                }
            }

            // --- 策略3: 标签/Placeholder 模糊匹配 (兼容旧逻辑作为补充) ---
            if (!textarea) {
                const textareas = nodeContainer.querySelectorAll('textarea');
                const searchName = widgetName.toLowerCase().replace(/_/g, ' '); // snake_case -> space separated

                for (const ta of textareas) {
                    //检查 placeholder
                    const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
                    // 检查 aria-label
                    const ariaLabel = (ta.getAttribute('aria-label') || '').toLowerCase();
                    // 检查父级 label
                    const label = ta.closest('label')?.textContent?.toLowerCase() || '';
                    // 检查前置 label (Vue 浮动标签结构)
                    const floatLabel = ta.parentElement?.querySelector('label')?.textContent?.toLowerCase() || '';

                    if (placeholder.includes(searchName) ||
                        ariaLabel.includes(searchName) ||
                        label.includes(searchName) ||
                        floatLabel.includes(searchName)) {
                        textarea = ta;
                        // logger.debug(`[NodeMountService] Vue模式: 模糊匹配成功 | Widget: ${widgetName}`);
                        break;
                    }
                }
            }

            // --- 策略4: 最后的兜底 (仅当只有一个 textarea 时才敢用) ---
            if (!textarea) {
                const textareas = nodeContainer.querySelectorAll('textarea');
                if (textareas.length === 1) {
                    textarea = textareas[0];
                    logger.debug(`[NodeMountService] Vue模式: 唯一匹配兜底 | Widget: ${widgetName}`);
                }
            }

            if (!textarea) {
                logger.debug(`[NodeMountService] Vue模式: 未找到textarea | 节点ID: ${node.id} | Widget: ${widgetName}`);
                // 对于使用comfy-markdown的节点（Note/MarkdownNote/PreviewTextNode等），返回nodeContainer作为容器但textarea为null
                if (this._isMarkdownNode(node)) {
                    return {
                        container: nodeContainer,
                        textarea: null, // 标记需要进一步查找
                        nodeContainer: nodeContainer,
                        mode: RENDER_MODE.VUE_NODES,
                        widgetName: widgetName,
                        isNoteNode: true
                    };
                }
                return null;
            }

            // 找到textarea的父容器作为挂载点
            // 优先找 floatlabel 容器，否则找父级
            const mountContainer = textarea.closest('.p-floatlabel, [class*="float"]') || textarea.parentElement;

            return {
                container: mountContainer,
                textarea: textarea,
                nodeContainer: nodeContainer,
                mode: RENDER_MODE.VUE_NODES,
                widgetName: widgetName
            };
        } catch (e) {
            logger.error(`[NodeMountService] Vue容器查找失败: ${e.message}`);
            return null;
        }
    }

    /**
     * litegraph.js 模式下查找容器
     * @param {object} node - LiteGraph节点对象
     * @param {object} widget - 输入控件对象
     * @returns {object|null} 容器信息
     */
    _findDomWidgetContainer(node, widget) {
        try {
            const inputEl = widget.inputEl || widget.element;
            if (!inputEl) {
                logger.debug('[NodeMountService] Litegraph模式: 输入元素不存在');
                return null;
            }

            // 向上查找 dom-widget 容器
            let parent = inputEl.parentElement;
            let domWidgetContainer = null;

            while (parent) {
                if (parent.classList?.contains('dom-widget')) {
                    domWidgetContainer = parent;
                    break;
                }
                parent = parent.parentElement;
            }

            if (!domWidgetContainer) {
                logger.debug(`[NodeMountService] Litegraph模式: 未找到dom-widget容器 | 节点ID: ${node.id}`);
                return null;
            }

            return {
                container: domWidgetContainer,
                textarea: inputEl,
                mode: RENDER_MODE.LITEGRAPH,
                widgetName: widget.name || widget.id
            };
        } catch (e) {
            logger.error(`[NodeMountService] dom-widget容器查找失败: ${e.message}`);
            return null;
        }
    }

    // ---图像节点容器查找---

    /**
     * 为图像节点查找挂载容器（用于ImageCaption）
     * @param {object} node - LiteGraph节点对象
     * @returns {object|null} 容器信息
     */
    findImageNodeContainer(node) {
        if (!node) return null;

        const mode = this.detectRenderMode();

        if (mode === RENDER_MODE.VUE_NODES) {
            return this._findVueImageNodeContainer(node);
        } else {
            // litegraph模式下，图像小助手使用fixed定位，不需要容器
            return {
                container: document.body,
                mode: RENDER_MODE.LITEGRAPH,
                useFixedPositioning: true
            };
        }
    }

    /**
     * Vue node2.0 模式下查找图像节点容器
     * @param {object} node - LiteGraph节点对象
     * @returns {object|null} 容器信息
     */
    _findVueImageNodeContainer(node) {
        try {
            const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
            if (!nodeContainer) {
                logger.debug(`[NodeMountService] Vue模式: 未找到图像节点容器 | ID: ${node.id}`);
                return null;
            }

            return {
                container: nodeContainer,
                mode: RENDER_MODE.VUE_NODES,
                useFixedPositioning: false
            };
        } catch (e) {
            logger.error(`[NodeMountService] Vue图像节点容器查找失败: ${e.message}`);
            return null;
        }
    }

    // ---挂载辅助方法---

    /**
     * 将小助手元素挂载到容器
     * @param {HTMLElement} assistantElement - 小助手DOM元素
     * @param {object} containerInfo - findMountContainer返回的容器信息
     * @param {object} options - 挂载选项
     * @returns {boolean} 是否挂载成功
     */
    mountAssistant(assistantElement, containerInfo, options = {}) {
        if (!assistantElement || !containerInfo?.container) {
            logger.debug('[NodeMountService] mountAssistant: 参数无效');
            return false;
        }

        try {
            const { container, mode } = containerInfo;
            const { position = 'bottom-right', offset = { x: 4, y: 4 } } = options;

            if (mode === RENDER_MODE.VUE_NODES) {
                // Vue node2.0 模式：使用相对定位
                assistantElement.style.position = 'absolute';
                assistantElement.style.zIndex = '10';

                if (position === 'bottom-right') {
                    assistantElement.style.right = `${offset.x}px`;
                    assistantElement.style.bottom = `${offset.y}px`;
                    assistantElement.style.left = 'auto';
                    assistantElement.style.top = 'auto';
                } else if (position === 'bottom-left') {
                    assistantElement.style.left = `${offset.x}px`;
                    assistantElement.style.bottom = `${offset.y}px`;
                    assistantElement.style.right = 'auto';
                    assistantElement.style.top = 'auto';
                }

                // 确保容器有相对定位
                const containerPosition = window.getComputedStyle(container).position;
                if (containerPosition === 'static') {
                    container.style.position = 'relative';
                }

                container.appendChild(assistantElement);

            } else {
                // litegraph.js 模式：使用绝对定位（在dom-widget内）
                assistantElement.style.position = 'absolute';
                assistantElement.style.right = `${offset.x}px`;
                assistantElement.style.bottom = `${offset.y}px`;
                assistantElement.style.height = '20px';
                assistantElement.style.minHeight = '20px';

                container.appendChild(assistantElement);
            }

            // 触发回流确保样式生效
            void assistantElement.offsetWidth;

            logger.debug(`[NodeMountService] 挂载成功 | 模式: ${mode}`);
            return true;

        } catch (e) {
            logger.error(`[NodeMountService] 挂载失败: ${e.message}`);
            return false;
        }
    }

    /**
     * 等待元素出现 (使用 MutationObserver)
     * 替代轮询，实现几乎零延迟的响应
     * @param {HTMLElement} parent - 要监听的父元素
     * @param {string} selector - 目标选择器 (或者检查函数)
     * @param {number} timeout - 超时时间 (ms)
     * @returns {Promise<HTMLElement|null>}
     */
    waitForElement(parent, selector, timeout = 2000) {
        return new Promise((resolve) => {
            // 1. 立即检查是否存在
            let element = null;
            if (typeof selector === 'function') {
                element = selector(parent);
            } else {
                element = parent.querySelector(selector);
            }

            if (element) {
                return resolve(element);
            }

            // 2. 设置观察者
            const observer = new MutationObserver((mutations) => {
                let found = null;
                if (typeof selector === 'function') {
                    found = selector(parent);
                } else {
                    found = parent.querySelector(selector);
                }

                if (found) {
                    observer.disconnect();
                    resolve(found);
                }
            });

            observer.observe(parent, {
                childList: true,
                subtree: true,
                attributes: true // 有时元素可能只是属性变化（如hidden移除）
            });

            // 3. 设置超时
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    /**
     * 带重试/等待的容器查找
     * 优化：使用 MutationObserver 替代单纯的轮询
     * @param {object} node - 节点对象
     * @param {object} widget - 控件对象
     * @param {object} options - 选项
     * @returns {Promise<object|null>} 容器信息
     */
    async findMountContainerWithRetry(node, widget, options = {}) {
        // 默认快速响应，但给予足够的总等待时间给Vue渲染
        const { timeout = 1000 } = options;

        // 尝试立即查找
        const immediateResult = this.findMountContainer(node, widget);
        if (immediateResult && immediateResult.textarea) {
            return immediateResult;
        }

        // 如果是 Note 节点且找到了容器但没找到 textarea，也视为一种中间状态
        if (immediateResult && immediateResult.isNoteNode) {
            // 继续往下，试图等到 textarea 出现
        }

        const mode = this.detectRenderMode();

        // 只有 Vue 模式下才需要使用 Observer 等待 DOM 渲染
        if (mode === RENDER_MODE.VUE_NODES) {
            // 查找 Vue 节点主容器
            const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);

            if (nodeContainer) {
                // 在节点容器内等待 textarea 出现
                // 使用 Observer 监听节点容器的变化
                logger.debugSample(() => `[NodeMountService] 开始监听DOM变化 | 节点: ${node.id}`);

                await this.waitForElement(nodeContainer, () => {
                    // 每次变化都尝试重新查找完整容器信息
                    const result = this.findMountContainer(node, widget);
                    return (result && result.textarea) ? result : null;
                }, timeout);

                // 再次尝试获取最终结果
                const finalResult = this.findMountContainer(node, widget);
                if (finalResult && finalResult.textarea) {
                    logger.debugSample(() => `[NodeMountService] DOM监听成功，找到容器 | 节点: ${node.id}`);
                    return finalResult;
                }
            }
        }

        // 降级策略/LiteGraph模式：简单的延迟重试（次数减少，避免长延迟）
        // 或者是 Vue 模式下一直没等到
        const retryCount = 2;
        for (let i = 0; i < retryCount; i++) {
            await new Promise(r => setTimeout(r, 200)); // 短间隔
            const res = this.findMountContainer(node, widget);
            if (res && res.textarea) return res;
        }

        logger.warn(() => `[NodeMountService] 容器查找最终失败 | 节点ID: ${node?.id}`);
        return null; // 或者返回仅包含 container 的结果（视情况而定）
    }
}

// 创建单例实例
export const nodeMountService = new NodeMountService();

// 导出类（用于类型检查或继承）
export { NodeMountService };
