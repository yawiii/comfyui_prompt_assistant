/**
 * 提示词小助手核心类
 * 统一管理小助手的生命周期、实例创建、UI交互等功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { FEATURES } from "../config/features.js";
import { HistoryManager } from "./history.js";
import { TagManager } from "./tag.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG, CacheService } from "../services/cache.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { PromptFormatter } from "../utils/promptFormatter.js";
import { APIService } from "../services/api.js";

// ====================== 工具函数 ======================

/**
 * 生成唯一请求ID
 */
function generateRequestId(prefix = 'baidu_trans', type = null) {
    // 如果提供了type，根据type确定前缀
    if (type) {
        switch (type) {
            case 'llm':
                prefix = 'llm_trans';
                break;
            case 'baidu':
                prefix = 'baidu_trans';
                break;
            case 'expand':
                prefix = 'glm4_expand';
                break;
            default:
                // 保持传入的prefix不变
                break;
        }
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 6);
    return `${prefix}_${timestamp}_${random}`;
}

/**
 * 防抖函数
 * 限制函数调用频率，避免频繁触发导致性能问题
 */
function debounce(func, wait = 100) {
    return EventManager.debounce(func, wait);
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

            // 检查总开关的初始状态
            const initialEnabled = app.ui.settings.getSettingValue("PromptAssistant.Features.Enabled");
            window.FEATURES.enabled = initialEnabled !== undefined ? initialEnabled : true;

            // 记录总开关状态
            logger.log(`总开关状态 | 状态:${window.FEATURES.enabled ? "启用" : "禁用"}`);

            // 迁移旧的缓存数据到新的键名格式
            CacheService.migrateCache();

            // 初始化资源管理器
            ResourceManager.init();

            // 只有在总开关打开时才做完整初始化
            if (window.FEATURES.enabled) {
                // 注册全局鼠标监听
                this.registerGlobalMouseListener();
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

        logger.log(`总开关 | 动作:${enable ? "启用" : "禁用"}`);

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

                // 3. 注册全局鼠标监听
                await this.registerGlobalMouseListener();

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

                // 3. 移除全局鼠标监听
                this.removeGlobalMouseListener();
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
                        const remainingTags = Object.keys(localStorage)
                            .filter(key => key.startsWith(CACHE_CONFIG.TAG_KEY_PREFIX))
                            .reduce((total, key) => {
                                try {
                                    const cacheData = JSON.parse(localStorage.getItem(key));
                                    return total + (cacheData ? Object.keys(cacheData).length : 0);
                                } catch (e) {
                                    return total;
                                }
                            }, 0);
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

                // 统计并清理所有标签缓存和实例
                for (const [key, instance] of PromptAssistant.instances) {
                    if (instance && instance.nodeId && instance.inputId) {
                        const tags = TagCacheService.getAllRawTags(instance.nodeId, instance.inputId);
                        totalTagCount += tags ? tags.length : 0;
                        TagCacheService.clearCache(instance.nodeId, instance.inputId);
                        allInstanceNames.push(instance.inputId);
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

    // ---实例管理功能---
    /**
     * 检查节点是否有效
     */
    static isValidNode(node) {
        return node &&
            typeof node.id !== 'undefined' &&
            node.id !== -1 &&  // 防止id为-1的无效节点
            node.widgets &&    // 确保有widgets属性
            typeof node.type === 'string'; // 确保有类型
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
        // 始终首先检查总开关状态
        if (!window.FEATURES.enabled || !PromptAssistant.isValidNode(node) || (node.flags && node.flags.collapsed)) {
            return;
        }

        // 查找有效的文本输入控件
        const validInputs = [];
        if (node.widgets) {
            node.widgets.forEach(widget => {
                // 不再直接设置 node 引用，因为它现在是只读的
                if (UIToolkit.isValidInput(widget)) {
                    validInputs.push(widget);
                }
            });
        }

        // 如果没有找到有效的文本输入控件，直接返回
        if (validInputs.length === 0) {
            return;
        }

        // 为每个有效控件创建小助手
        validInputs.forEach(inputWidget => {
            const inputId = inputWidget.name || inputWidget.id;
            const assistantKey = `${node.id}_${inputId}`;

            // 检查实例是否已存在
            if (PromptAssistant.hasInstance(assistantKey)) {
                return; // 跳过已存在的实例
            }

            // 再次检查总开关状态，确保在创建过程中没有被禁用
            if (!window.FEATURES.enabled) {
                return;
            }

            // 创建小助手实例
            const assistant = this.setupNodeAssistant(node, inputWidget);
            if (assistant) {
                logger.log(`创建小助手 | 节点:${node.id} | 控件:${inputId} | 实例:${assistantKey}`);
                

            }
        });
    }

    /**
     * 为节点设置小助手
     * 创建小助手实例并初始化显示状态
     */
    setupNodeAssistant(node, inputWidget) {
        // 简化参数检查
        if (!node || !inputWidget) {
            return null;
        }

        try {
            const nodeId = node.id;
            const inputId = inputWidget.name || inputWidget.id || Math.random().toString(36).substring(2, 10);
            const isNoteNode = node.type === "Note";

            // 简化节点信息
            const nodeInfo = {
                nodeType: node.type,
                inputType: inputId,
                isNoteNode: isNoteNode
            };

            // 创建小助手实例
            const assistant = this.createAssistant(
                node,
                inputId,
                isNoteNode ? { ...inputWidget, inputEl: inputWidget.element } : inputWidget, // Note节点特殊处理
                nodeInfo
            );

            if (assistant) {
                // 初始化显示状态
                assistant.isFirstCreate = true;
                this.showAssistantUI(assistant);

                // 设置初始悬停状态，2秒后恢复正常行为
                assistant.isMouseOver = true;
                setTimeout(() => {
                    if (assistant) {
                        assistant.isFirstCreate = false;
                        if (!assistant.isMouseOver) {
                            this.updateAssistantVisibility(assistant);
                        }
                    }
                }, 2000);

                return assistant;
            }

            return null;
        } catch (error) {
            logger.error(`创建小助手 | 结果:异常 | 节点ID: ${node.id}, 错误: ${error.message}`);
            return null;
        }
    }

    /**
     * 创建小助手实例
     * 根据节点和输入控件构建小助手对象并初始化UI
     */
    createAssistant(node, inputId, inputWidget, nodeInfo = {}) {
        // 简化前置检查
        if (!window.FEATURES.enabled || !node || !inputId || !inputWidget || !UIToolkit.isValidInput(inputWidget)) {
            return null;
        }

        // 确保输入元素存在
        const inputEl = inputWidget.inputEl || inputWidget.element;
        if (!inputEl) {
            return null;
        }

        const nodeId = node.id;
        const widgetKey = `${nodeId}_${inputId}`;

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
            text_element: inputEl,
            inputEl: inputEl, // 直接添加inputEl引用，方便历史记录回写
            // 不再直接设置 node 引用，而是保存 nodeId
            nodeInfo: {
                ...nodeInfo,
                nodeId: node.id,
                nodeType: node.type
            },
            isMouseOver: false, // 鼠标悬停状态
            isFirstCreate: false, // 首次创建标记
            isTransitioning: false // 添加状态标记，避免频繁切换
        };

        // 创建全局输入框映射（如果不存在）
        if (!window.PromptAssistantInputWidgetMap) {
            window.PromptAssistantInputWidgetMap = {};
        }

        // 将当前输入框添加到映射
        window.PromptAssistantInputWidgetMap[widgetKey] = {
            inputEl: inputEl,
            widget: widget
        };

        logger.debug(`输入框映射 | 添加映射 | 键:${widgetKey}`);

        // 创建UI并添加到实例集合
        this.createAssistantUI(widget, inputWidget);
        PromptAssistant.addInstance(widgetKey, widget);

        // 初始化撤销状态
        HistoryCacheService.initUndoState(nodeId, inputId, inputEl.value);
        // 初始化时立即更新撤销/重做按钮状态
        UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

        // 绑定输入框失焦事件，写入历史
        if (inputWidget.inputEl) {
            // 使用事件管理器添加DOM事件监听
            const removeBlurListener = EventManager.addDOMListener(inputWidget.inputEl, 'blur', async () => {
                logger.debug(`历史写入准备｜ 原因：失焦事件触发 node_id=${node.id} input_id=${inputId}`);
                HistoryCacheService.addHistory({
                    workflow_id: nodeInfo?.workflow_id || '',
                    node_id: node.id,
                    input_id: inputId,
                    content: inputWidget.inputEl.value,
                    operation_type: 'input',
                    timestamp: Date.now()
                });
                // 重置撤销状态
                HistoryCacheService.initUndoState(node.id, inputId, inputWidget.inputEl.value);
                // 更新按钮状态
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                logger.debug(`历史写入完成｜原因：输入框失焦 node_id=${node.id} input_id=${inputId}`);
            });

            // 保存清理函数引用，以便后续清理
            widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
            widget._eventCleanupFunctions.push(removeBlurListener);

            // 添加输入事件监听，实时更新撤销/重做按钮状态
            const removeInputListener = EventManager.addDOMListener(inputWidget.inputEl, 'input', () => {
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
            });
            widget._eventCleanupFunctions.push(removeInputListener);
        }

        return widget;
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
            // 获取DOM相关信息
            const inputEl = inputWidget.inputEl;
            const graphCanvasContainer = document.querySelector('.graphcanvas');
            const canvasContainerRect = graphCanvasContainer?.getBoundingClientRect();

            // 创建内部内容容器（分离视觉效果）
            const innerContentDiv = document.createElement('div');
            innerContentDiv.className = 'prompt-assistant-inner';

            // 创建主容器 - 简化样式，减少触发栅格化的属性
            const containerDiv = document.createElement('div');
            containerDiv.className = 'prompt-assistant-container';
            containerDiv.dataset.nodeId = nodeId;
            containerDiv.dataset.inputId = inputId;

            // 添加内容容器到主容器
            containerDiv.appendChild(innerContentDiv);

            // 保存引用并初始化
            widget.element = containerDiv;
            widget.innerContent = innerContentDiv;
            widget.buttons = {};

            // 初始化UI组件和事件
            this.addFunctionButtons(widget);
            this._setupUIEventHandling(widget, inputEl, containerDiv);
            this._setupUIPosition(widget, inputEl, containerDiv, canvasContainerRect);

            // 默认隐藏状态
            containerDiv.style.display = 'none';

            logger.log(`UI创建 | 结果:完成 | 节点ID: ${nodeId}`);
            return containerDiv;
        } catch (error) {
            logger.error(`UI创建 | 结果:异常 | 节点ID: ${nodeId}, 错误: ${error.message}`);
            return null;
        }
    }

    /**
     * 显示小助手UI
     * 控制UI显示动画和状态
     */
    showAssistantUI(widget, forceAnimation = false) {
        if (!widget?.element) return;

        // 避免重复显示和不必要的动画
        const isCurrentlyShown = widget.element.classList.contains('assistant-show');
        if (isCurrentlyShown && !forceAnimation) {
            // 如果已经显示且不需要强制动画，则仅确保显示状态
            widget.element.style.display = 'flex';
            widget.element.style.opacity = '1';
            return;
        }

        // 取消任何隐藏计时器
        if (widget.hideTimeout) {
            clearTimeout(widget.hideTimeout);
            widget.hideTimeout = null;
        }

        // 设置过渡状态
        widget.isTransitioning = true;

        // 优化渲染性能
        widget.element.style.willChange = 'auto';
        widget.element.style.transform = 'translateZ(0)';
        widget.element.style.opacity = '1';

        // 显示元素并应用动画类
        widget.element.style.display = 'flex';
        void widget.element.offsetWidth; // 触发回流，确保动画生效
        widget.element.classList.remove('assistant-hide');
        widget.element.classList.add('assistant-show');

        // 动画结束后重置过渡状态
        setTimeout(() => {
            widget.isTransitioning = false;
            // 动画结束后检查鼠标状态
            setTimeout(() => this.forceUpdateMouseState(widget), 10);
        }, 300); // 与CSS动画时长匹配
    }

    /**
     * 隐藏小助手UI
     * 控制UI隐藏动画和状态
     */
    hideAssistantUI(widget) {
        if (!widget?.element) return;

        // 避免重复隐藏
        if (!widget.element.classList.contains('assistant-show')) return;

        // 设置过渡状态
        widget.isTransitioning = true;

        // 应用隐藏动画类
        widget.element.classList.add('assistant-hide');
        widget.element.classList.remove('assistant-show');

        // 触发回流确保动画生效
        void widget.element.offsetWidth;

        // 动画结束后隐藏元素
        widget.hideTimeout = setTimeout(() => {
            if (widget.element) {
                widget.element.style.display = 'none';
            }

            // 重置过渡状态
            widget.isTransitioning = false;

            // 动画结束后检查鼠标状态
            setTimeout(() => this.forceUpdateMouseState(widget), 10);
        }, 300); // 与CSS动画时长匹配
    }

    /**
     * 更新小助手可见性
     * 根据鼠标悬停和首次创建状态决定是否显示
     */
    updateAssistantVisibility(widget) {
        if (!widget) return;

        // 总开关关闭时不处理可见性更新
        if (!window.FEATURES || !window.FEATURES.enabled) {
            return;
        }

        // 检查是否有按钮处于激活或处理中状态
        const hasActiveButtons = this._checkAssistantActiveState(widget);

        // 如果有激活的按钮，强制显示小助手（带动画）
        if (hasActiveButtons) {
            this.showAssistantUI(widget, true);
            return;
        }

        const isMouseOver = widget.isMouseOver === true;
        const isFirstCreate = widget.isFirstCreate === true;

        // 显示条件：首次创建或鼠标悬停
        const shouldShow = isFirstCreate || isMouseOver;
        const isCurrentlyShown = widget.element?.classList.contains('assistant-show');

        // 仅在状态需变化时更新
        if (shouldShow !== isCurrentlyShown) {
            const reason = isFirstCreate ? "首次创建" : (isMouseOver ? "鼠标悬停" : "鼠标离开");

            if (shouldShow) {
                // 首次创建时使用动画，鼠标悬停时不使用动画
                this.showAssistantUI(widget, isFirstCreate);
                logger.debug(`UI显示 | 节点:${widget.nodeId} | 原因:${reason}`);
            } else {
                this.hideAssistantUI(widget);
                logger.debug(`UI隐藏 | 节点:${widget.nodeId} | 原因:${reason}`);
            }
        }
    }

    /**
     * 检查小助手是否有按钮处于激活状态
     */
    _checkAssistantActiveState(widget) {
        if (!widget || !widget.buttons) return false;

        // 首先检查中央按钮状态管理器是否有该widget的激活按钮
        const activeButtonInfo = UIToolkit.getActiveButtonInfo();
        if (activeButtonInfo && activeButtonInfo.widget === widget) {
            return true;
        }

        // 再遍历所有按钮，检查是否有按钮处于active或processing状态
        for (const buttonId in widget.buttons) {
            const button = widget.buttons[buttonId];
            if (button.classList.contains('button-active') ||
                button.classList.contains('button-processing')) {
                return true;
            }
        }

        return false;
    }

    /**
     * 更新所有实例的可见性
     * 在按钮状态变化时调用
     */
    updateAllInstancesVisibility() {
        PromptAssistant.instances.forEach(widget => {
            if (!widget.isTransitioning) {
                this.updateAssistantVisibility(widget);
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
     * 配置鼠标悬停相关的事件监听 - 简化版本
     */
    _setupUIEventHandling(widget, inputEl, containerDiv) {
        // 设置容器的事件穿透
        containerDiv.style.pointerEvents = 'none';
        widget.innerContent.style.pointerEvents = 'auto'; // 确保内容容器可以接收事件

        // 确保所有按钮可点击
        const buttons = containerDiv.querySelectorAll('button');
        buttons.forEach(button => {
            button.style.pointerEvents = 'auto';
            button.classList.add('prompt-assistant-button-active');
        });

        // 初始化过渡状态标记
        widget.isTransitioning = false;

        // 使用清理函数数组存储所有事件清理函数
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // 添加清理函数
        widget.cleanupListeners = () => {
            // 执行所有保存的清理函数
            if (widget._eventCleanupFunctions && widget._eventCleanupFunctions.length) {
                widget._eventCleanupFunctions.forEach(cleanupFn => {
                    if (typeof cleanupFn === 'function') {
                        cleanupFn();
                    }
                });
                widget._eventCleanupFunctions = [];
            }
        };
    }

    /**
     * 判断鼠标是否在元素上方
     */
    isMouseOverElement(element) {
        if (!element) return false;

        try {
            // 直接使用计算而非委托给EventManager，减少一层调用
            const mousePos = EventManager.getMousePosition();
            const rect = element.getBoundingClientRect();

            return (
                mousePos.x >= rect.left &&
                mousePos.x <= rect.right &&
                mousePos.y >= rect.top &&
                mousePos.y <= rect.bottom
            );
        } catch (error) {
            logger.error(`鼠标位置检测失败 | 错误: ${error.message}`);
            return false;
        }
    }

    /**
     * 强制更新鼠标悬停状态
     */
    forceUpdateMouseState(widget) {
        if (!widget || !widget.node || !widget.text_element || !widget.element) return;

        // 总开关关闭时不处理鼠标状态更新
        if (!window.FEATURES || !window.FEATURES.enabled) {
            return;
        }

        // 使用直接检测方法检查鼠标是否在元素上方
        const isOverInput = this.isMouseOverElement(widget.text_element);
        const isOverContainer = widget.element.style.display !== 'none' &&
            this.isMouseOverElement(widget.element);

        // 更新状态
        const oldState = widget.isMouseOver;
        widget.isMouseOver = isOverInput || isOverContainer;

        // 如果状态变化，更新可见性
        if (oldState !== widget.isMouseOver) {
            logger.debug(`鼠标状态 | 手动更新 | 节点:${widget.nodeId} | 原状态:${oldState} | 新状态:${widget.isMouseOver}`);
            this.updateAssistantVisibility(widget);
        }

        return widget.isMouseOver;
    }

    // ---鼠标监听功能---
    /**
     * 判断全局鼠标监听器是否已注册
     */
    isGlobalMouseListenerRegistered() {
        try {
            return EventManager.listeners.has('global_mouse_move') &&
                EventManager.listeners.get('global_mouse_move').has('assistant_manager');
        } catch (error) {
            logger.error(`鼠标监听器状态检查失败 | 错误: ${error.message}`);
            return false;
        }
    }

    /**
     * 注册全局鼠标移动事件监听
     */
    async registerGlobalMouseListener() {
        try {
            // 确保EventManager已初始化
            EventManager.init();

            // 检查是否已注册，避免重复
            if (this.isGlobalMouseListenerRegistered()) {
                return true;
            }

            // 创建去抖动的全局监听函数
            const debouncedListener = EventManager.debounce((e) => {
                // 检查总开关状态，如果总开关已关闭，则不处理
                if (!window.FEATURES || !window.FEATURES.enabled) {
                    return;
                }

                try {
                    // 获取当前实例数量
                    const instanceCount = PromptAssistant.instances.size;
                    if (instanceCount === 0) return;

                    // 遍历所有实例，更新鼠标状态
                    PromptAssistant.instances.forEach(widget => {
                        // 跳过正在过渡的实例
                        if (widget.isTransitioning) return;

                        // 检查鼠标是否在实例上
                        const isOver = this.isMouseOverElement(widget.text_element) ||
                            (widget.element?.style.display !== 'none' && this.isMouseOverElement(widget.element));

                        // 如果状态变化，更新可见性
                        if (widget.isMouseOver !== isOver) {
                            widget.isMouseOver = isOver;
                            this.updateAssistantVisibility(widget);
                        }
                    });
                } catch (error) {
                    logger.error(`鼠标处理异常 | 错误: ${error.message}`);
                }
            }, 50);

            // 注册全局鼠标移动事件监听器
            EventManager.on('global_mouse_move', 'assistant_manager', debouncedListener);

            return true;
        } catch (error) {
            logger.error(`全局鼠标监听注册失败 | 错误: ${error.message}`);
            return false;
        }
    }

    /**
     * 移除全局鼠标移动事件监听
     */
    removeGlobalMouseListener() {
        try {
            // 检查是否已注册，未注册则不需要移除
            if (!this.isGlobalMouseListenerRegistered()) {
                return true;
            }

            // 移除事件监听器
            EventManager.off('global_mouse_move', 'assistant_manager');
            return true;
        } catch (error) {
            logger.error(`全局鼠标监听移除失败 | 错误: ${error.message}`);
            return false;
        }
    }

    // ---辅助功能---
    /**
     * 更新输入框内容并添加高亮效果
     */
    updateInputWithHighlight(widget, content) {
        if (!widget?.inputEl) return;

        try {
            // 更新输入框内容
            widget.inputEl.value = content;

            // 触发输入事件
            widget.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            widget.inputEl.dispatchEvent(new Event('change', { bubbles: true }));

            // 添加高亮效果
            widget.inputEl.classList.add('input-highlight');
            // 动画结束后移除类
            setTimeout(() => {
                widget.inputEl.classList.remove('input-highlight');
            }, 200); // 与 CSS 动画时长匹配

            logger.debug(`输入框更新 | 结果:成功 | 内容长度:${content.length}`);
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

        // 检查是否是Note节点
        const isNoteNode = widget.nodeInfo && widget.nodeInfo.isNoteNode === true;

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
                visible: !isNoteNode // Note节点不显示分割线
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
                title: '扩写',
                icon: 'icon-expand',
                onClick: async (e, widget) => {
                    logger.debug('按钮点击 | 动作: 扩写');

                    // 如果按钮处于 processing 状态且被点击，显示"扩写中"提示并直接返回
                    if (e.currentTarget.classList.contains('button-processing')) {
                        const btnRect = e.currentTarget.getBoundingClientRect();
                        UIToolkit.showStatusTip(
                            e.currentTarget,
                            'loading',
                            '扩写中',
                            { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                        );
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'expand',
                        e.currentTarget,
                        async () => {
                            try {
                                // 获取输入值
                                const inputValue = widget.inputEl.value;
                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('请输入要扩写的内容');
                                }

                                // 生成唯一request_id
                                const request_id = generateRequestId('glm4_expand');

                                // 显示扩写中提示
                                const btnRect = e.currentTarget.getBoundingClientRect();
                                UIToolkit.showStatusTip(
                                    e.currentTarget,
                                    'loading',
                                    '扩写中',
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
                                        tipMessage: '扩写完成'
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
                visible: !isNoteNode && FEATURES.expand // Note节点不显示此按钮
            },
            {
                id: 'translate',
                title: '翻译',
                icon: 'icon-translate',
                onClick: async (e, widget) => {
                    logger.debug('按钮点击 | 动作: 翻译');

                    // 如果按钮处于 processing 状态且被点击，显示"翻译中"提示并直接返回
                    if (e.currentTarget.classList.contains('button-processing')) {
                        const btnRect = e.currentTarget.getBoundingClientRect();
                        UIToolkit.showStatusTip(
                            e.currentTarget,
                            'loading',
                            '翻译中',
                            { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                        );
                        return;
                    }

                    await UIToolkit.handleAsyncButtonOperation(
                        widget,
                        'translate',
                        e.currentTarget,
                        async () => {
                            try {
                                // 获取输入值
                                const inputValue = widget.inputEl.value;
                                if (!inputValue || inputValue.trim() === '') {
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

                                // 首先查询翻译缓存
                                const cacheResult = TranslateCacheService.queryTranslateCache(inputValue);

                                // 缓存命中情况处理
                                if (cacheResult) {
                                    let resultText = '';
                                    let tipMessage = '';
                                    let useCache = true;

                                    // 根据缓存匹配类型处理
                                    if (cacheResult.type === 'source') {
                                        // 命中原文，返回译文
                                        resultText = cacheResult.translatedText;
                                        tipMessage = '译文';
                                    } else if (cacheResult.type === 'translated') {
                                        // 命中译文，返回原文
                                        resultText = cacheResult.sourceText;
                                        tipMessage = '原文';
                                    }

                                    // 更新输入框内容并添加高亮效果
                                    this.updateInputWithHighlight(widget, resultText);

                                    // 添加翻译结果到历史记录
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: resultText,
                                        operation_type: 'translate',
                                        timestamp: Date.now()
                                    });

                                    // 重置撤销状态
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, resultText);

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
                                // 获取翻译类型
                                const translateType = localStorage.getItem("PromptAssistant_Settings_translate_type") || "baidu";

                                // 生成唯一request_id，根据翻译类型生成对应的前缀
                                const request_id = generateRequestId(null, translateType);

                                // 检测语言
                                const langResult = PromptFormatter.detectLanguage(inputValue);

                                // 根据翻译类型选择服务
                                let result;
                                try {
                                    if (translateType === "baidu") {
                                        // 使用百度翻译服务
                                        result = await APIService.baiduTranslate(
                                            inputValue,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    } else {
                                        // 使用LLM翻译服务
                                        result = await APIService.llmTranslate(
                                            inputValue,
                                            langResult.from,
                                            langResult.to,
                                            request_id
                                        );
                                    }

                                    if (!result) {
                                        throw new Error('翻译服务返回空结果');
                                    }
                                } catch (error) {
                                    logger.error(`翻译失败 | 服务:${translateType} | 错误:${error.message}`);
                                    throw new Error(`翻译失败: ${error.message}`);
                                }

                                if (result.success) {
                                    // 格式化翻译结果（转换标点符号）
                                    const formattedText = PromptFormatter.formatTranslatedText(result.data.translated);

                                    // 添加翻译结果到历史记录
                                    HistoryCacheService.addHistory({
                                        workflow_id: widget.nodeInfo?.workflow_id || '',
                                        node_id: widget.nodeId,
                                        input_id: widget.inputId,
                                        content: formattedText,
                                        operation_type: 'translate',
                                        request_id: request_id,
                                        timestamp: Date.now()
                                    });

                                    // 更新输入框内容并添加高亮效果
                                    this.updateInputWithHighlight(widget, formattedText);

                                    // 重置撤销状态
                                    HistoryCacheService.initUndoState(widget.nodeId, widget.inputId, formattedText);

                                    // 更新按钮状态
                                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);

                                    // 添加到翻译缓存
                                    TranslateCacheService.addTranslateCache(inputValue, formattedText);

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
                visible: FEATURES.translate // Note节点只显示此按钮
            },
        ];

        // 记录添加的按钮
        let historyButtons = [];
        let otherButtons = [];
        let divider = null;

        // ---使用for...of循环支持异步操作---
        for (const config of buttonConfigs) {
            if (config.type === 'divider') {
                // 创建分割线但暂不添加
                divider = document.createElement('div');
                divider.className = 'prompt-assistant-divider';
                divider.dataset.id = config.id || `divider_${Date.now()}`;
                // 保存引用
                if (config.id) {
                    widget.buttons[config.id] = divider;
                }
                continue;
            }

            // 检查按钮是否可见
            if (config.visible === false) {
                // 区分节点类型和功能禁用的情况
                const reason = (widget.nodeInfo?.isNoteNode && config.id !== 'translate') ? "Note节点限制" : "功能禁用";
                // logger.debug(`按钮跳过 | 按钮: ${config.id || 'unknown'} | 原因: ${reason}`);
                continue;
            }

            // ---异步创建按钮---
            const button = this.addButtonWithIcon(widget, config);
            if (!button) continue;

            // 设置初始状态
            if (config.initialState) {
                Object.entries(config.initialState).forEach(([stateType, value]) => {
                    UIToolkit.setButtonState(widget, config.id, stateType, value);
                });
            }



            // 根据按钮类型分组
            if (['history', 'undo', 'redo'].includes(config.id)) {
                historyButtons.push(button);
            } else {
                otherButtons.push(button);
            }
        }

        // 添加按钮到DOM，并在需要时添加分割线
        let addedButtonCount = 0;

        // 添加历史相关按钮
        historyButtons.forEach(button => {
            widget.innerContent.appendChild(button);
            addedButtonCount++;
        });

        // 如果两种类型的按钮都存在，添加分割线
        if (historyButtons.length > 0 && otherButtons.length > 0 && divider) {
            widget.innerContent.appendChild(divider);
        }

        // 添加其他按钮
        otherButtons.forEach(button => {
            widget.innerContent.appendChild(button);
            addedButtonCount++;
        });

        // 判断节点类型并记录日志
        if (widget.nodeInfo?.isNoteNode) {
            logger.debug(`按钮添加 | 结果:完成 | 节点ID: ${widget.nodeId} | Note节点: 仅显示翻译按钮 | 添加数量: ${addedButtonCount}`);
        } else {
            logger.debug(`按钮添加 | 结果:完成 | 节点ID: ${widget.nodeId} | 标准节点 | 添加数量: ${addedButtonCount}`);
        }
    }

    /**
     * 添加带图标的按钮
     */
    addButtonWithIcon(widget, config) {
        if (!widget?.element || !widget?.innerContent) return null;

        const { id, title, icon, onClick } = config;

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

        // 保存引用
        if (id) {
            widget.buttons[id] = button;
        }

        return button;
    }



    /**
     * 设置UI位置
     * 使用绝对定位方式
     */
    _setupUIPosition(widget, inputEl, containerDiv, canvasContainerRect) {
        // 查找dom-widget父容器（ComfyUI 0.3.27及以上版本的标准容器）
        const findDomWidgetContainer = () => {
            let domWidgetContainer = null;
            // 向上查找dom-widget容器
            let parent = inputEl.parentElement;
            while (parent) {
                if (parent.classList && parent.classList.contains('dom-widget')) {
                    domWidgetContainer = parent;
                    break;
                }
                parent = parent.parentElement;
            }
            return domWidgetContainer;
        };

        // 初始查找dom-widget容器
        let domWidgetContainer = findDomWidgetContainer();
        
        // 清理函数列表
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];
        
        // 检查是否需要使用兼容模式
        let needCompatibilityMode = !domWidgetContainer;
        
        // 如果初次判断需要使用兼容模式，添加延迟重试机制
        // 这是为了处理新创建节点时DOM可能尚未完全渲染的情况
        if (needCompatibilityMode) {
            // 先创建一个临时容器，避免显示延迟
            const tempDiv = document.createElement('div');
            tempDiv.className = 'prompt-assistant-container prompt-assistant-temp';
            tempDiv.style.display = 'none';
            document.body.appendChild(tempDiv);
            
            // 保存临时容器引用，以便后续移除
            widget._tempContainer = tempDiv;
            
            // 设置重试次数和间隔
            const maxRetries = 2;
            const retryInterval = 100; // 毫秒
            let retryCount = 0;
            
            // 创建重试函数
            const retrySetupPosition = () => {
                // 重新查找dom-widget容器
                domWidgetContainer = findDomWidgetContainer();
                
                if (domWidgetContainer) {
                    // 找到了dom-widget容器，使用标准定位方案
                    logger.log("定位方式 - 延迟检测后使用标准方案");
                    needCompatibilityMode = false;
                    
                    // 移除临时容器
                    if (widget._tempContainer && document.body.contains(widget._tempContainer)) {
                        document.body.removeChild(widget._tempContainer);
                        delete widget._tempContainer;
                    }
                    
                    // 使用标准定位方案
                    containerDiv.style.right = '6px';
                    containerDiv.style.bottom = '8px';
                    
                    // 直接添加到dom-widget容器
                    domWidgetContainer.appendChild(containerDiv);
                    
                    // 触发回流，确保样式更新
                    void containerDiv.offsetWidth;
                    
                    // 强制应用容器高度
                    containerDiv.style.height = '20px';
                    containerDiv.style.minHeight = '20px';
                    void containerDiv.offsetWidth;
                    
                    return true;
                } else if (retryCount < maxRetries) {
                    // 继续重试
                    retryCount++;
                    logger.debug(`定位方式 - 重试查找dom-widget容器 (${retryCount}/${maxRetries})`);
                    setTimeout(retrySetupPosition, retryInterval);
                    return false;
                } else {
                    // 达到最大重试次数，使用兼容定位方案
                    logger.log("定位方式 - 重试失败，使用兼容方案");
                    
                    // 移除临时容器
                    if (widget._tempContainer && document.body.contains(widget._tempContainer)) {
                        document.body.removeChild(widget._tempContainer);
                        delete widget._tempContainer;
                    }
                    
                    // 使用兼容定位方案
                    setupCompatibilityMode();
                    return true;
                }
            };
            
            // 定义兼容模式设置函数
            const setupCompatibilityMode = () => {
                // === 兼容方案定位 (ComfyUI 0.3.26及以下) ===
                logger.log("定位方式 - 兼容方案");

                // 使用固定定位样式，不添加额外类
                containerDiv.style.position = 'fixed';
                containerDiv.style.zIndex = '9999';
                document.body.appendChild(containerDiv);

                // 设置初始显示
                containerDiv.style.display = 'flex';

                // 更新位置的函数，确保跟随输入框并位于右下角
                const updatePosition = () => {
                    if (!widget.element || !inputEl || !containerDiv) return;

                    try {
                        // 获取输入框的位置信息
                        const inputRect = inputEl.getBoundingClientRect();

                        // 设置容器样式 - 首先确保容器可见以便获得正确的尺寸
                        containerDiv.style.display = 'flex';
                        containerDiv.style.visibility = 'hidden'; // 暂时隐藏以避免闪烁

                        // 先设置样式，使其能正确计算尺寸
                        Object.assign(containerDiv.style, {
                            width: 'auto',
                            height: '24px',
                            pointerEvents: 'none'
                        });

                        // 确保小部件样式正确
                        Object.assign(widget.element.style, {
                            transformOrigin: 'right center',
                            margin: '0',
                            pointerEvents: 'auto'
                        });

                        // 强制回流以获取正确尺寸
                        void containerDiv.offsetWidth;

                        // 现在设置位置 - 放置在输入框右下角
                        const offsetRight = 12; // 右侧偏移
                        const offsetBottom = 8;

                        containerDiv.style.left = `${inputRect.right - containerDiv.offsetWidth - offsetRight}px`;
                        containerDiv.style.top = `${inputRect.bottom - containerDiv.offsetHeight - offsetBottom}px`;
                        containerDiv.style.visibility = 'visible'; // 恢复可见性

                        // 最终触发回流，确保样式更新
                        void containerDiv.offsetWidth;
                    } catch (error) {
                        logger.error("更新小助手位置出错:", error);
                        // 错误恢复 - 确保组件仍然可见
                        if (containerDiv) containerDiv.style.visibility = 'visible';
                    }
                };

                // 初始更新位置
                updatePosition();

                // 使用防抖函数优化位置更新，但降低延迟提高流畅度
                const debouncedUpdatePosition = EventManager.debounce(updatePosition, 16);

                // 添加窗口resize事件监听
                const removeResizeListener = EventManager.addDOMListener(window, 'resize', debouncedUpdatePosition);
                widget._eventCleanupFunctions.push(removeResizeListener);

                // 监听画布变化
                const app = window.app || null;

                if (!app || !app.canvas) {
                    logger.error("错误：无法获取app对象，小助手无法正常工作");
                    return;
                }

                // 1. 使用MutationObserver监听画布变化
                const observer = new MutationObserver(debouncedUpdatePosition);
                const canvasParent = app.canvas.canvas.parentElement;

                if (canvasParent) {
                    observer.observe(canvasParent, {
                        attributes: true,
                        attributeFilter: ['style', 'transform']
                    });

                    // 添加Observer清理函数
                    widget._eventCleanupFunctions.push(() => observer.disconnect());
                }

                // 2. 监听画布重绘 - 使用直接更新而不是防抖版本，确保重绘时位置准确
                const originalDrawBackground = app.canvas.onDrawBackground;
                app.canvas.onDrawBackground = function () {
                    const ret = originalDrawBackground?.apply(this, arguments);
                    // 直接调用updatePosition而不是防抖版本
                    updatePosition();
                    return ret;
                };

                // 添加画布重绘清理函数
                widget._eventCleanupFunctions.push(() => {
                    if (originalDrawBackground) {
                        app.canvas.onDrawBackground = originalDrawBackground;
                    }
                });

                // 3. 监听节点移动 - 使用 nodeInfo 而不是直接的 node 引用
                const nodeId = widget.nodeInfo?.nodeId;
                if (nodeId && app.canvas && app.canvas.graph) {
                    const node = app.canvas.graph.getNodeById(nodeId);
                    if (node) {
                        // 使用LiteGraph提供的onNodeMoved事件
                        const originalOnNodeMoved = app.canvas.onNodeMoved;
                        app.canvas.onNodeMoved = function(node_dragged) {
                            if (originalOnNodeMoved) {
                                originalOnNodeMoved.apply(this, arguments);
                            }
                            
                            // 仅当移动的是当前节点时更新位置
                            if (node_dragged && node_dragged.id === nodeId) {
                                // 直接调用updatePosition而不是防抖版本，确保拖动时UI跟随节点
                                updatePosition();
                            }
                        };
                        
                        // 添加节点移动清理函数
                        widget._eventCleanupFunctions.push(() => {
                            if (app.canvas) {
                                app.canvas.onNodeMoved = originalOnNodeMoved;
                            }
                        });
                        
                        // 为节点本身添加移动监听（兼容性处理）
                        const nodeOriginalOnNodeMoved = node.onNodeMoved;
                        node.onNodeMoved = function() {
                            const ret = nodeOriginalOnNodeMoved?.apply(this, arguments);
                            // 直接调用updatePosition而不是防抖版本
                            updatePosition();
                            return ret;
                        };
                        
                        // 添加节点自身移动清理函数
                        widget._eventCleanupFunctions.push(() => {
                            if (node && nodeOriginalOnNodeMoved) {
                                node.onNodeMoved = nodeOriginalOnNodeMoved;
                            }
                        });
                    }
                }
                
                // 统一的画布事件处理函数
                const handleCanvasEvent = () => {
                    if (widget.element && widget.element.style.display !== 'none') {
                        updatePosition();
                    }
                };

                // 监听画布相关事件
                if (!app || !app.canvas) {
                    logger.error("错误：无法获取app对象，小助手无法正常工作");
                    return;
                }

                // 保存原始方法引用
                const originalMethods = {
                    setDirty: app.canvas.setDirty,
                    drawBackground: app.canvas.onDrawBackground,
                    dsModified: app.canvas.ds.onModified,
                    setTransform: app.canvas.ds.setTransform,
                    resize: app.canvas.resize
                };

                // 1. 监听画布变换（包括缩放、平移等）
                app.canvas.setDirty = function(value, skipEvents) {
                    const ret = originalMethods.setDirty?.apply(this, arguments);
                    if (!skipEvents) {
                        handleCanvasEvent();
                    }
                    return ret;
                };

                // 2. 监听画布重绘和缩放
                app.canvas.onDrawBackground = function () {
                    const ret = originalMethods.drawBackground?.apply(this, arguments);
                    handleCanvasEvent();
                    return ret;
                };

                app.canvas.ds.onModified = function(...args) {
                    if (originalMethods.dsModified) {
                        originalMethods.dsModified.apply(this, args);
                    }
                    handleCanvasEvent();
                };

                app.canvas.ds.setTransform = function() {
                    const ret = originalMethods.setTransform?.apply(this, arguments);
                    handleCanvasEvent();
                    return ret;
                };

                // 3. 监听画布大小变化
                app.canvas.resize = function() {
                    const ret = originalMethods.resize?.apply(this, arguments);
                    handleCanvasEvent();
                    return ret;
                };

                // 4. 使用MutationObserver监听画布容器变化
                const canvasContainer = app.canvas.canvas.parentElement;
                if (canvasContainer) {
                    const observer = new MutationObserver(() => handleCanvasEvent());
                    observer.observe(canvasContainer, {
                        attributes: true,
                        attributeFilter: ['style', 'transform']
                    });
                    widget._eventCleanupFunctions.push(() => observer.disconnect());
                }

                // 5. 使用requestAnimationFrame实现平滑更新
                let rafId = null;
                const smoothUpdate = () => {
                    handleCanvasEvent();
                    rafId = requestAnimationFrame(smoothUpdate);
                };
                rafId = requestAnimationFrame(smoothUpdate);

                // 添加所有清理函数
                widget._eventCleanupFunctions.push(
                    () => {
                        // 清理画布相关事件监听
                        if (app.canvas) {
                            app.canvas.setDirty = originalMethods.setDirty;
                            app.canvas.onDrawBackground = originalMethods.drawBackground;
                            app.canvas.resize = originalMethods.resize;
                        }
                        if (app.canvas?.ds) {
                            app.canvas.ds.onModified = originalMethods.dsModified;
                            app.canvas.ds.setTransform = originalMethods.setTransform;
                        }
                        // 清理requestAnimationFrame
                        if (rafId !== null) {
                            cancelAnimationFrame(rafId);
                        }
                    }
                );

                // 添加DOM元素清理函数
                widget._eventCleanupFunctions.push(() => {
                    // 移除DOM元素
                    if (containerDiv && document.body.contains(containerDiv)) {
                        document.body.removeChild(containerDiv);
                    }
                });
                
                // 强制应用容器高度
                containerDiv.style.height = '20px';
                containerDiv.style.minHeight = '20px';
                void containerDiv.offsetWidth; // 触发回流，确保样式应用
            };
            
            // 开始重试流程
            setTimeout(retrySetupPosition, retryInterval);
        } else {
            // === 标准方案定位 (ComfyUI 0.3.27及以上) ===
            logger.log("定位方式 - 标准方案");

            // 标准模式使用默认的绝对定位，添加位置参数
            containerDiv.style.right = '6px';
            containerDiv.style.bottom = '8px';

            // 直接添加到dom-widget容器，但不修改dom-widget本身
            domWidgetContainer.appendChild(containerDiv);

            // 触发回流，确保样式更新
            void containerDiv.offsetWidth;
            
            // 强制应用容器高度
            containerDiv.style.height = '20px';
            containerDiv.style.minHeight = '20px';
            void containerDiv.offsetWidth; // 触发回流，确保样式应用
        }
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

            // 4. 从DOM中移除元素
            if (instance.element) {
                try {
                    // 确保在移除元素前清理所有子元素的事件
                    const allButtons = instance.element.querySelectorAll('button');
                    allButtons.forEach(button => {
                        button.replaceWith(button.cloneNode(true));
                    });

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
}

// 创建单例实例
const promptAssistant = new PromptAssistant();

// 导出
export { promptAssistant, PromptAssistant };