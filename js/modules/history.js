/**
 * 历史记录管理器
 * 负责管理历史记录的显示和操作
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { HistoryCacheService } from "../services/cache.js";
import { PopupManager } from "../utils/popupManager.js";
import { EventManager } from "../utils/eventManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { ResourceManager } from "../utils/resourceManager.js";

/**
 * 历史记录管理器类
 * 管理历史记录弹窗和历史记录选择
 */
class HistoryManager {
    static popupInstance = null;
    static onCloseCallback = null;
    static currentNodeId = null;  // 当前节点ID
    static currentInputId = null; // 当前输入框ID
    static eventCleanups = [];    // 事件清理函数数组
    static activeTooltip = null;  // 当前活动的 tooltip

    /**
     * 显示历史记录弹窗
     */
    static async showHistoryPopup(params) {
        const { anchorButton, nodeId, inputId, onClose } = params;

        try {
            // 保存当前节点和输入框ID
            this.currentNodeId = nodeId;
            this.currentInputId = inputId;

            logger.debug(`历史弹窗 | 触发显示 | 节点:${nodeId} | 输入框:${inputId}`);

            // 清理现有事件监听
            this._cleanupEvents();

            // 获取历史数据
            const historyList = HistoryCacheService.getHistoryList({
                nodeId: nodeId,
                limit: 100,  // 增加限制以确保有足够的历史数据
                workflowId: app.graph?._workflow_id
            });

            // 创建新弹窗
            const popup = this._createHistoryPopup({ historyList, nodeId });

            // 使用PopupManager显示弹窗
            await PopupManager.showPopup({
                popup: popup,
                anchorButton: anchorButton,
                buttonInfo: params.buttonInfo,
                onClose: () => {
                    // 清理事件监听
                    this._cleanupEvents();
                    // 执行传入的关闭回调
                    if (typeof onClose === 'function') {
                        onClose();
                    }
                }
            });

            logger.debug(`历史弹窗 | 结果:显示成功 | 节点:${nodeId}`);
        } catch (error) {
            logger.error(`历史弹窗 | 结果:失败 | 错误:${error.message}`);
            this._cleanupAll();
        }
    }

    /**
     * 隐藏历史记录弹窗
     */
    static hideHistoryPopup() {
        // 清理事件监听
        this._cleanupEvents();

        // 使用PopupManager关闭所有弹窗
        PopupManager.closeAllPopups();
    }

    /**
     * 清理所有事件监听
     */
    static _cleanupEvents() {
        // 执行并清空所有事件清理函数
        if (this.eventCleanups.length > 0) {
            this.eventCleanups.forEach(cleanup => {
                if (typeof cleanup === 'function') {
                    cleanup();
                }
            });
            this.eventCleanups = [];
        }
    }

    /**
     * 强制清理所有相关资源
     */
    static _cleanupAll() {
        // 清理事件监听
        this._cleanupEvents();

        // 使用PopupManager关闭所有弹窗
        PopupManager.closeAllPopups();
    }

    /**
     * 格式化历史内容，进行适当的截断和处理
     */
    static _formatHistoryContent(content, operationType) {
        // 不再添加操作类型前缀，直接返回内容
        return content;
    }

    /**
     * 创建并显示tooltip
     */
    static _showTooltip(target, text) {
        // 移除已存在的tooltip
        this._hideTooltip();

        // 创建tooltip元素
        const tooltip = document.createElement('div');
        tooltip.className = 'tag_tooltip';
        tooltip.textContent = text;
        document.body.appendChild(tooltip);

        // 获取目标元素的位置和尺寸
        const rect = target.getBoundingClientRect();

        // 计算tooltip位置
        const tooltipRect = tooltip.getBoundingClientRect();
        const left = rect.left + (rect.width - tooltipRect.width) / 2;
        const top = rect.top - tooltipRect.height - 8; // 8px的间距

        // 设置tooltip位置
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        // 保存当前tooltip引用
        this.activeTooltip = tooltip;
    }

