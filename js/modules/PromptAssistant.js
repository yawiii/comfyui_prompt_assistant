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
// import { CLIP_NODE_TYPES } from "../services/interceptor.js";
import { buttonMenu } from "../services/btnMenu.js";
import { rulesConfigManager } from "./rulesConfigManager.js";

/**
 * 更新指定CLIP编码器节点的自动翻译指示器状态
 * 使用从interceptor.js导入的CLIP_NODE_TYPES，确保UI指示器与实际功能一致
 * @param {boolean} enabled 
 */
/* 
export function updateAutoTranslateIndicators(enabled) {
    if (!app.canvas?.graph) return;

    app.canvas.graph._nodes.forEach(node => {
        // 检查是否为指定的CLIP编码器节点
        const isClipNode = node.type && CLIP_NODE_TYPES.includes(node.type);

        if (isClipNode) {
            // 查找该节点的小助手实例
            const nodeId = node.id;
            if (node.widgets) {
                node.widgets.forEach(widget => {
                    const inputId = widget.name || widget.id;
                    if (inputId) {
                        const assistantKey = `${nodeId}_${inputId}`;
                        const assistantInstance = PromptAssistant.getInstance(assistantKey);

                        // 如果找到小助手实例，更新其样式
                        if (assistantInstance && assistantInstance.element) {
                            assistantInstance.element.classList.toggle('auto-translate-enabled', enabled);
                        }
                    }
                });
            }
        }
    });
}
*/

/**
 * 暂时禁用的自动翻译指示器功能的空占位函数
 * 保持导出以避免其他模块的导入错误
 */
