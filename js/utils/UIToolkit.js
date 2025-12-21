/**
 * UI工具包
 * 提供通用的UI操作工具函数，供各模块共用
 */

import { logger } from './logger.js';
import { ResourceManager } from "./resourceManager.js";
import { APIService } from "../services/api.js";

class UIToolkit {
    // 中央按钮状态管理器 - 记录激活状态的按钮
    static #activeButtonInfo = null; // {widget, buttonId, popupInstance}

    // 状态提示管理器 - 记录每个按钮的状态提示元素
    static #statusTips = new Map(); // Map<buttonElement, tipElement>

    // 支持的输入字段ID
    static VALID_INPUT_IDS = ["text", "text_positive", "text_negative", "text_g", "text_l"];

    // 状态文本管理
    static STATUS_TEXTS = {
        translate: {
            loading: '翻译中',
            // success: (from, to) => `翻译完成 (${from} → ${to})`,
            success: (from, to) => '翻译完成',
            error: (msg) => msg || '翻译失败'
        },
        expand: {
            loading: '提示词优化中',
            success: '提示词优化完成',
            error: (msg) => msg || '提示词优化失败'
        }
    };

    /**
     * 检查输入控件是否为有效的文本输入
     * 支持传统litegraph模式和Vue node2.0模式
     */
    static isValidInput(widget, options = {}) {
        const { debug = false, node = null } = options;
        let isValid = false;
        let reason = '';

        // 方法1: 标准文本输入控件（传统litegraph模式）
        if (widget.inputEl && widget.inputEl.tagName === "TEXTAREA" &&
            this.VALID_INPUT_IDS.includes(widget.name)) {
            isValid = true;
            reason = 'litegraph textarea matched';
        }
        // 方法2: Note节点特殊输入
        else if (widget.element && widget.element.tagName === "TEXTAREA") {
            isValid = true;
            reason = 'Note textarea matched';
        }
        // 方法3: Markdown Note节点特殊输入（Tiptap编辑器）
        else if (this.isMarkdownNoteInput(widget)) {
            isValid = true;
            reason = 'Markdown Note matched';
        }
        // 方法4: Vue node2.0 模式检测 - 通过节点类型判断
        else if (this._isVueNodesModeWidget(widget, node)) {
            isValid = true;
            reason = 'Vue node2.0 mode widget';
        }

        if (debug) {
            const widgetName = widget.name || widget.id || 'unknown';
            const nodeType = node?.type || widget.node?.type || 'unknown';
            logger.debug(`[isValidInput] 控件: ${widgetName} | 节点类型: ${nodeType} | 有效: ${isValid} | 原因: ${reason}`);
        }

        return isValid;
    }

    /**
     * 检查是否为 Vue node2.0 模式下的有效文本控件
     * 在Vue模式下，widget对象可能没有inputEl/element，但节点类型可以判断
     */
    static _isVueNodesModeWidget(widget, node = null) {
        // 获取节点引用
        const nodeRef = node || widget.node;
        if (!nodeRef) return false;

        // 检查是否为Vue节点模式
        if (typeof LiteGraph !== 'undefined' && LiteGraph.vueNodesMode !== true) {
            return false;
        }

        // 已知支持的节点类型
        const supportedNodeTypes = [
            'Note',
            'MarkdownNote',
            'PreviewAny',       // Preview as Text节点（实际类型）
            'PreviewTextNode',  // Preview节点可能的其他名称
            'Show any [Crystools]',
            // 添加其他支持的节点类型
        ];

        // 检查节点类型
        if (supportedNodeTypes.includes(nodeRef.type)) {
            return true;
        }

        // 检查控件名称是否为有效输入
        if (this.VALID_INPUT_IDS.includes(widget.name)) {
            return true;
        }

        // Markdown类型节点检测（包括Preview as Text等使用comfy-markdown的节点）
        const typeLower = nodeRef.type?.toLowerCase() || '';
        if (typeLower.includes('markdown') ||
            (typeLower.includes('preview') && typeLower.includes('text'))) {
            return true;
        }

        return false;
    }

