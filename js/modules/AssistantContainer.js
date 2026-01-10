import { app } from "../../../scripts/app.js";
import { EventManager } from "../utils/eventManager.js";
import "../lib/Sortable.min.js";

/**
 * 调试开关：禁止自动折叠
 * 在控制台输入 window.PA_DEBUG_NO_COLLAPSE = true 可禁止自动折叠
 * 输入 window.PA_DEBUG_NO_COLLAPSE = false 可恢复自动折叠
 */
window.PA_DEBUG_NO_COLLAPSE = window.PA_DEBUG_NO_COLLAPSE || false;

// 锚点位置枚举
export const ANCHOR_POSITION = {
    TOP_LEFT_H: 'top-left-h',
    TOP_LEFT_V: 'top-left-v',
    TOP_CENTER_H: 'top-center-h',
    TOP_RIGHT_H: 'top-right-h',
    TOP_RIGHT_V: 'top-right-v',
    RIGHT_CENTER_V: 'right-center-v',
    BOTTOM_RIGHT_H: 'bottom-right-h',
    BOTTOM_RIGHT_V: 'bottom-right-v',
    BOTTOM_CENTER_H: 'bottom-center-h',
    BOTTOM_LEFT_H: 'bottom-left-h',
    BOTTOM_LEFT_V: 'bottom-left-v',
    LEFT_CENTER_V: 'left-center-v'
};

export class AssistantContainer {
    constructor(options = {}) {
        this.nodeId = options.nodeId;
        this.type = options.type || 'prompt'; // 'prompt' or 'image'
        this.anchorPosition = options.anchorPosition || ANCHOR_POSITION.BOTTOM_RIGHT_H;
        this.offset = options.offset || { x: 0, y: 0 };
        this.enableDragSort = options.enableDragSort !== false;

        // 回调函数
        this.onButtonOrderChange = options.onButtonOrderChange;
        this.shouldCollapse = options.shouldCollapse;

        // 状态
        this.isCollapsed = true;
        this.isTransitioning = false;
        this.isDestroyed = false;
        this.buttons = [];
        this.element = null;
        this.container = null;
        this.hoverArea = null;
        this.indicator = null;
        this.content = null;

        // 定时器
        this._collapseTimer = null;
        this._expandTimer = null;

        // 事件清理函数
        this._cleanupFunctions = [];

        // Sortable 实例
        this._sortable = null;
    }

    render() {
        // 检查是否已销毁
        if (this.isDestroyed) return null;

        // 主容器
        this.element = document.createElement('div');
        this.element.className = `assistant-container-common ${this.type}-assistant-container`;

        // 悬停区域（不可见，用于检测鼠标进入/离开）
        this.hoverArea = document.createElement('div');
        this.hoverArea.className = 'assistant-hover-area';
        this.element.appendChild(this.hoverArea);

        // 指示器（图标）
        this.indicator = document.createElement('div');
        this.indicator.className = `assistant-indicator ${this.type}-assistant-indicator`;

        // 添加入场动画类
        this.indicator.classList.add('indicator-init');

        // 动画结束后移除初始化类
        this.indicator.addEventListener('animationend', () => {
            this.indicator.classList.remove('indicator-init');
        }, { once: true });

        this.element.appendChild(this.indicator);

        // 按钮内容容器
        this.content = document.createElement('div');
        this.content.className = 'assistant-content';
        this.element.appendChild(this.content);

        // 基于锚点的初始样式
        this.updatePosition();

        // 绑定事件
        this._bindEvents();

        // 设置 Sortable
        if (this.enableDragSort) {
            this._setupSortable();
        }

        return this.element;
    }

    mount(parentElement) {
        if (parentElement) {
            parentElement.appendChild(this.element);
            // 挂载后强制回流/更新尺寸
            requestAnimationFrame(() => this.updateDimensions());
        }
    }

    setIconContent(svgContent) {
        if (this.indicator) {
            this.indicator.innerHTML = svgContent;
        }
    }

    addButton(buttonElement, id) {
        if (!buttonElement) return;
        buttonElement.dataset.id = id; // 用于 Sortable

        // 设置按钮索引，用于递进动画延迟
        const buttonIndex = this.buttons.length;
        buttonElement.style.setProperty('--button-index', buttonIndex);

        this.content.appendChild(buttonElement);
        this.buttons.push({ id, element: buttonElement });

        // 如果是分割线，根据当前布局方向设置类名
        if (buttonElement.classList.contains('prompt-assistant-divider') ||
            buttonElement.classList.contains('image-assistant-divider')) {
            const isVertical = this.anchorPosition.endsWith('-v');
            if (isVertical) {
                buttonElement.classList.add('divider-horizontal');
            }
        }

        this.updateDimensions();
    }

