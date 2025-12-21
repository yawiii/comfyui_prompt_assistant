/**
 * 提示词小助手核心类
 * 统一管理小助手的生命周期、实例创建、UI交互等功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { FEATURES } from "../services/features.js";
import { HistoryManager } from "./history.js";
import { TagManager } from "./tag.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG, CacheService } from "../services/cache.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { PromptFormatter } from "../utils/promptFormatter.js";
import { APIService } from "../services/api.js";

import { buttonMenu } from "../services/btnMenu.js";
import { rulesConfigManager } from "./rulesConfigManager.js";
import { nodeMountService, RENDER_MODE } from "../services/NodeMountService.js";
import { AssistantContainer, ANCHOR_POSITION } from "./AssistantContainer.js";
import { PopupManager } from "../utils/popupManager.js";
import { MarkdownNoteTranslate } from "../utils/markdownNoteTranslate.js";



// ====================== 工具函数 ======================

/**
 * 计算小助手UI的预设宽度
 * 根据当前启用的功能数量返回对应的固定宽度值
 * @returns {number} 宽度值（像素）
 */
function calculateAssistantWidth() {
    // 统计启用的功能
    const hasHistory = window.FEATURES.history;
    const hasTag = window.FEATURES.tag;
    const hasExpand = window.FEATURES.expand;
    const hasTranslate = window.FEATURES.translate;

    // 统计非历史功能的数量
    const otherFeaturesCount = [hasTag, hasExpand, hasTranslate].filter(Boolean).length;

    // 根据功能组合返回预设宽度
    if (hasHistory && otherFeaturesCount === 3) {
        // 所有功能全开
        return 179.04;
    } else if (hasHistory && otherFeaturesCount === 2) {
        // 历史 + 两个其他功能
        return 151.36;
    } else if (!hasHistory && otherFeaturesCount === 3) {
        // 只有三个其他功能
        return 87.21;
    } else if (hasHistory && otherFeaturesCount === 1) {
        // 历史 + 一个其他功能
        return 123.69;
    } else if (!hasHistory && otherFeaturesCount === 2) {
        // 只有两个其他功能
        return 59.54;
    } else if (hasHistory && otherFeaturesCount === 0) {
        // 只有历史功能
        return 87.21;
    } else if (!hasHistory && otherFeaturesCount === 1) {
        // 只有一个其他功能
        return 31.87;
    }

    // 默认值（理论上不应该到这里）
    return 31.87;
}



/**
 * 防抖函数
 * 限制函数调用频率，避免频繁触发导致性能问题
 */
function debounce(func, wait = 100) {
    return EventManager.debounce(func, wait);
}

/**
 * 获取输入元素的内容
 * 支持普通textarea、Tiptap编辑器、ProseMirror编辑器等
 * @param {object} widget - 小助手widget对象
 * @returns {string} 输入内容
 */
function getInputValue(widget, options = {}) {
    if (!widget || !widget.inputEl) {
        return '';
    }

    const inputEl = widget.inputEl;
    const returnHtml = options.html === true;

    // 标准textarea
    if (inputEl.tagName === 'TEXTAREA' && inputEl.value !== undefined) {
        return inputEl.value;
    }

    // Tiptap/ProseMirror/comfy-markdown编辑器
    if (inputEl.classList.contains('tiptap') ||
        inputEl.classList.contains('ProseMirror') ||
        inputEl.classList.contains('comfy-markdown')) {

        let targetEl = inputEl;
        // 对于comfy-markdown，查找内部编辑器元素
        if (inputEl.classList.contains('comfy-markdown')) {
            const editorEl = inputEl.querySelector('.tiptap, .ProseMirror');
            if (editorEl) {
                targetEl = editorEl;
            }
        }

        if (returnHtml) {
            return targetEl.innerHTML || '';
        }

        const textContent = targetEl.textContent || targetEl.innerText || '';
        if (textContent.trim()) {
            return textContent;
        }

        // 从widget.value获取
        if (widget.value !== undefined) {
            return widget.value;
        }

        // 从node.widgets找到对应的widget.value
        if (widget.node && widget.node.widgets) {
            const matchingWidget = widget.node.widgets.find(w =>
                w.name === widget.inputId || w.name === 'text'
            );
            if (matchingWidget && matchingWidget.value !== undefined) {
                return matchingWidget.value;
            }
        }
    }

    // contenteditable元素
    if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
        if (returnHtml) {
            return inputEl.innerHTML || '';
        }
        return inputEl.textContent || inputEl.innerText || '';
    }

    // widget.value
    if (widget.value !== undefined && typeof widget.value === 'string') {
        return widget.value;
    }

    // inputWidget.value
    if (widget.inputWidget && widget.inputWidget.value !== undefined) {
        return widget.inputWidget.value;
    }

    return '';
}

/**
 * 设置输入元素的内容
 * 支持普通textarea、Tiptap编辑器、ProseMirror编辑器等
 * @param {object} widget - 小助手widget对象
 * @param {string} content - 要设置的内容
 * @returns {boolean} 是否设置成功
 */