    /**
     * 检查是否为使用comfy-markdown的节点输入框
     * 包括 MarkdownNote、Preview as Text 等使用 Tiptap/ProseMirror 编辑器的节点
     */
    static isMarkdownNoteInput(widget) {
        // 方法1: 检查节点类型
        const nodeRef = widget.node;
        if (nodeRef) {
            // 支持的使用comfy-markdown的节点类型
            const markdownNodeTypes = ['MarkdownNote', 'PreviewAny', 'PreviewTextNode'];
            if (markdownNodeTypes.includes(nodeRef.type)) {
                return true;
            }

            // 检查节点类型名称是否包含相关关键词
            const typeLower = nodeRef.type?.toLowerCase() || '';
            if (typeLower.includes('markdown') ||
                (typeLower.includes('preview') && typeLower.includes('text'))) {
                return true;
            }
        }

        // 方法2: 检查widget名称（Vue模式下可能只有名称）
        if (widget.name === 'text' && nodeRef && nodeRef.type?.toLowerCase().includes('markdown')) {
            return true;
        }

        // 方法3: 通过 DOM 结构检测
        let element = widget.element || widget.inputEl;
        if (!element) return false;

        // 向上查找 .comfy-markdown 容器
        let parent = element.parentElement;
        while (parent) {
            if (parent.classList && parent.classList.contains('comfy-markdown')) {
                return true;
            }
            // Vue模式下检测 widget-markdown 类
            if (parent.classList && parent.classList.contains('widget-markdown')) {
                return true;
            }
            parent = parent.parentElement;
        }

        // 检查元素本身是否是 Tiptap 编辑器
        if (element.classList &&
            (element.classList.contains('tiptap') || element.classList.contains('ProseMirror'))) {
            return true;
        }

        return false;
    }