    // 批量添加按钮，如果已存在Sortable，则会遵循Sortable的逻辑（通常append）
    // 如果需要特定顺序，应该在添加前排好序
    addButtons(buttonElementsWithIds) {
        buttonElementsWithIds.forEach(({ element, id }) => {
            this.addButton(element, id);
        });
    }

    // 清空按钮
    clearButtons() {
        this.content.innerHTML = '';
        this.buttons = [];
    }

    setAnchorPosition(position) {
        if (Object.values(ANCHOR_POSITION).includes(position)) {
            this.anchorPosition = position;
            this.updatePosition();
        }
    }

    updatePosition() {
        if (!this.element) return;

        // 保存当前展开/折叠状态
        const wasExpanded = !this.isCollapsed;

        // 重置类名，保持当前状态
        const stateClass = wasExpanded ? 'expanded' : 'collapsed';
        this.element.className = `assistant-container-common ${this.type}-assistant-container ${stateClass}`;

        // 添加布局类名
        this.element.classList.add(`layout-${this.anchorPosition}`);

        // 确保内容容器的 Flex 方向正确
        const isVertical = this.anchorPosition.endsWith('-v');
        if (isVertical) {
            this.content.classList.add('flex-col');
            this.content.classList.remove('flex-row');
        } else {
            this.content.classList.add('flex-row');
            this.content.classList.remove('flex-col');
        }

        // 更新分割线类名：垂直布局时添加 divider-horizontal 类
        this._updateDividerOrientation(isVertical);

        // 触发尺寸重新计算
        this.updateDimensions();
    }

    // 更新分割线方向类名
    _updateDividerOrientation(isVertical) {
        if (!this.content) return;
        const dividers = this.content.querySelectorAll('.prompt-assistant-divider, .image-assistant-divider');
        dividers.forEach(divider => {
            if (isVertical) {
                divider.classList.add('divider-horizontal');
            } else {
                divider.classList.remove('divider-horizontal');
            }
        });
    }

    /**
     * 更新容器尺寸 (优化版：常量布局模式)
     * 根据当前启用的按钮组合直接计算尺寸，避免 DOM 克隆测量带来的开销
     */
    updateDimensions() {
        if (!this.element || !this.content) return;

        // --- 1. 获取当前状态统计 ---
        const buttons = Array.from(this.content.children).filter(el =>
            el.style.display !== 'none' &&
            !el.classList.contains('assistant-indicator')
        );

        const totalCount = buttons.length;
        if (totalCount === 0) return;

        // 统计功能组
        const hasHistoryGroup = buttons.some(el => el.dataset.id === 'history' || el.dataset.id === 'undo' || el.dataset.id === 'redo');
        const hasDivider = buttons.some(el => el.classList.contains('prompt-assistant-divider') || el.classList.contains('image-assistant-divider'));

        // 计算非历史且非分隔线的有效功能按钮数量
        const otherFeaturesCount = buttons.filter(el =>
            !['history', 'undo', 'redo'].includes(el.dataset.id) &&
            !el.classList.contains('prompt-assistant-divider') &&
            !el.classList.contains('image-assistant-divider')
        ).length;

        // --- 2. 基于预设常量的尺寸映射 ---
        let finalDimension = 28; // 默认单个按钮宽度 (或折叠尺寸)

        // 逻辑规则匹配 (根据用户提供的精确测量值)
        if (hasHistoryGroup && otherFeaturesCount === 3) {
            finalDimension = 143; // 所有功能全开 (历史3 + 分隔线1 + 其它3)
        } else if (hasHistoryGroup && otherFeaturesCount === 2) {
            finalDimension = 121; // 历史 + 两个其它
        } else if (hasHistoryGroup && otherFeaturesCount === 1) {
            finalDimension = 99;  // 历史 + 一个其它
        } else if (hasHistoryGroup && otherFeaturesCount === 0) {
            finalDimension = 77;  // 只有历史功能
        } else if (!hasHistoryGroup && otherFeaturesCount === 3) {
            finalDimension = 72;  // 关闭历史的三个功能
        } else if (!hasHistoryGroup && otherFeaturesCount === 2) {
            finalDimension = 50;  // 只有两个按钮
        } else if (!hasHistoryGroup && otherFeaturesCount === 1) {
            finalDimension = 28;  // 只有一个按钮
        } else {
            // 兜底动态计算逻辑: 基础28 + (额外按钮 * 22) + (如果有分隔线 ? 5 : 0)
            const extraCount = totalCount - 1;
            finalDimension = 28 + (extraCount * 22);
            if (hasDivider) finalDimension += 5;
        }

        // --- 3. 应用尺寸 ---
        const isVertical = this.anchorPosition.endsWith('-v');
        if (isVertical) {
            // 竖向布局：宽度固定，高度动态
            this.element.style.setProperty('--expanded-width', `28px`);
            this.element.style.setProperty('--expanded-height', `${finalDimension}px`);
        } else {
            // 横向布局：高度固定，宽度动态
            this.element.style.setProperty('--expanded-width', `${finalDimension}px`);
            this.element.style.setProperty('--expanded-height', `28px`);
        }

        /* 
        // --- 原有自动测量代码 (已注释，备用) ---
        const clone = this.content.cloneNode(true);
        clone.style.cssText = `
            position: absolute; 
            visibility: hidden; 
            height: auto; 
            width: auto; 
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 0;
        `;

        const isVerticalMeasure = this.anchorPosition.endsWith('-v');
        clone.style.flexDirection = isVerticalMeasure ? 'column' : 'row';

        document.body.appendChild(clone);
        const contentWidth = clone.scrollWidth;
        const contentHeight = clone.scrollHeight;
        document.body.removeChild(clone);

        const containerPadding = 4;
        const lastButtonMargin = 2;
        const collapsedSize = 28;

        let expandedWidth, expandedHeight;
        if (isVerticalMeasure) {
            expandedWidth = collapsedSize;
            expandedHeight = Math.max(contentHeight + containerPadding + lastButtonMargin, collapsedSize);
        } else {
            expandedWidth = Math.max(contentWidth + containerPadding + lastButtonMargin, collapsedSize);
            expandedHeight = collapsedSize;
        }

        this.element.style.setProperty('--expanded-width', `${expandedWidth}px`);
        this.element.style.setProperty('--expanded-height', `${expandedHeight}px`);
        */
    }

