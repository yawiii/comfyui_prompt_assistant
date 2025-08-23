/**
 * 图像节点小助手类
 * 用于检测和处理图像节点，提供图像反推功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { EventManager } from "../utils/eventManager.js";
import { APIService } from '../services/api.js';
import { HistoryCacheService } from '../services/cache.js';
import { buttonMenu } from "../services/btnMenu.js";
import { rulesConfigManager } from "./rulesConfigManager.js";


class ImageCaption {
    /** 存储所有小助手实例的Map集合 */
    static instances = new Map();

    constructor() {
        this.initialized = false;
    }

    /**
     * 获取低画质渲染阈值
     * 将此方法提取为类方法，确保所有地方使用相同的阈值计算逻辑
     */
    _getQualityThreshold() {
        // 优先从系统设置获取
        if (app.ui?.settings) {
            try {
                // 修复：不使用已弃用的defaultValue参数
                const settingValue = app.ui.settings.getSettingValue('Comfy.Graph.CanvasInfo');
                if (typeof settingValue === 'number') {
                    return settingValue;
                }
            } catch (e) {
                // 忽略错误，使用默认值
            }
        }
        // 从canvas对象获取
        return app.canvas?.low_quality_zoom_threshold || 0.6;
    }

    /**
     * 检查节点类型是否是允许的图像节点类型
     * @param {object} node - LiteGraph节点对象
     * @param {boolean} debug - 是否打印调试日志
     * @returns {boolean} 是否是允许的节点类型
     */
    _isAllowedNodeType(node, debug = false) {
        if (!node || !node.type) return false;
        
        // 允许的节点类型列表（可根据实际情况调整）
        const allowedTypes = [
            // 加载图像节点
            'LoadImage',
            'LoadImageFromUrl',
            
            // 预览图像节点
            'PreviewImage',
            'ImagePreview',
            
            // 保存图像节点
            'SaveImage',
            'SaveImages'
        ];
        
        // 检查节点类型是否在允许列表中
        // 使用部分匹配方式，以便兼容不同插件中的类似节点
        const isAllowed = allowedTypes.some(type => 
            node.type.includes(type) || 
            (node.title && node.title.includes(type))
        );
        
        // 开发阶段可打开调试日志
        if (debug && !isAllowed) {
            logger.debug(`[图像小助手] 节点类型不允许: ${node.type || '未知'} | 标题: ${node.title || '未知'}`);
        }
        
        return isAllowed;
    }

    /**
     * 检查节点和画布状态是否适合显示小助手
     * @param {object} node - LiteGraph节点对象
     * @returns {object} 返回检测结果对象
     */
    _checkNodeAndCanvasState(node) {
        const result = {
            isValid: false,
            isCollapsed: false,
            isLowQuality: false,
            hasValidImage: false
        };

        if (!node) {
            return result;
        }

        // 检查节点是否是允许的图像节点类型
        if (!this._isAllowedNodeType(node)) {
            return result;
        }

        // 检查节点是否被折叠
        if (node.flags && node.flags.collapsed) {
            result.isCollapsed = true;
            return result;
        }

        // 检查是否处于低质量渲染状态
        if (app.canvas) {
            // 获取低画质渲染阈值
            const threshold = this._getQualityThreshold();
            const scale = app.canvas.ds.scale;

            // 添加一个较大的容差值，解决浮点数比较和阈值应用延迟问题
            const epsilon = 0.001;
            if (scale <= threshold + epsilon) {
                result.isLowQuality = true;
                return result;
            }
        }

        // 检查节点是否有有效图像
        if (node.imgs && Array.isArray(node.imgs) && node.imgs.length > 0) {
            const imageIndex = node.imageIndex || 0;
            if (imageIndex >= 0 && imageIndex < node.imgs.length && node.imgs[imageIndex]) {
                result.hasValidImage = true;
                result.isValid = true;
            }
        }

        return result;
    }

    /**
     * 检查节点是否有有效图像
     * @param {object} node - LiteGraph节点对象
     * @returns {boolean} 是否有有效图像
     */
    hasValidImage(node) {
        if (!node) return false;

        // 检查节点类型是否允许
        if (!this._isAllowedNodeType(node)) {
            return false;
        }

        // 检查节点是否有imgs属性
        if (!node.imgs || !Array.isArray(node.imgs) || node.imgs.length === 0) {
            return false;
        }

        // 获取当前显示的图像
        const imageIndex = node.imageIndex || 0;
        return imageIndex >= 0 && imageIndex < node.imgs.length && node.imgs[imageIndex] != null;
    }

    /**
     * 获取节点当前显示的图像对象
     * @param {object} node - LiteGraph节点对象
     * @returns {object|null} 返回图像对象或null
     */
    getNodeImage(node) {
        // 检查节点类型是否允许
        if (!this._isAllowedNodeType(node)) {
            return null;
        }
        
        const state = this._checkNodeAndCanvasState(node);

        if (!state.isValid) {
            return null;
        }

        // 返回当前显示的图像
        const imageIndex = node.imageIndex || 0;
        return node.imgs[imageIndex];
    }

    /**
     * 初始化图像小助手
     */
    async initialize() {
        if (this.initialized) return true;

        try {
            // 检查总开关的初始状态
            const initialEnabled = app.ui.settings.getSettingValue("PromptAssistant.Features.ImageCaption");
            window.FEATURES.imageCaption = initialEnabled !== undefined ? initialEnabled : true;

            // 只在调试模式下记录初始化状态
            logger.debug(`图像反推功能初始化 | 状态:${window.FEATURES.imageCaption ? "启用" : "禁用"}`);

            // 注册节点选择监听器
            this.registerNodeSelectionListener();

            // 标记为已初始化
            this.initialized = true;
            logger.log("图像小助手初始化完成");
            return true;
        } catch (error) {
            logger.error(`图像小助手初始化失败 | 错误: ${error.message}`);
            this.initialized = false;
            return false;
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

        // 如果已经注册过选择事件处理器，则不再重复注册
        if (app.canvas._imageCaptionSelectionHandler) {
            logger.debug("图像小助手节点选择监听器已存在，跳过注册");
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

        // 添加到LiteGraph的事件系统
        if (app.canvas.graph) {
            app.canvas.graph._imageCaptionNodeSelectionChange = selectionHandler;
        }

        logger.debug("图像小助手节点选择监听器注册成功");

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

        // 检查节点类型是否允许
        if (!this._isAllowedNodeType(node)) {
            return;
        }

        // 检查节点是否已被删除（只有在删除时才清理实例）
        if (!app.canvas || !app.canvas.graph || !app.canvas.graph._nodes_by_id[node.id]) {
            // 节点已被删除，清理实例
            if (ImageCaption.hasInstance(node.id)) {
                this.cleanup(node.id);
            }
            return;
        }

        // 检查节点和画布状态
        const nodeState = this._checkNodeAndCanvasState(node);

        // 如果节点折叠或画布缩放过小，隐藏已存在的实例但不创建新实例
        if (nodeState.isCollapsed || nodeState.isLowQuality) {
            if (ImageCaption.hasInstance(node.id)) {
                const instance = ImageCaption.getInstance(node.id);
                if (instance) {
                    this.updateAssistantVisibility(instance);
                }
            }
            return;
        }

        // 使用新的方法检查节点是否有有效且可见的图像
        const currentImage = this.getNodeImage(node);

        if (currentImage) {
            // 有效图像，创建或显示小助手
            const existingInstance = ImageCaption.getInstance(node.id);

            // 验证现有实例是否有效
            if (existingInstance && existingInstance.element && document.body.contains(existingInstance.element)) {
                // 实例有效，显示它
                this.showAssistantUI(existingInstance);
            } else {
                // 实例无效或不存在，清理并创建新实例
                if (existingInstance) {
                    // 先清理可能存在但无效的实例
                    this.cleanup(node.id);
                }

                // 创建新的小助手实例
                const assistant = this.setupNodeAssistant(node);
                if (assistant) {
                    logger.log(`创建图像小助手 | ID: ${node.id}`);
                }
            }
        }
    }

    /**
     * 为节点设置小助手
     */
    setupNodeAssistant(node) {
        if (!node) return null;

        // 创建小助手实例
        const assistant = this.createAssistant(node);
        if (assistant) {
            // 初始化显示状态
            this.showAssistantUI(assistant);
            return assistant;
        }
        return null;
    }

    /**
     * 创建小助手实例
     */
    createAssistant(node) {
        // 检查节点是否有效
        if (!node || !node.id || node.id === -1) {
            return null;
        }

        // 检查是否已存在实例
        if (ImageCaption.hasInstance(node.id)) {
            return ImageCaption.getInstance(node.id);
        }

        // 创建小助手对象
        const assistant = {
            node,
            nodeId: node.id,
            buttons: {},
            isActive: false,
            isTransitioning: false,
            _eventCleanupFunctions: [], // 用于存储事件清理函数
            _timers: {} // 用于存储定时器引用
        };

        // 创建UI
        this.createAssistantUI(assistant);

        // 添加到实例集合
        ImageCaption.addInstance(node.id, assistant);

        // 设置节点折叠状态监听
        this._setupNodeCollapseListener(assistant);

        // 设置画布缩放监听
        this._setupCanvasScaleListener(assistant);

        // 显示小助手
        this.updateAssistantVisibility(assistant);

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
            innerContentDiv.className = 'image-assistant-inner';

            // 创建主容器
            const containerDiv = document.createElement('div');
            containerDiv.className = 'image-assistant-container image-assistant-transition';
            containerDiv.dataset.nodeId = assistant.nodeId;

            // 添加内容容器到主容器
            containerDiv.appendChild(innerContentDiv);

            // 创建悬停区域 - 用于检测鼠标悬停
            const hoverAreaDiv = document.createElement('div');
            hoverAreaDiv.className = 'image-assistant-hover-area';
            // 由于初始状态为折叠，所以显示悬停区域
            hoverAreaDiv.style.display = 'block';
            containerDiv.appendChild(hoverAreaDiv);

            // 创建折叠状态指示器图标
            const indicatorDiv = document.createElement('div');
            indicatorDiv.className = 'image-assistant-indicator animate-creation';

            // 从ResourceManager获取图标并添加到指示器
            const mainIcon = ResourceManager.getIcon('icon-main.svg');
            if (mainIcon) {
                indicatorDiv.appendChild(mainIcon);
            }

            containerDiv.appendChild(indicatorDiv);

            // 保存引用
            assistant.element = containerDiv;
            assistant.innerContent = innerContentDiv;
            assistant.hoverArea = hoverAreaDiv;
            assistant.indicator = indicatorDiv;
            assistant.buttons = {};
            assistant.isCollapsed = true; // 初始状态为折叠

            // 初始化UI组件和事件
            this.addFunctionButtons(assistant);

            // 默认隐藏状态
            containerDiv.style.display = 'none';

            // 使用固定定位样式
            containerDiv.style.position = 'fixed';
            containerDiv.style.zIndex = '1';
            document.body.appendChild(containerDiv);

            // 初始状态为折叠，添加折叠样式类
            containerDiv.classList.add('collapsed');

            // 延迟设置位置
            requestAnimationFrame(() => {
                this._setupUIPosition(assistant);
            });

            // 设置展开折叠事件
            this._setupCollapseExpandEvents(assistant);

            // 移除动画类的定时器
            setTimeout(() => {
                if (indicatorDiv && indicatorDiv.classList.contains('animate-creation')) {
                    indicatorDiv.classList.remove('animate-creation');
                }
            }, 1000);

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
            icon: 'icon-caption-zh',
            onClick: async (e, assistant) => {
                e.preventDefault();
                e.stopPropagation();
                await this.handleImageAnalysis(assistant, 'zh');
            },
            // 添加中文反推按钮的右键菜单
            contextMenu: async (assistant) => {
                let activePromptId = null;
                let visionPrompts = [];

                try {
                    const response = await fetch('/prompt_assistant/api/config/system_prompts');
                    if (response.ok) {
                        const data = await response.json();
                        activePromptId = data.active_prompts?.vision_zh || null;

                        if (data.vision_prompts) {
                            const originalOrder = Object.keys(data.vision_prompts);
                            originalOrder.forEach(key => {
                                if (key.startsWith('vision_zh')) {
                                    const prompt = data.vision_prompts[key];
                                    visionPrompts.push({
                                        id: key,
                                        name: prompt.name || key,
                                        isActive: key === activePromptId
                                    });
                                }
                            });
                            visionPrompts.sort((a, b) =>
                                originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                            );
                        }
                    }
                } catch (error) {
                    logger.error(`获取中文反推提示词失败: ${error.message}`);
                }

                if (visionPrompts.length === 0) {
                    return [{ label: '未找到提示词', disabled: true }];
                }

                // 添加分割线和规则管理按钮
                const menuItems = visionPrompts.map(prompt => ({
                    label: prompt.name,
                    icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                    onClick: async (context) => {
                        try {
                            const response = await fetch('/prompt_assistant/api/config/active_prompt', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type: 'vision_zh', prompt_id: prompt.id })
                            });
                            if (response.ok) {
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${prompt.name}`);
                            } else {
                                throw new Error(`服务器返回错误: ${response.status}`);
                            }
                        } catch (error) {
                            logger.error(`切换中文反推提示词失败: ${error.message}`);
                            UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${error.message}`);
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
                return menuItems;

            }
        });

        // 创建反推按钮（英文）
        const buttonEn = this.addButtonWithIcon(assistant, {
            id: 'caption_en',
            title: '反推提示词（英文）',
            icon: 'icon-caption-en',
            onClick: async (e, assistant) => {
                e.preventDefault();
                e.stopPropagation();
                await this.handleImageAnalysis(assistant, 'en');
            },
            // 添加英文反推按钮的右键菜单
            contextMenu: async (assistant) => {
                let activePromptId = null;
                let visionPrompts = [];

                try {
                    const response = await fetch('/prompt_assistant/api/config/system_prompts');
                    if (response.ok) {
                        const data = await response.json();
                        activePromptId = data.active_prompts?.vision_en || null;

                        if (data.vision_prompts) {
                            const originalOrder = Object.keys(data.vision_prompts);
                            originalOrder.forEach(key => {
                                if (key.startsWith('vision_en')) {
                                    const prompt = data.vision_prompts[key];
                                    visionPrompts.push({
                                        id: key,
                                        name: prompt.name || key,
                                        isActive: key === activePromptId
                                    });
                                }
                            });
                            visionPrompts.sort((a, b) =>
                                originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id)
                            );
                        }
                    }
                } catch (error) {
                    logger.error(`获取英文反推提示词失败: ${error.message}`);
                }

                if (visionPrompts.length === 0) {
                    return [{ label: '未找到提示词', disabled: true }];
                }

                // 添加分割线和规则管理按钮
                const menuItems = visionPrompts.map(prompt => ({
                    label: prompt.name,
                    icon: `<span class="pi ${prompt.isActive ? 'pi-check-circle active-status' : 'pi-circle-off inactive-status'}"></span>`,
                    onClick: async (context) => {
                        try {
                            const response = await fetch('/prompt_assistant/api/config/active_prompt', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type: 'vision_en', prompt_id: prompt.id })
                            });
                            if (response.ok) {
                                UIToolkit.showStatusTip(context.buttonElement, 'success', `已切换到: ${prompt.name}`);
                            } else {
                                throw new Error(`服务器返回错误: ${response.status}`);
                            }
                        } catch (error) {
                            logger.error(`切换英文反推提示词失败: ${error.message}`);
                            UIToolkit.showStatusTip(context.buttonElement, 'error', `切换失败: ${error.message}`);
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
                return menuItems;

            }
        });

        // 按顺序添加元素：中文按钮 -> 英文按钮
        if (buttonZh) {
            assistant.innerContent.appendChild(buttonZh);
        }
        if (buttonEn) {
            assistant.innerContent.appendChild(buttonEn);
        }
    }

    /**
     * 处理图像分析
     */
    async handleImageAnalysis(assistant, lang) {
        // 存储当前请求ID，用于取消操作
        let currentRequestId = null;

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

            // 检查按钮是否已经处于处理状态，如果是，则取消当前请求
            if (buttonElement.classList.contains('button-processing') && assistant.currentRequestId) {
                // 取消当前请求
                await APIService.cancelRequest(assistant.currentRequestId);

                // 显示取消提示
                UIToolkit.showStatusTip(
                    buttonElement,
                    'info',
                    '反推已取消',
                    { x: buttonElement.getBoundingClientRect().left + buttonElement.offsetWidth / 2, y: buttonElement.getBoundingClientRect().top }
                );

                // 重置按钮状态
                this._setButtonState(assistant, buttonId, 'processing', false);

                // 恢复其他按钮状态
                Object.keys(assistant.buttons).forEach(id => {
                    if (id !== buttonId) {
                        this._setButtonState(assistant, id, 'disabled', false);
                    }
                });

                // 更新小助手状态为非激活状态
                this._updateAssistantActiveState(assistant, false);

                // 清除当前请求ID
                assistant.currentRequestId = null;

                return;
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
            currentRequestId = `${node.id}_${Date.now()}`;
            // 保存到assistant对象中，以便取消操作
            assistant.currentRequestId = currentRequestId;

            // 将图像转换为Base64
            let imageBase64;
            try {
                imageBase64 = await APIService.imageToBase64(currentImage);
                if (!imageBase64) {
                    throw new Error('图像转换失败');
                }
            } catch (e) {
                throw new Error(`图像转换失败: ${e.message || e}`);
            }

            // 确保图像数据格式正确
            if (typeof imageBase64 !== 'string') {
                throw new Error(`图像数据类型错误: ${typeof imageBase64}`);
            }

            // 确保图像数据是Base64格式
            if (!imageBase64.startsWith('data:image')) {
                imageBase64 = `data:image/jpeg;base64,${imageBase64}`;
            }

            // 获取当前激活的提示词内容
            let promptContent = '';
            try {
                const response = await fetch('/prompt_assistant/api/config/system_prompts');
                if (response.ok) {
                    const data = await response.json();
                    const activePromptKey = `vision_${lang}`;
                    const activePromptId = data.active_prompts?.[activePromptKey];
                    if (activePromptId && data.vision_prompts?.[activePromptId]) {
                        promptContent = data.vision_prompts[activePromptId].content;
                    }
                }
                if (!promptContent) {
                    throw new Error(`未找到有效的 ${lang === 'zh' ? '中文' : '英文'} 反推提示词`);
                }
            } catch (error) {
                throw new Error(`获取反推规则失败: ${error.message}`);
            }

            // 调用图像分析服务，传入提示词内容
            const result = await APIService.llmAnalyzeImage(imageBase64, promptContent, currentRequestId);

            // 清除当前请求ID
            assistant.currentRequestId = null;

            // 检查是否被取消
            if (result && result.cancelled) {
                logger.debug(`图像分析请求已取消 | ID: ${currentRequestId}`);
                return;
            }

            if (!result || !result.success) {
                const errorMsg = result?.error || '未知错误';
                throw new Error(errorMsg);
            }

            // 获取描述文本
            const description = result.data.description;
            if (!description) {
                throw new Error('未获取到图像描述');
            }

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

                if (!copySuccess) {
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
                request_id: currentRequestId
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
            // 清除当前请求ID
            assistant.currentRequestId = null;

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
            };

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
        dialogContainer.className = 'image-assistant-copy-dialog';

        // 创建标题
        const title = document.createElement('div');
        title.className = 'image-assistant-copy-dialog-title';
        title.textContent = '由于剪贴板权限被限制，请手动点击复制提示词内容';
        dialogContainer.appendChild(title);

        // 创建关闭按钮
        const closeButton = document.createElement('button');
        closeButton.className = 'image-assistant-copy-dialog-close';
        closeButton.onclick = () => {
            document.body.removeChild(dialogContainer);
        };

        // 添加关闭图标
        UIToolkit.addIconToButton(closeButton, 'pi-times', '关闭');
        dialogContainer.appendChild(closeButton);

        // 创建文本区域
        const contentArea = document.createElement('textarea');
        contentArea.className = 'image-assistant-copy-dialog-textarea';
        contentArea.value = content;
        contentArea.readOnly = true;
        dialogContainer.appendChild(contentArea);

        // 创建复制按钮
        const copyButton = document.createElement('button');
        copyButton.className = 'image-assistant-copy-dialog-copy-btn';
        copyButton.textContent = '复制到剪贴板';
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
        dialogContainer.appendChild(copyButton);

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
            this._updateButtonClickability(button, stateType, value);

        } catch (error) {
            logger.error(`按钮状态 | 设置失败 | 按钮:${buttonId} | 状态:${stateType} | 错误:${error.message}`);
        }
    }

    /**
     * 更新按钮可点击状态
     */
    _updateButtonClickability(button, stateType, value) {
        // 检查按钮是否处于禁用状态
        const isDisabled = button.classList.contains('button-disabled');

        // 处理中的按钮仍然可点击（用于取消操作）
        const isProcessing = button.classList.contains('button-processing');

        if (isDisabled) {
            // 如果按钮被禁用，阻止点击事件
            button.style.pointerEvents = 'none';
        } else {
            // 恢复点击事件，包括处理中的按钮
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
            // 如果不再激活，先更新可见性
            this.updateAssistantVisibility(assistant);

            // 然后手动触发自动折叠（如果小助手仍然可见且处于展开状态）
            if (assistant.element &&
                assistant.element.style.display !== 'none' &&
                !assistant.isCollapsed &&
                !assistant.isTransitioning) {
                // 延迟一点时间再触发折叠，让用户有时间看到结果
                setTimeout(() => {
                    this.triggerAutoCollapse(assistant);
                }, 1500); // 1.5秒后自动折叠，给用户足够时间查看结果
            }
        }
    }

    /**
     * 显示小助手UI 
     */
    showAssistantUI(assistant) {
        if (!assistant?.element) return;

        // 避免重复显示
        if (assistant.element.classList.contains('image-assistant-show')) {
            // 确保元素可见
            assistant.element.style.display = 'flex';
            assistant.element.style.opacity = '1';
            return;
        }

        // 直接显示，无动画过渡
        assistant.element.style.opacity = '1';
        assistant.element.style.display = 'flex';
        assistant.element.classList.add('image-assistant-show');

        // 确保悬停区域可见（用于折叠状态下的交互）
        if (assistant.isCollapsed && assistant.hoverArea) {
            assistant.hoverArea.style.display = 'block';
        }

        // 重置过渡状态
        assistant.isTransitioning = false;

        // 只有当明确不是折叠状态时才触发自动折叠
        if (!assistant.isCollapsed) {
            this.triggerAutoCollapse(assistant);
        }
    }

    /**
     * 隐藏小助手UI
     */
    hideAssistantUI(assistant) {
        if (!assistant?.element) return;

        // 清除自动折叠定时器
        if (assistant._autoCollapseTimer) {
            clearTimeout(assistant._autoCollapseTimer);
            assistant._autoCollapseTimer = null;
        }

        // 隐藏元素
        assistant.element.style.display = 'none';
        assistant.element.classList.remove('image-assistant-show');

        // 重置状态
        assistant.isTransitioning = false;
    }

    /**
     * 更新小助手可见性
     */
    updateAssistantVisibility(assistant) {
        if (!assistant) return;

        // 记录当前显示状态，用于检测变化
        const wasVisible = assistant.element &&
            assistant.element.style.display !== 'none' &&
            assistant.element.classList.contains('image-assistant-show');

        // 检查总开关和图像反推功能开关状态
        if (!window.FEATURES || !window.FEATURES.enabled || !window.FEATURES.imageCaption) {
            this.cleanup(assistant.node.id);
            return;
        }

        // 检查节点是否已被删除（关键修复）
        if (assistant.node && (!app.canvas || !app.canvas.graph || !app.canvas.graph._nodes_by_id[assistant.node.id])) {
            // 清理已删除节点的实例
            this.cleanup(assistant.node.id);
            return;
        }

        // 使用统一的状态检测方法
        const nodeState = this._checkNodeAndCanvasState(assistant.node);

        // 检查是否有按钮处于激活状态
        const hasActiveButtons = this._checkAssistantActiveState(assistant);

        // 确定新的可见性状态
        let shouldBeVisible = true;

        // 如果有激活的按钮，强制显示小助手（覆盖其他隐藏条件）
        if (hasActiveButtons) {
            this.showAssistantUI(assistant);

            // 如果当前是折叠状态，则展开
            if (assistant.isCollapsed) {
                this._expandAssistant(assistant);
            }

            return;
        }

        // 如果节点折叠或画布缩放过小，隐藏小助手但不清理实例
        if (nodeState.isCollapsed || nodeState.isLowQuality) {
            shouldBeVisible = false;
        }

        // 如果节点没有有效图像，隐藏小助手但不清理实例
        if (!nodeState.hasValidImage) {
            shouldBeVisible = false;
        }

        // 跳过正在过渡的实例，避免动画中断
        if (assistant.isTransitioning) {
            return;
        }

        // 根据可见性状态更新UI
        if (shouldBeVisible) {
            // 条件满足时显示小助手
            this.showAssistantUI(assistant);
        } else {
            // 隐藏小助手
            this.hideAssistantUI(assistant);
        }
    }

    /**
     * 展开小助手
     */
    _expandAssistant(assistant) {
        if (!assistant || !assistant.element || !assistant.isCollapsed || assistant.isTransitioning) return;

        assistant.isTransitioning = true;

        // 隐藏悬停区域，避免覆盖按钮
        if (assistant.hoverArea) {
            assistant.hoverArea.style.display = 'none';
        }

        const containerDiv = assistant.element;

        // 计算展开后的宽度
        let targetWidth = containerDiv.style.getPropertyValue('--expanded-width');

        // 如果没有保存宽度或需要重新计算
        if (!targetWidth || targetWidth === '') {
            // 先移除折叠类，但保持不可见状态进行测量
            containerDiv.classList.remove('collapsed');
            const originalDisplay = containerDiv.style.display;
            const originalOpacity = containerDiv.style.opacity;

            // 临时设置样式以便测量
            containerDiv.style.opacity = '0';
            containerDiv.style.display = 'flex';
            containerDiv.style.position = 'fixed';

            // 强制回流并测量
            void containerDiv.offsetWidth;

            // 获取自然宽度
            const naturalWidth = containerDiv.offsetWidth;
            targetWidth = naturalWidth + 'px';

            // 保存宽度供将来使用
            containerDiv.style.setProperty('--expanded-width', targetWidth);

            // 恢复原始样式
            containerDiv.style.opacity = originalOpacity;
            containerDiv.style.position = 'fixed';

            // 重新应用折叠类以准备动画
            containerDiv.classList.add('collapsed');
            void containerDiv.offsetWidth; // 强制回流
        }

        // 手动设置宽度转换
        containerDiv.style.width = '28px'; // 起始宽度

        // 强制回流
        void containerDiv.offsetWidth;

        // 移除折叠类
        containerDiv.classList.remove('collapsed');

        // 设置目标宽度以触发过渡
        containerDiv.style.width = targetWidth;

        // 动画结束后清理
        setTimeout(() => {
            // 移除固定宽度，恢复自动宽度
            containerDiv.style.width = '';
            assistant.isCollapsed = false;
            assistant.isTransitioning = false;
        }, 300);
    }

    /**
     * 触发自动折叠
     */
    triggerAutoCollapse(assistant) {
        // 如果widget没有初始化或者已经处于折叠状态，则不处理
        if (!assistant || !assistant.element || assistant.isCollapsed || assistant.isTransitioning) return;

        // 如果有活跃按钮，不自动折叠
        if (this._checkAssistantActiveState(assistant)) return;

        // 如果鼠标当前悬停在容器上，不自动折叠
        if (assistant.isMouseOver) return;

        // 清除可能已存在的自动折叠定时器
        if (assistant._autoCollapseTimer) {
            clearTimeout(assistant._autoCollapseTimer);
        }

        // 设置自动折叠定时器
        assistant._autoCollapseTimer = setTimeout(() => {
            // 再次检查条件
            if (!assistant.isCollapsed && !assistant.isTransitioning &&
                !this._checkAssistantActiveState(assistant) && !assistant.isMouseOver) {

                const containerDiv = assistant.element;

                // 保存当前宽度用于展开动画
                if (containerDiv.offsetWidth > 0) {
                    containerDiv.style.setProperty('--expanded-width', `${containerDiv.offsetWidth}px`);
                }

                // 设置过渡状态
                assistant.isTransitioning = true;

                // 直接添加折叠类
                containerDiv.classList.add('collapsed');
                assistant.isCollapsed = true;

                // 显示悬停区域，用于检测鼠标悬停以展开UI
                if (assistant.hoverArea) {
                    assistant.hoverArea.style.display = 'block';
                }

                // 动画结束后重置过渡状态
                setTimeout(() => {
                    assistant.isTransitioning = false;
                }, 300);
            }

            assistant._autoCollapseTimer = null;
        }, 1000);
    }

    /**
     * 添加带图标的按钮
     */
    addButtonWithIcon(assistant, config) {
        if (!assistant?.element || !assistant?.innerContent) return null;

        const { id, title, icon, onClick, contextMenu } = config;

        // 创建按钮
        const button = document.createElement('button');
        button.className = 'image-assistant-button';
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

                // 即使按钮正在处理中也允许点击，用于取消操作
                // 如果按钮被禁用，不执行操作
                if (button.classList.contains('button-disabled')) {
                    return;
                }

                // 执行点击回调
                onClick(e, assistant);
            });
        }

        // 添加右键菜单（如果有）
        if (contextMenu && typeof contextMenu === 'function') {
            this._setupButtonContextMenu(button, contextMenu, assistant);
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

                // 获取画布缩放比例
                const scale = canvas.ds.scale;

                // 获取节点边界
                const [nodeX, nodeY, nodeWidth, nodeHeight] = assistant.node.getBounding();

                // 计算内部偏移量（用于将小助手放在节点内部）
                const INNER_OFFSET_X = 6; // 水平偏移量
                const INNER_OFFSET_Y = 6; // 垂直偏移量

                // 计算定位点位置（节点左下角）
                const anchorX = nodeX + INNER_OFFSET_X;
                const anchorY = nodeY + nodeHeight - INNER_OFFSET_Y;

                // 获取画布元素的边界
                const rect = canvas.canvas.getBoundingClientRect();

                // 将定位点位置转换为屏幕坐标
                const canvasPoint = canvas.convertOffsetToCanvas([anchorX, anchorY]);

                if (!canvasPoint) return;

                // 计算最终的屏幕坐标（考虑画布元素的位置）
                const screenX = canvasPoint[0] + rect.left;
                const screenY = canvasPoint[1] + rect.top;

                // 设置容器位置，使其左下角与定位点对齐
                containerDiv.style.left = `${screenX}px`;
                containerDiv.style.bottom = `${window.innerHeight - screenY}px`;
                containerDiv.style.right = 'auto';
                containerDiv.style.top = 'auto';

                // 应用缩放
                containerDiv.style.setProperty('--assistant-scale', scale);

            } catch (error) {
                logger.error(`更新小助手位置失败: ${error.message}`);
            }
        };

        // 初始更新位置
        updatePosition();

        // 使用防抖函数优化位置更新
        const debouncedUpdatePosition = EventManager.debounce(updatePosition, 16);

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
                // 直接调用updatePosition确保位置准确
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
                app.canvas.onNodeMoved = function (node_dragged) {
                    if (originalOnNodeMoved) {
                        originalOnNodeMoved.apply(this, arguments);
                    }

                    // 仅当移动的是当前节点时更新位置
                    if (node_dragged && node_dragged.id === assistant.node.id) {
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
                assistant.node.onNodeMoved = function () {
                    const ret = nodeOriginalOnNodeMoved?.apply(this, arguments);
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
                // 缩放时直接更新
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
     * 设置节点折叠状态监听
     */
    _setupNodeCollapseListener(assistant) {
        if (!assistant?.node) return;

        const node = assistant.node;

        // 保存原始的 collapse 方法
        const originalCollapse = node.collapse;

        // 重写 collapse 方法
        node.collapse = function () {
            // 调用原始的 collapse 方法
            originalCollapse.apply(this, arguments);

            // 调用统一的可见性更新方法，而不是直接操作DOM
            const imageCaptionInstance = window.imageCaptionInstance || imageCaption;
            if (imageCaptionInstance && typeof imageCaptionInstance.updateAssistantVisibility === 'function') {
                imageCaptionInstance.updateAssistantVisibility(assistant);
            }
        };

        // 保存清理函数
        assistant._eventCleanupFunctions.push(() => {
            // 恢复原始的 collapse 方法
            if (node.collapse !== originalCollapse) {
                node.collapse = originalCollapse;
            }
        });
    }

    /**
     * 设置画布缩放监听
     */
    _setupCanvasScaleListener(assistant) {
        if (!assistant?.node || !app.canvas) return;

        let lastScale = app.canvas.ds.scale;

        // 使用类方法获取阈值，确保一致性
        const threshold = this._getQualityThreshold();

        // 直接检测缩放状态并更新UI可见性
        const checkScaleAndUpdate = () => {
            if (!assistant.element || !assistant.node || !app.canvas) return;

            const currentScale = app.canvas.ds.scale;
            const threshold = imageCaption._getQualityThreshold(); // 修复：使用全局实例的方法
            const epsilon = 0.001; // 增加容差值

            // 计算与上次缩放的差值
            const scaleDiff = Math.abs(currentScale - lastScale);

            // 更新上次缩放值
            lastScale = currentScale;

            // 判断当前画质状态（使用容差值）
            const isCurrentlyLowQuality = currentScale <= threshold + epsilon;

            // 无条件更新UI可见性，让_checkNodeAndCanvasState方法决定是否显示
            this.updateAssistantVisibility(assistant);
        };

        // 确保立即响应
        const immediateUpdate = checkScaleAndUpdate;

        // 监听画布的鼠标滚轮事件（缩放）
        const wheelHandler = (e) => {
            if (e.ctrlKey || e.metaKey) {
                // 立即更新并安排延迟检查
                immediateUpdate();
                setTimeout(immediateUpdate, 50);
            }
        };

        // 监听画布的触摸事件（移动端缩放）
        const touchHandler = (e) => {
            if (e.touches && e.touches.length === 2) {
                // 立即更新并安排延迟检查
                immediateUpdate();
                setTimeout(immediateUpdate, 50);
            }
        };

        // 添加事件监听器
        const canvas = app.canvas.canvas;
        if (canvas) {
            canvas.addEventListener('wheel', wheelHandler, { passive: true });
            canvas.addEventListener('touchmove', touchHandler, { passive: true });
        }

        // 定期检查缩放变化
        const scaleCheckInterval = setInterval(immediateUpdate, 50);

        // 初始检查一次当前状态
        immediateUpdate();

        // 保存清理函数
        assistant._eventCleanupFunctions.push(() => {
            if (canvas) {
                canvas.removeEventListener('wheel', wheelHandler);
                canvas.removeEventListener('touchmove', touchHandler);
            }
            clearInterval(scaleCheckInterval);
        });

        // 监听画布缩放事件（直接监听ds.scale变化）
        const originalDSScale = Object.getOwnPropertyDescriptor(app.canvas.ds, 'scale');
        if (originalDSScale && originalDSScale.set) {
            const originalSetter = originalDSScale.set;

            Object.defineProperty(app.canvas.ds, 'scale', {
                get: originalDSScale.get,
                set: function (value) {
                    // 获取旧值
                    const oldValue = this.scale;
                    const threshold = imageCaption._getQualityThreshold();

                    // 调用原始setter
                    originalSetter.call(this, value);

                    // 检测是否跨越了阈值边界
                    const epsilon = 0.001;
                    const crossedThreshold =
                        (oldValue <= threshold + epsilon && value > threshold + epsilon) ||
                        (oldValue > threshold + epsilon && value <= threshold + epsilon);

                    if (crossedThreshold) {
                        // 如果跨越了阈值，只记录一次日志
                        // 使用静态变量记录上次跨越阈值的时间，避免短时间内重复输出
                        const now = Date.now();
                        if (!ImageCaption._lastThresholdCrossTime || now - ImageCaption._lastThresholdCrossTime > 500) {
                            logger.log(`[图像小助手-缩放监听] 跨越阈值 | 旧值: ${oldValue.toFixed(4)} | 新值: ${value.toFixed(4)} | 阈值: ${threshold}`);
                            ImageCaption._lastThresholdCrossTime = now;
                        }
                    }

                    // 无论是否跨越阈值，都立即更新
                    immediateUpdate();

                    // 多次检查确保状态正确应用
                    setTimeout(immediateUpdate, 10);
                    setTimeout(immediateUpdate, 50);
                    setTimeout(() => {
                        // 更新所有已存在的图像小助手实例
                        ImageCaption.instances.forEach((instance) => {
                            if (instance && instance.node) {
                                imageCaption.updateAssistantVisibility(instance);
                            }
                        });
                    }, 100);
                },
                configurable: true
            });

            // 添加清理函数
            assistant._eventCleanupFunctions.push(() => {
                if (app.canvas && app.canvas.ds) {
                    Object.defineProperty(app.canvas.ds, 'scale', originalDSScale);
                }
            });
        }
    }

    /**
     * 设置展开折叠事件
     */
    _setupCollapseExpandEvents(assistant) {
        if (!assistant?.element) return;

        const containerDiv = assistant.element;

        // 记录原始宽度，用于展开动画
        const saveOriginalWidth = () => {
            if (!assistant.isCollapsed && containerDiv.offsetWidth > 0) {
                containerDiv.style.setProperty('--expanded-width', `${containerDiv.offsetWidth}px`);
            }
        };

        // 延迟保存宽度，确保DOM已完全渲染
        setTimeout(saveOriginalWidth, 300);

        // 折叠函数
        const collapseAssistant = () => {
            if (assistant.isCollapsed || assistant.isTransitioning) return;

            // 保存当前宽度用于展开动画
            saveOriginalWidth();
            assistant.isTransitioning = true;

            // 直接添加折叠类
            containerDiv.classList.add('collapsed');
            assistant.isCollapsed = true;

            // 显示悬停区域，用于检测鼠标悬停以展开UI
            assistant.hoverArea.style.display = 'block';

            // 动画结束后重置过渡状态
            setTimeout(() => {
                assistant.isTransitioning = false;
            }, 300);
        };

        // 展开函数
        const expandAssistant = () => {
            if (!assistant.isCollapsed || assistant.isTransitioning) return;

            assistant.isTransitioning = true;

            // 隐藏悬停区域，避免覆盖按钮
            assistant.hoverArea.style.display = 'none';

            // 计算展开后的宽度
            let targetWidth = containerDiv.style.getPropertyValue('--expanded-width');

            // 如果没有保存宽度或需要重新计算
            if (!targetWidth || targetWidth === '') {
                // 先移除折叠类，但保持不可见状态进行测量
                containerDiv.classList.remove('collapsed');
                const originalDisplay = containerDiv.style.display;
                const originalOpacity = containerDiv.style.opacity;

                // 临时设置样式以便测量
                containerDiv.style.opacity = '0';
                containerDiv.style.display = 'flex';
                containerDiv.style.position = 'fixed';

                // 强制回流并测量
                void containerDiv.offsetWidth;

                // 获取自然宽度
                const naturalWidth = containerDiv.offsetWidth;
                targetWidth = naturalWidth + 'px';

                // 保存宽度供将来使用
                containerDiv.style.setProperty('--expanded-width', targetWidth);

                // 恢复原始样式
                containerDiv.style.opacity = originalOpacity;
                containerDiv.style.position = 'fixed';

                // 重新应用折叠类以准备动画
                containerDiv.classList.add('collapsed');
                void containerDiv.offsetWidth; // 强制回流
            }

            // 手动设置宽度转换
            containerDiv.style.width = '28px'; // 起始宽度

            // 强制回流
            void containerDiv.offsetWidth;

            // 移除折叠类
            containerDiv.classList.remove('collapsed');

            // 设置目标宽度以触发过渡
            containerDiv.style.width = targetWidth;

            // 动画结束后清理
            setTimeout(() => {
                // 移除固定宽度，恢复自动宽度
                containerDiv.style.width = '';
                assistant.isCollapsed = false;
                assistant.isTransitioning = false;
            }, 300);
        };

        // 创建折叠定时器变量
        let collapseTimer = null;
        let autoCollapseTimer = null;

        // 鼠标离开容器时折叠
        const handleMouseLeave = () => {
            // 如果有活跃按钮，不折叠
            if (this._checkAssistantActiveState(assistant)) return;

            // 设置延时，避免鼠标短暂离开就触发折叠
            collapseTimer = setTimeout(() => {
                collapseAssistant();
            }, 500);
        };

        // 鼠标进入容器时取消折叠定时器
        const handleMouseEnter = () => {
            if (collapseTimer) {
                clearTimeout(collapseTimer);
                collapseTimer = null;
            }

            // 取消自动折叠定时器
            if (autoCollapseTimer) {
                clearTimeout(autoCollapseTimer);
                autoCollapseTimer = null;
            }

            // 如果当前是折叠状态，则展开
            if (assistant.isCollapsed) {
                expandAssistant();
            }
        };

        // 为容器添加鼠标事件
        const removeContainerMouseLeave = EventManager.addDOMListener(containerDiv, 'mouseleave', handleMouseLeave);
        const removeContainerMouseEnter = EventManager.addDOMListener(containerDiv, 'mouseenter', handleMouseEnter);

        // 为悬停区域添加鼠标事件
        const removeHoverAreaMouseEnter = EventManager.addDOMListener(assistant.hoverArea, 'mouseenter', handleMouseEnter);

        // 添加清理函数
        assistant._eventCleanupFunctions = assistant._eventCleanupFunctions || [];
        assistant._eventCleanupFunctions.push(removeContainerMouseLeave);
        assistant._eventCleanupFunctions.push(removeContainerMouseEnter);
        assistant._eventCleanupFunctions.push(removeHoverAreaMouseEnter);

        // 添加清理定时器的函数
        assistant._eventCleanupFunctions.push(() => {
            if (collapseTimer) {
                clearTimeout(collapseTimer);
                collapseTimer = null;
            }
            if (autoCollapseTimer) {
                clearTimeout(autoCollapseTimer);
                autoCollapseTimer = null;
            }
        });

        // 创建后自动折叠功能
        const setupAutoCollapse = () => {
            // 如果有活跃按钮，不自动折叠
            if (this._checkAssistantActiveState(assistant)) return;

            // 设置自动折叠定时器，1秒后自动折叠
            autoCollapseTimer = setTimeout(() => {
                // 再次检查是否有活跃按钮或鼠标悬停在容器上
                if (!this._checkAssistantActiveState(assistant) && !assistant.isMouseOver) {
                    collapseAssistant();
                }
            }, 1000);
        };

        // 添加鼠标悬停状态跟踪
        assistant.isMouseOver = false;
        const trackMouseOver = () => {
            assistant.isMouseOver = true;
        };
        const trackMouseOut = () => {
            assistant.isMouseOver = false;
        };

        // 为容器和悬停区域添加鼠标悬停状态跟踪
        const removeContainerMouseOverTracking = EventManager.addDOMListener(containerDiv, 'mouseover', trackMouseOver);
        const removeContainerMouseOutTracking = EventManager.addDOMListener(containerDiv, 'mouseout', trackMouseOut);
        const removeHoverAreaMouseOverTracking = EventManager.addDOMListener(assistant.hoverArea, 'mouseover', trackMouseOver);
        const removeHoverAreaMouseOutTracking = EventManager.addDOMListener(assistant.hoverArea, 'mouseout', trackMouseOut);

        // 添加清理函数
        assistant._eventCleanupFunctions.push(removeContainerMouseOverTracking);
        assistant._eventCleanupFunctions.push(removeContainerMouseOutTracking);
        assistant._eventCleanupFunctions.push(removeHoverAreaMouseOverTracking);
        assistant._eventCleanupFunctions.push(removeHoverAreaMouseOutTracking);

        // 设置自动折叠（延迟执行，确保DOM已完全渲染）
        setTimeout(setupAutoCollapse, 500);
    }

    /**
     * 设置按钮右键菜单
     * @param {HTMLElement} button 按钮元素
     * @param {Function} getMenuItems 获取菜单项的函数
     * @param {Object} assistant 小助手实例
     */
    _setupButtonContextMenu(button, getMenuItems, assistant) {
        if (!button || typeof getMenuItems !== 'function') return;

        // 确保assistant对象具有正确的类型标识，方便右键菜单关闭时识别
        assistant.type = 'image_caption_assistant';

        const cleanup = buttonMenu.setupButtonMenu(button, () => {
            return getMenuItems(assistant);
        }, { widget: assistant, buttonElement: button }); // 传递正确的上下文

        if (cleanup) {
            assistant._eventCleanupFunctions = assistant._eventCleanupFunctions || [];
            assistant._eventCleanupFunctions.push(cleanup);
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
     * 清理小助手实例
     * @param {string|null} nodeId - 节点ID，如果为null则清理所有实例
     * @param {boolean} silent - 是否静默清理（不输出日志）
     */
    cleanup(nodeId = null, silent = false) {
        // 如果正在切换工作流，完全清理图像小助手实例
        if (window.PROMPT_ASSISTANT_WORKFLOW_SWITCHING) {
            // 单个节点清理时打印详细日志，全局清理时不打印
            if (nodeId !== null) {
                logger.debug(`[清理跳过] 正在切换工作流，清理图像小助手UI，节点ID: ${nodeId}`);
            }

            if (nodeId === null) {
                // 清理所有实例，并从集合中移除
                const instanceCount = ImageCaption.instances.size;
                if (instanceCount > 0) {
                    ImageCaption.instances.forEach((assistant, id) => {
                        this._cleanupSingleInstance(assistant);
                    });
                    // 清空实例集合
                    ImageCaption.instances.clear();
                }
            } else {
                // 清理特定节点实例
                const assistant = ImageCaption.getInstance(nodeId);
                if (assistant) {
                    this._cleanupSingleInstance(assistant);
                    ImageCaption.instances.delete(String(nodeId));
                }
            }

            return;
        }

        try {
            if (nodeId === null) {
                // 清理所有实例
                const instanceCount = ImageCaption.instances.size;
                if (instanceCount > 0) {
                    ImageCaption.instances.forEach((assistant, id) => {
                        this._cleanupSingleInstance(assistant);
                    });
                    ImageCaption.instances.clear();
                    if (!silent) {
                        logger.log(`清理所有图像小助手实例 | 数量: ${instanceCount}`);
                    }
                }
            } else {
                // 清理指定实例
                const assistant = ImageCaption.getInstance(nodeId);
                if (assistant) {
                    this._cleanupSingleInstance(assistant);
                    ImageCaption.instances.delete(String(nodeId));
                    if (!silent) {
                        logger.log(`清理图像小助手实例 | ID: ${nodeId}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`清理图像小助手实例失败 | ${error.message}`);
        }
    }

    /**
     * 清理单个实例的内部方法
     * @param {object} assistant - 小助手实例
     */
    _cleanupSingleInstance(assistant) {
        if (!assistant) return;

        try {
            // 清理DOM元素
            if (assistant.element && assistant.element.parentNode) {
                assistant.element.parentNode.removeChild(assistant.element);
            }

            // 清理事件监听器
            if (assistant._eventCleanupFunctions && Array.isArray(assistant._eventCleanupFunctions)) {
                assistant._eventCleanupFunctions.forEach(cleanup => {
                    if (typeof cleanup === 'function') {
                        cleanup();
                    }
                });
                assistant._eventCleanupFunctions = [];
            }

            // 清理定时器
            if (assistant._timers) {
                Object.values(assistant._timers).forEach(timer => {
                    if (timer) {
                        clearTimeout(timer);
                    }
                });
                assistant._timers = {};
            }

            // 清理引用
            assistant.element = null;
            assistant.innerContent = null;
            assistant.hoverArea = null;
            assistant.indicator = null;
            assistant.buttons = {};
            assistant.node = null;
        } catch (error) {
            logger.error(`清理单个实例失败 | ${error.message}`);
        }
    }

    /**
     * 统一控制总开关功能
     */
    async toggleGlobalFeature(enable, force = false) {
        // 更新状态
        const oldValue = window.FEATURES.imageCaption;
        window.FEATURES.imageCaption = enable;

        // 状态未变化时不执行操作，除非force为true
        if (!force && oldValue === enable) {
            return;
        }

        // 仅当状态变化或强制执行时才记录日志
        if (oldValue !== enable || force) {
            logger.log(`图像反推功能 | 动作:${enable ? "启用" : "禁用"}`);
        }

        try {
            if (enable) {
                // === 启用图像反推功能 ===
                // 确保管理器已初始化
                if (!EventManager.initialized) {
                    EventManager.init();
                }

                // 1. 重置节点初始化标记，准备重新检测
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._imageCaptionInitialized = false;
                        }
                    });
                }

                // 2. 设置或恢复节点选择事件监听
                this.registerNodeSelectionListener();

                // 3. 检查当前选中的节点
                if (app.canvas && app.canvas.selected_nodes) {
                    app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
                }
            } else {
                // === 禁用图像反推功能 ===
                // 1. 清理所有实例
                const instanceCount = ImageCaption.instances.size;
                this.cleanup(null, true);
            }

            // 更新按钮可见性
            if (window.FEATURES.updateButtonsVisibility) {
                window.FEATURES.updateButtonsVisibility();
            }
        } catch (error) {
            logger.error(`图像小助手功能开关操作失败 | 错误: ${error.message}`);
        }
    }

}

// 创建单例实例
const imageCaption = new ImageCaption();


// 导出
export { imageCaption, ImageCaption };