    /**
     * 获取 Markdown Note 的 Tiptap 编辑器实例
     * @param {HTMLElement} element - 输入框元素或相关元素
     * @returns {Object|null} Tiptap 编辑器实例，如果找不到则返回 null
     */
    static getMarkdownNoteEditor(element) {
        if (!element) return null;

        // 查找 .comfy-markdown 容器
        let container = element;
        if (!container.classList || !container.classList.contains('comfy-markdown')) {
            container = element.closest('.comfy-markdown');
        }

        if (!container) return null;

        // 查找 Tiptap 编辑器元素
        const editorElement = container.querySelector('.tiptap.ProseMirror, .ProseMirror.tiptap');
        if (!editorElement) return null;

        // 尝试从元素获取 Tiptap 编辑器实例
        // Tiptap 通常会将编辑器实例存储在元素的某个属性中
        if (editorElement.__tiptap_editor) {
            return editorElement.__tiptap_editor;
        }

        // 尝试从全局或父元素查找
        if (container.__tiptap_editor) {
            return container.__tiptap_editor;
        }

        // 如果找不到实例，返回编辑器元素本身，后续可以通过 DOM 操作
        return {
            element: editorElement,
            getHTML: () => editorElement.innerHTML,
            getText: () => editorElement.textContent || editorElement.innerText,
            setContent: (content) => {
                if (editorElement.__tiptap_editor) {
                    editorElement.__tiptap_editor.commands.setContent(content);
                } else {
                    // 降级方案：直接操作 DOM
                    editorElement.innerHTML = content;
                    // 触发更新事件
                    editorElement.dispatchEvent(new Event('input', { bubbles: true }));
                    editorElement.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        };
    }

    /**
     * 显示状态提示
     */
    static showStatusTip(anchorElement, type, message, position = null) {
        // 移除同一按钮上的旧提示
        this.removeStatusTip(anchorElement);

        // 创建提示元素
        const tipElement = document.createElement('div');
        tipElement.className = `statustip ${type}`;
        tipElement.textContent = message;
        document.body.appendChild(tipElement);

        // 设置位置和样式
        const { posX, posY } = this._calculateTipPosition(anchorElement, position);
        tipElement.style.left = `${posX}px`;
        tipElement.style.top = `${posY}px`;

        // 根据position类型调整transform
        if (position === 'top') {
            tipElement.style.transform = 'translate(-50%, -100%) translateY(-12px)';
        } else {
            tipElement.style.transform = 'translate(-50%, -100%) translateY(-8px)';
        }

        tipElement.classList.add('statustip-show');

        // 记录提示元素
        this.#statusTips.set(anchorElement, tipElement);

        // 设置自动消失
        this._setupTipAutoHide(tipElement, anchorElement);

        return tipElement;
    }

    /**
     * 移除指定按钮的状态提示
     */
    static removeStatusTip(anchorElement) {
        const existingTip = this.#statusTips.get(anchorElement);
        if (existingTip) {
            // 移除动画类
            existingTip.classList.remove('statustip-show');
            // 立即移除元素
            existingTip.parentNode?.removeChild(existingTip);
            // 从管理器中移除记录
            this.#statusTips.delete(anchorElement);
        }
    }

    /**
     * 计算提示气泡位置
     */
    static _calculateTipPosition(anchorElement, position) {
        let posX, posY;

        if (typeof position === 'object' && position !== null) {
            // 如果position是对象，直接使用其x,y值
            posX = position.x;
            posY = position.y;
        } else if (position === 'top') {
            // 如果position是'top'，将提示放在元素上方中央
            const rect = anchorElement.getBoundingClientRect();
            posX = rect.left + rect.width / 2;
            posY = rect.top;
        } else {
            // 默认情况，使用元素的位置
            const rect = anchorElement.getBoundingClientRect();
            posX = rect.left + rect.width / 2;
            posY = rect.top;
        }

        return { posX, posY };
    }

    /**
     * 设置提示自动隐藏
     */
    static _setupTipAutoHide(tipElement, anchorElement) {
        // 增加显示时间到2秒
        setTimeout(() => {
            // 检查提示是否仍然存在
            if (this.#statusTips.get(anchorElement) === tipElement) {
                tipElement.classList.remove('statustip-show');
                tipElement.classList.add('statustip-hide');

                setTimeout(() => {
                    // 再次检查提示是否仍然存在
                    if (this.#statusTips.get(anchorElement) === tipElement) {
                        tipElement.parentNode?.removeChild(tipElement);
                        this.#statusTips.delete(anchorElement);
                    }
                }, 400); // 这是提示框淡出动画的时长
            }
        }, 1000); // 显示1秒
    }

    /**
     * 为按钮添加图标
     * @param {HTMLElement} button 按钮元素
     * @param {string} icon 图标名称，支持SVG或PrimeIcons，例如'icon-history.svg'或'pi-times'
     * @param {string} alt 替代文本
     */
    static addIconToButton(button, icon, alt) {
        if (!icon) return;

        try {
            button.innerHTML = '';

            // 判断是否是PrimeIcon
            if (icon.startsWith('pi-')) {
                const iconSpan = document.createElement('span');
                iconSpan.className = `pi ${icon}`;
                iconSpan.title = alt || '';
                button.appendChild(iconSpan);
                return;
            }

            // 获取图标名称（确保带有.svg后缀）
            const iconName = icon.endsWith('.svg') ? icon : `${icon}.svg`;

            // 从ResourceManager获取图标
            const cachedImg = ResourceManager.getIcon(iconName);
            if (cachedImg) {
                button.appendChild(cachedImg);
                cachedImg.alt = alt || '';
                cachedImg.draggable = false;
            } else {
                logger.warn(`图标加载 | 结果:失败 | 图标: ${icon}, 原因: 未找到缓存`);
            }
        } catch (error) {
            logger.warn(`图标加载 | 结果:失败 | 图标: ${icon}, 错误: ${error.message}`);
        }
    }

    /**
     * 判断元素是否可见
     */
    static isElementVisible(element) {
        return element &&
            element.style.display !== 'none' &&
            element.style.visibility !== 'hidden';
    }

    /**
     * 创建并添加DOM元素
     */
    static createElement(tagName, props = {}, parent = null) {
        const element = document.createElement(tagName);

        // 设置属性
        Object.entries(props).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'style') {
                Object.assign(element.style, value);
            } else if (key === 'content') {
                element.textContent = value;
            } else {
                element[key] = value;
            }
        });