    _bindEvents() {
        // 带中断逻辑的悬停处理
        const onMouseEnter = () => this.expand();
        const onMouseLeave = () => this.collapse();

        // 绑定到悬停区域和元素本身
        // 使用 EventManager 来绑定，以便于清理
        this._cleanupFunctions.push(EventManager.addDOMListener(this.element, 'mouseenter', onMouseEnter));
        this._cleanupFunctions.push(EventManager.addDOMListener(this.element, 'mouseleave', onMouseLeave));
    }

    expand() {
        // 检查是否已销毁
        if (this.isDestroyed) return;

        // 清除任何挂起的折叠定时器
        if (this._collapseTimer) {
            clearTimeout(this._collapseTimer);
            this._collapseTimer = null;
        }

        // 先更新尺寸，确保 CSS 变量在展开前就设置好
        this.updateDimensions();

        // 根据锚点位置调整按钮递进动画索引
        this._updateButtonStaggerIndex();

        // 立即展开
        this.isCollapsed = false;
        this.element.classList.remove('collapsed');
        this.element.classList.add('expanded');

        // 隐藏指示器
        if (this.indicator) {
            this.indicator.style.opacity = '0';
            this.indicator.style.pointerEvents = 'none';
        }

        // 显示内容
        if (this.content) {
            this.content.style.opacity = '1';
            this.content.style.pointerEvents = 'auto';
        }
    }

    // 根据锚点位置调整按钮递进动画索引
    _updateButtonStaggerIndex() {
        if (!this.content) return;

        const children = Array.from(this.content.children);
        const totalButtons = children.length;

        // 判断是否需要反向索引
        // 右侧布局向左展开、底部布局向上展开时，需要反向（最后的按钮先显示）
        const needReverse = this._isReverseStaggerDirection();

        children.forEach((child, index) => {
            const staggerIndex = needReverse ? (totalButtons - 1 - index) : index;
            child.style.setProperty('--button-index', staggerIndex);
        });
    }

    // 判断递进动画是否需要反向
    _isReverseStaggerDirection() {
        // 从右侧/底部展开的布局需要反向
        // right 布局：从右向左展开，最右边的按钮先显示
        // bottom-v 布局：从下向上展开，最下面的按钮先显示
        const pos = this.anchorPosition;

        // 横向布局：右侧的需要反向
        if (pos.includes('right') && pos.endsWith('-h')) {
            return true;
        }
        // 竖向布局：底部的需要反向（column-reverse）
        if (pos.includes('bottom') && pos.endsWith('-v')) {
            return true;
        }

        return false;
    }