    /**
     * 隐藏tooltip
     */
    static _hideTooltip() {
        if (this.activeTooltip) {
            this.activeTooltip.remove();
            this.activeTooltip = null;
        }
    }

    /**
     * 创建历史记录弹窗
     */
    static _createHistoryPopup({ historyList, nodeId }) {
        const popup = document.createElement('div');
        popup.className = 'popup_container';

        // 创建标题栏
        const titleBar = document.createElement('div');
        titleBar.className = 'popup_title_bar';

        const title = document.createElement('div');
        title.className = 'popup_title';
        title.textContent = '历史记录';

        const actions = document.createElement('div');
        actions.className = 'popup_actions';

        // 创建清除当前按钮
        const clearCurrentBtn = document.createElement('button');
        clearCurrentBtn.className = 'popup_action_btn';
        clearCurrentBtn.textContent = '清除当前';

        // 使用EventManager添加点击事件
        const clearCurrentCleanup = EventManager.addDOMListener(clearCurrentBtn, 'click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hideHistoryPopup();
            try {
                // 获取当前输入框内容
                const inputEl = window.PromptAssistantInputWidgetMap?.[`${nodeId}_${this.currentInputId}`]?.inputEl;
                const currentContent = inputEl?.value || '';

                // 清除当前节点的历史
                await HistoryCacheService.clearNodeHistory(nodeId);

                // 如果输入框有内容，添加到历史记录
                if (currentContent.trim()) {
                    HistoryCacheService.addHistory({
                        workflow_id: '',
                        node_id: nodeId,
                        input_id: this.currentInputId,
                        content: currentContent,
                        operation_type: 'input',
                        timestamp: Date.now()
                    });
                    logger.debug(`历史记录 | 清除后保存当前内容 | 节点:${nodeId} | 输入框:${this.currentInputId}`);
                }

                // 更新按钮状态
                if (window.PromptAssistantInputWidgetMap?.[`${nodeId}_${this.currentInputId}`]?.widget) {
                    const widget = window.PromptAssistantInputWidgetMap[`${nodeId}_${this.currentInputId}`].widget;
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                }

                logger.debug(`历史记录 | 清除当前节点历史 | 节点:${nodeId}`);
            } catch (error) {
                logger.error(`历史记录 | 清除失败 | 错误:${error.message}`);
            }
        });
        this.eventCleanups.push(clearCurrentCleanup);

        // 创建清除所有按钮
        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'popup_action_btn danger';
        clearAllBtn.textContent = '清除所有';