export function updateAutoTranslateIndicators(enabled) {
    // 空实现，不执行任何操作
    logger.debug("自动翻译指示器功能已暂时禁用");
    return;
}

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

            // 记录总开关状态（改为调试级别）
            logger.debug(`初始化时检测总开关状态 | 状态:${window.FEATURES.enabled ? "启用" : "禁用"}`);

            // 初始化资源管理器
            ResourceManager.init();

            // 只有在总开关打开时才做完整初始化
            if (window.FEATURES.enabled) {
                // 更新CLIP节点的指示器状态
                updateAutoTranslateIndicators(window.FEATURES.autoTranslate);
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

            // 如果功能已启用，更新自动翻译指示器状态
            /* 暂时禁用自动翻译指示器
            if (enable) {
                updateAutoTranslateIndicators(window.FEATURES.autoTranslate);
            }
            */
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
        if (!window.FEATURES.enabled || !node || !node.widgets) {
            return;
        }

        // 获取所有有效的输入控件
        const validInputs = node.widgets.filter(widget => {
            return UIToolkit.isValidInput(widget);
        });

        if (validInputs.length === 0) {
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
                if (instance && instance.text_element !== inputWidget.inputEl) {
                    // 如果输入控件已更新，清理旧实例并创建新实例
                    this.cleanup(node.id);
                } else {
                    return; // 跳过已存在且未更新的实例
                }
            }

            // 再次检查总开关状态，确保在创建过程中没有被禁用
            if (!window.FEATURES.enabled) {
                return;
            }

            // 创建小助手实例
            const assistant = this.setupNodeAssistant(node, inputWidget, assistantKey);
            if (assistant) {
                logger.log(`创建小助手 | 节点:${node.id} | 控件:${inputId} | 索引:${widgetIndex} | 实例:${assistantKey}`);

                // 检查是否为指定的CLIP编码器节点，并应用自动翻译样式
                // 使用从interceptor.js导入的CLIP_NODE_TYPES，确保UI指示器与实际功能一致
                // 暂时禁用自动翻译检测
                /* 
                const isClipNode = node.type && CLIP_NODE_TYPES.includes(node.type);

                if (isClipNode && assistant.element) {
                    assistant.element.classList.toggle('auto-translate-enabled', window.FEATURES.autoTranslate);
                }
                */
            }
        });
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
            const isNoteNode = node.type === "Note";

            // 简化节点信息
            const nodeInfo = {
                workflow_id: app.graph?._workflow_id || 'unknown',
                nodeType: node.type,
                inputType: inputId,
                isNoteNode: isNoteNode
            };

            // 创建小助手实例
            const assistant = this.createAssistant(
                node,
                inputId,
                isNoteNode ? { ...inputWidget, inputEl: inputWidget.element } : inputWidget, // Note节点特殊处理
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
            text_element: inputEl,
            inputEl: inputEl, // 直接添加inputEl引用，方便历史记录回写
            // 不再直接设置 node 引用，而是保存 nodeId
            nodeInfo: {
                ...nodeInfo,
                nodeId: node.id,
                nodeType: node.type
            },
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

            // 添加输入事件监听，实时更新撤销/重做按钮状态和位置调整
            const removeInputListener = EventManager.addDOMListener(inputWidget.inputEl, 'input', () => {
                UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                // 检测滚动条状态并调整位置
                this._adjustPositionForScrollbar(widget, inputWidget.inputEl);
            });
            widget._eventCleanupFunctions.push(removeInputListener);

            // 添加ResizeObserver监听输入框尺寸变化
            if (window.ResizeObserver) {
                const resizeObserver = new ResizeObserver(() => {
                    // 延迟执行，确保浏览器完成布局更新
                    setTimeout(() => {
                        this._adjustPositionForScrollbar(widget, inputWidget.inputEl);
                    }, 10);
                });

                resizeObserver.observe(inputWidget.inputEl);

                // 添加清理函数
                widget._eventCleanupFunctions.push(() => {
                    resizeObserver.disconnect();
                });
            } else {
                // 降级方案：监听window resize事件
                const removeResizeListener = EventManager.addDOMListener(window, 'resize',
                    EventManager.debounce(() => {
                        this._adjustPositionForScrollbar(widget, inputWidget.inputEl);
                    }, 100)
                );
                widget._eventCleanupFunctions.push(removeResizeListener);
            }
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
            innerContentDiv.className = 'prompt-assistant-inner prompt-assistant-content-fixed';

            // 创建主容器 - 简化样式，减少触发栅格化的属性
            const containerDiv = document.createElement('div');
            containerDiv.className = 'prompt-assistant-container prompt-assistant-transition';
            containerDiv.dataset.nodeId = nodeId;
            containerDiv.dataset.inputId = inputId;

            // 添加内容容器到主容器
            containerDiv.appendChild(innerContentDiv);

            // 创建悬停区域 - 用于检测鼠标悬停
            const hoverAreaDiv = document.createElement('div');
            hoverAreaDiv.className = 'prompt-assistant-hover-area';
            // 将悬停区域添加到容器中
            containerDiv.appendChild(hoverAreaDiv);

            // 创建折叠状态指示器图标
            const indicatorDiv = document.createElement('div');
            indicatorDiv.className = 'prompt-assistant-indicator animate-creation';

            // 从ResourceManager获取图标并添加到指示器
            const mainIcon = ResourceManager.getIcon('icon-main.svg');
            if (mainIcon) {
                indicatorDiv.appendChild(mainIcon);
            }

            // 将指示器添加到容器中
            containerDiv.appendChild(indicatorDiv);

            // 保存引用并初始化
            widget.element = containerDiv;
            widget.innerContent = innerContentDiv;
            widget.hoverArea = hoverAreaDiv;
            widget.indicator = indicatorDiv;
            widget.buttons = {};
            widget.isCollapsed = true; // 初始状态为折叠

            // 初始化UI组件和事件
            this.addFunctionButtons(widget);
            this._setupUIEventHandling(widget, inputEl, containerDiv);
            
            // 异步设置UI位置，并在定位失败时清理资源
            this._setupUIPosition(widget, inputEl, containerDiv, canvasContainerRect, (success) => {
                if (!success) {
                    // 定位失败，清理所有资源
                    logger.error(`创建小助手失败 | 节点ID: ${nodeId} | 原因: 定位失败，未找到dom-widget容器`);
                    
                    // 清理DOM元素
                    if (containerDiv.parentNode) {
                        containerDiv.parentNode.removeChild(containerDiv);
                    }
                    
                    // 清理事件监听器
                    if (widget.cleanupListeners && typeof widget.cleanupListeners === 'function') {
                        widget.cleanupListeners();
                    }
                    
                    // 清理图标
                    if (indicatorDiv) {
                        indicatorDiv.innerHTML = '';
                    }
                    
                    // 从实例集合中移除
                    const widgetKey = widget.widgetKey;
                    if (widgetKey && PromptAssistant.instances.has(widgetKey)) {
                        PromptAssistant.instances.delete(widgetKey);
                    }
                    
                    // 清理输入框映射
                    if (window.PromptAssistantInputWidgetMap && widgetKey) {
                        delete window.PromptAssistantInputWidgetMap[widgetKey];
                    }
                    
                    return;
                }
                
                // 定位成功，继续初始化
                // 立即设置预设的展开宽度，避免首次展开时需要测量
                const presetWidth = calculateAssistantWidth();
                containerDiv.style.setProperty('--expanded-width', `${presetWidth}px`);
                logger.debug(`[宽度预设] 节点:${nodeId} | 宽度:${presetWidth}px`);

                // 初始滚动条检测和位置调整
                setTimeout(() => {
                    this._adjustPositionForScrollbar(widget, inputEl);
                }, 100); // 延迟执行，确保DOM完全渲染

                // 设置初始折叠状态
                containerDiv.classList.add('collapsed');
                hoverAreaDiv.style.display = 'block'; // 显示悬停区域以便用户展开

                // 默认隐藏状态
                containerDiv.style.display = 'none';

                // 移除动画类的定时器
                setTimeout(() => {
                    if (indicatorDiv && indicatorDiv.classList.contains('animate-creation')) {
                        indicatorDiv.classList.remove('animate-creation');
                    }
                }, 1000);
            });

            // 立即返回容器，定位将异步完成
            return containerDiv;
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
        // 如果widget没有初始化或者已经处于折叠状态，则不处理
        if (!widget || !widget.element || widget.isCollapsed || widget.isTransitioning) return;

        // 如果有活跃按钮，不自动折叠
        if (this._checkAssistantActiveState(widget)) return;

        // 如果鼠标当前悬停在容器上，不自动折叠
        if (widget.isMouseOver) return;

        // 设置自动折叠定时器
        if (widget._autoCollapseTimer) {
            clearTimeout(widget._autoCollapseTimer);
        }

        widget._autoCollapseTimer = setTimeout(() => {
            // 再次检查条件
            if (!widget.isCollapsed && !widget.isTransitioning &&
                !this._checkAssistantActiveState(widget) && !widget.isMouseOver) {

                const containerDiv = widget.element;

                // 保存当前宽度用于展开动画
                if (containerDiv.offsetWidth > 0) {
                    containerDiv.style.setProperty('--expanded-width', `${containerDiv.offsetWidth}px`);
                }

                // 设置过渡状态
                widget.isTransitioning = true;

                // 直接添加折叠类
                containerDiv.classList.add('collapsed');
                widget.isCollapsed = true;

                // 显示悬停区域，用于检测鼠标悬停以展开UI
                if (widget.hoverArea) {
                    widget.hoverArea.style.display = 'block';
                }

                // 动画结束后重置过渡状态
                setTimeout(() => {
                    widget.isTransitioning = false;
                }, 300);
            }

            widget._autoCollapseTimer = null;
        }, 1000);

        // 确保清理函数中包含这个定时器
        if (widget._eventCleanupFunctions) {
            widget._eventCleanupFunctions.push(() => {
                if (widget._autoCollapseTimer) {
                    clearTimeout(widget._autoCollapseTimer);
                    widget._autoCollapseTimer = null;
                }
            });
        }
    }

    /**
     * 展开小助手
     */
    _expandAssistant(widget) {
        if (!widget || !widget.element) return;

        // 如果已经是展开状态，直接返回
        if (!widget.isCollapsed && !widget.isTransitioning) return;

        // 如果正在折叠中，允许打断折叠动画
        if (widget.isTransitioning) {
            // 清理折叠动画的定时器
            if (widget._transitionTimer) {
                clearTimeout(widget._transitionTimer);
                widget._transitionTimer = null;
            }
            // 重置过渡状态，准备执行展开
            widget.isTransitioning = false;
        }

        // 如果不是折叠状态，不执行展开
        if (!widget.isCollapsed) return;

        widget.isTransitioning = true;

        // 隐藏悬停区域，避免覆盖按钮
        if (widget.hoverArea) {
            widget.hoverArea.style.display = 'none';
        }

        const containerDiv = widget.element;

        // 使用预设宽度，不再实时测量
        let targetWidth = containerDiv.style.getPropertyValue('--expanded-width');

        // 如果没有预设宽度，立即计算并设置
        if (!targetWidth || targetWidth === '') {
            const presetWidth = calculateAssistantWidth();
            targetWidth = `${presetWidth}px`;
            containerDiv.style.setProperty('--expanded-width', targetWidth);
            logger.debug(`[宽度预设] 展开时设置 | 宽度:${targetWidth}`);
        }

        // 手动设置宽度转换
        containerDiv.style.width = '28px'; // 起始宽度

        // 强制回流
        void containerDiv.offsetWidth;

        // 移除折叠类
        containerDiv.classList.remove('collapsed');

        // 设置目标宽度以触发过渡
        containerDiv.style.width = targetWidth;

        // 清理之前的过渡定时器
        if (widget._transitionTimer) {
            clearTimeout(widget._transitionTimer);
        }

        // 动画结束后清理
        widget._transitionTimer = setTimeout(() => {
            // 移除固定宽度，恢复自动宽度
            containerDiv.style.width = '';
            widget.isCollapsed = false;
            widget.isTransitioning = false;
            widget._transitionTimer = null;
        }, 300);
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

            // 如果当前是折叠状态，则展开
            if (widget.isCollapsed) {
                this._expandAssistant(widget);
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
        // 设置容器可以接收事件，而不是穿透
        containerDiv.style.pointerEvents = 'auto';
        widget.innerContent.style.pointerEvents = 'auto'; // 确保内容容器可以接收事件
        widget.hoverArea.style.pointerEvents = 'auto'; // 确保悬停区域可以接收事件
        widget.hoverArea.style.display = 'none'; // 初始状态下隐藏悬停区域，避免覆盖按钮

        // 确保所有按钮可点击
        const buttons = containerDiv.querySelectorAll('button');
        buttons.forEach(button => {
            // button.style.pointerEvents = 'auto'; // 移除此行，由CSS控制指针事件
            button.classList.add('prompt-assistant-button-active');
        });

        // 初始化过渡状态标记
        widget.isTransitioning = false;

        // 使用清理函数数组存储所有事件清理函数
        widget._eventCleanupFunctions = widget._eventCleanupFunctions || [];

        // 折叠和展开功能
        const setupCollapseExpandEvents = () => {
            // 记录原始宽度，用于展开动画
            const saveOriginalWidth = () => {
                if (!widget.isCollapsed && containerDiv.offsetWidth > 0) {
                    containerDiv.style.setProperty('--expanded-width', `${containerDiv.offsetWidth}px`);
                }
            };

            // 延迟保存宽度，确保DOM已完全渲染
            setTimeout(saveOriginalWidth, 300);

            // 过渡动画定时器，保存到widget对象上供所有函数访问
            widget._transitionTimer = null;

            // 折叠函数
            const collapseAssistant = () => {
                if (widget.isCollapsed || widget.isTransitioning) return;

                // 保存当前宽度用于展开动画
                saveOriginalWidth();
                widget.isTransitioning = true;

                // 直接添加折叠类，不使用动画类
                containerDiv.classList.add('collapsed');
                widget.isCollapsed = true;

                // 显示悬停区域，用于检测鼠标悬停以展开UI
                widget.hoverArea.style.display = 'block';

                // 清理之前的过渡定时器
                if (widget._transitionTimer) {
                    clearTimeout(widget._transitionTimer);
                }

                // 动画结束后重置过渡状态
                widget._transitionTimer = setTimeout(() => {
                    widget.isTransitioning = false;
                    widget._transitionTimer = null;
                }, 300);
            };

            // 展开函数
            const expandAssistant = () => {
                // 如果已经是展开状态，直接返回
                if (!widget.isCollapsed && !widget.isTransitioning) return;

                // 如果正在折叠中，允许打断折叠动画
                if (widget.isTransitioning) {
                    // 清理折叠动画的定时器
                    if (widget._transitionTimer) {
                        clearTimeout(widget._transitionTimer);
                        widget._transitionTimer = null;
                    }
                    // 重置过渡状态，准备执行展开
                    widget.isTransitioning = false;
                }

                // 如果不是折叠状态，不执行展开
                if (!widget.isCollapsed) return;

                widget.isTransitioning = true;

                // 隐藏悬停区域，避免覆盖按钮
                widget.hoverArea.style.display = 'none';

                // 使用预设宽度，不再实时测量
                let targetWidth = widget.element.style.getPropertyValue('--expanded-width');

                // 如果没有预设宽度，立即计算并设置
                if (!targetWidth || targetWidth === '') {
                    const presetWidth = calculateAssistantWidth();
                    targetWidth = `${presetWidth}px`;
                    containerDiv.style.setProperty('--expanded-width', targetWidth);
                    logger.debug(`[宽度预设] 事件处理中设置 | 宽度:${targetWidth}`);
                }

                // 手动设置宽度转换
                containerDiv.style.width = '28px'; // 起始宽度

                // 强制回流
                void containerDiv.offsetWidth;

                // 移除折叠类
                containerDiv.classList.remove('collapsed');

                // 设置目标宽度以触发过渡
                containerDiv.style.width = targetWidth;

                // 清理之前的过渡定时器
                if (widget._transitionTimer) {
                    clearTimeout(widget._transitionTimer);
                }

                // 动画结束后清理
                widget._transitionTimer = setTimeout(() => {
                    // 移除固定宽度，恢复自动宽度
                    containerDiv.style.width = '';
                    widget.isCollapsed = false;
                    widget.isTransitioning = false;
                    widget._transitionTimer = null;
                }, 300);
            };

            // 创建折叠定时器变量
            let collapseTimer = null;
            let autoCollapseTimer = null;

            // 鼠标离开容器时折叠
            const handleMouseLeave = () => {
                // 如果有活跃按钮，不折叠
                if (this._checkAssistantActiveState(widget)) return;

                // 设置延时，避免鼠标短暂离开就触发折叠
                collapseTimer = setTimeout(() => {
                    collapseAssistant();
                }, 500);
            };

            // 鼠标进入容器（展开时）以保持展开状态
            const handleContainerMouseEnter = () => {
                // 仅当小助手展开时，进入容器才会阻止其自动折叠
                if (widget.isCollapsed) return;

                if (collapseTimer) {
                    clearTimeout(collapseTimer);
                    collapseTimer = null;
                }
                if (autoCollapseTimer) {
                    clearTimeout(autoCollapseTimer);
                    autoCollapseTimer = null;
                }
            };

            // 鼠标进入悬停区域（折叠时）以展开
            const handleHoverAreaMouseEnter = () => {
                if (collapseTimer) {
                    clearTimeout(collapseTimer);
                    collapseTimer = null;
                }
                if (autoCollapseTimer) {
                    clearTimeout(autoCollapseTimer);
                    autoCollapseTimer = null;
                }
                // 如果当前是折叠状态，则展开
                if (widget.isCollapsed) {
                    expandAssistant();
                }
            };

            // 为容器添加鼠标事件
            const removeContainerMouseLeave = EventManager.addDOMListener(containerDiv, 'mouseleave', handleMouseLeave);
            const removeContainerMouseEnter = EventManager.addDOMListener(containerDiv, 'mouseenter', handleContainerMouseEnter);

            // 为悬停区域添加鼠标事件
            const removeHoverAreaMouseEnter = EventManager.addDOMListener(widget.hoverArea, 'mouseenter', handleHoverAreaMouseEnter);

            // 添加清理函数
            widget._eventCleanupFunctions.push(removeContainerMouseLeave);
            widget._eventCleanupFunctions.push(removeContainerMouseEnter);
            widget._eventCleanupFunctions.push(removeHoverAreaMouseEnter);

            // 添加清理定时器的函数
            widget._eventCleanupFunctions.push(() => {
                if (collapseTimer) {
                    clearTimeout(collapseTimer);
                    collapseTimer = null;
                }
                if (autoCollapseTimer) {
                    clearTimeout(autoCollapseTimer);
                    autoCollapseTimer = null;
                }
                if (widget._transitionTimer) {
                    clearTimeout(widget._transitionTimer);
                    widget._transitionTimer = null;
                }
            });

            // 创建后自动折叠功能
            const setupAutoCollapse = () => {
                // 如果有活跃按钮，不自动折叠
                if (this._checkAssistantActiveState(widget)) return;

                // 设置自动折叠定时器，1秒后自动折叠
                autoCollapseTimer = setTimeout(() => {
                    // 再次检查是否有活跃按钮或鼠标悬停在容器上
                    if (!this._checkAssistantActiveState(widget) && !widget.isMouseOver) {
                        collapseAssistant();
                    }
                }, 1000);
            };

            // 添加鼠标悬停状态跟踪
            widget.isMouseOver = false;
            const trackMouseOver = () => {
                widget.isMouseOver = true;
            };
            const trackMouseOut = () => {
                widget.isMouseOver = false;
            };

            // 为容器和悬停区域添加鼠标悬停状态跟踪
            const removeContainerMouseOverTracking = EventManager.addDOMListener(containerDiv, 'mouseover', trackMouseOver);
            const removeContainerMouseOutTracking = EventManager.addDOMListener(containerDiv, 'mouseout', trackMouseOut);
            const removeHoverAreaMouseOverTracking = EventManager.addDOMListener(widget.hoverArea, 'mouseover', trackMouseOver);
            const removeHoverAreaMouseOutTracking = EventManager.addDOMListener(widget.hoverArea, 'mouseout', trackMouseOut);

            // 添加清理函数
            widget._eventCleanupFunctions.push(removeContainerMouseOverTracking);
            widget._eventCleanupFunctions.push(removeContainerMouseOutTracking);
            widget._eventCleanupFunctions.push(removeHoverAreaMouseOverTracking);
            widget._eventCleanupFunctions.push(removeHoverAreaMouseOutTracking);

            // 设置自动折叠（延迟执行，确保DOM已完全渲染）
            setTimeout(setupAutoCollapse, 500);
        };

        // 设置折叠展开事件
        setupCollapseExpandEvents();

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
                                // 获取输入值
                                const inputValue = widget.inputEl.value;
                                if (!inputValue || inputValue.trim() === '') {
                                    throw new Error('请输入要扩写的内容');
                                }

                                // 生成唯一request_id
                                const request_id = generateRequestId('glm4_expand');

                                // 通知UI可以准备取消操作了
                                notifyCancelReady(request_id);

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
                visible: !isNoteNode && FEATURES.expand, // Note节点不显示此按钮
                // 添加右键菜单配置
                contextMenu: async (widget) => {
                    // 获取当前激活的扩写提示词ID
                    let activePromptId = null;
                    let expandPrompts = [];

                    try {
                        // 从服务器获取系统提示词配置
                        const response = await fetch('/prompt_assistant/api/config/system_prompts');
                        if (response.ok) {
                            const data = await response.json();

                            // 获取激活的提示词ID
                            activePromptId = data.active_prompts?.expand || null;

                            // 转换扩写规则数据
                            if (data.expand_prompts) {
                                // 保存原始顺序
                                const originalOrder = Object.keys(data.expand_prompts);

                                // 使用原始顺序遍历键
                                originalOrder.forEach(key => {
                                    const prompt = data.expand_prompts[key];
                                    expandPrompts.push({
                                        id: key,
                                        name: prompt.name || key,
                                        content: prompt.content,
                                        isActive: key === activePromptId
                                    });
                                });

                                // 按原始顺序排序
                                expandPrompts.sort((a, b) =>
                                    originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                                );
                            }
                        }
                    } catch (error) {
                        logger.error(`获取扩写提示词失败: ${error.message}`);
                    }

                    // 如果没有获取到提示词，显示一个提示
                    if (expandPrompts.length === 0) {
                        return [
                            {
                                label: '未找到扩写提示词',
                                disabled: true
                            }
                        ];
                    }

                    // 创建菜单项
                    const menuItems = expandPrompts.map(prompt => ({
                        label: prompt.name,
                        icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                        onClick: async (context) => {
                            logger.log(`右键菜单 | 动作: 切换扩写提示词 | ID: ${prompt.id}`);

                            try {
                                // 更新激活的提示词
                                const response = await fetch('/prompt_assistant/api/config/active_prompt', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        type: 'expand',
                                        prompt_id: prompt.id
                                    })
                                });

                                if (response.ok) {
                                    // 显示成功提示
                                    UIToolkit.showStatusTip(
                                        context.widget.buttons.expand,
                                        'success',
                                        `已切换到: ${prompt.name}`,
                                        null
                                    );
                                } else {
                                    throw new Error(`服务器返回错误: ${response.status}`);
                                }
                            } catch (error) {
                                logger.error(`切换扩写提示词失败: ${error.message}`);
                                UIToolkit.showStatusTip(
                                    context.widget.buttons.expand,
                                    'error',
                                    `切换失败: ${error.message}`,
                                    null
                                );
                            }
                        }
                    }));

                    menuItems.push({ type: 'separator' });
                    menuItems.push({
                        label: '规则管理',
                        icon: '<span class="pi pi-pen-to-square"></span>',
                        onClick: () => {
                            rulesConfigManager.showRulesConfigModal();
                        }
                    });

                    // 在规则管理下方添加 服务选择 子菜单（LLM提供商）
                    try {
                        const resp = await fetch('/prompt_assistant/api/config/llm');
                        if (resp.ok) {
                            const cfg = await resp.json();
                            const providers = cfg.providers || {};
                            const current = cfg.provider || null;
                            const providerNameMap = { zhipu: '智谱', siliconflow: '硅基流动', "302ai": '302.AI', ollama: 'Ollama', custom: '自定义' };
                            const order = ['zhipu', 'siliconflow', '302ai', 'ollama', 'custom'];
                            const children = order
                                .filter(key => Object.prototype.hasOwnProperty.call(providers, key))
                                .map(key => ({
                                    label: providerNameMap[key] || key,
                                    icon: `<span class=\"pi ${current === key ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}\"></span>`,
                                    onClick: async (context) => {
                                        try {
                                            const res = await fetch('/prompt_assistant/api/config/llm', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ current_provider: key })
                                            });
                                            if (!res.ok) throw new Error(`服务器返回错误: ${res.status}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${providerNameMap[key] || key}`);
                                        } catch (err) {
                                            logger.error(`切换LLM提供商失败: ${err.message}`);
                                            UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${err.message}`);
                                        }
                                    }
                                }));
                            menuItems.push({
                                label: '服务选择',
                                icon: '<span class="pi pi-sparkles"></span>',
                                children
                            });
                        }
                    } catch (e) {
                        logger.error(`加载LLM提供商失败: ${e.message}`);
                    }

                    return menuItems;
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

                                // 1. 查询缓存
                                let cacheResult = null;
                                if (FEATURES.useTranslateCache) {
                                    cacheResult = TranslateCacheService.queryTranslateCache(inputValue);
                                }
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
                                const translateType = app.settings?.["PromptAssistant.Settings.TranslateType"] || "baidu";

                                // 生成唯一request_id，根据翻译类型生成对应的前缀
                                const request_id = generateRequestId(null, translateType);

                                // 通知UI可以准备取消操作了
                                notifyCancelReady(request_id);

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

                                    // 只有开启缓存时才写入缓存
                                    if (FEATURES.useTranslateCache) {
                                        TranslateCacheService.addTranslateCache(inputValue, formattedText);
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
                    const currentTranslateType = app.ui.settings.getSettingValue("PromptAssistant.Settings.TranslateType", "baidu");
                    const useTranslateCache = app.ui.settings.getSettingValue("PromptAssistant.Features.UseTranslateCache", true);

                    // 获取LLM提供商列表
                    let llmProviders = {};
                    let currentLLMProvider = null;
                    try {
                        const resp = await fetch('/prompt_assistant/api/config/llm');
                        if (resp.ok) {
                            const cfg = await resp.json();
                            llmProviders = cfg.providers || {};
                            currentLLMProvider = cfg.provider || null;
                        }
                    } catch (e) {
                        logger.error(`获取LLM提供商失败: ${e.message}`);
                    }

                    const providerNameMap = { zhipu: '智谱', siliconflow: '硅基流动', "302ai": '302.AI', ollama: 'Ollama', custom: '自定义' };

                    const order = ['zhipu', 'siliconflow', '302ai', 'ollama', 'custom'];
                    const providerChildren = order
                        .filter(key => Object.prototype.hasOwnProperty.call(llmProviders, key))
                        .map(key => ({
                            label: providerNameMap[key] || key,
                            icon: `<span class="pi ${currentLLMProvider === key ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                            onClick: async (context) => {
                                try {
                                    const res = await fetch('/prompt_assistant/api/config/llm', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ current_provider: key })
                                    });
                                    if (!res.ok) throw new Error(`服务器返回错误: ${res.status}`);
                                    // 确保切换到LLM翻译
                                    app.ui.settings.setSettingValue("PromptAssistant.Settings.TranslateType", "llm");
                                    UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${providerNameMap[key] || key}`);
                                } catch (err) {
                                    logger.error(`切换LLM提供商失败: ${err.message}`);
                                    UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${err.message}`);
                                }
                            }
                        }));

                    return [
                        {
                            label: "使用百度翻译",
                            icon: `<span class="pi ${currentTranslateType === 'baidu' ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                            onClick: (context) => {
                                logger.log("右键菜单 | 动作: 切换到百度翻译");
                                app.ui.settings.setSettingValue("PromptAssistant.Settings.TranslateType", "baidu");
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: 百度翻译`);
                            }
                        },
                        {
                            label: "使用大语言模型翻译",
                            icon: `<span class="pi ${currentTranslateType === 'llm' ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                            onClick: (context) => {
                                logger.log("右键菜单 | 动作: 切换到LLM翻译");
                                app.ui.settings.setSettingValue("PromptAssistant.Settings.TranslateType", "llm");
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: 大语言模型翻译`);
                            },
                            children: providerChildren
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
     */
    _adjustPositionForScrollbar(widget, inputEl) {
        if (!widget?.element || !inputEl) return;

        const hasScrollbar = this._detectScrollbar(inputEl);
        const containerDiv = widget.element;

        // 仅在滚动条状态发生变化时更新位置与输出日志
        const prevState = containerDiv.dataset.hasScrollbar === 'true';
        if (prevState === hasScrollbar) {
            return; // 状态未变，不做任何操作
        }
        containerDiv.dataset.hasScrollbar = String(hasScrollbar);

        // 标准定位模式调整
        const rightOffset = hasScrollbar ? '16px' : '4px'; // 有滚动条时向左偏移12px
        containerDiv.style.right = rightOffset;
        logger.debug(`[位置调整] 标准方案 | 滚动条: ${hasScrollbar} → 偏移: ${rightOffset}`);
    }

    /**
     * 设置UI位置
     * 使用标准定位方式（仅支持 ComfyUI 0.3.27 及以上版本）
     * @param {Function} onComplete - 定位完成回调，接收boolean参数，true表示成功，false表示失败
     */
    _setupUIPosition(widget, inputEl, containerDiv, canvasContainerRect, onComplete) {
        const _applyStandardPositioning = (containerDiv, domWidgetContainer) => {
            // 标准模式使用默认的绝对定位，添加位置参数
            containerDiv.style.right = '4px';
            containerDiv.style.bottom = '4px';

            // 直接添加到dom-widget容器，但不修改dom-widget本身
            domWidgetContainer.appendChild(containerDiv);

            // 触发回流，确保样式更新
            void containerDiv.offsetWidth;

            // 强制应用容器高度
            containerDiv.style.height = '20px';
            containerDiv.style.minHeight = '20px';
            void containerDiv.offsetWidth; // 触发回流，确保样式应用
        };

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

        // 如果初次查找失败，添加延迟重试机制
        // 这是为了处理新创建节点时DOM可能尚未完全渲染的情况
        if (!domWidgetContainer) {
            // 设置重试次数和间隔
            const maxRetries = 3;
            const retryInterval = 500; // 毫秒
            let retryCount = 0;

            // 创建重试函数
            const retrySetupPosition = () => {
                // 重新查找dom-widget容器
                domWidgetContainer = findDomWidgetContainer();

                if (domWidgetContainer) {
                    // 找到了dom-widget容器，使用标准定位方案
                    // 使用标准定位方案
                    _applyStandardPositioning(containerDiv, domWidgetContainer);

                    // 通知定位成功
                    if (onComplete) onComplete(true);
                } else if (retryCount < maxRetries) {
                    // 继续重试
                    retryCount++;
                    logger.debug(`定位方式 - 重试查找dom-widget容器 (${retryCount}/${maxRetries})`);
                    setTimeout(retrySetupPosition, retryInterval);
                } else {
                    // 达到最大重试次数，定位失败
                    // 通知定位失败
                    if (onComplete) onComplete(false);
                }
            };

            // 开始重试流程
            setTimeout(retrySetupPosition, retryInterval);
        } else {
            // === 标准方案定位 (ComfyUI 0.3.27及以上) ===
            _applyStandardPositioning(containerDiv, domWidgetContainer);
            
            // 通知定位成功
            if (onComplete) onComplete(true);
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