    collapse() {
        // 检查是否已销毁
        if (this.isDestroyed) return;

        // 调试模式：禁止自动折叠
        if (window.PA_DEBUG_NO_COLLAPSE) return;

        // 检查是否应阻止折叠（例如：激活的菜单）
        if (this.shouldCollapse && !this.shouldCollapse()) {
            return;
        }

        // 折叠前设置短暂延迟，允许鼠标在间隙/按钮之间移动
        // 但如果用户移回，expand() 会取消此操作。
        this._collapseTimer = setTimeout(() => {
            // 再次检查，因为在延迟期间状态可能已改变
            if (this.shouldCollapse && !this.shouldCollapse()) {
                return;
            }

            this.isCollapsed = true;
            this.element.classList.remove('expanded');
            this.element.classList.add('collapsed');

            // 显示指示器（清除内联样式，让 CSS 变量 --assistant-icon-opacity 生效）
            if (this.indicator) {
                this.indicator.style.opacity = '';
                this.indicator.style.pointerEvents = '';
            }

            // 隐藏内容
            if (this.content) {
                this.content.style.opacity = '0';
                this.content.style.pointerEvents = 'none';
            }

            // 折叠完成后，检测鼠标是否仍在热区内
            // 解决自动折叠后鼠标仍在热区，但需要移出再移入才能展开的问题
            this._checkMouseStillInHoverArea();
        }, 150); // 为了易用性设置的小延迟
    }

    // ---检测鼠标是否仍在热区内---
    _checkMouseStillInHoverArea() {
        if (!this.element) return;

        // 使用 requestAnimationFrame 确保 DOM 已更新
        requestAnimationFrame(() => {
            // 获取当前鼠标位置下的元素
            const hoveredElements = document.querySelectorAll(':hover');

            // 检查小助手容器或其子元素是否被悬停
            let isMouseInside = false;
            for (const el of hoveredElements) {
                if (this.element.contains(el) || el === this.element) {
                    isMouseInside = true;
                    break;
                }
            }

            // 如果鼠标仍在热区内，且当前是折叠状态，则触发展开
            if (isMouseInside && this.isCollapsed) {
                this.expand();
            }
        });
    }

    _setupSortable() {
        if (!this.content) return;

        this._sortable = new Sortable(this.content, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                const newOrder = Array.from(this.content.children)
                    .map(el => el.dataset.id)
                    .filter(Boolean);

                // 保存排序
                if (this.onButtonOrderChange) {
                    this.onButtonOrderChange(newOrder);
                }

                // 持久化到 settings
                this._saveOrderToSettings(newOrder);
            }
        });
    }

    _saveOrderToSettings(order) {
        const settingKey = `PromptAssistant.ButtonOrder.${this.type}`;
        // 使用 app.ui.settings 保存
        // ComfyUI 设置通常通过 app.ui.settings.setSettingValue(id, value) 设置
        if (app.ui && app.ui.settings) {
            app.ui.settings.setSettingValue(settingKey, JSON.stringify(order));
        }
    }

    restoreOrder() {
        const settingKey = `PromptAssistant.ButtonOrder.${this.type}`;
        if (!app.ui || !app.ui.settings) return;

        const orderStr = app.ui.settings.getSettingValue(settingKey);
        if (!orderStr) return;

        try {
            const order = JSON.parse(orderStr);
            if (!Array.isArray(order) || order.length === 0) return;

            // 按ID创建现有按钮的映射
            const buttonMap = new Map();
            Array.from(this.content.children).forEach(el => {
                if (el.dataset.id) {
                    buttonMap.set(el.dataset.id, el);
                }
            });

            // 按保存的顺序恢复按钮位置,新增按钮放在末尾
            const existingButtons = Array.from(this.content.children);
            const orderedIds = new Set(order);

            // 首先追加排序后的项
            order.forEach(id => {
                const el = buttonMap.get(id);
                if (el) {
                    this.content.appendChild(el);
                }
            });

            // 然后追加任何剩余项，如果它们不在顺序列表中
            existingButtons.forEach(el => {
                if (el.dataset.id && !orderedIds.has(el.dataset.id)) {
                    this.content.appendChild(el);
                }
            });

            this.updateDimensions();
        } catch (e) {
            logger.warn("[PromptAssistant] 恢复按钮顺序失败:", e);
        }
    }

    destroy() {
        // 防止重复销毁
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        // 清理定时器
        if (this._collapseTimer) {
            clearTimeout(this._collapseTimer);
            this._collapseTimer = null;
        }
        if (this._expandTimer) {
            clearTimeout(this._expandTimer);
            this._expandTimer = null;
        }

        // 清理监听器
        this._cleanupFunctions.forEach(fn => fn && fn());
        this._cleanupFunctions = [];

        // 销毁 Sortable
        if (this._sortable) {
            this._sortable.destroy();
            this._sortable = null;
        }

        // 移除元素
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        // 清空所有引用
        this.element = null;
        this.container = null;
        this.content = null;
        this.indicator = null;
        this.hoverArea = null;
        this.buttons = [];
    }
}