        // 添加到父元素
        if (parent) {
            parent.appendChild(element);
        }

        return element;
    }

    // ====================== 按钮状态管理 ======================

    /**
     * 获取当前激活的按钮信息
     */
    static getActiveButtonInfo() {
        return this.#activeButtonInfo;
    }

    /**
     * 设置当前激活的按钮信息
     */
    static setActiveButton(buttonInfo) {
        // 如果新旧按钮信息相同，不做任何处理
        if (this.#activeButtonInfo && buttonInfo &&
            this.#activeButtonInfo.widget === buttonInfo.widget &&
            this.#activeButtonInfo.buttonId === buttonInfo.buttonId) {
            return;
        }

        // 清理旧的激活按钮状态
        if (this.#activeButtonInfo) {
            const oldInfo = this.#activeButtonInfo;
            // 重置旧按钮状态
            this.setButtonState(oldInfo.widget, oldInfo.buttonId, 'active', false);
            logger.debug(`按钮状态重置 | 按钮:${oldInfo.buttonId} | 节点:${oldInfo.widget.nodeId}`);
        }

        // 设置新的激活按钮
        this.#activeButtonInfo = buttonInfo;

        // 如果有新的按钮信息，设置其状态为激活
        if (buttonInfo) {
            this.setButtonState(buttonInfo.widget, buttonInfo.buttonId, 'active', true);
            logger.debug(`按钮激活 | 按钮:${buttonInfo.buttonId} | 节点:${buttonInfo.widget.nodeId}`);
        }
    }

    /**
     * 检查按钮是否为当前激活按钮
     */
    static isActiveButton(widget, buttonId) {
        return this.#activeButtonInfo &&
            this.#activeButtonInfo.widget === widget &&
            this.#activeButtonInfo.buttonId === buttonId;
    }

    /**
     * 处理弹窗相关按钮点击
     */
    static handlePopupButtonClick(e, widget, buttonId, showPopupFn, hidePopupFn) {
        e.preventDefault();
        e.stopPropagation();

        logger.debug(`弹窗按钮点击 | 按钮: ${buttonId} | 节点: ${widget.nodeId}`);

        // 检查当前按钮状态
        const isCurrentActive = this.isActiveButton(widget, buttonId);

        // 如果当前按钮已激活，则关闭弹窗
        if (isCurrentActive) {
            // 重置按钮状态并隐藏弹窗
            this.setActiveButton(null);
            hidePopupFn();
            return;
        }

        // 设置新的激活按钮状态
        const buttonInfo = {
            widget,
            buttonId,
            timestamp: Date.now()
        };

        // **不要**在这里设置激活按钮，让弹窗管理器在清理完其他窗口后设置
        // this.setActiveButton(buttonInfo);

        // 显示弹窗
        showPopupFn({
            anchorButton: e.currentTarget,
            nodeId: widget.nodeId,
            inputId: widget.inputId,
            buttonInfo: buttonInfo,
            onClose: () => {
                // 弹窗关闭时，如果当前按钮仍为激活状态，则重置
                if (this.isActiveButton(widget, buttonId)) {
                    this.setActiveButton(null);
                }

                // 确保按钮状态恢复默认
                this.setButtonState(widget, buttonId, 'active', false);

                // 触发额外的回调
                if (typeof widget.onPopupClosed === 'function') {
                    widget.onPopupClosed(buttonId);
                }
            }
        });
    }

    /**
     * 获取按钮当前状态
     */
    static getButtonState(widget, buttonId) {
        if (!widget || !widget.buttons || !widget.buttons[buttonId]) {
            logger.error(`按钮状态获取 | 结果:失败 | 原因:按钮未找到 | 按钮ID:${buttonId}`);
            return null;
        }

        const button = widget.buttons[buttonId];

        return {
            active: button.classList.contains('button-active'),
            processing: button.classList.contains('button-processing'),
            disabled: button.classList.contains('button-disabled')
        };
    }

    /**
     * 设置按钮状态
     */
    static setButtonState(widget, buttonId, stateType, value = true) {
        try {
            const button = widget.buttons[buttonId];
            if (!button) return;

            const stateClass = `button-${stateType}`;

            if (value) {
                button.classList.add(stateClass);
                // 如果是禁用状态，添加disabled属性
                if (stateType === 'disabled') {
                    button.setAttribute('disabled', 'disabled');
                }
            } else {
                button.classList.remove(stateClass);
                // 如果取消禁用状态，移除disabled属性
                if (stateType === 'disabled') {
                    button.removeAttribute('disabled');
                }
            }

            // 更新按钮可点击状态
            this._updateButtonClickability(button);

        } catch (error) {
            logger.error(`按钮状态 | 设置失败 | 按钮:${buttonId} | 状态:${stateType} | 错误:${error.message}`);
        }
    }

    /**
     * 更新按钮可点击状态
     */
    static _updateButtonClickability(button) {
        // 检查按钮是否处于禁用状态
        const isDisabled = button.classList.contains('button-disabled');

        if (isDisabled) {
            // 如果按钮被禁用，阻止点击事件
            button.style.pointerEvents = 'none';
        } else {
            // 其他所有情况（包括processing）都允许点击，
            // 具体操作由事件监听器内部逻辑决定
            button.style.pointerEvents = 'auto';
        }
    }

    /**
     * 重置按钮状态
     */
    static resetButtonState(widget, buttonId = null) {
        try {
            const resetButton = (button, id) => {
                if (button) {
                    // 移除所有状态类
                    button.classList.remove('button-active', 'button-processing', 'button-disabled');
                    // 移除disabled属性
                    button.removeAttribute('disabled');
                    // 恢复点击事件
                    button.style.pointerEvents = 'auto';
                }
            };

            if (buttonId) {
                // 重置指定按钮
                const button = widget.buttons[buttonId];
                resetButton(button, buttonId);
            } else {
                // 重置所有按钮
                Object.entries(widget.buttons).forEach(([id, button]) => {
                    resetButton(button, id);
                });
            }
        } catch (error) {
            logger.error(`按钮状态 | 重置失败 | 按钮:${buttonId || 'all'} | 错误:${error.message}`);
        }
    }

    /**
     * 更新撤销/重做按钮状态
     */
    static updateUndoRedoButtonState(widget, LocalHistoryService) {
        // 更新撤销按钮状态
        const undoButton = widget.buttons['undo'];
        if (undoButton) {
            const canUndo = LocalHistoryService.canUndo(widget.nodeId, widget.inputId);
            this.setButtonState(widget, 'undo', 'disabled', !canUndo);
        }

        // 更新重做按钮状态
        const redoButton = widget.buttons['redo'];
        if (redoButton) {
            const canRedo = LocalHistoryService.canRedo(widget.nodeId, widget.inputId);
            this.setButtonState(widget, 'redo', 'disabled', !canRedo);
        }
    }

    /**
     * 处理按钮点击操作
     */
    static handleButtonOperation(e, widget, buttonId, operation, LocalHistoryService) {
        e.preventDefault();
        e.stopPropagation();

        // 获取按钮状态
        const state = this.getButtonState(widget, buttonId);

        // 如果按钮已禁用或正在处理中，不执行操作
        if (!state || state.disabled || state.processing) {
            logger.debug(`按钮操作 | 结果:跳过 | 按钮:${buttonId} | 原因:${state.disabled ? '已禁用' : '处理中'}`);
            return;
        }

        // 设置按钮为处理中状态
        this.setButtonState(widget, buttonId, 'processing', true);
        logger.debug(`按钮操作 | 动作:开始 | 按钮:${buttonId}`);

        // 执行操作（接收一个回调函数用于处理操作完成后的逻辑）
        try {
            const callback = (success = true, error = null) => {
                // 重置按钮状态
                this.setButtonState(widget, buttonId, 'processing', false);

                // 如果操作成功且有结果，将结果写入历史记录
                if (success && widget.inputEl && widget.inputEl.value) {
                    // 添加到历史
                    logger.debug(`准备写入历史｜ ${buttonId}操作完成｜ node_id=${widget.nodeId}`);
                    LocalHistoryService.addHistory({
                        workflow_id: '',
                        node_id: widget.nodeId,
                        input_id: widget.inputId,
                        content: widget.inputEl.value,
                        operation_type: buttonId, // 使用按钮ID作为操作类型
                    });
                }

                if (error) {
                    logger.error(`按钮操作完成 | 结果:失败 | 按钮:${buttonId} | 错误:${error}`);
                    this.showStatusTip(
                        e.currentTarget,
                        'error',
                        `操作失败: ${error?.message || '未知错误'}`,
                        null
                    );
                } else {
                    logger.debug(`按钮操作完成 | 结果:${success ? '成功' : '失败'} | 按钮:${buttonId}`);
                    this.showStatusTip(
                        e.currentTarget,
                        'success',
                        `${e.currentTarget.title || buttonId} 操作完成`,
                        null
                    );
                }
            };

            // 执行操作并传入回调
            logger.debug(`历史缓存 ｜ 按钮操作准备执行 node_id=${widget.nodeId} input_id=${widget.inputId} type=${buttonId}`);
            operation(callback);
        } catch (error) {
            // 出现异常时重置按钮状态
            this.setButtonState(widget, buttonId, 'processing', false);
            logger.error(`按钮操作 | 结果:异常 | 按钮:${buttonId} | 错误:${error.message}`);
            this.showStatusTip(
                e.currentTarget,
                'error',
                `操作异常: ${error.message}`,
                null
            );
        }
    }

    /**
     * 处理按钮点击
     * 显示状态提示信息
     */
    static handleButtonClick(e, widget, message, type) {
        const btnRect = e.target.getBoundingClientRect();
        this.showStatusTip(
            e.target,
            type,
            message,
            { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
        );
    }

    /**
     * 写入内容到输入框
     */
    static writeToInput(content, nodeId, inputId, options = { highlight: true, focus: false }) {
        const mappingKey = `${nodeId}_${inputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];

        if (mapping && mapping.inputEl) {
            const inputEl = mapping.inputEl;

            // 检查是否为 Markdown Note
            const editor = this.getMarkdownNoteEditor(inputEl);
            if (editor) {
                // 使用 Tiptap 编辑器写入内容
                editor.setContent(content);

                // 添加高亮效果（对编辑器元素）
                if (options.highlight && editor.element) {
                    this._highlightInput(editor.element);
                }

                // 聚焦编辑器
                if (options.focus && editor.element) {
                    editor.element.focus();
                }

                logger.debug(`内容写入 | 结果:成功 | 节点:${nodeId} | 输入框:${inputId} | 类型:Markdown Note`);
                return true;
            }

            // 标准输入框处理
            // 将内容写入输入框
            inputEl.value = content;

            // 触发input事件，确保UI和数据同步
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));

            // 添加高亮效果
            if (options.highlight) {
                this._highlightInput(inputEl);
            }

            // 聚焦输入框
            if (options.focus) {
                inputEl.focus();
            }

            logger.debug(`内容写入 | 结果:成功 | 节点:${nodeId} | 输入框:${inputId}`);
            return true;
        } else {
            logger.error(`内容写入 | 结果:失败 | 节点:${nodeId} | 输入框:${inputId} | 原因:找不到输入框`);
            return false;
        }
    }

    /**
     * 在光标位置插入内容
     */
    static insertAtCursor(content, nodeId, inputId, options = { highlight: true, keepFocus: true }) {
        const mappingKey = `${nodeId}_${inputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];

        if (mapping && mapping.inputEl) {
            const inputEl = mapping.inputEl;

            // 检查是否为 Markdown Note
            const editor = this.getMarkdownNoteEditor(inputEl);
            if (editor) {
                // 对于 Markdown Note，使用 Tiptap 的插入命令
                if (editor.element && editor.element.__tiptap_editor) {
                    const tiptapEditor = editor.element.__tiptap_editor;
                    // 使用 Tiptap 的 insertContent 命令
                    tiptapEditor.commands.insertContent(content);
                } else {
                    // 降级方案：获取当前文本，插入内容，然后设置回去
                    const currentText = editor.getText();
                    const selection = window.getSelection();
                    let cursorPos = 0;
                    if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        const preCaretRange = range.cloneRange();
                        preCaretRange.selectNodeContents(editor.element);
                        preCaretRange.setEnd(range.endContainer, range.endOffset);
                        cursorPos = preCaretRange.toString().length;
                    }
                    const beforeText = currentText.substring(0, cursorPos);
                    const afterText = currentText.substring(cursorPos);
                    const newContent = beforeText + content + afterText;
                    editor.setContent(newContent);
                }

                // 添加高亮效果
                if (options.highlight && editor.element) {
                    this._highlightInput(editor.element);
                }

                // 保持焦点
                if (options.keepFocus && editor.element) {
                    editor.element.focus();
                }

                logger.debug(`内容插入 | 结果:成功 | 节点:${nodeId} | 输入框:${inputId} | 类型:Markdown Note`);
                return true;
            }

            // 标准输入框处理
            const currentValue = inputEl.value;
            const cursorPos = inputEl.selectionStart;
            const beforeText = currentValue.substring(0, cursorPos);
            const afterText = currentValue.substring(inputEl.selectionEnd);

            // 插入内容
            const newValue = beforeText + content + afterText;
            inputEl.value = newValue;

            // 触发事件
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));

            // 更新光标位置
            const newPos = cursorPos + content.length;
            inputEl.setSelectionRange(newPos, newPos);

            // 添加高亮效果
            if (options.highlight) {
                this._highlightInput(inputEl);
            }

            // 根据参数决定是否保持焦点
            if (options.keepFocus) {
                inputEl.focus();
            }

            logger.debug(`内容插入 | 结果:成功 | 节点:${nodeId} | 输入框:${inputId}`);
            return true;
        } else {
            logger.error(`内容插入 | 结果:失败 | 节点:${nodeId} | 输入框:${inputId} | 原因:找不到输入框`);
            return false;
        }
    }

    /**
     * 为输入框添加高亮动画效果
     */
    static _highlightInput(inputEl) {
        // 移除可能存在的旧动画类
        inputEl.classList.remove('input-highlight');

        // 强制重绘
        void inputEl.offsetWidth;

        // 添加动画类
        inputEl.classList.add('input-highlight');

        // 动画结束后移除类
        setTimeout(() => {
            inputEl.classList.remove('input-highlight');
        }, 800); // 与CSS中的动画时长匹配
    }

    /**
     * 处理异步按钮操作
     */
    static async handleAsyncButtonOperation(widget, buttonId, buttonElement, asyncOperation) {
        const statusConfig = this.STATUS_TEXTS[buttonId] || {
            loading: '处理中',
            success: '完成',
            error: (msg) => msg || '操作失败'
        };

        let currentRequestId = null;
        let cancellationTimer = null;
        let cancelClickHandler = null;

        try {
            // 设置当前按钮为处理中状态
            this.setButtonState(widget, buttonId, 'processing', true);
            // 禁用其他按钮
            Object.keys(widget.buttons).forEach(id => {
                if (id !== buttonId) {
                    this.setButtonState(widget, id, 'disabled', true);
                }
            });

            // 执行异步操作，并捕获请求ID
            const result = await asyncOperation((requestId) => {
                currentRequestId = requestId;

                // 0.5秒后允许取消
                cancellationTimer = setTimeout(() => {
                    // 检查按钮是否仍在处理中
                    const currentState = this.getButtonState(widget, buttonId);
                    if (currentState && currentState.processing) {
                        buttonElement.classList.add('cancellable');
                        // 临时添加取消事件
                        cancelClickHandler = async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (currentRequestId) {
                                logger.debug(`用户取消请求 | ID: ${currentRequestId}`);
                                await APIService.cancelRequest(currentRequestId);

                                // 根据按钮ID显示不同的取消提示
                                let cancelMessage = '请求已取消';
                                if (buttonId === 'expand') {
                                    cancelMessage = '提示词优化已取消';
                                } else if (buttonId === 'translate') {
                                    cancelMessage = '翻译已取消';
                                }

                                // 显示取消提示
                                this.showStatusTip(buttonElement, 'info', cancelMessage);
                            }
                        };
                        buttonElement.addEventListener('click', cancelClickHandler);
                    }
                }, 500);
            });

            // 根据操作结果显示不同的提示
            if (result && result.success) {
                const btnRect = buttonElement.getBoundingClientRect();
                const tipPosition = { x: btnRect.left + btnRect.width / 2, y: btnRect.top };

                if (result.useCache && result.tipType && result.tipMessage) {
                    this.showStatusTip(
                        result.buttonElement || buttonElement,
                        result.tipType,
                        result.tipMessage,
                        tipPosition
                    );
                } else if (!result.useCache) {
                    this.showStatusTip(
                        buttonElement,
                        'success',
                        typeof statusConfig.success === 'function' ? statusConfig.success(result.from, result.to) : statusConfig.success,
                        tipPosition
                    );
                }
            } else {
                // 如果是用户取消的，则不显示错误
                if (!result?.cancelled) {
                    throw new Error(statusConfig.error(result?.error));
                }
            }

        } catch (error) {
            // 如果是用户取消的，错误信息已在API层处理，这里不再显示
            if (error.name !== 'AbortError' && !error.message.includes('aborted')) {
                const btnRect = buttonElement.getBoundingClientRect();
                this.showStatusTip(
                    buttonElement,
                    'error',
                    error.message,
                    { x: btnRect.left + btnRect.width / 2, y: btnRect.top }
                );
                logger.error(`按钮操作失败 | 按钮:${buttonId} | 错误:${error.message}`);
            }

        } finally {
            // 清理
            if (cancellationTimer) clearTimeout(cancellationTimer);
            if (cancelClickHandler) buttonElement.removeEventListener('click', cancelClickHandler);
            buttonElement.classList.remove('cancellable');

            // 恢复为旧的、可靠的重置逻辑
            // 重置当前按钮状态
            this.setButtonState(widget, buttonId, 'processing', false);
            // 恢复其他按钮状态
            Object.keys(widget.buttons).forEach(id => {
                if (id !== buttonId) {
                    this.setButtonState(widget, id, 'disabled', false);
                }
            });

            // 操作完成后，触发小助手自动折叠
            setTimeout(() => {
                if (window.promptAssistant && typeof window.promptAssistant.triggerAutoCollapse === 'function') {
                    window.promptAssistant.triggerAutoCollapse(widget);
                    logger.debug(`异步操作完成 | 触发自动折叠 | 按钮:${buttonId}`);
                }
            }, 1500);
        }
    }
}

export { UIToolkit };