/**
 * 图像节点小助手类
 * 用于检测和处理图像节点，提供图像反推功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { EventManager } from "../utils/eventManager.js";
import { llmVisionService } from '../services/llm_v.js';
import { HistoryCacheService } from '../services/cache.js';

// 调试开关
window.DEBUG_BOUNDS = false;        // 显示边界框
window.DEBUG_BOUNDS_INFO = false;   // 显示边界框信息
window.DEBUG_BOUNDS_LOG = false;    // 显示调试日志

class ImageCaption {
    /** 存储所有小助手实例的Map集合 */
    static instances = new Map();

    constructor() {
        this.initialized = false;
    }

    /**
     * 初始化图像小助手
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // 检查总开关状态
            if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
                logger.log("图像小助手初始化跳过：功能已禁用");
                return;
            }

            // 检查app.canvas是否可用
            if (!app.canvas) {
                throw new Error("画布未初始化");
            }

            // 初始化事件管理器
            EventManager.init();
            // 初始化资源管理器
            ResourceManager.init();
            // 注册节点选择事件监听
            this.registerNodeSelectionListener();

            this.initialized = true;
            logger.log("图像小助手初始化完成");

            // 如果有当前选中的节点，立即处理
            if (app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
                app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
            }
        } catch (error) {
            logger.error(`图像小助手初始化失败: ${error.message}`);
            this.initialized = false;
            this.cleanup();
        }
    }

    /**
     * 注册节点选择事件监听
     */
    registerNodeSelectionListener() {
        if (!app.canvas) {
            logger.error("画布未初始化，无法注册节点选择事件监听器");
            return;
        }

        // 创建选择事件处理器
        const selectionHandler = (selected_nodes) => {
            // 当总开关或图像反推功能关闭时，跳过所有节点处理
            if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
                return;
            }

            // 处理空选择情况
            if (!selected_nodes || Object.keys(selected_nodes).length === 0) {
                return;
            }

            // 处理选中的节点
            for (const nodeId in selected_nodes) {
                const node = app.canvas.graph._nodes_by_id[nodeId];
                if (!node || node.id === -1) continue;

                // 移除初始化标记判断，每次选中都重新检测节点状态
                this.checkAndSetupNode(node);
            }
        };

        // 保存原始的选择事件处理器
        if (app.canvas.onSelectionChange && app.canvas.onSelectionChange !== selectionHandler) {
            app.canvas._originalImageCaptionSelectionChange = app.canvas.onSelectionChange;
        }

        // 设置新的选择事件处理器
        app.canvas._imageCaptionSelectionHandler = selectionHandler;

        // 不覆盖现有的 onSelectionChange，因为提示词小助手可能已经设置了它
        // 而是在 index.js 中的 onSelected 方法中调用我们的处理器

        // 添加到LiteGraph的事件系统
        if (app.canvas.graph) {
            // 不覆盖现有的 onNodeSelectionChange，因为提示词小助手可能已经设置了它
            app.canvas.graph._imageCaptionNodeSelectionChange = selectionHandler;
        }

        // 初始检查当前选中的节点
        if (app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
            selectionHandler(app.canvas.selected_nodes);
        }
    }

    /**
     * 检查节点并设置小助手
     */
    checkAndSetupNode(node) {
        // 检查总开关和图像反推功能开关状态
        if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
            return;
        }

        // 检查节点是否有效
        if (!node) return;

        // 检查节点是否被折叠
        if (node.flags && node.flags.collapsed) {
            // 如果节点被折叠，清理已存在的小助手实例
            if (ImageCaption.hasInstance(node.id)) {
                this.cleanup(node.id);
            }
            return;
        }

        // 检查是否处于低质量渲染状态
        if (app.canvas) {
            const threshold = app.canvas.low_quality_zoom_threshold || 0.6;
            const scale = app.canvas.ds.scale;
            // 当处于低质量渲染状态时，清理小助手
            if (scale < threshold) {
                if (ImageCaption.hasInstance(node.id)) {
                    this.cleanup(node.id);
                }
                return;
            }
        }

        // 检查是否有有效图像
        if (!this.hasValidImage(node)) {
            // 如果节点没有有效图像，清理已存在的小助手实例
            if (ImageCaption.hasInstance(node.id)) {
                this.cleanup(node.id);
            }
            return;
        }

        // 检查实例是否已存在
        if (ImageCaption.hasInstance(node.id)) {
            // 显示已存在的实例
            const instance = ImageCaption.getInstance(node.id);
            if (instance) {
                this.showAssistantUI(instance);
            }
            return;
        }

        // 创建新的小助手实例
        const assistant = this.setupNodeAssistant(node);
        if (assistant) {
            logger.log(`创建图像小助手 | ID: ${node.id}`);
        }
    }

    /**
     * 检查节点是否包含有效图像
     */
    hasValidImage(node) {
        if (!node) return false;

        try {
            // 检查节点是否被折叠
            if (node.flags && node.flags.collapsed) {
                return false;
            }

            // 检查是否处于低质量渲染状态
            if (app.canvas) {
                // 获取画布的low_quality_zoom_threshold（默认0.6）
                const threshold = app.canvas.low_quality_zoom_threshold || 0.6;
                // 当前缩放比例
                const scale = app.canvas.ds.scale;
                // 如果缩放比例小于阈值，说明处于低质量渲染状态
                if (scale < threshold) {
                    return false;
                }
            }

            // 检查节点类型
            const imageNodeTypes = [
                'PreviewImage',
                'SaveImage',
                'LoadImage',
                'ImageUpload',
                'VHS_LoadImage',
                'IPAdapter_Preprocessor',
                'Image Preprocessor'
            ];

            // 检查图像相关属性
            const imageProperties = {
                // 标准图像属性
                hasImgs: !!(node.imgs && Array.isArray(node.imgs) && node.imgs.length > 0),
                hasImageIndex: typeof node.imageIndex === 'number',
                hasOverIndex: typeof node.overIndex === 'number',
                // 预览相关属性
                hasPreview: !!node.preview,
                hasPreviewImage: !!node.preview_image,
                // 输出相关属性（优化：只有同时满足输出类型为image且有实际图像数据时才返回true）
                hasRealImageOutput: false
            };

            // 检查是否有实际的图像输出
            if (node.outputs && node.outputs.some(output => output && (output.type === 'image' || output.name === 'IMAGE'))) {
                // 只有当节点同时有图像数据时才认为有真实图像输出
                imageProperties.hasRealImageOutput = imageProperties.hasImgs || imageProperties.hasPreview || imageProperties.hasPreviewImage;
            }

            // 对于PreviewImage和SaveImage类型的节点，只检查是否有实际的图像数据
            if (['PreviewImage', 'SaveImage'].includes(node.type)) {
                // 检查节点是否有图像数据
                if (imageProperties.hasImgs) {
                    // 如果有imageIndex，检查对应索引的图像是否存在
                    if (imageProperties.hasImageIndex) {
                        return !!node.imgs[node.imageIndex];
                    }
                    // 如果没有imageIndex但有图像数组，说明有图像
                    return true;
                }
                return false;
            }

            // 其他已知的图像节点类型
            if (imageNodeTypes.includes(node.type)) {
                return true;
            }

            // 检查标准图像属性
            if (imageProperties.hasImgs) {
                if (imageProperties.hasImageIndex && node.imgs[node.imageIndex]) {
                    return true;
                }
                if (imageProperties.hasOverIndex && node.imgs[node.overIndex]) {
                    return true;
                }
            }

            // 检查预览图像
            if (imageProperties.hasPreview || imageProperties.hasPreviewImage) {
                return true;
            }

            // 检查图像输出（优化：必须有实际图像数据）
            if (imageProperties.hasRealImageOutput) {
                return true;
            }

            return false;
        } catch (error) {
            logger.error(`检查节点图像失败 | ID: ${node.id} | ${error.message}`);
            return false;
        }
    }

    /**
     * 为节点设置小助手
     */
    setupNodeAssistant(node) {
        if (!node) return null;

        try {
            // 创建小助手实例
            const assistant = this.createAssistant(node);
            if (assistant) {
                // 初始化显示状态
                this.showAssistantUI(assistant);
                return assistant;
            }
            return null;
        } catch (error) {
            logger.error(`创建图像小助手失败 | ID: ${node.id} | ${error.message}`);
            return null;
        }
    }

    /**
     * 创建小助手实例
     */
    createAssistant(node) {
        if (!node) return null;

        const nodeId = node.id;

        // 检查是否已存在实例
        if (ImageCaption.hasInstance(nodeId)) {
            return ImageCaption.getInstance(nodeId);
        }

        // 创建小助手对象
        const assistant = {
            type: "image_caption",
            nodeId,
            buttons: {},
            node,
            isTransitioning: false,
            isFirstCreate: true,  // 标记是否为首次创建
            isMouseOver: false,   // 鼠标悬停状态
            isActive: false       // 激活状态
        };

        // 创建UI并添加到实例集合
        this.createAssistantUI(assistant);
        ImageCaption.addInstance(nodeId, assistant);

        // 设置初始显示状态
        assistant.isMouseOver = true;

        // 2秒后恢复正常的鼠标检测行为
        setTimeout(() => {
            if (assistant) {
                assistant.isFirstCreate = false;
                assistant.isMouseOver = false;
                this.updateAssistantVisibility(assistant);
            }
        }, 2000);

        return assistant;
    }

    /**
     * 创建小助手UI
     */
    createAssistantUI(assistant) {
        if (!assistant?.node) return null;

        try {
            // 创建内部内容容器
            const innerContentDiv = document.createElement('div');
            innerContentDiv.className = 'prompt-assistant-inner';

            // 创建主容器
            const containerDiv = document.createElement('div');
            containerDiv.className = 'prompt-assistant-container';
            containerDiv.dataset.nodeId = assistant.nodeId;

            // 添加内容容器到主容器
            containerDiv.appendChild(innerContentDiv);

            // 保存引用
            assistant.element = containerDiv;
            assistant.innerContent = innerContentDiv;
            assistant.buttons = {};

            // 初始化UI组件和事件
            this.addFunctionButtons(assistant);

            // 默认隐藏状态
            containerDiv.style.display = 'none';

            // 使用固定定位样式
            containerDiv.style.position = 'fixed';
            containerDiv.style.zIndex = '999';
            document.body.appendChild(containerDiv);

            // 新增：添加鼠标事件监听
            this._setupMouseEvents(assistant);

            // 新增：延迟设置位置，确保canvas已经初始化
            requestAnimationFrame(() => {
                this._setupUIPosition(assistant);
            });

            return containerDiv;
        } catch (error) {
            logger.error(`图像小助手UI创建失败 | ID: ${assistant.nodeId} | ${error.message}`);
            return null;
        }
    }

    /**
     * 添加功能按钮
     */
    addFunctionButtons(assistant) {
        if (!assistant?.element) return;

        // 创建反推按钮（中文）
        const buttonZh = this.addButtonWithIcon(assistant, {
            id: 'caption_zh',
            title: '反推提示词（中文）',
            icon: 'icon-caption-zh.svg',
            onClick: async (e, assistant) => {
                e.preventDefault();
                e.stopPropagation();
                await this.handleImageAnalysis(assistant, 'zh');
            }
        });

        // 创建分割线
        const divider = document.createElement('div');
        divider.className = 'prompt-assistant-divider';

        // 创建反推按钮（英文）
        const buttonEn = this.addButtonWithIcon(assistant, {
            id: 'caption_en',
            title: '反推提示词（英文）',
            icon: 'icon-caption-en.svg',
            onClick: async (e, assistant) => {
                e.preventDefault();
                e.stopPropagation();
                await this.handleImageAnalysis(assistant, 'en');
            }
        });

        // 按顺序添加元素：中文按钮 -> 分割线 -> 英文按钮
        if (buttonZh) {
            assistant.innerContent.appendChild(buttonZh);
        }
        assistant.innerContent.appendChild(divider);
        if (buttonEn) {
            assistant.innerContent.appendChild(buttonEn);
        }
    }

    /**
     * 处理图像分析
     */
    async handleImageAnalysis(assistant, lang) {
        try {
            const node = assistant.node;
            if (!node || !node.imgs || node.imgs.length === 0) {
                throw new Error('未找到有效的图像');
            }

            // 获取当前选中的图片
            const currentImage = node.imgs[node.imageIndex || 0];
            if (!currentImage) {
                throw new Error('未找到有效的图像');
            }

            // 获取按钮元素
            const buttonId = lang === 'en' ? 'caption_en' : 'caption_zh';
            const buttonElement = assistant.buttons[buttonId];
            if (!buttonElement) {
                throw new Error('未找到按钮元素');
            }

            // 设置当前按钮为处理中状态
            this._setButtonState(assistant, buttonId, 'processing', true);

            // 禁用其他按钮
            Object.keys(assistant.buttons).forEach(id => {
                if (id !== buttonId) {
                    this._setButtonState(assistant, id, 'disabled', true);
                }
            });

            // 更新小助手状态为激活状态
            this._updateAssistantActiveState(assistant, true);

            // 显示加载状态提示
            const tipMessage = lang === 'en' ? "反推提示词...（英文）" : "反推提示词...（中文）";
            UIToolkit.showStatusTip(
                buttonElement,
                'loading',
                tipMessage,
                { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
            );

            // 生成请求ID
            const request_id = `${node.id}_${Date.now()}`;

            // 调用图像分析服务，传入语言参数
            const result = await llmVisionService.analyzeImage(currentImage, request_id, lang);

            if (!result.success) {
                throw new Error(result.error);
            }

            // 获取描述文本
            const description = result.data.description;

            // 尝试复制到剪贴板
            let copySuccess = false;
            try {
                // 优先使用现代的 Clipboard API
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(description);
                    copySuccess = true;
                } else {
                    // 创建一个临时的textarea元素
                    const textarea = document.createElement('textarea');
                    textarea.value = description;
                    textarea.style.position = 'fixed';
                    textarea.style.left = '0';
                    textarea.style.top = '0';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);

                    // 尝试聚焦并选中文本
                    textarea.focus();
                    textarea.select();
                    textarea.setSelectionRange(0, textarea.value.length);

                    // 尝试复制
                    try {
                        copySuccess = document.execCommand('copy');
                    } catch (err) {
                        logger.warn(`execCommand复制失败: ${err.message}`);
                    }

                    // 移除临时元素
                    document.body.removeChild(textarea);
                }

                if (copySuccess) {
                    logger.debug('文本复制成功');
                } else {
                    throw new Error('复制到剪贴板操作未能成功执行');
                }
            } catch (copyError) {
                logger.warn(`复制到剪贴板失败: ${copyError.message}`);
                // 即使复制失败也继续执行，不抛出错误，但记录状态
                copySuccess = false;
            }

            // 为当前图像节点创建历史记录
            HistoryCacheService.addHistory({
                node_id: node.id,
                input_id: "image",
                content: description,
                operation_type: 'caption',
                timestamp: Date.now(),
                request_id: request_id
            });

            // 显示成功提示
            const successMessage = copySuccess 
                ? (lang === 'en' ? "反推完成，已复制到剪贴板" : "反推完成，已复制到剪贴板")
                : (lang === 'en' ? "反推完成，但复制失败" : "反推完成，但复制失败");

            UIToolkit.showStatusTip(
                buttonElement,
                copySuccess ? 'success' : 'warning',
                successMessage,
                { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
            );

            // 限制Toast显示的文本长度
            const maxLength = 40;
            const truncatedDescription = description.length > maxLength
                ? description.substring(0, maxLength) + '...'
                : description;

            // 显示Toast提示
            app.extensionManager.toast.add({
                severity: copySuccess ? "success" : "info",
                summary: copySuccess 
                    ? (lang === 'en' ? "图像反推完成（英文），请使用 ctrl+v 粘贴" : "图像反推完成（中文），请使用 ctrl+v 粘贴")
                    : (lang === 'en' ? "图像反推完成（英文），但复制失败，请手动复制" : "图像反推完成（中文），但复制失败，请手动复制"),
                detail: truncatedDescription,
                life: 5000
            });

            // 如果复制失败，创建一个对话框显示结果，允许用户手动复制
            if (!copySuccess) {
                this._showCopyDialog(description, lang);
            }

        } catch (error) {
            logger.error(`图像分析失败: ${error.message}`);

            // 获取按钮元素
            const buttonId = lang === 'en' ? 'caption_en' : 'caption_zh';
            const buttonElement = assistant.buttons[buttonId];

            if (buttonElement) {
                // 显示错误提示
                UIToolkit.showStatusTip(
                    buttonElement,
                    'error',
                    error.message,
                    { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
                );
            }

            app.extensionManager.toast.add({
                severity: "error",
                summary: lang === 'en' ? "Error" : "错误",
                detail: error.message,
                life: 3000
            });
        } finally {
            // 获取按钮ID
            const buttonId = lang === 'en' ? 'caption_en' : 'caption_zh';

            // 重置当前按钮状态
            this._setButtonState(assistant, buttonId, 'processing', false);

            // 恢复其他按钮状态
            Object.keys(assistant.buttons).forEach(id => {
                if (id !== buttonId) {
                    this._setButtonState(assistant, id, 'disabled', false);
                }
            });

            // 更新小助手状态为非激活状态
            this._updateAssistantActiveState(assistant, false);
        }
    }

    /**
     * 显示复制对话框
     * 当剪贴板API失败时，提供一个对话框让用户手动复制内容
     */
    _showCopyDialog(content, lang) {
        // 创建对话框容器
        const dialogContainer = document.createElement('div');
        dialogContainer.className = 'prompt-assistant-copy-dialog';
        dialogContainer.style.position = 'fixed';
        dialogContainer.style.top = '50%';
        dialogContainer.style.left = '50%';
        dialogContainer.style.transform = 'translate(-50%, -50%)';
        dialogContainer.style.backgroundColor = 'var(--litegraph-bg-color, #333)';
        dialogContainer.style.color = 'var(--litegraph-node-color, #eee)';
        dialogContainer.style.padding = '20px';
        dialogContainer.style.borderRadius = '8px';
        dialogContainer.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
        dialogContainer.style.zIndex = '9999';
        dialogContainer.style.maxWidth = '80%';
        dialogContainer.style.maxHeight = '80%';
        dialogContainer.style.overflow = 'auto';
        dialogContainer.style.display = 'flex';
        dialogContainer.style.flexDirection = 'column';
        dialogContainer.style.gap = '15px';

        // 创建标题
        const title = document.createElement('div');
        title.style.fontSize = '18px';
        title.style.fontWeight = 'bold';
        title.style.borderBottom = '1px solid var(--litegraph-node-color, #ccc)';
        title.style.paddingBottom = '10px';
        title.textContent = lang === 'en' ? '图像反推结果 (英文)' : '图像反推结果 (中文)';
        dialogContainer.appendChild(title);

        // 创建内容区域
        const contentArea = document.createElement('textarea');
        contentArea.value = content;
        contentArea.style.width = '100%';
        contentArea.style.minHeight = '200px';
        contentArea.style.padding = '10px';
        contentArea.style.border = '1px solid var(--litegraph-node-title, #666)';
        contentArea.style.borderRadius = '4px';
        contentArea.style.backgroundColor = 'var(--litegraph-node-title-color, #444)';
        contentArea.style.color = 'var(--litegraph-node-color, #eee)';
        contentArea.readOnly = true;
        dialogContainer.appendChild(contentArea);

        // 创建按钮容器
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'space-between';
        buttonContainer.style.gap = '10px';
        dialogContainer.appendChild(buttonContainer);

        // 创建复制按钮
        const copyButton = document.createElement('button');
        copyButton.textContent = '复制到剪贴板';
        copyButton.style.padding = '8px 15px';
        copyButton.style.backgroundColor = 'var(--litegraph-node-selected-color, #245)';
        copyButton.style.color = 'var(--litegraph-node-color, white)';
        copyButton.style.border = 'none';
        copyButton.style.borderRadius = '4px';
        copyButton.style.cursor = 'pointer';
        copyButton.onclick = () => {
            contentArea.select();
            try {
                const success = document.execCommand('copy');
                if (success) {
                    copyButton.textContent = '复制成功!';
                    setTimeout(() => {
                        copyButton.textContent = '复制到剪贴板';
                    }, 2000);
                } else {
                    copyButton.textContent = '复制失败，请手动选择和复制';
                    contentArea.focus();
                }
            } catch (err) {
                copyButton.textContent = '复制失败，请手动选择和复制';
                contentArea.focus();
            }
        };
        buttonContainer.appendChild(copyButton);

        // 创建关闭按钮
        const closeButton = document.createElement('button');
        closeButton.textContent = '关闭';
        closeButton.style.padding = '8px 15px';
        closeButton.style.backgroundColor = 'var(--litegraph-node-color-terminal, #333)';
        closeButton.style.color = 'var(--litegraph-node-color, white)';
        closeButton.style.border = 'none';
        closeButton.style.borderRadius = '4px';
        closeButton.style.cursor = 'pointer';
        closeButton.onclick = () => {
            document.body.removeChild(dialogContainer);
        };
        buttonContainer.appendChild(closeButton);

        // 添加到文档
        document.body.appendChild(dialogContainer);

        // 聚焦内容区域，使用户可以立即复制
        setTimeout(() => {
            contentArea.focus();
            contentArea.select();
        }, 100);
    }

    /**
     * 设置按钮状态
     */
    _setButtonState(assistant, buttonId, stateType, value = true) {
        try {
            const button = assistant.buttons[buttonId];
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
    _updateButtonClickability(button) {
        // 检查按钮是否处于禁用或处理中状态
        const isDisabled = button.classList.contains('button-disabled');
        const isProcessing = button.classList.contains('button-processing');

        if (isDisabled || isProcessing) {
            // 如果按钮被禁用或正在处理中，阻止点击事件
            button.style.pointerEvents = 'none';
        } else {
            // 恢复点击事件
            button.style.pointerEvents = 'auto';
        }
    }

    /**
     * 检查小助手是否有按钮处于激活状态
     */
    _checkAssistantActiveState(assistant) {
        if (!assistant || !assistant.buttons) return false;

        // 遍历所有按钮，检查是否有按钮处于active或processing状态
        for (const buttonId in assistant.buttons) {
            const button = assistant.buttons[buttonId];
            if (button.classList.contains('button-active') ||
                button.classList.contains('button-processing')) {
                return true;
            }
        }

        return false;
    }

    /**
     * 更新小助手激活状态
     */
    _updateAssistantActiveState(assistant, isActive) {
        if (!assistant) return;

        // 更新激活状态
        assistant.isActive = isActive;

        // 如果激活，强制显示小助手
        if (isActive) {
            this.showAssistantUI(assistant);
        } else {
            // 如果不再激活，根据鼠标悬停状态决定是否显示
            this.updateAssistantVisibility(assistant);
        }
    }

    /**
     * 添加带图标的按钮
     */
    addButtonWithIcon(assistant, config) {
        if (!assistant?.element || !assistant?.innerContent) return null;

        const { id, title, icon, onClick } = config;

        // 创建按钮
        const button = document.createElement('button');
        button.className = 'prompt-assistant-button';
        button.title = title || '';
        button.dataset.id = id || `btn_${Date.now()}`;
        button.dataset.icon = icon?.replace('.svg', '');

        // 添加图标
        if (icon) {
            UIToolkit.addIconToButton(button, icon, title || id);
        }

        // 添加事件
        if (typeof onClick === 'function') {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (button.classList.contains('button-processing')) {
                    // 如果按钮正在处理中，显示"处理中"提示
                    const tipMessage = id.includes('en') ? "反推提示词...（英文）" : "反推提示词...（中文）";
                    UIToolkit.showStatusTip(
                        button,
                        'loading',
                        tipMessage,
                        { x: button.getBoundingClientRect().left + button.offsetWidth / 2, y: button.getBoundingClientRect().top }
                    );
                    return;
                }

                // 如果按钮被禁用，不执行操作
                if (button.classList.contains('button-disabled')) {
                    return;
                }

                // 执行点击回调
                onClick(e, assistant);
            });
        }

        // 保存引用
        if (id) {
            assistant.buttons[id] = button;
        }

        return button;
    }

    /**
     * 设置UI位置
     */
    _setupUIPosition(assistant) {
        if (!assistant?.element || !assistant?.node) return;

        const containerDiv = assistant.element;

        // 更新位置的函数
        const updatePosition = () => {
            if (!assistant.element || !assistant.node) return;

            try {
                const canvas = app.canvas;
                // 如果canvas未初始化，延迟重试
                if (!canvas) {
                    requestAnimationFrame(() => updatePosition());
                    return;
                }

                // 获取节点边界
                const [nodeX, nodeY, nodeWidth, nodeHeight] = assistant.node.getBounding();

                // 计算内部偏移量（用于将小助手放在节点内部）
                const INNER_OFFSET_X = 10; // 水平偏移量
                const INNER_OFFSET_Y = 18; // 垂直偏移量

                // 计算定位点位置（节点右下角）
                const anchorX = nodeX + nodeWidth - INNER_OFFSET_X;
                const anchorY = nodeY + nodeHeight - INNER_OFFSET_Y;

                // 获取画布元素的边界
                const rect = canvas.canvas.getBoundingClientRect();

                // 使用LGraphCanvas的坐标转换方法
                // 将定位点位置转换为屏幕坐标
                const canvasPoint = canvas.convertOffsetToCanvas([anchorX, anchorY]);

                if (!canvasPoint) return;

                // 计算最终的屏幕坐标（考虑画布元素的位置）
                const screenX = canvasPoint[0] + rect.left;
                const screenY = canvasPoint[1] + rect.top;

                // 设置容器位置，使其右下角与定位点对齐
                containerDiv.style.right = `${window.innerWidth - screenX}px`;
                containerDiv.style.bottom = `${window.innerHeight - screenY}px`;
                containerDiv.style.left = 'auto';
                containerDiv.style.top = 'auto';

            } catch (error) {
                logger.error(`更新小助手位置失败: ${error.message}`);
            }
        };

        // 初始更新位置
        updatePosition();

        // 使用防抖函数优化位置更新
        const debouncedUpdatePosition = EventManager.debounce(updatePosition, 16); // 降低到16ms提高流畅度

        // 添加窗口resize事件监听
        assistant._eventCleanupFunctions = assistant._eventCleanupFunctions || [];
        const removeResizeListener = EventManager.addDOMListener(window, 'resize', debouncedUpdatePosition);
        assistant._eventCleanupFunctions.push(removeResizeListener);

        // 监听画布变化
        if (app.canvas) {
            // 监听画布重绘
            const originalDrawBackground = app.canvas.onDrawBackground;
            app.canvas.onDrawBackground = function () {
                const ret = originalDrawBackground?.apply(this, arguments);
                // 直接调用updatePosition而不是防抖版本，保证重绘时位置准确
                updatePosition();
                return ret;
            };

            // 添加画布重绘清理函数
            assistant._eventCleanupFunctions.push(() => {
                if (originalDrawBackground) {
                    app.canvas.onDrawBackground = originalDrawBackground;
                }
            });

            // 监听节点移动
            if (assistant.node) {
                // 使用LiteGraph提供的onNodeMoved事件
                const originalOnNodeMoved = app.canvas.onNodeMoved;
                app.canvas.onNodeMoved = function(node_dragged) {
                    if (originalOnNodeMoved) {
                        originalOnNodeMoved.apply(this, arguments);
                    }

                    // 仅当移动的是当前节点时更新位置
                    if (node_dragged && node_dragged.id === assistant.node.id) {
                        // 直接调用updatePosition而不是防抖版本，确保拖动时UI跟随节点
                        updatePosition();
                    }
                };

                // 添加节点移动清理函数
                assistant._eventCleanupFunctions.push(() => {
                    if (app.canvas) {
                        app.canvas.onNodeMoved = originalOnNodeMoved;
                    }
                });

                // 为节点本身添加移动监听（兼容性处理）
                const nodeOriginalOnNodeMoved = assistant.node.onNodeMoved;
                assistant.node.onNodeMoved = function() {
                    const ret = nodeOriginalOnNodeMoved?.apply(this, arguments);
                    // 直接调用updatePosition而不是防抖版本
                    updatePosition();
                    return ret;
                };

                // 添加节点自身移动清理函数
                assistant._eventCleanupFunctions.push(() => {
                    if (assistant.node && nodeOriginalOnNodeMoved) {
                        assistant.node.onNodeMoved = nodeOriginalOnNodeMoved;
                    }
                });
            }

            // 监听画布缩放
            const originalDSModified = app.canvas.ds.onModified;
            app.canvas.ds.onModified = function (...args) {
                if (originalDSModified) {
                    originalDSModified.apply(this, args);
                }
                // 缩放时直接更新，不使用防抖
                updatePosition();
            };

            // 添加画布缩放清理函数
            assistant._eventCleanupFunctions.push(() => {
                if (app.canvas?.ds) {
                    app.canvas.ds.onModified = originalDSModified;
                }
            });
        }

        // 添加DOM元素清理函数
        assistant._eventCleanupFunctions.push(() => {
            if (containerDiv && document.body.contains(containerDiv)) {
                document.body.removeChild(containerDiv);
            }
        });
    }

    /**
     * 设置鼠标事件监听
     */
    _setupMouseEvents(assistant) {
        if (!assistant?.node) return;

        const checkMouseInNodeArea = (e) => {
            // 检查总开关和图像反推功能开关状态
            if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
                return false;
            }

            const node = assistant.node;
            if (!node) return false;

            // 检查节点是否已被删除（关键修复）
            if (!app.canvas || !app.canvas.graph || !app.canvas.graph._nodes_by_id[node.id]) {
                return false;
            }

            const canvas = app.canvas;
            if (!canvas) return false;

            try {
                // 获取鼠标在画布中的位置（使用LGraphCanvas的转换方法）
                const canvasPos = canvas.convertEventToCanvasOffset(e);
                if (!canvasPos) return false;

                const [canvasX, canvasY] = canvasPos;

                // 获取节点边界 - 使用LiteGraph内置方法
                const [nodeX, nodeY, nodeWidth, nodeHeight] = node.getBounding();

                // 计算标题栏高度 - 根据ComfyUI的节点样式
                const titleHeight = node.flags?.collapsed ? 0 : (node.title_height || 30);

                // 计算内容区域（排除标题栏）
                const contentY = nodeY + titleHeight;
                const contentHeight = nodeHeight - titleHeight;

                // 检查鼠标是否在内容区域内（使用画布坐标系）
                const isInside = canvasX >= nodeX && canvasX <= nodeX + nodeWidth &&
                    canvasY >= contentY && canvasY <= contentY + contentHeight;

                // 检查鼠标是否在小助手UI上
                const isOverUI = assistant.element &&
                                assistant.element.style.display !== 'none' &&
                                EventManager.isMouseOverElement(assistant.element);

                return isInside || isOverUI;
            } catch (error) {
                logger.error(`检查节点区域失败: ${error.message}`);
                return false;
            }
        };

        // 使用 requestAnimationFrame 优化更新
        let rafId = null;
        let lastMouseEvent = null;

        const updateMouseState = () => {
            // 检查总开关和图像反推功能开关状态
            if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
                if (assistant.isMouseOver) {
                    assistant.isMouseOver = false;
                    this.updateAssistantVisibility(assistant);
                }
                rafId = null;
                return;
            }

            // 检查节点是否已被删除（关键修复）
            if (!assistant.node || !app.canvas || !app.canvas.graph || !app.canvas.graph._nodes_by_id[assistant.node.id]) {
                if (assistant.isMouseOver) {
                    assistant.isMouseOver = false;
                    this.updateAssistantVisibility(assistant);
                }
                rafId = null;
                return;
            }

            // 跳过首次创建的检查（首次创建时已经设置为显示）
            if (assistant.isFirstCreate) {
                rafId = null;
                return;
            }

            // 如果小助手处于激活状态，保持鼠标悬停状态为true
            if (assistant.isActive || this._checkAssistantActiveState(assistant)) {
                if (!assistant.isMouseOver) {
                    assistant.isMouseOver = true;
                    this.updateAssistantVisibility(assistant);
                }
                rafId = null;
                return;
            }

            // 只有在有最后鼠标事件的情况下才检查
            if (lastMouseEvent) {
                const isOver = checkMouseInNodeArea(lastMouseEvent);

                // 只在状态变化时更新可见性，避免不必要的重绘
                if (isOver !== assistant.isMouseOver) {
                    assistant.isMouseOver = isOver;
                    this.updateAssistantVisibility(assistant);
                }
            }

            rafId = null;
        };

        // 处理鼠标移动
        const handleMouseMove = (e) => {
            // 检查总开关和图像反推功能开关状态
            if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
                return;
            }

            lastMouseEvent = e;
            if (!rafId) {
                rafId = requestAnimationFrame(updateMouseState);
            }
        };

        // 处理画布变换
        const handleCanvasTransform = () => {
            // 检查总开关和图像反推功能开关状态
            if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
                return;
            }

            if (lastMouseEvent) {
                if (!rafId) {
                    rafId = requestAnimationFrame(updateMouseState);
                }
            }
        };

        // 添加事件监听
        if (app.canvas.canvas) {
            // 鼠标移动事件
            app.canvas.canvas.addEventListener('mousemove', handleMouseMove);

            // 画布变换事件
            const canvas = app.canvas;
            const originalDSModified = canvas.ds.onModified;
            canvas.ds.onModified = function (...args) {
                if (originalDSModified) {
                    originalDSModified.apply(this, args);
                }
                handleCanvasTransform();
            };

            // 保存清理函数
            assistant._eventCleanupFunctions = assistant._eventCleanupFunctions || [];
            assistant._eventCleanupFunctions.push(() => {
                app.canvas.canvas.removeEventListener('mousemove', handleMouseMove);
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                // 恢复原始的 onModified 处理器
                if (canvas.ds) {
                    canvas.ds.onModified = originalDSModified;
                }
            });
        }
    }

    /**
     * 更新小助手可见性
     */
    updateAssistantVisibility(assistant) {
        if (!assistant) return;

        // 检查总开关和图像反推功能开关状态
        if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
            this.hideAssistantUI(assistant);
            return;
        }

        // 检查节点是否已被删除（关键修复）
        if (assistant.node && (!app.canvas || !app.canvas.graph || !app.canvas.graph._nodes_by_id[assistant.node.id])) {
            this.hideAssistantUI(assistant);
            // 清理已删除节点的实例
            this.cleanup(assistant.node.id);
            return;
        }

        // 检查是否处于低质量渲染状态
        if (app.canvas) {
            const threshold = app.canvas.low_quality_zoom_threshold || 0.6;
            const scale = app.canvas.ds.scale;
            // 当处于低质量渲染状态时，隐藏小助手
            if (scale < threshold) {
                this.hideAssistantUI(assistant);
                return;
            }
        }

        // 跳过正在过渡的实例，避免动画中断
        if (assistant.isTransitioning) {
            return;
        }

        // 检查是否有按钮处于激活状态
        const hasActiveButtons = this._checkAssistantActiveState(assistant);

        // 如果有激活的按钮，强制显示小助手
        if (assistant.isActive || hasActiveButtons) {
            this.showAssistantUI(assistant);
            return;
        }

        // 根据鼠标悬停状态或首次创建标记决定显示或隐藏
        if (assistant.isFirstCreate || assistant.isMouseOver) {
            // 使用requestAnimationFrame确保在下一帧渲染，提高流畅性
            requestAnimationFrame(() => {
                this.showAssistantUI(assistant);
            });
        } else {
            // 使用requestAnimationFrame确保在下一帧渲染，提高流畅性
            requestAnimationFrame(() => {
                this.hideAssistantUI(assistant);
            });
        }
    }

    /**
     * 显示小助手UI
     */
    showAssistantUI(assistant, forceAnimation = false) {
        if (!assistant?.element) return;

        // 避免重复显示
        if (assistant.element.classList.contains('assistant-show') && !forceAnimation) {
            assistant.element.style.display = 'flex';
            assistant.element.style.opacity = '1';
            return;
        }

        // 取消任何隐藏计时器
        if (assistant.hideTimeout) {
            clearTimeout(assistant.hideTimeout);
            assistant.hideTimeout = null;
        }

        // 设置过渡状态
        assistant.isTransitioning = true;

        // 优化渲染性能
        assistant.element.style.willChange = 'auto';
        assistant.element.style.transform = 'translateZ(0)';
        assistant.element.style.opacity = '1';

        // 显示元素并应用动画类
        assistant.element.style.display = 'flex';
        void assistant.element.offsetWidth; // 触发回流
        assistant.element.classList.remove('assistant-hide');
        assistant.element.classList.add('assistant-show');

        // 动画结束后重置过渡状态
        setTimeout(() => {
            assistant.isTransitioning = false;
            // 动画结束后检查鼠标状态（关键修复）
            setTimeout(() => this.forceUpdateMouseState(assistant), 10);
        }, 300);
    }

    /**
     * 隐藏小助手UI
     */
    hideAssistantUI(assistant) {
        if (!assistant?.element) return;

        // 避免重复隐藏
        if (!assistant.element.classList.contains('assistant-show')) return;

        // 如果小助手处于激活状态且功能开关开启，不隐藏
        if (window.FEATURES && window.FEATURES.enabled && window.FEATURES.imageCaption &&
            (assistant.isActive || this._checkAssistantActiveState(assistant))) {
            return;
        }

        // 设置过渡状态
        assistant.isTransitioning = true;

        // 应用隐藏动画类
        assistant.element.classList.add('assistant-hide');
        assistant.element.classList.remove('assistant-show');

        // 触发回流确保动画生效
        void assistant.element.offsetWidth;

        // 动画结束后隐藏元素
        assistant.hideTimeout = setTimeout(() => {
            if (assistant.element) {
                assistant.element.style.display = 'none';
            }
            assistant.isTransitioning = false;
            // 动画结束后检查鼠标状态（关键修复）
            setTimeout(() => this.forceUpdateMouseState(assistant), 10);
        }, 300);
    }

    /**
     * 隐藏所有小助手
     */
    hideAllAssistants() {
        ImageCaption.instances.forEach(assistant => {
            this.hideAssistantUI(assistant);
        });
    }

    /**
     * 清理资源
     */
    cleanup(nodeId = null, silent = false) {
        try {
            if (nodeId) {
                // 清理特定节点
                const instance = ImageCaption.getInstance(nodeId);
                if (instance) {
                    // 记录删除前的实例数量
                    const beforeCount = ImageCaption.instances.size;
                    logger.debug(`[删除前] 图像小助手实例数量: ${beforeCount}`);

                    // 清理实例内部资源
                    this._cleanupInstance(instance, nodeId);

                    // 从实例集合中移除
                    ImageCaption.instances.delete(String(nodeId));

                    // 记录删除后的实例数量
                    const afterCount = ImageCaption.instances.size;

                    if (!silent) {
                        // 获取当前剩余的统计信息
                        logger.log(`清理图像小助手 | 节点ID: ${nodeId}`);
                        logger.log(`[剩余统计] 图像小助手实例: ${afterCount}个 | 删除前: ${beforeCount}个`);
                    }
                } else {
                    // 检查是否有以该nodeId开头的实例（关键修复）
                    const keysToDelete = Array.from(ImageCaption.instances.keys())
                        .filter(key => key.startsWith(`${nodeId}_`));

                    if (keysToDelete.length > 0) {
                        const beforeCount = ImageCaption.instances.size;

                        // 清理所有匹配的实例
                        keysToDelete.forEach(key => {
                            const instance = ImageCaption.getInstance(key);
                            if (instance) {
                                this._cleanupInstance(instance, key);
                                ImageCaption.instances.delete(key);
                            }
                        });

                        const afterCount = ImageCaption.instances.size;

                        if (!silent) {
                            logger.log(`清理图像小助手 | 节点ID: ${nodeId} | 关联实例: ${keysToDelete.length}个`);
                            logger.log(`[剩余统计] 图像小助手实例: ${afterCount}个 | 删除前: ${beforeCount}个`);
                        }
                    }
                }
                return;
            }

            // 清理所有实例
            const instanceCount = ImageCaption.instances.size;
            if (instanceCount > 0) {
                logger.debug(`[全部删除前] 图像小助手实例数量: ${instanceCount}`);

                ImageCaption.instances.forEach((instance, key) => {
                    this._cleanupInstance(instance, key);
                });
                ImageCaption.instances.clear();

                if (!silent) {
                    logger.log(`清理所有图像小助手 | 实例数: ${instanceCount}`);
                    logger.log(`[剩余统计] 图像小助手实例: 0个`);
                }
            }
        } catch (error) {
            logger.error(`清理资源失败: ${error.message}`);
        }
    }

    /**
     * 清理单个实例
     */
    _cleanupInstance(instance, instanceKey) {
        try {
            if (!instance) return;

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
            if (instance._eventCleanupFunctions) {
                instance._eventCleanupFunctions.forEach(cleanup => {
                    if (typeof cleanup === 'function') {
                        try {
                            cleanup();
                        } catch (err) {
                            logger.error(`事件清理失败: ${err.message}`);
                        }
                    }
                });
                instance._eventCleanupFunctions = [];
            }

            // 3. 从DOM中移除元素
            if (instance.element && instance.element.parentNode) {
                // 确保在移除元素前清理所有子元素的事件
                const allButtons = instance.element.querySelectorAll('button');
                allButtons.forEach(button => {
                    button.replaceWith(button.cloneNode(true));
                });
                instance.element.parentNode.removeChild(instance.element);
            }

            // 4. 清理节点引用（关键修复）
            if (instance.node) {
                delete instance.node;
            }

            // 5. 清理实例属性
            Object.keys(instance).forEach(key => {
                try {
                    delete instance[key];
                } catch (err) {
                    logger.error(`属性清理失败: ${err.message}`);
                }
            });

            logger.debug(`图像小助手实例清理 | 结果:成功 | 实例:${instanceKey}`);
        } catch (error) {
            logger.error(`图像小助手实例清理失败: ${error.message}`);
        }
    }

    // ---静态方法---
    /**
     * 添加实例到管理器
     */
    static addInstance(nodeId, assistant) {
        if (nodeId != null && assistant != null) {
            this.instances.set(String(nodeId), assistant);
            return true;
        }
        return false;
    }

    /**
     * 获取实例
     */
    static getInstance(nodeId) {
        if (nodeId == null) return null;

        // 确保nodeId是字符串类型
        const key = String(nodeId);
        const instance = this.instances.get(key);

        // 添加调试日志
        if (instance) {
            logger.debug(`获取图像小助手实例 | 节点ID: ${key} | 结果: 成功`);
        } else {
            logger.debug(`获取图像小助手实例 | 节点ID: ${key} | 结果: 未找到`);
        }

        return instance;
    }

    /**
     * 检查实例是否存在
     */
    static hasInstance(nodeId) {
        if (nodeId == null) return false;
        // 确保nodeId是字符串类型
        return this.instances.has(String(nodeId));
    }

    /**
     * 统一控制总开关功能
     * 集中管理所有受总开关控制的服务功能
     */
    async toggleGlobalFeature(enable, force = false) {
        try {
            // 更新状态
            const oldValue = window.FEATURES.imageCaption;

            // 状态未变化时不执行操作，除非force为true
            if (!force && oldValue === enable) {
                return;
            }

            logger.log(`图像小助手功能开关 | 动作:${enable ? "启用" : "禁用"}`);

            if (enable) {
                // === 启用图像小助手 ===

                // 1. 初始化图像小助手（如果尚未初始化）
                if (!this.initialized) {
                    await this.initialize();
                }

                // 2. 重置节点初始化标记，准备重新检测
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._imageCaptionInitialized = false;
                        }
                    });
                }

                // 3. 设置或恢复节点选择事件监听
                this.registerNodeSelectionListener();

                // 4. 如果有当前选中的节点，立即处理
                if (app.canvas && app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
                    app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
                }
            } else {
                // === 禁用图像小助手 ===

                // 清理所有图像小助手实例
                this.cleanup(null, true);
            }
        } catch (error) {
            logger.error(`图像小助手功能开关操作失败 | 错误: ${error.message}`);
        }
    }

    /**
     * 强制更新鼠标悬停状态
     */
    forceUpdateMouseState(assistant) {
        if (!assistant || !assistant.node || !assistant.element) return;

        // 总开关关闭时不处理鼠标状态更新
        if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
            return;
        }

        // 检查节点是否已被删除（关键修复）
        if (!app.canvas || !app.canvas.graph || !app.canvas.graph._nodes_by_id[assistant.node.id]) {
            assistant.isMouseOver = false;
            this.updateAssistantVisibility(assistant);
            return;
        }

        try {
            // 获取鼠标在画布中的位置
            const mousePos = EventManager.getMousePosition();
            const canvas = app.canvas;

            if (!canvas) return;

            // 将屏幕坐标转换为画布坐标
            const canvasPos = canvas.convertEventToCanvasOffset({
                clientX: mousePos.x,
                clientY: mousePos.y
            });

            if (!canvasPos) return;

            const [canvasX, canvasY] = canvasPos;

            // 获取节点边界
            const [nodeX, nodeY, nodeWidth, nodeHeight] = assistant.node.getBounding();

            // 计算标题栏高度 - 根据ComfyUI的节点样式
            const titleHeight = assistant.node.flags?.collapsed ? 0 : (assistant.node.title_height || 30);

            // 计算内容区域（排除标题栏）
            const contentY = nodeY + titleHeight;
            const contentHeight = nodeHeight - titleHeight;

            // 检查鼠标是否在内容区域内
            const isOverNode = canvasX >= nodeX && canvasX <= nodeX + nodeWidth &&
                canvasY >= contentY && canvasY <= contentY + contentHeight;

            // 检查鼠标是否在小助手UI上
            const isOverUI = assistant.element.style.display !== 'none' &&
                this.isMouseOverElement(assistant.element);

            // 更新状态
            const oldState = assistant.isMouseOver;
            assistant.isMouseOver = isOverNode || isOverUI;

            // 如果状态变化，更新可见性
            if (oldState !== assistant.isMouseOver) {
                logger.debug(`鼠标状态 | 手动更新 | 节点:${assistant.node.id} | 原状态:${oldState} | 新状态:${assistant.isMouseOver}`);
                this.updateAssistantVisibility(assistant);
            }

            return assistant.isMouseOver;
        } catch (error) {
            logger.error(`强制更新鼠标状态失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 判断鼠标是否在元素上方
     */
    isMouseOverElement(element) {
        if (!element) return false;

        try {
            // 获取鼠标位置
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
}

// 创建单例实例
const imageCaption = new ImageCaption();

// 导出
export { imageCaption, ImageCaption };