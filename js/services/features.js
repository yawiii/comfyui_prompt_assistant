/**
 * 小助手功能特性管理模块
 * 负责管理所有功能开关、按钮可见性、功能状态变更等
 */

import { logger } from '../utils/logger.js';

// 外部注入的 promptAssistant 实例
let promptAssistant = null;
// 外部注入的 PromptAssistant 类
let PromptAssistant = null;
// 外部注入的 UIToolkit
let UIToolkit = null;
// 外部注入的 HistoryCacheService
let HistoryCacheService = null;
// 外部注入的 imageCaption 实例
let imageCaption = null;
// 外部注入的 ImageCaption 类
let ImageCaption = null;

/**
 * 注入依赖实例（由主入口调用）
 */
export function setFeatureModuleDeps({ promptAssistant: pa, PromptAssistant: PAC, UIToolkit: ui, HistoryCacheService: hc, imageCaption: ic, ImageCaption: ICC }) {
    promptAssistant = pa;
    PromptAssistant = PAC;
    UIToolkit = ui;
    HistoryCacheService = hc;
    imageCaption = ic;
    ImageCaption = ICC;
    // 初始化时同步日志级别
    try {
        if (typeof window !== 'undefined' && window.FEATURES) {
            if (typeof window.FEATURES.logLevel === 'undefined') {
                window.FEATURES.logLevel = 0;
            }
            if (typeof logger.setLevel === 'function') {
                logger.setLevel(window.FEATURES.logLevel);
            }
        }
    } catch (e) { }
}

/**
 * 功能特性配置对象
 * 控制各个功能的启用状态
 */
export const FEATURES = {
    // 基础功能开关
    enabled: true,

    // 具体功能开关
    history: true, // 历史功能（包含历史、撤销、重做）
    tag: true,
    expand: true,
    translate: true,
    autoTranslate: false, // 自动翻译功能
    imageCaption: true, // 图像反推提示词功能

    // 翻译格式化选项
    translateFormatPunctuation: true, // 标点符号自动转成半角
    translateFormatSpace: true, // 移除多余空格
    translateFormatDots: false, // 处理连续点号
    translateFormatNewline: false, // 保留换行符

    /**
     * 更新所有实例的按钮显示状态
     * 根据功能开关状态控制UI元素的显示和隐藏
     */
    updateButtonsVisibility() {
        if (!PromptAssistant) return;
        // 遍历所有助手实例
        PromptAssistant.instances.forEach((instance) => {
            if (instance.buttons) {
                // 历史相关按钮 - 由单一的history开关控制
                if (instance.buttons['history']) {
                    instance.buttons['history'].style.display = this.history ? 'block' : 'none';
                }
                if (instance.buttons['undo']) {
                    instance.buttons['undo'].style.display = this.history ? 'block' : 'none';
                }
                if (instance.buttons['redo']) {
                    instance.buttons['redo'].style.display = this.history ? 'block' : 'none';
                }

                // 分隔线1 - 在历史功能之后
                if (instance.buttons['divider1']) {
                    const hasHistoryFeature = this.history;
                    const hasOtherFeatures = this.tag || this.expand || this.translate;
                    const showDivider1 = hasHistoryFeature && hasOtherFeatures;
                    instance.buttons['divider1'].style.display = showDivider1 ? 'block' : 'none';
                }

                // 其他功能按钮
                if (instance.buttons['tag']) {
                    instance.buttons['tag'].style.display = this.tag ? 'block' : 'none';
                }
                if (instance.buttons['expand']) {
                    instance.buttons['expand'].style.display = this.expand ? 'block' : 'none';
                }
                if (instance.buttons['translate']) {
                    instance.buttons['translate'].style.display = this.translate ? 'block' : 'none';
                }

                // 记录日志
                logger.debug(`按钮更新 | 节点ID: ${instance.nodeId}`);
            }
        });

        // 处理图像小助手的按钮显示
        if (ImageCaption) {
            ImageCaption.instances.forEach((assistant) => {
                if (assistant.buttons) {
                    // 图像反推按钮
                    if (assistant.buttons['caption_zh']) {
                        assistant.buttons['caption_zh'].style.display = this.imageCaption ? 'block' : 'none';
                    }
                    if (assistant.buttons['caption_en']) {
                        assistant.buttons['caption_en'].style.display = this.imageCaption ? 'block' : 'none';
                    }

                    // 如果图像反推功能被禁用，隐藏整个小助手
                    if (assistant.element) {
                        if (!this.imageCaption) {
                            assistant.element.style.display = 'none';
                        } else {
                            // 始终显示图像小助手
                            assistant.element.style.display = 'flex';
                        }
                    }
                }
            });
        }
    }
};

/**
 * 处理功能开关状态变化
 */
export function handleFeatureChange(featureName, value, oldValue) {
    if (!PromptAssistant || !promptAssistant) return;
    // 无论总开关状态如何，功能开关始终独立工作
    // 如果是从禁用变为启用，需要重新创建按钮
    if (value && !oldValue) {
        // 只有当小助手系统已初始化时才重建按钮
        if (PromptAssistant.instances.size > 0) {
            // 重新创建所有实例的按钮
            PromptAssistant.instances.forEach((instance) => {
                if (instance.element && instance.innerContent) {
                    // 清空现有按钮容器
                    instance.innerContent.innerHTML = '';
                    instance.buttons = {};
                    // 重新创建所有按钮
                    promptAssistant.addFunctionButtons(instance);
                }
            });
            logger.debug(`功能重建 | 结果:完成 | 功能: ${featureName}`);
            
            // 重新计算并更新所有实例的宽度
            promptAssistant.updateAllInstancesWidth();
        }

        // 如果是图像反推功能被启用
        if (featureName === '图像反推' && imageCaption) {
            // 启用图像小助手功能
            if (imageCaption.initialized) {
                // 重置节点初始化标记
                if (app.canvas && app.canvas.graph) {
                    const nodes = app.canvas.graph._nodes || [];
                    nodes.forEach(node => {
                        if (node) {
                            node._imageCaptionInitialized = false;
                        }
                    });
                }

                // 如果有当前选中的节点，立即处理
                if (app.canvas && app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
                    app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
                }
            } else {
                // 如果图像小助手尚未初始化，则初始化它
                imageCaption.initialize().then(() => {
                    // 初始化完成后处理当前选中的节点
                    if (app.canvas && app.canvas.selected_nodes && Object.keys(app.canvas.selected_nodes).length > 0) {
                        app.canvas._imageCaptionSelectionHandler(app.canvas.selected_nodes);
                    }
                });
            }
        }
    } else {
        // 否则只更新显示状态
        FEATURES.updateButtonsVisibility();

        // 如果是图像反推功能被禁用
        if (featureName === '图像反推' && !value && imageCaption) {
            // 清理所有图像小助手实例
            imageCaption.cleanup();
        }
        
        // 功能开关变化时，更新所有实例的宽度
        if (PromptAssistant.instances.size > 0) {
            promptAssistant.updateAllInstancesWidth();
        }
    }
} 