function setInputValue(widget, content, options = {}) {
    if (!widget || !widget.inputEl) {
        return false;
    }

    const inputEl = widget.inputEl;
    const useHtml = options.html === true;

    try {
        // 标准textarea
        if (inputEl.tagName === 'TEXTAREA' && inputEl.value !== undefined) {
            inputEl.value = content;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        // comfy-markdown或Tiptap/ProseMirror编辑器
        if (inputEl.classList.contains('comfy-markdown') ||
            inputEl.classList.contains('tiptap') ||
            inputEl.classList.contains('ProseMirror')) {

            // 对于comfy-markdown，找到内部编辑器
            let targetEl = inputEl;
            if (inputEl.classList.contains('comfy-markdown')) {
                const editorEl = inputEl.querySelector('.tiptap, .ProseMirror');
                if (editorEl) {
                    targetEl = editorEl;
                }
            }

            // 设置textContent/innerHTML
            if (targetEl.isContentEditable || targetEl.getAttribute('contenteditable') === 'true') {
                if (useHtml) {
                    targetEl.innerHTML = content;
                } else {
                    targetEl.textContent = content;
                }
            } else {
                targetEl.innerHTML = content;
            }

            // 触发输入事件
            targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            targetEl.dispatchEvent(new Event('change', { bubbles: true }));

            // 同时更新widget.value
            if (widget.value !== undefined) {
                widget.value = content;
            }

            // 同时更新node.widgets[].value
            if (widget.node && widget.node.widgets) {
                const matchingWidget = widget.node.widgets.find(w =>
                    w.name === widget.inputId || w.name === 'text'
                );
                if (matchingWidget) {
                    matchingWidget.value = content;
                }
            }

            return true;
        }

        // contenteditable元素
        if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
            if (useHtml) {
                inputEl.innerHTML = content;
            } else {
                inputEl.textContent = content;
            }
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        // widget.value
        if (widget.value !== undefined) {
            widget.value = content;
            return true;
        }

        return false;
    } catch (error) {
        logger.error(`[setInputValue] 设置失败 | 错误: ${error.message}`);
        return false;
    }
}

// ====================== 主类实现 ======================

/**
 * 提示词小助手主类
 * 统一管理小助手的生命周期、实例和资源
 */
class PromptAssistant {
    /** 存储所有小助手实例的Map集合 */
    static instances = new Map();

    constructor() {
        this.initialized = false;
    }

    // ---生命周期管理功能---
    /**
     * 判断功能是否被禁用
     */
    areAllFeaturesDisabled() {
        return !window.FEATURES.enabled;
    }

    /**
     * 初始化提示词小助手
     */
    initialize() {
        if (this.initialized) return;

        try {
            // 检查版本号
            if (!window.PromptAssistant_Version) {
                logger.error("初始化时未找到版本号！这可能导致UI显示异常");
            } else {
                logger.debug(`初始化时检测到版本号: ${window.PromptAssistant_Version}`);
            }

            // 初始化事件管理器
            EventManager.init();

            // 从配置加载所有功能开关状态
            FEATURES.loadSettings();
            // 同步到 window.FEATURES 以兼容旧代码
            window.FEATURES.enabled = FEATURES.enabled;

            // 记录总开关状态（改为调试级别）
            logger.debug(`初始化时检测总开关状态 | 状态:${FEATURES.enabled ? "启用" : "禁用"}`);

            // 初始化资源管理器
            ResourceManager.init();

            // 只有在总开关打开时才做完整初始化
            if (window.FEATURES.enabled) {

            }

            this.initialized = true;
            logger.log("初始化完成 | 小助手已完全启动");
        } catch (error) {
            logger.error(`初始化失败 | 错误: ${error.message}`);
            // 重置状态
            this.initialized = false;
            window.FEATURES.enabled = false;
            // 确保清理
            this.cleanup();
        }
    }

    /**
     * 统一控制总开关功能
     * 集中管理所有受总开关控制的服务功能
     */
    async toggleGlobalFeature(enable, force = false) {
        // 更新状态
        const oldValue = window.FEATURES.enabled;
        window.FEATURES.enabled = enable;

        // 状态未变化时不执行操作，除非force为true
        if (!force && oldValue === enable) {
            return;
        }

        // 仅当状态真正变化或强制执行时才记录日志
        if (oldValue !== enable || force === true) {
            logger.log(`总开关 | 动作:${enable ? "启用" : "禁用"}`);
        }

        try {
            if (enable) {
                // === 启用所有服务 ===
                // 确保管理器已初始化
                if (!EventManager.initialized) {
                    EventManager.init();
                }

                if (!ResourceManager.isInitialized()) {
                    ResourceManager.init();
                }

                // 1. 重置节点初始化标记，准备重新检测
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._promptAssistantInitialized = false;
                        }
                    });
                }

                // 2. 设置或恢复节点选择事件监听
                if (app.canvas) {
                    // 避免重复设置监听器
                    if (!app.canvas._promptAssistantSelectionHandler) {
                        app.canvas._promptAssistantSelectionHandler = function (selected_nodes) {
                            // 当总开关关闭时，跳过所有节点处理
                            if (!window.FEATURES.enabled) {
                                return;
                            }

                            if (selected_nodes && Object.keys(selected_nodes).length > 0) {
                                Object.keys(selected_nodes).forEach(nodeId => {
                                    const node = app.canvas.graph.getNodeById(nodeId);
                                    if (!node) return;

                                    // 初始化未初始化的节点
                                    if (!node._promptAssistantInitialized) {
                                        node._promptAssistantInitialized = true;
                                        this.checkAndSetupNode(node);
                                    }
                                });
                            }
                        }.bind(this);
                    }

                    // 保存当前监听器并设置新的
                    if (app.canvas.onSelectionChange && app.canvas.onSelectionChange !== app.canvas._promptAssistantSelectionHandler) {
                        app.canvas._originalSelectionChange = app.canvas.onSelectionChange;
                    }

                    app.canvas.onSelectionChange = app.canvas._promptAssistantSelectionHandler;
                }
            } else {
                // === 禁用所有服务 ===

                // 1. 计数并清理所有实例
                const instanceCount = PromptAssistant.instances.size;
                this.cleanup(null, true);

                // 2. 恢复原始节点选择事件监听
                if (app.canvas) {
                    if (app.canvas._originalSelectionChange) {
                        app.canvas.onSelectionChange = app.canvas._originalSelectionChange;
                    } else {
                        app.canvas.onSelectionChange = null;
                    }
                }
            }

            // 按钮可见性更新在features中单独处理
            window.FEATURES.updateButtonsVisibility();


        } catch (error) {
            logger.error(`总开关操作失败 | 错误: ${error.message}`);
            // 恢复原始状态
            window.FEATURES.enabled = oldValue;
        }
    }

    // ---资源管理功能---
    /**
     * 清理所有资源
     */
    cleanup(nodeId = null, silent = false) {
        // 【调试】添加调用栈追踪，帮助定位触发清理的原因
        // 在非切换工作流和非静默模式下，打印详细的调用栈
        if (!window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING && !silent) {
            if (nodeId !== null && nodeId !== undefined) {
                console.trace(`[PromptAssistant-调试] cleanup 被调用 | 节点ID: ${nodeId}`);
                logger.debug(`[cleanup] 调用栈追踪 | 节点ID: ${nodeId} | 请查看控制台 trace 信息`);
            }
        }

        // 如果正在切换工作流，则只清理UI实例，不删除缓存
        if (window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING) {
            // 简化日志：工作流切换期间不逐条打印节点清理日志，避免高频刷屏
            // 如需排查问题，可将下行改回 debug 单条输出
            // if (nodeId !== null) { logger.debug(`[清理跳过] 正在切换工作流，仅清理提示词小助手UI，节点ID: ${nodeId}`); }

            const keysToDelete = Array.from(PromptAssistant.instances.keys())
                .filter(key => nodeId === null || key.startsWith(`${String(nodeId)}_`));

            keysToDelete.forEach(key => {
                const instance = PromptAssistant.getInstance(key);
                if (instance) {
                    this._cleanupInstance(instance, key, false); // false表示从实例集合中移除
                }
            });

            // 如果是全局清理，清空实例集合
            if (nodeId === null) {
                PromptAssistant.instances.clear();
            }
            return;
        }

        // 检查nodeId是否有效
        if (nodeId !== null && nodeId !== undefined) {
            // 确保nodeId是字符串类型，便于后续比较
            const nodeIdStr = String(nodeId);

            // 获取当前节点的所有实例键
            const keysToDelete = Array.from(PromptAssistant.instances.keys())
                .filter(key => key === nodeIdStr || key.startsWith(`${nodeIdStr}_`));

            // 如果有实例需要清理
            if (keysToDelete.length > 0) {
                let historyCount = 0;
                let tagCount = 0;
                let instanceNames = [];

                try {
                    // 统计并清理历史记录
                    const allHistory = HistoryCacheService.getAllHistory();
                    historyCount = allHistory.filter(item => item.node_id === nodeId).length;
                    HistoryCacheService.clearNodeHistory(nodeId);

                    // 统计并清理标签缓存
                    keysToDelete.forEach(key => {
                        const instance = PromptAssistant.getInstance(key);
                        if (instance && instance.inputId) {
                            const tags = TagCacheService.getAllRawTags(nodeId, instance.inputId);
                            tagCount += tags ? tags.length : 0;
                            TagCacheService.clearCache(nodeId, instance.inputId);
                            instanceNames.push(instance.inputId);
                        }
                    });

                    // 清理实例
                    keysToDelete.forEach(key => {
                        const instance = PromptAssistant.getInstance(key);
                        if (instance) {
                            this._cleanupInstance(instance, key, true);
                            PromptAssistant.instances.delete(key);
                        }
                    });

                    if (!silent) {
                        // 获取当前剩余的统计信息
                        const remainingInstances = PromptAssistant.instances.size;
                        // 获取标签缓存统计
                        const tagStats = TagCacheService.getTagStats();
                        const remainingTags = tagStats.total;
                        const remainingHistory = HistoryCacheService.getAllHistory().length;

                        logger.log(`[节点清理] 节点ID: ${nodeId} | 实例: ${instanceNames.join(', ')} | 历史: ${historyCount}条 | 标签: ${tagCount}个`);
                        logger.log(`[剩余统计] 小助手实例: ${remainingInstances}个 | 标签缓存: ${remainingTags}个 | 节点历史缓存: ${remainingHistory}条`);
                    }
                } catch (error) {
                    logger.error(`[节点清理] 失败 | 节点ID: ${nodeId} | 错误: ${error.message}`);
                }
            }
            return;
        }

        // 清理所有实例和历史
        const beforeCleanupSize = PromptAssistant.instances.size;
        if (beforeCleanupSize > 0) {
            let totalHistoryCount = 0;
            let totalTagCount = 0;
            let allInstanceNames = [];

            try {
                // 统计并清理所有历史记录
                const allHistory = HistoryCacheService.getAllHistory();
                totalHistoryCount = allHistory.length;
                HistoryCacheService.clearAllHistory();

                // 统计标签缓存
                const tagStats = TagCacheService.getTagStats();
                totalTagCount = tagStats.total;

                // 清理所有标签缓存
                TagCacheService.clearAllTagCache();

                // 清理所有实例
                for (const [key, instance] of PromptAssistant.instances) {
                    if (instance) {
                        allInstanceNames.push(instance.inputId || key);
                        this._cleanupInstance(instance, key, true);
                    }
                }

                // 清空实例集合
                PromptAssistant.instances.clear();

                if (!silent) {
                    logger.log(`[全局清理] 实例: ${allInstanceNames.join(', ')} | 历史: ${totalHistoryCount}条 | 标签: ${totalTagCount}个`);
                    logger.log(`[剩余统计] 小助手实例: 0个 | 标签缓存: 0个 | 节点历史缓存: 0条`);
                }
            } catch (error) {
                logger.error(`[全局清理] 失败 | 错误: ${error.message}`);
            }
        }
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

    // ---实例管理功能---
    /**
     * 检查节点是否有效
     * Vue mode下Note/MarkdownNote节点可能没有widgets属性，需要特殊处理
     */
    static isValidNode(node) {
        if (!node || typeof node.id === 'undefined' || node.id === -1) {
            return false;
        }

        if (typeof node.type !== 'string') {
            return false;
        }

        // Vue mode下的特殊节点类型（可能没有标准widgets属性）
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
        const vueSpecialNodeTypes = ['Note', 'MarkdownNote', 'PreviewAny', 'PreviewTextNode'];

        // 检查是否为markdown类型节点
        const isMarkdownNode = vueSpecialNodeTypes.includes(node.type) ||
            (node.type && node.type.toLowerCase().includes('markdown')) ||
            (node.type && node.type.toLowerCase().includes('preview') && node.type.toLowerCase().includes('text'));

        if (isVueMode && isMarkdownNode) {
            // Vue mode下这些节点类型直接视为有效
            return true;
        }

        // 标准检查：需要有widgets属性
        return !!node.widgets;
    }

    /**
     * 添加实例到管理器
     */
    static addInstance(nodeId, widget) {
        if (nodeId != null && widget != null) {
            this.instances.set(String(nodeId), widget);
            return true;
        }
        return false;
    }

    /**
     * 获取实例
     */
    static getInstance(nodeId) {
        if (nodeId == null) return null;
        return this.instances.get(String(nodeId));
    }

    /**
     * 检查实例是否存在
     */
    static hasInstance(nodeId) {
        if (nodeId == null) return false;
        return this.instances.has(String(nodeId));
    }

    /**
     * 检查节点并设置小助手
     * 查找节点中的有效输入控件并创建小助手
     */
    checkAndSetupNode(node) {
        // 快速检查
        if (!window.FEATURES.enabled || !node) return;

        const isVueMode = LiteGraph.vueNodesMode === true;

        // Vue mode下Note/MarkdownNote节点特殊处理
        if (!node.widgets) {
            if (isVueMode && (node.type === 'Note' || node.type === 'MarkdownNote')) {
                this._handleVueSpecialNode(node);
            }
            return;
        }

        // 获取所有有效的输入控件
        const validInputs = node.widgets.filter(widget => {
            if (!widget.node) widget.node = node;
            return UIToolkit.isValidInput(widget, { debug: false, node: node });
        });

        if (validInputs.length === 0) {
            // Vue mode下使用comfy-markdown节点回退处理
            if (isVueMode && this._isMarkdownNode(node)) {
                this._handleVueSpecialNode(node);
            }
            return;
        }

        // 为每个有效控件创建小助手
        validInputs.forEach((inputWidget, widgetIndex) => {
            const inputId = inputWidget.name || inputWidget.id;

            // 生成唯一的 assistantKey
            // 对于同名的多个输入框（如 Show Any 节点的列表输入），使用索引区分
            let assistantKey = `${node.id}_${inputId}`;

            // 检查是否存在同名的输入框，如果存在则使用索引或 DOM 元素的唯一标识
            const sameNameWidgets = validInputs.filter(w => (w.name || w.id) === inputId);
            if (sameNameWidgets.length > 1) {
                // 多个同名输入框，使用索引或输入框元素的内存地址作为唯一标识
                const inputEl = inputWidget.inputEl || inputWidget.element;
                if (inputEl) {
                    // 为输入框元素添加唯一标识
                    if (!inputEl.dataset.promptAssistantUniqueId) {
                        inputEl.dataset.promptAssistantUniqueId = `${node.id}_${inputId}_${widgetIndex}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    }
                    assistantKey = inputEl.dataset.promptAssistantUniqueId;
                } else {
                    // 降级方案：使用索引
                    assistantKey = `${node.id}_${inputId}_${widgetIndex}`;
                }
            }

            // 检查实例是否已存在
            if (PromptAssistant.hasInstance(assistantKey)) {
                // 如果实例存在，检查输入控件是否已更新
                const instance = PromptAssistant.getInstance(assistantKey);
                const currentInputEl = inputWidget.inputEl;
                const instanceInputEl = instance?.text_element;

                // 只有在以下情况下才清理并重建：
                // 1. 两个元素都存在
                // 2. 它们是不同的元素
                // 3. 不是因为临时的 DOM 状态变化（如打开弹窗）
                if (instanceInputEl && currentInputEl && instanceInputEl !== currentInputEl) {
                    // 进一步检查：确保确实需要重建（避免误判）
                    // 如果当前元素已经从 DOM 中移除，才需要清理
                    if (!document.body.contains(instanceInputEl)) {
                        logger.debug(() => `[checkAndSetupNode] 输入元素已失效，清理实例 | 节点ID: ${node.id}`);
                        this.cleanup(node.id);
                    } else {
                        // 元素仍然在 DOM 中，可能只是引用变化，不需要清理
                        logger.debug(() => `[checkAndSetupNode] 输入元素引用变化但仍有效，跳过清理 | 节点ID: ${node.id}`);
                        return;
                    }
                } else if (!currentInputEl && instanceInputEl) {
                    // Vue 模式下，inputEl 可能暂时为 null，不应该触发清理
                    logger.debug(() => `[checkAndSetupNode] 当前inputEl为null，跳过清理（Vue模式下可能暂时为null） | 节点ID: ${node.id}`);
                    return;
                } else {
                    // 实例存在且未更新，跳过
                    return;
                }
            }

            // 再次检查总开关状态，确保在创建过程中没有被禁用
            if (!window.FEATURES.enabled) {
                return;
            }

            // 【防重复挂载检查】在创建前检查 inputEl 是否已被其他实例挂载
            const inputEl = inputWidget.inputEl || inputWidget.element;
            if (inputEl && inputEl._promptAssistantMounted) {
                logger.debug(() => `[checkAndSetupNode] 跳过创建 | 原因: inputEl 已被挂载 | 节点ID: ${node.id} | 控件: ${inputId}`);
                return;
            }

            // 创建小助手实例
            const assistant = this.setupNodeAssistant(node, inputWidget, assistantKey);
            if (assistant) {
                logger.log(() => `创建小助手 | 节点:${node.id} | 控件:${inputId} | 索引:${widgetIndex} | 实例:${assistantKey}`);


            }
        });
    }

    /**
     * Vue mode下使用comfy-markdown节点的特殊处理
     * 包括 Note、MarkdownNote、PreviewTextNode 等
     * 直接从DOM中查找textarea/编辑器并创建小助手
     */
    _handleVueSpecialNode(node) {
        if (!node || !this._isMarkdownNode(node)) return;

        const nodeId = node.id;
        const assistantKey = `${nodeId}_text`;

        // 检查是否已存在实例
        if (PromptAssistant.hasInstance(assistantKey)) return;

        // 查找节点DOM容器和textarea
        const nodeContainer = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (!nodeContainer) return;

        const textarea = nodeContainer.querySelector('textarea.p-textarea') ||
            nodeContainer.querySelector('textarea') ||
            nodeContainer.querySelector('.tiptap') ||
            nodeContainer.querySelector('.ProseMirror');
        if (!textarea) return;

        // 创建虚拟widget对象
        const virtualWidget = {
            name: 'text', id: 'text', type: 'textarea',
            inputEl: textarea, element: textarea, node: node
        };

        // 节点信息
        const nodeInfo = {
            workflow_id: app.graph?._workflow_id || 'unknown',
            nodeType: node.type, inputType: 'text',
            isNoteNode: this._isMarkdownNode(node),
            isVueMode: true
        };

        // 创建小助手实例
        const assistant = this.createAssistant(node, 'text', virtualWidget, nodeInfo, assistantKey);
        if (assistant) {
            this.showAssistantUI(assistant);
            logger.log(`${node.type}节点小助手创建成功 | ID: ${nodeId}`);
        }
    }

    /**
     * 为节点设置小助手
     * 创建小助手实例并初始化显示状态
     */
    setupNodeAssistant(node, inputWidget, assistantKey = null) {
        // 简化参数检查
        if (!node || !inputWidget) {
            return null;
        }

        try {
            const nodeId = node.id;
            const inputId = inputWidget.name || inputWidget.id || Math.random().toString(36).substring(2, 10);
            const isNoteNode = this._isMarkdownNode(node);
            const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;

            // 简化节点信息
            const nodeInfo = {
                workflow_id: app.graph?._workflow_id || 'unknown',
                nodeType: node.type,
                inputType: inputId,
                isNoteNode: isNoteNode,
                isVueMode: isVueMode
            };

            // 处理inputWidget的inputEl引用
            // Vue mode下Note/MarkdownNote节点的element可能为null，需要延迟获取
            let processedWidget = inputWidget;
            if (isNoteNode) {
                // Note/MarkdownNote节点特殊处理：尝试使用element作为inputEl
                const inputEl = inputWidget.element || inputWidget.inputEl;
                processedWidget = {
                    ...inputWidget,
                    inputEl: inputEl,
                    // Vue mode下标记需要延迟查找textarea
                    _needsDelayedTextareaLookup: isVueMode && !inputEl
                };
            }

            // 创建小助手实例
            const assistant = this.createAssistant(
                node,
                inputId,
                processedWidget,
                nodeInfo,
                assistantKey
            );

            if (assistant) {
                // 初始化显示状态，始终显示
                this.showAssistantUI(assistant);
                return assistant;
            }

            return null;
        } catch (error) {
            logger.error(`创建小助手失败 | 节点ID: ${node.id} | 原因: ${error.message}`);
            return null;
        }
    }

    /**
     * 创建小助手实例
     * 根据节点和输入控件构建小助手对象并初始化UI
     */
    createAssistant(node, inputId, inputWidget, nodeInfo = {}, assistantKey = null) {
        logger.debug(() => `[createAssistant] 开始创建 | 节点ID: ${node?.id} | inputId: ${inputId} | isVueMode: ${typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true}`);

        // 简化前置检查 - Vue mode下允许inputEl暂时不存在
        if (!window.FEATURES.enabled || !node || !inputId || !inputWidget) {
            logger.debug(() => `[createAssistant] 前置检查失败 | enabled: ${window.FEATURES.enabled} | node: ${!!node} | inputId: ${inputId} | inputWidget: ${!!inputWidget}`);
            return null;
        }

        // 确保widget设置了node引用
        if (!inputWidget.node) {
            inputWidget.node = node;
        }

        // 验证是否为有效输入
        if (!UIToolkit.isValidInput(inputWidget, { node: node })) {
            logger.debug(() => `[createAssistant] 无效输入 | 节点ID: ${node?.id} | 控件: ${inputId}`);
            return null;
        }

        // 获取输入元素 - Vue mode下可能暂时不存在，将在_setupUIPosition中查找
        let inputEl = inputWidget.inputEl || inputWidget.element;

        // 判断是否为Vue mode
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;

        // 非Vue mode下，inputEl必须存在
        if (!inputEl && !isVueMode) {
            logger.debug(() => `[createAssistant] 输入元素不存在 | 节点ID: ${node?.id} | 控件: ${inputId}`);
            return null;
        }

        const nodeId = node.id;
        // 使用传入的 assistantKey，如果没有则使用默认生成方式
        const widgetKey = assistantKey || `${nodeId}_${inputId}`;

        // 检查是否已存在实例
        if (PromptAssistant.hasInstance(widgetKey)) {
            return PromptAssistant.getInstance(widgetKey);
        }

        // 创建小助手对象
        const widget = {
            type: "prompt_assistant",
            name: inputId,
            nodeId,
            inputId,
            widgetKey,
            buttons: {},
            text_element: inputEl, // Vue mode下可能为null，将在定位时更新
            inputEl: inputEl,      // Vue mode下可能为null，将在定位时更新
            node: node,            // 保存node引用，用于getInputValue等函数访问
            nodeInfo: {
                ...nodeInfo,
                nodeId: node.id,
                nodeType: node.type,
                isVueMode: isVueMode // 标记是否为Vue mode
            },
            isTransitioning: false // 添加状态标记，避免频繁切换
        };

        // 创建全局输入框映射（如果不存在）
        if (!window.PromptAssistantInputWidgetMap) {
            window.PromptAssistantInputWidgetMap = {};
        }

        // 将当前输入框添加到映射 - Vue mode下inputEl可能为null，将在定位时更新
        window.PromptAssistantInputWidgetMap[widgetKey] = {
            inputEl: inputEl,
            widget: widget
        };

        logger.debug(`输入框映射 | 添加映射 | 键:${widgetKey} | inputEl: ${inputEl ? 'exists' : 'null (Vue mode)'}`);

        // 创建UI并添加到实例集合
        this.createAssistantUI(widget, inputWidget);
        PromptAssistant.addInstance(widgetKey, widget);

        // 初始化撤销状态和事件绑定 - 仅在inputEl存在时执行
        // Vue mode下将在_setupUIPosition找到实际textarea后再执行
        logger.debug(() => `[createAssistant] inputEl检查 | 节点ID: ${nodeId} | inputEl存在: ${!!inputEl} | isVueMode: ${isVueMode}`);
        if (inputEl) {
            logger.debug(() => `[createAssistant] 调用_initializeInputElBindings | 节点ID: ${nodeId}`);
            this._initializeInputElBindings(widget, inputWidget, node, inputId, nodeInfo);
        } else {
            logger.debug(() => `[createAssistant] Vue mode - 延迟初始化inputEl绑定 | 节点ID: ${nodeId}`);
        }

        return widget;
    }

    /**
     * 初始化inputEl相关的事件绑定
     * 在传统模式下立即调用，Vue mode下在找到textarea后调用
     */
    _initializeInputElBindings(widget, inputWidget, node, inputId, nodeInfo) {
        const inputEl = inputWidget.inputEl || widget.inputEl;
        if (!inputEl) {
            logger.warn(`[_initializeInputElBindings] inputEl不存在 | 节点ID: ${node?.id}`);
            return;
        }

        const nodeId = node.id;

        // 初始化撤销状态（只初始化一次，使用widget级别的标记）
        if (!widget._undoStateInitialized) {
            const initialValue = inputEl.value || '';
            HistoryCacheService.initUndoState(nodeId, inputId, initialValue);
            widget._undoStateInitialized = true;
            logger.debug(`[初始化] 撤销状态初始化 | 节点ID: ${nodeId}`);
        }
        // 初始化时立即更新撤销/重做按钮状态
        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

        // 检查是否已绑定事件（避免重复绑定）
        // 【关键修复】使用 widget 级别的标记来精确控制绑定状态
        // 确保不会因为 _eventCleanupFunctions 中包含其他清理函数（如按钮菜单）而误判
        if (widget._inputEventsBound) {
            logger.debug(`[_initializeInputElBindings] 跳过绑定 | 节点ID: ${nodeId} | 原因: 已绑定`);
            return;
        }

        // 如果检测到遗留标记，记录一下（仅用于调试）
        if (inputEl._promptAssistantBound) {
            logger.debug(`[_initializeInputElBindings] 检测到DOM遗留标记，重新绑定 | 节点ID: ${nodeId}`);
        }

        inputEl._promptAssistantBound = true;
        widget._inputEventsBound = true;
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // 绑定输入框失焦事件，写入历史
        // 使用事件管理器添加DOM事件监听
        const removeBlurListener = EventManager.addDOMListener(inputEl, 'blur', async () => {
            logger.debug(`历史写入准备｜ 原因：失焦事件触发 node_id=${node.id} input_id=${inputId}`);
            HistoryCacheService.addHistory({
                workflow_id: nodeInfo?.workflow_id || '',
                node_id: node.id,
                input_id: inputId,
                content: inputEl.value,
                operation_type: 'input',
                timestamp: Date.now()
            });
            // 重置撤销状态
            HistoryCacheService.initUndoState(node.id, inputId, inputEl.value);
            // 更新按钮状态
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            logger.debug(`历史写入完成｜原因：输入框失焦 node_id=${node.id} input_id=${inputId}`);
        });

        // 保存清理函数引用，以便后续清理
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
        widget._eventCleanupFunctions.push(removeBlurListener);

        // 添加输入事件监听，实时更新撤销/重做按钮状态和位置调整
        const removeInputListener = EventManager.addDOMListener(inputEl, 'input', () => {
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            // 检测滚动条状态并调整位置
            this._adjustPositionForScrollbar(widget, inputEl);
        });
        widget._eventCleanupFunctions.push(removeInputListener);

        // 添加ResizeObserver监听输入框尺寸变化
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                // 延迟执行，确保浏览器完成布局更新
                setTimeout(() => {
                    this._adjustPositionForScrollbar(widget, inputEl);
                }, 10);
            });

            resizeObserver.observe(inputEl);

            // 添加清理函数
            widget._eventCleanupFunctions.push(() => {
                resizeObserver.disconnect();
            });
        } else {
            // 降级方案：监听window resize事件
            const removeResizeListener = EventManager.addDOMListener(window, 'resize',
                EventManager.debounce(() => {
                    this._adjustPositionForScrollbar(widget, inputEl);
                }, 100)
            );
            widget._eventCleanupFunctions.push(removeResizeListener);
        }
    }

    // ---UI管理功能---
    /**
     * 创建小助手UI
     * 构建DOM元素并设置事件监听和初始样式
     */
    createAssistantUI(widget, inputWidget) {
        const nodeId = widget.nodeId;
        const inputId = widget.inputId;

        try {
            // Get location setting
            const locationSetting = app.ui.settings.getSettingValue(
                "PromptAssistant.Location",
                "bottom-right-h"
            );

            // Create AssistantContainer instance
            const container = new AssistantContainer({
                nodeId: nodeId,
                type: 'prompt',
                anchorPosition: locationSetting,
                enableDragSort: true,
                onButtonOrderChange: (order) => {
                    // Order is saved handled by AssistantContainer
                    // We might want to log or update internal state if needed
                    logger.debug(`[排序更新] 节点:${nodeId} | 新顺序: ${order.join(',')}`);
                },
                shouldCollapse: () => {
                    // Check if we should block collapse (e.g. active buttons)
                    return !this._checkAssistantActiveState(widget);
                }
            });

            // Render container
            const containerEl = container.render();

            // Set Icon
            // Existing logic uses ResourceManager
            const mainIcon = ResourceManager.getIcon('icon-main.svg');
            if (mainIcon) {
                // Remove existing content if any (though render creates empty)
                if (container.indicator) {
                    container.indicator.innerHTML = '';
                    container.indicator.appendChild(mainIcon);
                }
            }

            // Save references
            widget.container = container;
            widget.element = containerEl;
            widget.innerContent = container.content; // Map innerContent to container content
            widget.hoverArea = container.hoverArea;
            widget.indicator = container.indicator;
            widget.buttons = {};
            // widget.isCollapsed is managed by container, but PromptAssistant might read it
            // Sync state
            Object.defineProperty(widget, 'isCollapsed', {
                get: () => container.isCollapsed,
                set: (val) => {
                    // Manual override? Better to use container methods
                    if (val) container.collapse(); else container.expand();
                }
            });
            // widget.isTransitioning also managed by container
            Object.defineProperty(widget, 'isTransitioning', {
                get: () => container.isTransitioning,
                set: (val) => { container.isTransitioning = val; }
            });

            // Initialize buttons
            this.addFunctionButtons(widget);

            // Note: _setupUIEventHandling is no longer needed as container handles it

            // Restore button order
            container.restoreOrder();

            // Setup Positioning
            const inputEl = inputWidget.inputEl || widget.inputEl;
            const graphCanvasContainer = document.querySelector('.graphcanvas');
            const canvasContainerRect = graphCanvasContainer?.getBoundingClientRect();

            this._setupUIPosition(widget, inputEl, containerEl, canvasContainerRect, (success) => {
                if (!success) {
                    logger.debug(`创建小助手失败 | 节点ID: ${nodeId} | 原因: 定位失败 (等待DOM渲染)`);
                    container.destroy();
                    // Clean up instance map
                    const widgetKey = widget.widgetKey;
                    if (widgetKey && PromptAssistant.instances.has(widgetKey)) {
                        PromptAssistant.instances.delete(widgetKey);
                    }
                    if (window.PromptAssistantInputWidgetMap && widgetKey) {
                        delete window.PromptAssistantInputWidgetMap[widgetKey];
                    }
                    return;
                }

                // Positioning success
                // Trigger dimension update now that it is in DOM
                container.updateDimensions();

                // Initial visibility check?
                // AssistantContainer starts collapsed and visible (opacity 1 for indicator)
                // We might want to initially hide it if needed, but standard behavior is fine.
            });

            return containerEl;
        } catch (error) {
            logger.error(`创建小助手失败 | 节点ID: ${nodeId} | 原因: ${error.message}`);
            return null;
        }
    }

    /**
     * 显示小助手UI
     * 控制UI显示动画和状态，创建时直接以折叠状态显示
     */
    showAssistantUI(widget, forceAnimation = false) {
        if (!widget?.element) return;

        // 避免重复显示
        if (widget.element.classList.contains('assistant-show')) {
            // 确保元素可见
            widget.element.style.display = 'flex';
            widget.element.style.opacity = '1';
            return;
        }

        // 直接显示，无动画过渡
        widget.element.style.opacity = '1';
        widget.element.style.display = 'flex';
        widget.element.classList.add('assistant-show');

        // 确保悬停区域可见（用于折叠状态下的交互）
        if (widget.isCollapsed && widget.hoverArea) {
            widget.hoverArea.style.display = 'block';
        }

        // 重置过渡状态
        widget.isTransitioning = false;

        // 只有当明确不是折叠状态时才触发自动折叠
        if (!widget.isCollapsed) {
            this.triggerAutoCollapse(widget);
        }
    }

    /**
     * 检查并触发自动折叠（如果需要）
     */
    _triggerAutoCollapseIfNeeded(widget) {
        if (widget && widget.container) {
            widget.container.collapse();
        }
    }




    /**
     * 展开小助手
     */
    _expandAssistant(widget) {
        if (widget && widget.container) {
            widget.container.expand();
        }
    }



    /**
     * 公开方法：触发小助手自动折叠
     * 供外部模块调用，用于在操作完成后折叠小助手UI
     */
    triggerAutoCollapse(widget) {
        return this._triggerAutoCollapseIfNeeded(widget);
    }

    /**
     * 更新小助手可见性
     * 始终显示小助手，不再根据鼠标悬停状态来决定
     */
    updateAssistantVisibility(widget) {
        if (!widget) return;

        // 总开关关闭时不处理可见性更新
        if (!window.FEATURES || !window.FEATURES.enabled) {
            return;
        }

        // 检查是否有按钮处于激活或处理中状态
        const hasActiveButtons = this._checkAssistantActiveState(widget);

        // 如果有激活的按钮，强制显示小助手（带动画）并取消自动折叠
        if (hasActiveButtons) {
            this.showAssistantUI(widget, true);

            // 取消可能的自动折叠定时器
            if (widget._autoCollapseTimer) {
                clearTimeout(widget._autoCollapseTimer);
                widget._autoCollapseTimer = null;
            }

            // 如果当前是折叠状态，则展开 - 使用requestAnimationFrame
            if (widget.isCollapsed) {
                requestAnimationFrame(() => {
                    this._expandAssistant(widget);
                });
            }

            return;
        }

        // 始终显示小助手，不再检查鼠标状态
        const isCurrentlyShown = widget.element?.classList.contains('assistant-show');
        if (!isCurrentlyShown) {
            this.showAssistantUI(widget, false);
            logger.debug(`UI显示 | 节点:${widget.nodeId} | 原因:始终显示`);
        } else {
            // 已经显示，检查是否需要自动折叠
            this.triggerAutoCollapse(widget);
        }
    }

    /**
     * 检查小助手是否有按钮处于激活状态
     */
    _checkAssistantActiveState(widget) {
        if (!widget || !widget.buttons) return false;

        // 0. 检查是否正在切换弹窗（切换期间不允许折叠）
        if (PopupManager._isTransitioning) {
            logger.debug(() => `[ActiveState] 阻止折叠 | 原因: PopupManager 正在切换弹窗 | 节点: ${widget.nodeId}`);
            return true;
        }

        // 1. 检查右键菜单是否可见（并且属于当前 widget）
        if (buttonMenu.isMenuVisible && buttonMenu.menuContext?.widget === widget) {
            logger.debug(() => `[ActiveState] 阻止折叠 | 原因: 右键菜单可见 | 节点: ${widget.nodeId}`);
            return true;
        }

        // 2. 检查中央按钮状态管理器是否有该widget的激活按钮
        const activeButtonInfo = UIToolkit.getActiveButtonInfo();
        if (activeButtonInfo && activeButtonInfo.widget === widget) {
            logger.debug(() => `[ActiveState] 阻止折叠 | 原因: UIToolkit.activeButtonInfo 匹配 | 节点: ${widget.nodeId}`);
            return true;
        }

        // 3. 检查 PopupManager 的活动弹窗是否属于当前 widget
        if (PopupManager.activePopupInfo?.buttonInfo?.widget === widget) {
            logger.debug(() => `[ActiveState] 阻止折叠 | 原因: PopupManager.activePopupInfo 匹配 | 节点: ${widget.nodeId}`);
            return true;
        }

        // 4. 检查按钮的 active/processing 状态
        for (const buttonId in widget.buttons) {
            const button = widget.buttons[buttonId];
            if (button.classList.contains('button-active') ||
                button.classList.contains('button-processing')) {
                logger.debug(() => `[ActiveState] 阻止折叠 | 原因: 按钮${buttonId}状态激活 | 节点: ${widget.nodeId}`);
                return true;
            }
        }

        // 调试日志：记录检查结果
        logger.debug(() => `[ActiveState] 允许折叠 | 节点: ${widget.nodeId} | UIToolkit: ${!!activeButtonInfo} | PopupManager: ${!!PopupManager.activePopupInfo} | 右键菜单: ${buttonMenu.isMenuVisible}`);
        return false;
    }

    /**
     * 更新所有实例的可见性
     * 在按钮状态变化时调用
     */
    updateAllInstancesVisibility() {
        PromptAssistant.instances.forEach(widget => {
            this.updateAssistantVisibility(widget);
        });
    }

    /**
     * 更新所有实例的预设宽度
     * 在功能开关变更时调用，重新计算并设置宽度
     */
    updateAllInstancesWidth() {
        const newWidth = calculateAssistantWidth();
        logger.debug(`[宽度更新] 计算新宽度:${newWidth}px | 实例数量:${PromptAssistant.instances.size}`);

        PromptAssistant.instances.forEach((widget) => {
            if (widget && widget.element) {
                widget.element.style.setProperty('--expanded-width', `${newWidth}px`);
            }
        });
    }

    /**
     * 显示状态提示
     * 创建临时提示信息气泡
     */
    showStatusTip(anchorElement, type, message, position = null) {
        return UIToolkit.showStatusTip(anchorElement, type, message, position);
    }

    // ---事件处理功能---
    /**
     * 设置UI事件处理
     * 配置按钮事件监听 - 简化版本
     */
    _setupUIEventHandling(widget, inputEl, containerDiv) {
        // 事件处理已委托给 AssistantContainer
        // 我们保留此方法是为了兼容外部调用，但现在它不执行任何操作。
    }



    // ---辅助功能---
    /**
     * 更新输入框内容并添加高亮效果
     */
    updateInputWithHighlight(widget, content, options = {}) {
        if (!widget?.inputEl) return;

        try {
            // 更新输入框内容 - 使用统一的setInputValue函数
            const success = setInputValue(widget, content, options);

            if (!success) {
                logger.warn(`输入框更新 | 结果:失败 | setInputValue返回false`);
                return;
            }

            // 添加高亮效果
            widget.inputEl.classList.add('input-highlight');
            setTimeout(() => {
                widget.inputEl.classList.remove('input-highlight');
            }, 200);
        } catch (error) {
            logger.error(`输入框更新 | 结果:异常 | 错误:${error.message}`);
        }
    }

    // ---按钮管理功能---
    /**
     * 添加功能按钮
     */
    addFunctionButtons(widget) {
        if (!widget?.element) {
            logger.error('添加按钮 | 结果:失败 | 原因: 容器不存在');
            return;
        }

        // 检查总开关状态
        if (!FEATURES.enabled) {
            logger.debug('添加按钮 | 结果:跳过 | 原因: 总功能已禁用');
            return;
        }

        // 检查是否有至少一个功能启用
        const hasEnabledFeatures = FEATURES.history || FEATURES.tag || FEATURES.expand || FEATURES.translate;
        if (!hasEnabledFeatures) {
            logger.debug('添加按钮 | 结果:跳过 | 原因: 没有启用任何功能');
            return;
        }

        // 检查是否是Note/MarkdownNote节点
        const isNoteNode = widget.nodeInfo && (widget.nodeInfo.isNoteNode === true || widget.nodeInfo.nodeType === 'MarkdownNote');

        // 获取历史状态（用于初始化撤销/重做按钮状态）
        const canUndo = HistoryCacheService.canUndo(widget.nodeId, widget.inputId);
        const canRedo = HistoryCacheService.canRedo(widget.nodeId, widget.inputId);

        // 按钮配置
        const buttonConfigs = [
            {
                id: 'history',
                title: '历史',
                icon: 'icon-history',
                onClick: (e, widget) => {
                    UIToolkit.handlePopupButtonClick(
                        e,
                        widget,
                        'history',
                        HistoryManager.showHistoryPopup.bind(HistoryManager),
                        HistoryManager.hideHistoryPopup.bind(HistoryManager)
                    );
                },
                visible: !isNoteNode && FEATURES.history, // Note节点不显示此按钮
                initialState: { disabled: false }
            },
            {
                id: 'undo',
                title: '撤销',
                icon: 'icon-undo',
                onClick: (e, widget) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logger.debug('按钮点击 | 动作: 撤销');

                    // 执行撤销操作
                    const undoContent = HistoryCacheService.undo(widget.nodeId, widget.inputId);
                    if (undoContent !== null) {
                        // 更新输入框内容并添加高亮效果
                        this.updateInputWithHighlight(widget, undoContent);

                        // 更新按钮状态
                        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                        logger.debug(`撤销操作 | 结果:成功 | 节点:${widget.nodeId}`);
                    } else {
                        logger.debug(`撤销操作 | 结果:失败 | 节点:${widget.nodeId} | 原因:无可用内容`);
                    }
                },
                visible: !isNoteNode && FEATURES.history,
                initialState: { disabled: !canUndo }
            },
            {
                id: 'redo',
                title: '重做',
                icon: 'icon-redo',
                onClick: (e, widget) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logger.debug('按钮点击 | 动作: 重做');

                    // 执行重做操作
                    const redoContent = HistoryCacheService.redo(widget.nodeId, widget.inputId);
                    if (redoContent !== null) {
                        // 更新输入框内容并添加高亮效果
                        this.updateInputWithHighlight(widget, redoContent);

                        // 更新按钮状态
                        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                        logger.debug(`重做操作 | 结果:成功 | 节点:${widget.nodeId}`);
                    } else {
                        logger.debug(`重做操作 | 结果:失败 | 节点:${widget.nodeId} | 原因:无可用内容`);
                    }
                },
                visible: !isNoteNode && FEATURES.history,
                initialState: { disabled: !canRedo }
            },
            {
                id: 'divider1',
                type: 'divider',
                visible: !isNoteNode && FEATURES.history // Note节点不显示，且跟随历史功能开关
            },
            {
                id: 'tag',
                title: '标签工具',
                icon: 'icon-tag',
                onClick: (e, widget) => {
                    // 创建一个带有标签选择功能的显示函数
                    const showTagPopup = (options) => {
                        // 处理标签选择功能
                        const enhancedOptions = {
                            ...options,
                            onTagSelect: (tag) => {
                                // 获取当前输入框的值和光标位置
                                const currentValue = widget.inputEl.value;
                                const cursorPos = widget.inputEl.selectionStart;
                                const beforeText = currentValue.substring(0, cursorPos);
                                const afterText = currentValue.substring(widget.inputEl.selectionEnd);

                                // 添加标签（英文值）
                                const newValue = beforeText + tag.en + afterText;

                                // 更新输入框内容并添加高亮效果
                                this.updateInputWithHighlight(widget, newValue);

                                // 更新光标位置
                                const newPos = cursorPos + tag.en.length;
                                widget.inputEl.setSelectionRange(newPos, newPos);

                                // 保持焦点在输入框
                                widget.inputEl.focus();
                            }
                        };

                        // 调用标签管理器显示弹窗
                        TagManager.showTagPopup(enhancedOptions);
                    };

                    // 使用统一的弹窗按钮点击处理
                    UIToolkit.handlePopupButtonClick(
                        e,
                        widget,
                        'tag',
                        showTagPopup,
                        TagManager.hideTagPopup.bind(TagManager)
                    );
                },
                visible: !isNoteNode && FEATURES.tag // Note节点不显示此按钮
            },
            {
                id: 'expand',
                title: '提示词优化',
                icon: 'icon-expand',
                onClick: async (e, widget) => {
                    logger.debug('按钮点击 | 动作: 提示词优化');

                    // 如果按钮处于 processing 状态且被点击，直接返回，
                    // 让UIToolkit中的取消逻辑接管
                    if (e.currentTarget.classList.contains('button-processing')) {
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'expand',
                        e.currentTarget,
                        async (notifyCancelReady) => {
                            try {
                                // 获取输入值 - 使用统一的getInputValue函数
                                const inputValue = getInputValue(widget);
                                logger.debug(`[提示词优化] 获取到的输入值长度: ${inputValue?.length || 0}`);

                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('请输入要优化的提示词');
                                }

                                // 生成唯一request_id
                                const request_id = APIService.generateRequestId('exp', null, widget.nodeId);

                                // 通知UI可以准备取消操作了
                                notifyCancelReady(request_id);

                                // 显示扩写中提示
                                const btnRect = e.currentTarget.getBoundingClientRect();
                                UIToolkit.showStatusTip(
                                    e.currentTarget,
                                    'loading',
                                    '提示词优化中',
                                    { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                );

                                // 调用LLM服务进行扩写
                                const result = await APIService.llmExpandPrompt(inputValue, request_id);

                                if (result.success) {
                                    // 更新输入框内容并添加高亮效果
                                    this.updateInputWithHighlight(widget, result.data.expanded);

                                    // 添加扩写结果到历史记录
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: result.data.expanded,
                                        operation_type: 'expand',
                                        request_id: request_id,
                                        timestamp: Date.now()
                                    });

                                    // 重置撤销状态
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, result.data.expanded);

                                    // 更新按钮状态
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    return {
                                        success: true,
                                        useCache: false,
                                        tipType: 'success',
                                        tipMessage: '提示词优化完成'
                                    };
                                } else {
                                    // 不在这里显示错误提示，直接抛出错误让 handleAsyncButtonOperation 处理
                                    throw new Error(result.error);
                                }
                            } catch (error) {
                                // 不在这里显示错误提示，直接抛出错误让 handleAsyncButtonOperation 处理
                                throw error;
                            }
                        }
                    );
                },
                visible: !isNoteNode && FEATURES.expand, // Note节点不显示此按钮
                // 添加右键菜单配置
                contextMenu: async (widget) => {
                    // 获取服务列表和当前激活状态
                    let services = [];
                    let currentLLMService = null;
                    let currentLLMModel = null;

                    // 获取扩写规则
                    let activePromptId = null;
                    let expandPrompts = [];

                    try {
                        // 获取服务列表
                        const servicesResp = await fetch(APIService.getApiUrl('/services'));
                        if (servicesResp.ok) {
                            const servicesData = await servicesResp.json();
                            if (servicesData.success) {
                                services = servicesData.services || [];
                            }
                        }

                        // 获取当前激活的LLM服务和模型
                        const llmResp = await fetch(APIService.getApiUrl('/config/llm'));
                        if (llmResp.ok) {
                            const llmConfig = await llmResp.json();
                            currentLLMService = llmConfig.provider || null;
                            currentLLMModel = llmConfig.model || null;
                        }

                        // 获取扩写规则
                        const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
                        if (response.ok) {
                            const data = await response.json();
                            activePromptId = data.active_prompts?.expand || null;

                            if (data.expand_prompts) {
                                const originalOrder = Object.keys(data.expand_prompts);
                                originalOrder.forEach(key => {
                                    const prompt = data.expand_prompts[key];
                                    const showIn = prompt.showIn || ['frontend', 'node'];

                                    // 仅当配置包含 'frontend' 时才在前端菜单显示
                                    if (showIn.includes('frontend')) {
                                        expandPrompts.push({
                                            id: key,
                                            name: prompt.name || key,
                                            category: prompt.category || '',
                                            content: prompt.content,
                                            showIn: showIn,
                                            isActive: key === activePromptId
                                        });
                                    }
                                });
                                expandPrompts.sort((a, b) =>
                                    originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                                );
                            }
                        }
                    } catch (error) {
                        logger.error(`获取提示词优化配置失败: ${error.message}`);
                    }

                    // 创建服务菜单项(只显示有LLM模型的服务,不包括百度)
                    const serviceMenuItems = services
                        .filter(service => service.llm_models && service.llm_models.length > 0)
                        .map(service => {
                            const isCurrentService = currentLLMService === service.id;

                            // 创建模型子菜单
                            const modelChildren = (service.llm_models || []).map(model => {
                                const isCurrentModel = isCurrentService && currentLLMModel === model.name;
                                return {
                                    label: model.display_name || model.name,
                                    icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                    onClick: async (context) => {
                                        try {
                                            const res = await fetch(APIService.getApiUrl('/services/current'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ service_type: 'llm', service_id: service.id, model_name: model.name })
                                            });
                                            if (!res.ok) throw new Error(`服务器返回错误: ${res.status}`);
                                            const modelLabel = model.display_name || model.name;
                                            UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${service.name} - ${modelLabel}`);
                                            logger.log(`提示词优化服务切换 | 服务: ${service.name} | 模型: ${modelLabel}`);
                                        } catch (err) {
                                            logger.error(`切换提示词优化模型失败: ${err.message}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${err.message}`);
                                        }
                                    }
                                };
                            });

                            return {
                                label: service.name || service.id,
                                icon: `<span class="pi ${isCurrentService ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'llm', service_id: service.id })
                                        });
                                        if (!res.ok) throw new Error(`服务器返回错误: ${res.status}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${service.name}`);
                                        logger.log(`提示词优化服务切换 | 服务: ${service.name}`);
                                    } catch (err) {
                                        logger.error(`切换提示词优化服务失败: ${err.message}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${err.message}`);
                                    }
                                },
                                children: modelChildren.length > 0 ? modelChildren : undefined
                            };
                        });

                    // ---创建规则菜单项（支持分类分组）---
                    const ruleMenuItems = [];

                    // 辅助函数：创建单个规则菜单项
                    const createRuleMenuItem = (prompt) => ({
                        label: prompt.name,
                        icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            logger.log(`右键菜单 | 动作: 切换提示词优化 | ID: ${prompt.id}`);
                            try {
                                const response = await fetch(APIService.getApiUrl('/config/active_prompt'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ type: 'expand', prompt_id: prompt.id })
                                });
                                if (response.ok) {
                                    UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${prompt.name}`);
                                } else {
                                    throw new Error(`服务器返回错误: ${response.status}`);
                                }
                            } catch (error) {
                                logger.error(`切换提示词优化失败: ${error.message}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${error.message}`);
                            }
                        }
                    });

                    // 按分类分组规则
                    const uncategorizedPrompts = expandPrompts.filter(p => !p.category);
                    const categorizedPrompts = expandPrompts.filter(p => p.category);

                    // 收集所有分类并排序
                    const categories = [...new Set(categorizedPrompts.map(p => p.category))].sort();

                    // 添加无分类的规则（放在顶层）
                    uncategorizedPrompts.forEach(prompt => {
                        ruleMenuItems.push(createRuleMenuItem(prompt));
                    });

                    // 添加分类分组（每个分类作为二级菜单）
                    categories.forEach(category => {
                        const promptsInCategory = categorizedPrompts.filter(p => p.category === category);
                        const hasActivePrompt = promptsInCategory.some(p => p.isActive);

                        ruleMenuItems.push({
                            label: category,
                            icon: `<span class="pi ${hasActivePrompt ? 'pi-folder-open' : 'pi-folder'}"></span>`,
                            submenuAlign: 'center',
                            children: promptsInCategory.map(prompt => createRuleMenuItem(prompt))
                        });
                    });


                    // 添加规则管理选项
                    ruleMenuItems.push({ type: 'separator' });
                    ruleMenuItems.push({
                        label: '规则管理',
                        icon: '<span class="pi pi-pen-to-square"></span>',
                        onClick: () => {
                            rulesConfigManager.showRulesConfigModal();
                        }
                    });

                    return [
                        ...ruleMenuItems,
                        // { type: 'separator' },
                        {
                            label: "选择服务",
                            icon: '<span class="pi pi-sparkles"></span>',
                            submenuAlign: 'bottom',
                            children: serviceMenuItems
                        }
                    ];
                }
            },
            {
                id: 'translate',
                title: '翻译',
                icon: 'icon-translate',
                onClick: async (e, widget) => {
                    logger.debug('按钮点击 | 动作: 翻译');

                    // 如果按钮处于 processing 状态且被点击，直接返回，
                    // 让UIToolkit中的取消逻辑接管
                    if (e.currentTarget.classList.contains('button-processing')) {
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'translate',
                        e.currentTarget,
                        async (notifyCancelReady) => {
                            try {
                                // --- Markdown LiteGraph 模式处理 ---
                                // 增强判断逻辑：除了检查nodeType，也检查DOM类名
                                const hasMarkdownClass = widget.inputEl?.classList?.contains('comfy-markdown');
                                const isMarkdownLiteGraph = (widget.nodeInfo?.nodeType === 'MarkdownNote' || hasMarkdownClass) &&
                                    widget.nodeInfo?.isVueMode !== true;

                                logger.debug(`[翻译调试] Markdown检测: ${isMarkdownLiteGraph} (Type: ${widget.nodeInfo?.nodeType}, HasClass: ${hasMarkdownClass})`);

                                // 获取输入值 - 根据模式决定是否获取HTML
                                const inputValue = getInputValue(widget, { html: isMarkdownLiteGraph });

                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('请输入要翻译的内容');
                                }

                                let contentToTranslate = inputValue;
                                let mdData = null;

                                if (isMarkdownLiteGraph) {
                                    mdData = MarkdownNoteTranslate.protectAndExtract(inputValue);
                                    if (mdData.texts && mdData.texts.length > 0) {
                                        contentToTranslate = mdData.texts.join('\n');
                                    } else {
                                        // 如果提取后没有文本（只有标签/代码），则认为空或者无需翻译
                                        if (!contentToTranslate || contentToTranslate.trim() === '') {
                                            // 保持原样或抛出错误，这里选择抛出提示
                                            throw new Error('没有检测到可翻译的内容');
                                        }
                                        // 如果原内容有东西但提取为空，可能全是代码块，保留原内容作为待翻译（实际上API可能跳过）
                                        // 或者这里 contentToTranslate 保持为 inputValue ?
                                        // 不，protectAndExtract 没提取到，说明不该翻译。
                                        // 但为了流程继续，如果不抛错，我们假设 contentToTranslate 为空导致后续报错
                                    }
                                }

                                if (!contentToTranslate || contentToTranslate.trim() === '') {
                                    throw new Error('请输入要翻译的内容');
                                }

                                // 显示翻译中提示
                                const btnRect = e.currentTarget.getBoundingClientRect();
                                UIToolkit.showStatusTip(
                                    e.currentTarget,
                                    'loading',
                                    '翻译中',
                                    { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                                );

                                // 1. 查询缓存
                                let cacheResult = null;
                                if (FEATURES.useTranslateCache) {
                                    cacheResult = TranslateCacheService.queryTranslateCache(contentToTranslate);
                                }

                                if (cacheResult) {
                                    let rawResultText = '';
                                    let tipMessage = '';
                                    let useCache = true;

                                    // 根据缓存匹配类型处理
                                    if (cacheResult.type === 'source') {
                                        // 命中原文，返回译文
                                        rawResultText = cacheResult.translatedText;
                                        tipMessage = '译文';
                                    } else if (cacheResult.type === 'translated') {
                                        // 命中译文，返回原文
                                        rawResultText = cacheResult.sourceText;
                                        tipMessage = '原文';
                                    }

                                    // 处理 Markdown 格式还原
                                    let finalResultText = rawResultText;
                                    if (isMarkdownLiteGraph && mdData) {
                                        const translatedSegments = rawResultText.split('\n');
                                        finalResultText = MarkdownNoteTranslate.restoreWithTranslations(mdData.placeholderHTML, mdData.placeholders, translatedSegments);
                                    }

                                    // 更新输入框内容并添加高亮效果
                                    this.updateInputWithHighlight(widget, finalResultText, { html: isMarkdownLiteGraph });

                                    // 添加翻译结果到历史记录
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalResultText,
                                        operation_type: 'translate',
                                        timestamp: Date.now()
                                    });

                                    // 重置撤销状态
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalResultText);

                                    // 更新按钮状态
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    return {
                                        success: true,
                                        useCache: useCache,
                                        tipType: 'info',
                                        tipMessage: tipMessage,
                                        buttonElement: e.currentTarget // 传递按钮元素
                                    };
                                }

                                // 缓存未命中，使用API翻译

                                // 生成唯一request_id
                                const request_id = APIService.generateRequestId('trans', null, widget.nodeId);

                                // 通知UI可以准备取消操作了
                                notifyCancelReady(request_id);

                                // 检测语言 (使用提取后的文本)
                                const langResult = PromptFormatter.detectLanguage(contentToTranslate);

                                // 获取翻译服务配置
                                let result;
                                try {
                                    // 获取翻译配置
                                    const configResp = await fetch(APIService.getApiUrl('/config/translate'));
                                    let isBaidu = false;

                                    if (configResp.ok) {
                                        const config = await configResp.json();
                                        // 检查provider是否为'baidu'
                                        if (config.provider === 'baidu') {
                                            isBaidu = true;
                                        }
                                    }

                                    if (isBaidu) {
                                        // 使用百度翻译服务
                                        result = await APIService.baiduTranslate(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    } else {
                                        // 使用LLM翻译服务
                                        result = await APIService.llmTranslate(
                                            contentToTranslate,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    }

                                    if (!result) {
                                        throw new Error('翻译服务返回空结果');
                                    }
                                } catch (error) {
                                    logger.error(`翻译失败 | 错误:${error.message}`);
                                    throw new Error(`翻译失败: ${error.message}`);
                                }

                                if (result.success) {
                                    // 格式化翻译结果（转换标点符号）
                                    const formattedText = PromptFormatter.formatTranslatedText(result.data.translated);

                                    // 处理 Markdown 格式还原
                                    let finalResultText = formattedText;
                                    if (isMarkdownLiteGraph && mdData) {
                                        const translatedSegments = formattedText.split('\n');
                                        finalResultText = MarkdownNoteTranslate.restoreWithTranslations(mdData.placeholderHTML, mdData.placeholders, translatedSegments);
                                    }

                                    // 添加翻译结果到历史记录
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: finalResultText,
                                        operation_type: 'translate',
                                        request_id: request_id,
                                        timestamp: Date.now()
                                    });

                                    // 更新输入框内容并添加高亮效果
                                    this.updateInputWithHighlight(widget, finalResultText, { html: isMarkdownLiteGraph });

                                    // 重置撤销状态
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, finalResultText);

                                    // 更新按钮状态
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    // 只有开启缓存时才写入缓存 (使用提取文本和翻译后的片段文本，以便下次能复用)
                                    if (FEATURES.useTranslateCache) {
                                        TranslateCacheService.addTranslateCache(contentToTranslate, formattedText);
                                    }

                                    return {
                                        success: true,
                                        useCache: false,
                                        tipType: 'success',
                                        tipMessage: '翻译完成'
                                    };
                                } else {
                                    // 不在这里显示错误提示，直接抛出错误让 handleAsyncButtonOperation 处理
                                    throw new Error(result.error);
                                }
                            } catch (error) {
                                // 不在这里显示错误提示，直接抛出错误让 handleAsyncButtonOperation 处理
                                throw error;
                            }
                        }
                    );
                },
                visible: FEATURES.translate, // Note节点只显示此按钮
                // 添加右键菜单配置
                contextMenu: async (widget) => {
                    const useTranslateCache = app.ui.settings.getSettingValue("PromptAssistant.Features.UseTranslateCache", true);

                    // 获取所有服务列表和当前激活状态
                    let services = [];
                    let currentTranslateService = null;
                    let currentTranslateModel = null;

                    try {
                        // 获取服务列表
                        const servicesResp = await fetch(APIService.getApiUrl('/services'));
                        if (servicesResp.ok) {
                            const servicesData = await servicesResp.json();
                            if (servicesData.success) {
                                services = servicesData.services || [];
                            }
                        }

                        // 获取当前激活的翻译服务和模型
                        const translateResp = await fetch(APIService.getApiUrl('/config/translate'));
                        if (translateResp.ok) {
                            const translateConfig = await translateResp.json();
                            currentTranslateService = translateConfig.provider || null;
                            currentTranslateModel = translateConfig.model || null;
                        }
                    } catch (e) {
                        logger.error(`获取服务列表失败: ${e.message}`);
                    }

                    // 创建服务菜单项
                    const serviceMenuItems = [];

                    // 百度翻译项（永远显示在第一位）
                    const isBaiduCurrent = currentTranslateService === 'baidu';
                    serviceMenuItems.push({
                        label: '百度翻译',
                        icon: `<span class="pi ${isBaiduCurrent ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            try {
                                const res = await fetch(APIService.getApiUrl('/services/current'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ service_type: 'translate', service_id: 'baidu' })
                                });
                                if (!res.ok) throw new Error(`服务器返回错误: ${res.status}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: 百度翻译`);
                                logger.log(`翻译服务切换 | 服务: 百度翻译`);
                            } catch (err) {
                                logger.error(`切换翻译服务失败: ${err.message}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${err.message}`);
                            }
                        }
                    });

                    // 动态添加其他LLM服务
                    const otherServiceMenuItems = services
                        .filter(service => service.llm_models && service.llm_models.length > 0)
                        .map(service => {
                            const isCurrentService = currentTranslateService === service.id;

                            // 创建模型子菜单
                            const modelChildren = (service.llm_models || []).map(model => {
                                const isCurrentModel = isCurrentService && currentTranslateModel === model.name;
                                return {
                                    label: model.display_name || model.name,
                                    icon: `<span class="pi ${isCurrentModel ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                    onClick: async (context) => {
                                        try {
                                            const res = await fetch(APIService.getApiUrl('/services/current'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ service_type: 'translate', service_id: service.id, model_name: model.name })
                                            });
                                            if (!res.ok) throw new Error(`服务器返回错误: ${res.status}`);
                                            const modelLabel = model.display_name || model.name;
                                            UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${service.name} - ${modelLabel}`);
                                            logger.log(`翻译服务切换 | 服务: ${service.name} | 模型: ${modelLabel}`);
                                        } catch (err) {
                                            logger.error(`切换翻译模型失败: ${err.message}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${err.message}`);
                                        }
                                    }
                                };
                            });

                            return {
                                label: service.name || service.id,
                                icon: `<span class="pi ${isCurrentService ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                                onClick: async (context) => {
                                    try {
                                        const res = await fetch(APIService.getApiUrl('/services/current'), {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service_type: 'translate', service_id: service.id })
                                        });
                                        if (!res.ok) throw new Error(`服务器返回错误: ${res.status}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${service.name}`);
                                        logger.log(`翻译服务切换 | 服务: ${service.name}`);
                                    } catch (err) {
                                        logger.error(`切换翻译服务失败: ${err.message}`);
                                        UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${err.message}`);
                                    }
                                },
                                children: modelChildren.length > 0 ? modelChildren : undefined
                            };
                        });

                    // 将其他服务添加到serviceMenuItems
                    serviceMenuItems.push(...otherServiceMenuItems);

                    return [
                        {
                            label: "选择服务",
                            icon: '<span class="pi pi-sparkles"></span>',
                            children: serviceMenuItems
                        },
                        { type: 'separator' },
                        {
                            label: "翻译缓存",
                            icon: `<span class="pi ${useTranslateCache ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                            onClick: (context) => {
                                const newStatus = !useTranslateCache;
                                app.ui.settings.setSettingValue("PromptAssistant.Features.UseTranslateCache", newStatus);
                                const statusText = newStatus ? '已开启' : '已关闭';
                                logger.log(`右键菜单 | 动作: 切换翻译缓存 | 状态: ${statusText}`);
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `翻译缓存${statusText}`);
                            }
                        }
                    ];
                }
            },
        ];

        // 记录添加的按钮
        let historyButtons = [];
        let otherButtons = [];
        let divider = null;

        // ---Add buttons to AssistantContainer---
        for (const config of buttonConfigs) {
            if (config.type === 'divider') {
                // Check visibility for divider
                if (config.visible === false) continue;

                const divider = document.createElement('div');
                divider.className = 'prompt-assistant-divider';
                // Add divider to container
                widget.container.addButton(divider, config.id || `divider_${Date.now()}`);
                // Save reference if needed
                if (config.id) widget.buttons[config.id] = divider;
                continue;
            }

            // Check visibility
            if (config.visible === false) continue;

            // Create button using existing helper
            // Note: addButtonWithIcon returns the button element and saves it to widget.buttons
            const button = this.addButtonWithIcon(widget, config);
            if (!button) continue;

            // Set initial state
            if (config.initialState) {
                Object.entries(config.initialState).forEach(([stateType, value]) => {
                    UIToolkit.setButtonState(widget, config.id, stateType, value);
                });
            }

            // Add to container
            widget.container.addButton(button, config.id);
        }


    }

    /**
     * 添加带图标的按钮
     */
    addButtonWithIcon(widget, config) {
        if (!widget?.element || !widget?.innerContent) return null;

        const { id, title, icon, onClick, contextMenu } = config;

        // 创建按钮
        const button = document.createElement('button');
        button.className = 'prompt-assistant-button';
        button.title = title || '';
        button.dataset.id = id || `btn_${Date.now()}`;

        // 添加图标 - 使用UIToolkit的SVG图标方法
        if (icon) {
            UIToolkit.addIconToButton(button, icon, title || '');
        }

        // 添加事件
        if (typeof onClick === 'function') {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 如果按钮被禁用，不执行操作
                if (button.classList.contains('button-disabled')) {
                    return;
                }

                // 执行点击回调
                onClick(e, widget);
            });
        }

        // 添加右键菜单（如果有）
        if (contextMenu && typeof contextMenu === 'function') {
            this._setupButtonContextMenu(button, contextMenu, widget);
        }

        // 保存引用
        if (id) {
            widget.buttons[id] = button;
        }

        return button;
    }

    /**
     * 检测输入框是否有滚动条
     * @param {HTMLElement} inputEl - 输入框元素
     * @returns {boolean} 是否有垂直滚动条
     */
    _detectScrollbar(inputEl) {
        if (!inputEl || inputEl.tagName !== 'TEXTAREA') {
            return false;
        }

        try {
            // 检查垂直滚动条：scrollHeight > clientHeight
            const hasVerticalScrollbar = inputEl.scrollHeight > inputEl.clientHeight;
            // 日志简化：详细滚动条检测日志移至 _adjustPositionForScrollbar，并仅在状态变更时输出
            return hasVerticalScrollbar;
        } catch (error) {
            logger.error(`[滚动条检测] 检测失败 | 错误: ${error.message}`);
            return false;
        }
    }

    /**
     * 根据滚动条状态调整小助手位置
     * @param {Object} widget - 小助手实例
     * @param {HTMLElement} inputEl - 输入框元素
     * @param {Boolean} forceUpdate - 是否强制更新（用于初始化）
     */
    _adjustPositionForScrollbar(widget, inputEl, forceUpdate = false) {
        if (!widget?.element || !inputEl) return;

        const hasScrollbar = this._detectScrollbar(inputEl);
        const containerDiv = widget.element;

        // 仅在滚动条状态发生变化时更新位置（除非强制更新）
        const prevState = containerDiv.dataset.hasScrollbar === 'true';
        if (!forceUpdate && prevState === hasScrollbar) {
            return; // 状态未变，不做任何操作
        }
        containerDiv.dataset.hasScrollbar = String(hasScrollbar);

        // 有滚动条时向左偏移，避开滚动条
        const rightOffset = hasScrollbar ? '16px' : '4px';
        containerDiv.style.right = rightOffset;
    }

    /**
     * 设置UI位置
     * 支持 Vue node2.0 和 litegraph.js 两种渲染模式
     * @param {Function} onComplete - 定位完成回调，接收boolean参数，true表示成功，false表示失败
     */
    _setupUIPosition(widget, inputEl, containerDiv, canvasContainerRect, onComplete) {
        logger.debug(`[_setupUIPosition] 开始定位 | 节点ID: ${widget.nodeId} | inputEl存在: ${!!inputEl}`);

        // 清理函数列表
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // 获取节点对象
        const node = app.graph?.getNodeById(widget.nodeId);
        if (!node) {
            logger.debug(`[定位] 节点不存在 | ID: ${widget.nodeId}`);
            if (onComplete) onComplete(false);
            return;
        }

        // 创建widget对象用于容器查找
        const widgetObj = {
            inputEl: inputEl,
            element: inputEl,
            name: widget.inputId,
            id: widget.inputId
        };

        // 使用 NodeMountService 进行带重试的容器查找
        // Vue mode下需要更多重试次数和更长间隔
        const isVueMode = typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode === true;
        nodeMountService.findMountContainerWithRetry(node, widgetObj, {
            maxRetries: isVueMode ? 5 : 3,
            retryInterval: isVueMode ? 800 : 500
        }).then(containerInfo => {
            if (!containerInfo) {
                logger.debug(`[定位] 容器查找失败 | 节点ID: ${widget.nodeId}`);
                if (onComplete) onComplete(false);
                return;
            }

            // 根据渲染模式应用不同的定位策略
            if (containerInfo.mode === RENDER_MODE.VUE_NODES) {
                this._applyVueNodesPositioning(widget, containerDiv, containerInfo);
            } else {
                this._applyLitegraphPositioning(widget, containerDiv, containerInfo);
            }

            // 保存渲染模式到widget，用于后续调整
            widget._renderMode = containerInfo.mode;

            // 触发回流确保样式生效
            void containerDiv.offsetWidth;

            if (onComplete) onComplete(true);
            logger.debug(`[定位] 成功 | 节点ID: ${widget.nodeId} | 模式: ${containerInfo.mode}`);

        }).catch(error => {
            logger.error(`[定位] 异常 | 节点ID: ${widget.nodeId} | 错误: ${error.message}`);
            if (onComplete) onComplete(false);
        });
    }

    /**
     * Vue node2.0 模式下的定位逻辑
     */
    _applyVueNodesPositioning(widget, containerDiv, containerInfo) {
        let { container, textarea, nodeContainer, isNoteNode } = containerInfo;

        // 【特殊处理】Note节点在Vue mode下可能需要二次查找textarea
        // 因为Note节点的DOM结构较简单，直接查找节点容器内的textarea
        if (!textarea && isNoteNode && nodeContainer) {
            logger.debug(`[Vue定位] Note节点二次查找textarea | 节点ID: ${widget.nodeId}`);

            // 在整个节点容器内查找textarea
            const textareas = nodeContainer.querySelectorAll('textarea');
            if (textareas.length > 0) {
                textarea = textareas[0];
                container = textarea.parentElement;
                logger.debug(`[Vue定位] Note节点找到textarea | 节点ID: ${widget.nodeId}`);
            } else {
                // 仍然没有找到，可能DOM还未渲染完成
                logger.warn(`[Vue定位] Note节点仍未找到textarea | 节点ID: ${widget.nodeId}`);
            }
        }

        // 【关键】在Vue mode下，更新widget的inputEl引用为实际的textarea元素
        // 这样翻译、扩写等功能才能正确读取/写入文本内容
        if (textarea && textarea !== widget.inputEl) {
            const oldInputEl = widget.inputEl;
            widget.inputEl = textarea;
            widget.text_element = textarea;

            // 更新全局输入框映射
            if (window.PromptAssistantInputWidgetMap && window.PromptAssistantInputWidgetMap[widget.widgetKey]) {
                window.PromptAssistantInputWidgetMap[widget.widgetKey].inputEl = textarea;
            }

            logger.debug(`[Vue定位] 更新inputEl引用 | 节点ID: ${widget.nodeId}`);

            // 为新的textarea绑定事件（如果之前没有绑定过）
            // 避免重复绑定：检查是否已经有相关事件监听
            if (!textarea._promptAssistantBound) {
                textarea._promptAssistantBound = true;
                widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

                // 绑定blur事件用于历史记录
                const removeBlurListener = EventManager.addDOMListener(textarea, 'blur', async () => {
                    logger.debug(`[Vue] 历史写入准备 | 原因：失焦事件触发 node_id=${widget.nodeId} input_id=${widget.inputId}`);
                    HistoryCacheService.addHistory({
                        workflow_id: widget.nodeInfo?.workflow_id || '',
                        node_id: widget.nodeId,
                        input_id: widget.inputId,
                        content: textarea.value,
                        operation_type: 'input',
                        timestamp: Date.now()
                    });
                    // 重置撤销状态
                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, textarea.value);
                    // 更新按钮状态
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                });
                widget._eventCleanupFunctions.push(removeBlurListener);

                // 绑定input事件用于实时更新按钮状态
                const removeInputListener = EventManager.addDOMListener(textarea, 'input', () => {
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                    this._adjustPositionForScrollbar(widget, textarea);
                });
                widget._eventCleanupFunctions.push(removeInputListener);

                // 添加ResizeObserver监听textarea尺寸变化，当节点大小改变时自动调整位置
                if (window.ResizeObserver) {
                    const resizeObserver = new ResizeObserver(() => {
                        setTimeout(() => this._adjustPositionForScrollbar(widget, textarea), 10);
                    });
                    resizeObserver.observe(textarea);
                    widget._eventCleanupFunctions.push(() => resizeObserver.disconnect());
                } else {
                    // 降级方案：监听window resize事件
                    const removeResizeListener = EventManager.addDOMListener(window, 'resize',
                        EventManager.debounce(() => this._adjustPositionForScrollbar(widget, textarea), 100)
                    );
                    widget._eventCleanupFunctions.push(removeResizeListener);
                }

                // 初始化撤销状态（只初始化一次，使用widget级别的标记）
                if (!widget._undoStateInitialized) {
                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, textarea.value);
                    widget._undoStateInitialized = true;
                    logger.debug(`[Vue定位] 撤销状态初始化 | 节点ID: ${widget.nodeId}`);
                } else {
                    logger.debug(`[Vue定位] 跳过重复初始化（已在createAssistant中完成） | 节点ID: ${widget.nodeId}`);
                }

                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                logger.debug(`[Vue定位] 事件绑定完成 | 节点ID: ${widget.nodeId}`);
            } else {
                // 如果已经绑定过事件，只更新按钮状态
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                logger.debug(`[Vue定位] 跳过重复绑定 | 节点ID: ${widget.nodeId}`);
            }
        }

        // 【防重复挂载检查】检查 textarea 是否已被小助手绑定
        // 如果 textarea 已有挂载标记，说明另一个小助手实例已绑定此 textarea，跳过本次挂载
        if (textarea && textarea._promptAssistantMounted) {
            logger.debug(`[Vue定位] 跳过挂载 | 原因: textarea 已被其他小助手绑定 | 节点ID: ${widget.nodeId}`);
            // 清理当前 widget 实例（因为无法正确挂载）
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // 【防重复挂载检查】检查容器内是否已存在小助手元素
        const existingAssistant = container.querySelector('.assistant-container-common');
        if (existingAssistant) {
            logger.debug(`[Vue定位] 跳过挂载 | 原因: 容器内已存在小助手 | 节点ID: ${widget.nodeId}`);
            // 清理当前 widget 实例（因为无法正确挂载）
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // 在 textarea 上添加挂载标记
        if (textarea) {
            textarea._promptAssistantMounted = true;
            // 保存 widgetKey 用于清理时移除标记
            textarea._promptAssistantWidgetKey = widget.widgetKey;
        }

        // Vue node2.0 模式：使用相对定位，根据 anchorPosition 设置位置
        containerDiv.style.position = 'absolute';
        containerDiv.style.zIndex = '10';

        // 确保容器有相对定位
        const containerPosition = window.getComputedStyle(container).position;
        if (containerPosition === 'static') {
            container.style.position = 'relative';
        }

        // 添加Vue模式标记类
        containerDiv.classList.add('vue-node-mode');

        // 挂载到容器
        container.appendChild(containerDiv);

        // 挂载完成后检测并调整滚动条位置
        // 使用多重延迟策略，确保 textarea 内容已完全加载
        if (textarea) {
            requestAnimationFrame(() => this._adjustPositionForScrollbar(widget, textarea, true));
            setTimeout(() => this._adjustPositionForScrollbar(widget, textarea, true), 50);
            setTimeout(() => this._adjustPositionForScrollbar(widget, textarea, true), 150);
        }

        logger.debug(`[Vue定位] 完成 | 节点ID: ${widget.nodeId} | 锚点: ${widget.container?.anchorPosition}`);
    }

    /**
     * litegraph.js 模式下的定位逻辑
     * 【修复】添加后备事件绑定逻辑，与 Vue mode 保持一致
     */
    _applyLitegraphPositioning(widget, containerDiv, containerInfo) {
        const { container: domWidgetContainer, textarea } = containerInfo;

        // 【关键修复】确保 inputEl 引用正确
        if (textarea && textarea !== widget.inputEl) {
            widget.inputEl = textarea;
            widget.text_element = textarea;

            // 更新全局输入框映射
            if (window.PromptAssistantInputWidgetMap && window.PromptAssistantInputWidgetMap[widget.widgetKey]) {
                window.PromptAssistantInputWidgetMap[widget.widgetKey].inputEl = textarea;
            }

            logger.debug(`[Litegraph定位] 更新inputEl引用 | 节点ID: ${widget.nodeId}`);
        }

        // 【关键修复】确保事件绑定（与 Vue mode 一致的后备逻辑）
        const inputEl = widget.inputEl || textarea;

        // 使用 widget 级别的 flag 判断
        const isBound = widget._inputEventsBound;

        logger.debug(`[Litegraph定位] 事件绑定检查 | 节点ID: ${widget.nodeId} | inputEl存在: ${!!inputEl} | isBound: ${isBound}`);

        // 如果没有绑定，则绑定事件
        if (inputEl && !isBound) {
            // 如果是遗留标记，记录日志
            if (inputEl._promptAssistantBound) {
                logger.debug(`[Litegraph定位] 检测到遗留标记，重新绑定 | 节点ID: ${widget.nodeId}`);
            }

            inputEl._promptAssistantBound = true;
            widget._inputEventsBound = true; // 设置标记
            widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
            logger.debug(`[Litegraph定位] 开始绑定事件 | 节点ID: ${widget.nodeId}`);

            // 绑定blur事件用于历史记录
            const removeBlurListener = EventManager.addDOMListener(inputEl, 'blur', async () => {
                logger.debug(`[Litegraph] 历史写入准备 | 原因：失焦事件触发 node_id=${widget.nodeId} input_id=${widget.inputId}`);
                HistoryCacheService.addHistory({
                    workflow_id: widget.nodeInfo?.workflow_id || '',
                    node_id: widget.nodeId,
                    input_id: widget.inputId,
                    content: inputEl.value,
                    operation_type: 'input',
                    timestamp: Date.now()
                });
                // 重置撤销状态
                HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, inputEl.value);
                // 更新按钮状态
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            });
            widget._eventCleanupFunctions.push(removeBlurListener);

            // 绑定input事件用于实时更新按钮状态
            const removeInputListener = EventManager.addDOMListener(inputEl, 'input', () => {
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                this._adjustPositionForScrollbar(widget, inputEl);
            });
            widget._eventCleanupFunctions.push(removeInputListener);

            // 初始化撤销状态
            if (!widget._undoStateInitialized) {
                HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, inputEl.value);
                widget._undoStateInitialized = true;
                logger.debug(`[Litegraph定位] 撤销状态初始化 | 节点ID: ${widget.nodeId}`);
            }

            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            logger.debug(`[Litegraph定位] 事件绑定完成 | 节点ID: ${widget.nodeId}`);
        } else if (inputEl && inputEl._promptAssistantBound) {
            // 已绑定，只更新按钮状态
            UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
        }

        // 【防重复挂载检查】检查 inputEl 是否已被小助手绑定
        if (inputEl && inputEl._promptAssistantMounted) {
            logger.debug(`[Litegraph定位] 跳过挂载 | 原因: inputEl 已被其他小助手绑定 | 节点ID: ${widget.nodeId}`);
            // 清理当前 widget 实例（因为无法正确挂载）
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // 【防重复挂载检查】检查容器内是否已存在小助手元素
        const existingAssistant = domWidgetContainer.querySelector('.assistant-container-common');
        if (existingAssistant) {
            logger.debug(`[Litegraph定位] 跳过挂载 | 原因: 容器内已存在小助手 | 节点ID: ${widget.nodeId}`);
            // 清理当前 widget 实例（因为无法正确挂载）
            if (widget.widgetKey && PromptAssistant.instances.has(widget.widgetKey)) {
                PromptAssistant.instances.delete(widget.widgetKey);
            }
            if (widget.container) {
                widget.container.destroy();
            }
            return;
        }

        // 在 inputEl 上添加挂载标记
        if (inputEl) {
            inputEl._promptAssistantMounted = true;
            inputEl._promptAssistantWidgetKey = widget.widgetKey;
        }

        // 确保 dom-widget 容器有相对定位
        const containerPosition = window.getComputedStyle(domWidgetContainer).position;
        if (containerPosition === 'static') {
            domWidgetContainer.style.position = 'relative';
        }

        // 标准模式使用绝对定位
        containerDiv.style.position = 'absolute';



        // 直接添加到dom-widget容器
        domWidgetContainer.appendChild(containerDiv);

        // 触发回流，确保样式更新
        void containerDiv.offsetWidth;

        // 挂载完成后检测并调整滚动条位置
        if (inputEl) {
            requestAnimationFrame(() => this._adjustPositionForScrollbar(widget, inputEl, true));
        }

        logger.debug(`[Litegraph定位] 完成 | 节点ID: ${widget.nodeId} | 锚点: ${widget.container?.anchorPosition}`);
    }

    /**
     * 清理单个实例的资源
     */
    _cleanupInstance(instance, instanceKey, skipRemove = false) {
        try {
            // 检查实例是否有效
            if (!instance) {
                logger.debug(`实例清理 | 结果:跳过 | 实例:${instanceKey || 'unknown'} | 原因:实例不存在`);
                return;
            }

            // 1. 重置所有按钮状态
            if (instance.buttons) {
                Object.keys(instance.buttons).forEach(buttonId => {
                    try {
                        const button = instance.buttons[buttonId];
                        if (button) {
                            // 移除所有状态类
                            button.classList.remove('button-active', 'button-processing', 'button-disabled');
                            // 移除所有事件监听器
                            button.replaceWith(button.cloneNode(true));
                        }
                    } catch (err) {
                        logger.debug(`按钮清理 | 按钮:${buttonId} | 错误:${err.message}`);
                    }
                });
                // 清空按钮引用
                instance.buttons = {};
            }

            // 2. 清理事件监听器
            if (instance.cleanupListeners && typeof instance.cleanupListeners === 'function') {
                try {
                    instance.cleanupListeners();
                } catch (err) {
                    logger.debug(`监听器清理 | 错误:${err.message}`);
                }
            }

            // 3. 清理所有保存的事件清理函数
            if (instance._eventCleanupFunctions && Array.isArray(instance._eventCleanupFunctions)) {
                instance._eventCleanupFunctions.forEach(cleanup => {
                    if (typeof cleanup === 'function') {
                        try {
                            cleanup();
                        } catch (err) {
                            logger.debug(`事件清理 | 错误:${err.message}`);
                        }
                    }
                });
                instance._eventCleanupFunctions = [];
            }

            // 3.5【关键修复】重置 inputEl 上的事件绑定标记
            // 确保模式切换后可以重新绑定事件
            if (instance.inputEl && instance.inputEl._promptAssistantBound) {
                instance.inputEl._promptAssistantBound = false;
                logger.debug(`重置绑定标记 | 节点ID: ${instance.nodeId || instanceKey}`);
            }
            if (instance.text_element && instance.text_element._promptAssistantBound) {
                instance.text_element._promptAssistantBound = false;
            }

            // 3.6【防重复挂载修复】重置 textarea 上的挂载标记
            // 确保清理后可以重新挂载小助手
            if (instance.inputEl && instance.inputEl._promptAssistantMounted) {
                instance.inputEl._promptAssistantMounted = false;
                delete instance.inputEl._promptAssistantWidgetKey;
                logger.debug(`重置挂载标记 | 节点ID: ${instance.nodeId || instanceKey}`);
            }
            if (instance.text_element && instance.text_element._promptAssistantMounted && instance.text_element !== instance.inputEl) {
                instance.text_element._promptAssistantMounted = false;
                delete instance.text_element._promptAssistantWidgetKey;
            }

            // 同时重置 widget 级别的标记
            instance._undoStateInitialized = false;
            instance._inputEventsBound = false; // 重置输入事件绑定标记


            // 4. 从DOM中移除元素
            if (instance.element) {
                try {
                    // 确保在移除元素前清理所有子元素的事件
                    const allButtons = instance.element.querySelectorAll('button');
                    allButtons.forEach(button => {
                        button.replaceWith(button.cloneNode(true));
                    });

                    // 清理指示器元素
                    if (instance.indicator && instance.indicator.parentNode) {
                        instance.indicator.innerHTML = '';
                    }

                    if (instance.element.parentNode) {
                        instance.element.parentNode.removeChild(instance.element);
                    }
                } catch (err) {
                    logger.debug(`DOM元素清理 | 错误:${err.message}`);
                }
            }

            // 5. 清理输入框映射
            if (window.PromptAssistantInputWidgetMap && instanceKey) {
                try {
                    delete window.PromptAssistantInputWidgetMap[instanceKey];
                } catch (err) {
                    logger.debug(`输入框映射清理 | 错误:${err.message}`);
                }
            }

            // 6. 清理弹窗状态
            if (window.FEATURES && window.FEATURES.updateButtonsVisibility) {
                try {
                    window.FEATURES.updateButtonsVisibility();
                } catch (err) {
                    logger.debug(`按钮可见性更新 | 错误:${err.message}`);
                }
            }

            // 7. 从实例集合中移除（除非明确指定跳过）
            if (!skipRemove && instanceKey) {
                try {
                    PromptAssistant.instances.delete(instanceKey);
                } catch (err) {
                    logger.debug(`实例集合清理 | 错误:${err.message}`);
                }
            }

            // 8. 清理实例属性
            try {
                Object.keys(instance).forEach(key => {
                    try {
                        delete instance[key];
                    } catch (err) {
                        logger.debug(`属性清理 | 属性:${key} | 错误:${err.message}`);
                    }
                });
            } catch (err) {
                logger.debug(`属性清理 | 错误:${err.message}`);
            }

            logger.debug(`实例清理 | 结果:成功 | 实例:${instanceKey || 'unknown'}`);
        } catch (error) {
            logger.error(`实例清理失败 | 实例:${instanceKey || 'unknown'} | 错误:${error.message}`);
        }
    }

    /**
     * 设置按钮右键菜单
     * @param {HTMLElement} button 按钮元素
     * @param {Function} getMenuItems 获取菜单项的函数
     * @param {Object} widget 小助手实例
     */
    _setupButtonContextMenu(button, getMenuItems, widget) {
        if (!button || typeof getMenuItems !== 'function') return;

        // 设置右键菜单
        const cleanup = buttonMenu.setupButtonMenu(button, () => {
            // 调用getMenuItems函数获取菜单项，传入widget作为上下文
            return getMenuItems(widget);
        }, { widget, buttonElement: button });

        // 保存清理函数到widget的事件清理函数列表中
        if (cleanup) {
            widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
            widget._eventCleanupFunctions.push(cleanup);
        }
    }
}

// 创建单例实例
const promptAssistant = new PromptAssistant();

// 导出
export { promptAssistant, PromptAssistant };