        // 使用EventManager添加点击事件
        const clearAllCleanup = EventManager.addDOMListener(clearAllBtn, 'click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hideHistoryPopup();
            try {
                // 获取当前输入框内容
                const inputEl = window.PromptAssistantInputWidgetMap?.[`${nodeId}_${this.currentInputId}`]?.inputEl;
                const currentContent = inputEl?.value || '';

                // 清除所有历史
                await HistoryCacheService.clearAllHistory();

                // 如果输入框有内容，添加到历史记录
                if (currentContent.trim()) {
                    HistoryCacheService.addHistory({
                        workflow_id: '',
                        node_id: nodeId,
                        input_id: this.currentInputId,
                        content: currentContent,
                        operation_type: 'input',
                        timestamp: Date.now()
                    });
                    logger.debug(`历史记录 | 清除后保存当前内容 | 节点:${nodeId} | 输入框:${this.currentInputId}`);
                }

                // 更新按钮状态
                if (window.PromptAssistantInputWidgetMap?.[`${nodeId}_${this.currentInputId}`]?.widget) {
                    const widget = window.PromptAssistantInputWidgetMap[`${nodeId}_${this.currentInputId}`].widget;
                    UIToolkit.updateUndoRedoButtonState(widget, HistoryCacheService);
                }

                logger.debug('历史记录 | 清除所有历史');
            } catch (error) {
                logger.error(`历史记录 | 清除失败 | 错误:${error.message}`);
            }
        });
        this.eventCleanups.push(clearAllCleanup);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'popup_btn';
        UIToolkit.addIconToButton(closeBtn, 'pi-times', '关闭');

        // 使用EventManager添加点击事件
        const closeCleanup = EventManager.addDOMListener(closeBtn, 'click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hideHistoryPopup();
        });
        this.eventCleanups.push(closeCleanup);

        // 添加按钮到操作区域
        actions.appendChild(clearCurrentBtn);
        actions.appendChild(clearAllBtn);
        actions.appendChild(closeBtn);
        titleBar.appendChild(title);
        titleBar.appendChild(actions);

        // 将历史记录按节点分组并排序
        const { orderedNodeIds, nodeGroups } = this._groupAndSortHistoryByNode(historyList, nodeId);

        // 创建tabs容器
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'popup_tabs_container';

        // 创建可滚动区域
        const tabsScroll = document.createElement('div');
        tabsScroll.className = 'popup_tabs_scroll';

        // 创建tabs
        const tabs = document.createElement('div');
        tabs.className = 'popup_tabs';

        // 创建左右滚动指示器
        const leftIndicator = document.createElement('div');
        leftIndicator.className = 'tabs_scroll_indicator left';

        // 添加图标
        const leftIcon = ResourceManager.getIcon('icon-movedown.svg');
        if (leftIcon) {
            leftIcon.classList.add('rotate_left', 'scroll_indicator_icon');
            leftIndicator.appendChild(leftIcon);
        }
        leftIndicator.style.display = 'none'; // 初始隐藏

        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'tabs_scroll_indicator right';

        // 添加图标
        const rightIcon = ResourceManager.getIcon('icon-movedown.svg');
        if (rightIcon) {
            rightIcon.classList.add('rotate_right', 'scroll_indicator_icon');
            rightIndicator.appendChild(rightIcon);
        }
        rightIndicator.style.display = 'none'; // 初始隐藏

        // 添加指示器点击事件 - 改进滚动逻辑
        const leftScrollCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
            // 获取可视区域宽度
            const visibleWidth = tabsScroll.clientWidth;

            // 计算滚动距离，PrimeVue风格是滚动一个较大的距离
            const scrollDistance = visibleWidth * 0.75;

            // 平滑滚动
            tabsScroll.scrollBy({
                left: -scrollDistance,
                behavior: 'smooth'
            });
        });
        this.eventCleanups.push(leftScrollCleanup);

        const rightScrollCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
            // 获取可视区域宽度
            const visibleWidth = tabsScroll.clientWidth;

            // 计算滚动距离，PrimeVue风格是滚动一个较大的距离
            const scrollDistance = visibleWidth * 0.75;

            // 平滑滚动
            tabsScroll.scrollBy({
                left: scrollDistance,
                behavior: 'smooth'
            });
        });
        this.eventCleanups.push(rightScrollCleanup);

        // 监听滚动事件，显示/隐藏滚动指示器
        const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', () => {
            // 检查是否需要滚动
            const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;

            if (!canScroll) {
                // 如果不需要滚动，隐藏两个指示器
                leftIndicator.style.display = 'none';
                rightIndicator.style.display = 'none';
                return;
            }

            // 显示/隐藏左右滚动指示器
            leftIndicator.style.display = tabsScroll.scrollLeft > 0 ? 'flex' : 'none';
            rightIndicator.style.display =
                tabsScroll.scrollLeft < (tabsScroll.scrollWidth - tabsScroll.clientWidth - 2) ? 'flex' : 'none';
        });
        this.eventCleanups.push(scrollCleanup);

        // 初始检测是否需要滚动指示器
        setTimeout(() => {
            // 检查是否需要滚动
            const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;

            if (canScroll) {
                // 如果需要滚动，显示右侧指示器
                rightIndicator.style.display = 'flex';
            }
        }, 100);

        // 创建内容区域
        const tabContentsContainer = document.createElement('div');
        tabContentsContainer.className = 'popup_content';

        // 记录tab和内容元素的映射
        const tabContentPairs = [];

        // 遍历已排序的节点ID数组，确保当前节点在最前面，其他节点按序号排序
        orderedNodeIds.forEach((groupNodeId) => {
            const nodeItems = nodeGroups[groupNodeId];

            // 如果没有数据，跳过
            if (!nodeItems || nodeItems.length === 0) return;

            // 创建tab
            const tab = document.createElement('div');
            tab.className = 'popup_tab';

            // 设置tab标题
            if (groupNodeId === nodeId) {
                tab.textContent = '当前节点';
                tab.classList.add('current_node');

                // 当前节点tab默认选中并激活
                tab.classList.add('active');
            } else {
                // 提取节点编号（假设格式为数字+可能的字母）
                const nodeNumMatch = String(groupNodeId).match(/\d+/);
                const nodeNum = nodeNumMatch ? nodeNumMatch[0] : groupNodeId;
                tab.textContent = `节点 ${nodeNum}`;
            }

            // 创建内容容器
            const tabContent = document.createElement('div');
            tabContent.className = 'popup_tab_content';

            // 如果该tab默认选中，显示其内容
            if (tab.classList.contains('active')) {
                tabContent.classList.add('active');
            }

            // 渲染该节点的历史记录
            if (nodeItems.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'popup_empty';
                empty.textContent = '暂无历史记录';
                tabContent.appendChild(empty);
            } else {
                nodeItems.forEach((item) => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'popup_list_item';

                    // 添加元数据容器
                    const metaDiv = document.createElement('div');
                    metaDiv.className = 'history_meta';

                    // 添加输入框ID（始终显示）
                    const inputIdSpan = document.createElement('span');
                    inputIdSpan.className = 'input_id';
                    inputIdSpan.textContent = `${item.input_id}`;
                    metaDiv.appendChild(inputIdSpan);

                    // 根据操作类型添加对应标签
                    if (item.operation_type) {
                        const operationSpan = document.createElement('span');

                        switch (item.operation_type) {
                            case 'translate':
                                operationSpan.className = 'history_operation translated';
                                operationSpan.textContent = '翻译';
                                break;
                            case 'expand':
                                operationSpan.className = 'history_operation expanded';
                                operationSpan.textContent = '扩写';
                                break;
                            case 'caption':
                                operationSpan.className = 'history_operation caption';
                                operationSpan.textContent = '提示词反推';
                                break;
                            // 其他操作类型可以在这里添加
                        }

                        if (operationSpan.textContent) {
                            metaDiv.appendChild(operationSpan);
                        }
                    }

                    // 创建内容容器
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'history_content';

                    // 设置显示内容 - 使用格式化方法
                    const displayContent = this._formatHistoryContent(item.content, item.operation_type);
                    contentDiv.textContent = displayContent;

                    // 组装历史记录项
                    itemDiv.appendChild(metaDiv);
                    itemDiv.appendChild(contentDiv);

                    // 添加鼠标悬浮事件，显示完整内容的tooltip
                    const mouseEnterCleanup = EventManager.addDOMListener(itemDiv, 'mouseenter', () => {
                        this._showTooltip(itemDiv, displayContent);
                    });

                    const mouseLeaveCleanup = EventManager.addDOMListener(itemDiv, 'mouseleave', () => {
                        this._hideTooltip();
                    });

                    this.eventCleanups.push(mouseEnterCleanup, mouseLeaveCleanup);

                    // 使用EventManager添加点击事件
                    const itemCleanup = EventManager.addDOMListener(itemDiv, 'click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        // 主动关闭 tooltip
                        this._hideTooltip();

                        // 使用UIToolkit写入内容到输入框
                        const success = UIToolkit.writeToInput(item.content, this.currentNodeId, this.currentInputId, {
                            highlight: true,
                            focus: true
                        });

                        if (success) {
                            // 如果内容来自其他输入框，使用新方法添加历史并更新撤销状态
                            if (item.node_id !== this.currentNodeId || item.input_id !== this.currentInputId) {
                                HistoryCacheService.addHistoryAndUpdateUndoState(
                                    this.currentNodeId,
                                    this.currentInputId,
                                    item.content,
                                    'input'
                                );
                            }

                            // 隐藏历史弹窗
                            this.hideHistoryPopup();
                        }
                    });
                    this.eventCleanups.push(itemCleanup);

                    tabContent.appendChild(itemDiv);
                });
            }

            // 添加到容器
            tabs.appendChild(tab);
            tabContentsContainer.appendChild(tabContent);

            // 保存tab和内容的映射关系，用于点击tab时切换内容
            tabContentPairs.push({ tab, content: tabContent });

            // 添加tab点击事件
            const tabCleanup = EventManager.addDOMListener(tab, 'click', () => {
                // 获取当前激活的标签
                const currentActiveTab = tabs.querySelector('.popup_tab.active');

                // 如果点击的是当前激活的标签，不做任何处理
                if (currentActiveTab === tab) return;

                // 为当前激活的标签添加退出动画
                if (currentActiveTab) {
                    currentActiveTab.classList.add('exiting');
                    // 监听动画结束
                    const animationEndHandler = () => {
                        currentActiveTab.classList.remove('active', 'exiting');
                        currentActiveTab.removeEventListener('transitionend', animationEndHandler);
                    };
                    currentActiveTab.addEventListener('transitionend', animationEndHandler);
                }

                // 移除所有内容的active类
                tabContentPairs.forEach(pair => {
                    pair.content.classList.remove('active');
                });

                // 激活当前点击的tab
                tab.classList.add('active');
                tabContent.classList.add('active');

                // 滚动到可见区域
                tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            });
            this.eventCleanups.push(tabCleanup);
        });

        // 组装tabs容器
        tabsScroll.appendChild(tabs);
        tabsContainer.appendChild(tabsScroll);
        tabsContainer.appendChild(leftIndicator);
        tabsContainer.appendChild(rightIndicator);

        // 组装弹窗
        popup.appendChild(titleBar);
        popup.appendChild(tabsContainer);
        popup.appendChild(tabContentsContainer);

        return popup;
    }

    /**
     * 按节点分组并排序历史记录
     */
    static _groupAndSortHistoryByNode(historyList, currentNodeId) {
        // 按节点ID分组
        const groups = {};

        // 收集所有节点ID，用于后续排序
        const nodeIds = new Set();

        // 分组历史记录
        historyList.forEach(item => {
            const nodeId = item.node_id;
            if (!groups[nodeId]) {
                groups[nodeId] = [];
                nodeIds.add(nodeId);
            }
            groups[nodeId].push(item);
        });

        // 确保当前节点ID存在于节点列表中
        if (currentNodeId && !nodeIds.has(currentNodeId)) {
            nodeIds.add(currentNodeId);
            groups[currentNodeId] = [];
        }

        // 将节点ID转换为数组并排序
        // 排序规则：1. 当前节点最前 2. 其他节点按数字序号排序
        const sortedNodeIds = Array.from(nodeIds).sort((a, b) => {
            // 如果a是当前节点，排在最前面
            if (a === currentNodeId) return -1;
            // 如果b是当前节点，排在最前面
            if (b === currentNodeId) return 1;

            // 提取节点ID中的数字部分
            const getNodeNumber = (id) => {
                const match = String(id).match(/\d+/);
                return match ? parseInt(match[0]) : 0;
            };

            // 按数字大小排序
            return getNodeNumber(a) - getNodeNumber(b);
        });

        // 对每个组内的历史记录按时间戳排序（最新的在前）
        Object.keys(groups).forEach(nodeId => {
            groups[nodeId].sort((a, b) => b.timestamp - a.timestamp);
        });

        // 返回排序后的节点ID数组和分组后的历史记录
        return {
            orderedNodeIds: sortedNodeIds,
            nodeGroups: groups
        };
    }
}

export { HistoryManager };