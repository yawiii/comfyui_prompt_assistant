import { app } from "../../../scripts/app.js";
import { EventManager } from "../utils/eventManager.js";
import "../lib/Sortable.min.js";

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

        // 重置类名
        this.element.className = `assistant-container-common ${this.type}-assistant-container collapsed`;

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

    updateDimensions() {
        if (!this.element || !this.content) return;

        // 测量内容尺寸
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

        // 根据方向设置 flex-direction
        const isVertical = this.anchorPosition.endsWith('-v');
        clone.style.flexDirection = isVertical ? 'column' : 'row';

        document.body.appendChild(clone);
        const contentWidth = clone.scrollWidth;
        const contentHeight = clone.scrollHeight;
        document.body.removeChild(clone);

        // 容器的 padding
        const containerPadding = 4; // 2px padding * 2

        // 按钮的 margin (每个按钮都有 margin: 2px)
        // 注意：scrollWidth/scrollHeight 不包含最后一个子元素的 margin-right/margin-bottom
        // 所以需要手动添加最后一个按钮的 margin
        const lastButtonMargin = 2; // 最后一个按钮的 margin-right 或 margin-bottom

        // 折叠状态的固定尺寸
        const collapsedSize = 28;

        // 根据布局方向计算展开后的尺寸
        let expandedWidth, expandedHeight;

        if (isVertical) {
            // 竖向布局：宽度固定为折叠尺寸，高度根据内容计算
            expandedWidth = collapsedSize;
            // contentHeight 不包含最后一个按钮的 margin-bottom，需要手动添加
            expandedHeight = Math.max(contentHeight + containerPadding + lastButtonMargin, collapsedSize);
        } else {
            // 横向布局：高度固定为折叠尺寸，宽度根据内容计算
            // contentWidth 不包含最后一个按钮的 margin-right，需要手动添加
            expandedWidth = Math.max(contentWidth + containerPadding + lastButtonMargin, collapsedSize);
            expandedHeight = collapsedSize;
        }

        // 更新 CSS 变量
        this.element.style.setProperty('--expanded-width', `${expandedWidth}px`);
        this.element.style.setProperty('--expanded-height', `${expandedHeight}px`);
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
        }, 150); // 为了易用性设置的小延迟
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
            console.warn("[PromptAssistant] 恢复按钮顺序失败:", e);
        }
    }

    destroy() {
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
    }
}
