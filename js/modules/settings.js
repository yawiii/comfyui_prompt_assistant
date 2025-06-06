/**
 * 小助手设置服务
 * 负责管理小助手的设置选项，提供开关控制功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { PromptAssistant } from "./PromptAssistant.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { FEATURES, handleFeatureChange } from "../config/features.js";

// 标记是否是首次加载页面
let isFirstLoad = true;

// ====================== 设置管理 ======================

/**
 * 创建加载按钮
 */
function createLoadingButton(text, onClick) {
    const button = document.createElement('button');
    button.className = 'p-button p-component p-button-primary w-52';
    button.innerHTML = `<span class="p-button-label">${text}</span>`;

    button.addEventListener('click', async () => {
        if (button.disabled) return;

        // 开始加载状态
        button.disabled = true;
        button.classList.add('p-disabled');

        try {
            await onClick();

            // 显示成功提示
            app.extensionManager.toast.add({
                severity: "success",
                summary: "清理已清理完成",
                life: 3000
            });

        } catch (error) {
            // 显示错误提示
            app.extensionManager.toast.add({
                severity: "error",
                summary: "清理失败",
                detail: error.message || "缓存清理过程中发生错误",
                life: 3000
            });
            logger.error(`按钮操作失败: ${error.message}`);
        } finally {
            // 恢复按钮状态
            button.disabled = false;
            button.classList.remove('p-disabled');
        }
    });

    return button;
}

/**
 * 注册设置选项
 * 将设置选项添加到ComfyUI设置面板
 */
export function registerSettings() {
    try {
        app.registerExtension({
            name: "PromptAssistant.Settings",
            settings: [
                // 总开关 - 独立控制小助手系统级功能
                {
                    id: "PromptAssistant.Features.Enabled",
                    name: "启用小助手",
                    category: ["✨提示词小助手", " 小助手开关", "总开关"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "关闭后，提示词小助手所有功能将禁用",
                    onChange: async (value) => {
                        try {
                            // 获取当前状态，用于判断是否是初始化
                            const currentState = window.FEATURES.enabled;

                            // 更新全局状态
                            window.FEATURES.enabled = value;
                            logger.log(`总开关状态变更 | 状态:${value ? "启用" : "禁用"}`);

                            // 从全局 app 对象获取 promptAssistant 实例
                            const promptAssistantInstance = app.promptAssistant;
                            const imageCaptionInstance = app.imageCaption;

                            if (!promptAssistantInstance) {
                                logger.error("总开关切换失败 | 错误:未找到PromptAssistant实例");
                                return;
                            }

                            // 根据开关状态执行相应操作
                            if (value) {
                                // 启用功能
                                await promptAssistantInstance.toggleGlobalFeature(true, true);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(true, true);
                                }
                                logger.log("功能启用完成");
                                // 只在状态发生变化且不是首次加载时显示提示
                                if (currentState !== value && !isFirstLoad) {
                                    app.extensionManager.toast.add({
                                        severity: "info",
                                        summary: "提示词小助手已启用",
                                        life: 3000
                                    });
                                }
                            } else {
                                // 禁用功能
                                await promptAssistantInstance.toggleGlobalFeature(false, true);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(false, true);
                                }
                                logger.log("功能禁用完成");
                                // 只在状态发生变化且不是首次加载时显示提示
                                if (currentState !== value && !isFirstLoad) {
                                    app.extensionManager.toast.add({
                                        severity: "warn",
                                        summary: "提示词小助手已禁用",
                                        life: 3000
                                    });
                                }
                            }

                            // 设置首次加载标志为 false，表示已经完成首次加载
                            isFirstLoad = false;
                        } catch (error) {
                            logger.error(`总开关切换异常 | 错误:${error.message}`);
                        }
                    }
                },

                // 历史功能（包含历史、撤销、重做按钮）
                {
                    id: "PromptAssistant.Features.History",
                    name: "启用历史功能",
                    category: ["✨提示词小助手", "功能开关", "历史功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭历史、撤销、重做功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.history;
                        FEATURES.history = value;
                        handleFeatureChange('历史功能', value, oldValue);
                        logger.log(`历史功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 标签工具
                {
                    id: "PromptAssistant.Features.Tag",
                    name: "标签工具",
                    category: ["✨提示词小助手", "功能开关", "标签功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭标签工具功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.tag;
                        FEATURES.tag = value;
                        handleFeatureChange('标签工具', value, oldValue);
                        logger.log(`标签工具 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 扩写功能
                {
                    id: "PromptAssistant.Features.Expand",
                    name: "扩写功能",
                    category: ["✨提示词小助手", "功能开关", "扩写功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭扩写功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.expand;
                        FEATURES.expand = value;
                        handleFeatureChange('扩写功能', value, oldValue);
                        logger.log(`扩写功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 翻译功能
                {
                    id: "PromptAssistant.Features.Translate",
                    name: "翻译功能",
                    category: ["✨提示词小助手", "功能开关", "翻译功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭翻译功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.translate;
                        FEATURES.translate = value;
                        handleFeatureChange('翻译功能', value, oldValue);
                        logger.log(`翻译功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 图像反推功能
                {
                    id: "PromptAssistant.Features.ImageCaption",
                    name: "图像反推功能",
                    category: ["✨提示词小助手", "功能开关", "图像反推"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭图像反推提示词功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.imageCaption;
                        FEATURES.imageCaption = value;
                        handleFeatureChange('图像反推', value, oldValue);
                        logger.log(`图像反推功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 系统设置
                {
                    id: "PromptAssistant.Settings.LogLevel",
                    name: "日志级别",
                    category: ["✨提示词小助手", "系统设置", "日志级别"],
                    type: "combo",
                    defaultValue: "0",
                    options: [
                        { text: "错误日志", value: "0" },
                        { text: "基础日志", value: "1" },
                        { text: "详细日志", value: "2" }
                    ],
                    tooltip: "设置日志输出级别：错误日志(仅错误)、基础日志(错误+基础信息)、详细日志(错误+基础信息+调试信息)",
                    onChange: (value) => {
                        const oldValue = window.FEATURES.logLevel;
                        window.FEATURES.logLevel = parseInt(value);
                        logger.setLevel(window.FEATURES.logLevel);
                        logger.log(`日志级别已更新 | 原级别:${oldValue} | 新级别:${value}`);
                    }
                },

                {
                    id: "PromptAssistant.Settings.ClearCache",
                    name: "清理缓存",
                    category: ["✨提示词小助手", "系统设置", "清理缓存"],
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton("清理所有缓存", async () => {
                            try {
                                // 获取清理前的缓存统计
                                const beforeStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0,
                                    translate: TranslateCacheService.getTranslateCacheStats()
                                };

                                // 统计所有标签数量
                                const tagCacheKeys = Object.keys(localStorage)
                                    .filter(key => key.startsWith(CACHE_CONFIG.TAG_KEY_PREFIX));

                                // 计算所有缓存中的标签总数
                                tagCacheKeys.forEach(key => {
                                    try {
                                        const cacheData = JSON.parse(localStorage.getItem(key));
                                        if (cacheData && typeof cacheData === 'object') {
                                            // 获取缓存中的标签数量
                                            const tagCount = Object.keys(cacheData).length;
                                            beforeStats.tags += tagCount;
                                        }
                                    } catch (e) {
                                        // 移除错误日志，静默处理解析错误
                                    }
                                });

                                // 执行历史记录清理操作
                                HistoryCacheService.clearAllHistory();

                                // 清理所有标签缓存
                                tagCacheKeys.forEach(key => {
                                    localStorage.removeItem(key);
                                });

                                // 清理翻译缓存
                                TranslateCacheService.clearAllTranslateCache();

                                // 获取清理后的缓存统计
                                const afterStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0, // 清理后标签数应该为0
                                    translate: TranslateCacheService.getTranslateCacheStats()
                                };

                                // 计算清理数量
                                const clearedHistory = beforeStats.history.total - afterStats.history.total;
                                const clearedTags = beforeStats.tags;
                                const clearedTranslate = beforeStats.translate.total - afterStats.translate.total;

                                // 只输出最终统计结果
                                logger.log(`缓存清理完成 | 历史记录: ${clearedHistory}条 | 标签: ${clearedTags}个 | 翻译: ${clearedTranslate}条`);

                                // 更新所有实例的撤销/重做按钮状态
                                PromptAssistant.instances.forEach((instance) => {
                                    if (instance && instance.nodeId && instance.inputId) {
                                        UIToolkit.updateUndoRedoButtonState(instance, HistoryCacheService);
                                    }
                                });

                            } catch (error) {
                                // 简化错误日志
                                logger.error(`缓存清理失败`);
                                throw error;
                            }
                        });

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

                // 百度翻译 API 配置
                {
                    id: "PromptAssistant.Settings.TranslateType",
                    name: "翻译方法",
                    category: ["✨提示词小助手", "翻译和扩写配置", "翻译方法"],
                    type: "combo",
                    defaultValue: "baidu",
                    options: [
                        { text: "百度翻译", value: "baidu" },
                        { text: "LLM翻译", value: "llm" }
                    ],
                    tooltip: "可选百度机翻或者大模型翻译，注意：大模型翻译速度比较慢，格式可能会发生变化。",
                    onChange: (value) => {
                        localStorage.setItem("PromptAssistant_Settings_translate_type", value);
                        logger.debug("翻译方式已更新：" + value);
                    }
                },

                {
                    id: "PromptAssistant.Settings.BaiduTranslate",
                    name: "百度翻译配置",
                    category: ["✨提示词小助手", "翻译和扩写配置", "百度翻译"],
                    tooltip: "百度翻译的App_id和密钥申请方法，请查看右上角插件介绍",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        // 输入框容器单元格
                        const inputCell = document.createElement("td");
                        inputCell.style.display = "flex";
                        inputCell.style.gap = "10px";
                        inputCell.style.alignItems = "center";

                        // AppID 输入框
                        const appIdInput = document.createElement("input");
                        appIdInput.type = "text";
                        appIdInput.className = "p-inputtext";
                        appIdInput.placeholder = "AppID";
                        appIdInput.value = localStorage.getItem("PromptAssistant_Settings_baidu_translate_appid") || "";
                        appIdInput.title = "请输入百度翻译API的AppID";
                        appIdInput.style.flex = "1";
                        appIdInput.style.minWidth = "120px";
                        appIdInput.addEventListener("change", (e) => {
                            localStorage.setItem("PromptAssistant_Settings_baidu_translate_appid", e.target.value);
                            logger.debug("百度翻译AppID已更新");
                            if (window.app && app.extensionManager && app.extensionManager.toast) {
                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: "百度翻译 APP_ID 已更新",
                                    life: 3000
                                });
                            }
                        });

                        // 密钥输入框容器
                        const secretContainer = document.createElement("div");
                        secretContainer.className = "p-password p-component p-inputwrapper";
                        secretContainer.style.flex = "1";
                        secretContainer.style.minWidth = "120px";
                        secretContainer.style.position = "relative";
                        secretContainer.style.display = "inline-flex";
                        secretContainer.style.alignItems = "center";

                        // 密钥输入框
                        const secretInput = document.createElement("input");
                        secretInput.type = "password";
                        secretInput.className = "p-password-input p-inputtext";
                        secretInput.placeholder = "密钥";
                        secretInput.value = localStorage.getItem("PromptAssistant_Settings_baidu_translate_secret") || "";
                        secretInput.title = "请输入百度翻译API的密钥";
                        secretInput.style.width = "100%";
                        secretInput.style.paddingRight = "2.5rem";
                        secretInput.addEventListener("change", (e) => {
                            localStorage.setItem("PromptAssistant_Settings_baidu_translate_secret", e.target.value);
                            logger.debug("百度翻译密钥已更新");
                            if (window.app && app.extensionManager && app.extensionManager.toast) {
                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: "百度翻译密钥已更新",
                                    life: 3000
                                });
                            }
                        });

                        // 添加密码显示切换图标
                        const toggleIcon = document.createElement("i");
                        toggleIcon.className = "p-password-icon";
                        toggleIcon.style.cursor = "pointer";
                        toggleIcon.style.position = "absolute";
                        toggleIcon.style.right = "0.5rem";
                        toggleIcon.style.top = "50%";
                        toggleIcon.style.transform = "translateY(-50%)";
                        toggleIcon.style.display = "flex";
                        toggleIcon.style.alignItems = "center";
                        toggleIcon.style.justifyContent = "center";
                        toggleIcon.style.width = "2rem";
                        toggleIcon.style.height = "100%";
                        toggleIcon.style.color = "var(--input-text)";
                        toggleIcon.style.userSelect = "none";
                        toggleIcon.style.webkitUserSelect = "none";
                        toggleIcon.style.msUserSelect = "none";
                        toggleIcon.innerHTML = `
                            <svg width="14" height="14" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3z"/>
                            </svg>
                        `;

                        // 添加切换密码显示的功能
                        toggleIcon.addEventListener("click", (e) => {
                            // 阻止事件冒泡和默认行为
                            e.preventDefault();
                            e.stopPropagation();

                            if (secretInput.type === "password") {
                                secretInput.type = "text";
                                toggleIcon.innerHTML = `
                                    <svg width="14" height="14" viewBox="0 0 24 24">
                                        <path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75c-1.73-4.39-6-7.5-11-7.5c-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28l.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5c1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22L21 20.73L3.27 3L2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65c0 1.66 1.34 3 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53c-2.76 0-5-2.24-5-5c0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15l.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                                    </svg>
                                `;
                            } else {
                                secretInput.type = "password";
                                toggleIcon.innerHTML = `
                                    <svg width="14" height="14" viewBox="0 0 24 24">
                                        <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3z"/>
                                    </svg>
                                `;
                            }
                        });

                        // 阻止鼠标按下事件的默认行为
                        toggleIcon.addEventListener("mousedown", (e) => {
                            e.preventDefault();
                        });

                        secretContainer.appendChild(secretInput);
                        secretContainer.appendChild(toggleIcon);

                        inputCell.appendChild(appIdInput);
                        inputCell.appendChild(secretContainer);
                        row.appendChild(inputCell);

                        return row;
                    }
                },

                // LLM API 配置
                {
                    id: "PromptAssistant.Settings.LLM.ApiKey",
                    name: "LLM配置",
                    category: ["✨提示词小助手", "翻译和扩写配置", "LLM"],
                    tooltip: "大模型API的密钥申请方法，请查看右上角插件介绍",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        // 输入框容器单元格
                        const inputCell = document.createElement("td");
                        inputCell.style.display = "flex";
                        inputCell.style.alignItems = "center";

                        // 密钥输入框容器
                        const secretContainer = document.createElement("div");
                        secretContainer.className = "p-password p-component p-inputwrapper";
                        secretContainer.style.flex = "1";
                        secretContainer.style.position = "relative";
                        secretContainer.style.display = "inline-flex";
                        secretContainer.style.alignItems = "center";

                        // 密钥输入框
                        const secretInput = document.createElement("input");
                        secretInput.type = "password";
                        secretInput.className = "p-password-input p-inputtext";
                        secretInput.placeholder = "API Key";
                        secretInput.value = localStorage.getItem("PromptAssistant_Settings_llm_api_key") || "";
                        secretInput.title = "请输入LLM API的密钥";
                        secretInput.style.width = "406px";
                        secretInput.style.paddingRight = "2.5rem";
                        secretInput.addEventListener("change", (e) => {
                            localStorage.setItem("PromptAssistant_Settings_llm_api_key", e.target.value);
                            logger.debug("LLM API密钥已更新");
                            if (window.app && app.extensionManager && app.extensionManager.toast) {
                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: "LLM API密钥已更新",
                                    life: 3000
                                });
                            }
                        });

                        // 添加密码显示切换图标
                        const toggleIcon = document.createElement("i");
                        toggleIcon.className = "p-password-icon";
                        toggleIcon.style.cursor = "pointer";
                        toggleIcon.style.position = "absolute";
                        toggleIcon.style.right = "0.5rem";
                        toggleIcon.style.top = "50%";
                        toggleIcon.style.transform = "translateY(-50%)";
                        toggleIcon.style.display = "flex";
                        toggleIcon.style.alignItems = "center";
                        toggleIcon.style.justifyContent = "center";
                        toggleIcon.style.width = "2rem";
                        toggleIcon.style.height = "100%";
                        toggleIcon.style.color = "var(--input-text)";
                        toggleIcon.style.userSelect = "none";
                        toggleIcon.style.webkitUserSelect = "none";
                        toggleIcon.style.msUserSelect = "none";
                        toggleIcon.innerHTML = `
                            <svg width="14" height="14" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3z"/>
                            </svg>
                        `;

                        // 添加切换密码显示的功能
                        toggleIcon.addEventListener("click", (e) => {
                            // 阻止事件冒泡和默认行为
                            e.preventDefault();
                            e.stopPropagation();

                            if (secretInput.type === "password") {
                                secretInput.type = "text";
                                toggleIcon.innerHTML = `
                                    <svg width="14" height="14" viewBox="0 0 24 24">
                                        <path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75c-1.73-4.39-6-7.5-11-7.5c-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28l.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5c1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22L21 20.73L3.27 3L2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65c0 1.66 1.34 3 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53c-2.76 0-5-2.24-5-5c0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15l.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                                    </svg>
                                `;
                            } else {
                                secretInput.type = "password";
                                toggleIcon.innerHTML = `
                                    <svg width="14" height="14" viewBox="0 0 24 24">
                                        <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3s3-1.34 3-3s-1.34-3-3-3z"/>
                                    </svg>
                                `;
                            }
                        });

                        // 阻止鼠标按下事件的默认行为
                        toggleIcon.addEventListener("mousedown", (e) => {
                            e.preventDefault();
                        });

                        secretContainer.appendChild(secretInput);
                        secretContainer.appendChild(toggleIcon);
                        inputCell.appendChild(secretContainer);
                        row.appendChild(inputCell);

                        return row;
                    }
                },

                // 关于插件信息
                {
                    id: "PromptAssistant.Settings.About",
                    name: "关于",
                    category: ["✨提示词小助手", " ✨提示词小助手"],
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";
                        const cell = document.createElement("td");
                        cell.colSpan = 2;
                        cell.style.display = "flex";
                        cell.style.alignItems = "center";
                        cell.style.gap = "12px";
                        // 版本徽标
                        const versionBadge = document.createElement("img");
                        versionBadge.alt = "Version";
                        versionBadge.style.display = "block";
                        versionBadge.style.height = "20px";

                        // 从全局变量获取版本号
                        if (!window.PromptAssistant_Version) {
                            logger.error("未找到版本号，徽标将无法正确显示");
                            versionBadge.src = `https://img.shields.io/badge/版本-未知-red?style=flat`;
                        } else {
                            const version = window.PromptAssistant_Version;
                            versionBadge.src = `https://img.shields.io/badge/版本-${version}-green?style=flat`;
                            logger.debug(`版本号徽标已更新: ${version}`);
                        }

                        cell.appendChild(versionBadge);



                        // GitHub 徽标
                        const authorTag = document.createElement("a");
                        authorTag.href = "https://github.com/yawiii/comfyui_prompt_assistant";
                        authorTag.target = "_blank";
                        authorTag.style.textDecoration = "none";
                        authorTag.style.display = "flex";
                        authorTag.style.alignItems = "center";
                        const authorBadge = document.createElement("img");
                        authorBadge.alt = "Static Badge";
                        authorBadge.src = "https://img.shields.io/badge/Github-Yawiii-blue?style=flat&logo=github&logoColor=black&labelColor=%23E1E1E2&color=%2307A3D7";
                        authorBadge.style.display = "block";
                        authorBadge.style.height = "20px";
                        authorTag.appendChild(authorBadge);
                        cell.appendChild(authorTag);
                        // 添加分隔符
                        const separator = document.createElement("div");
                        separator.style.width = "20px"; // 设置间距宽度
                        cell.appendChild(separator);

                        // 插件介绍文本
                        const introText = document.createElement("span");
                        introText.textContent = "插件介绍:";
                        introText.style.marginRight = "10px"; // 与右侧徽标保持间距
                        introText.style.fontWeight = "500"; // 稍微加粗
                        introText.style.color = "var(--p-text-muted-color)"; // 使用系统文本颜色
                        cell.appendChild(introText);
                        // B站徽标
                        const biliTag = document.createElement("a");
                        biliTag.href = "https://space.bilibili.com/520680644";
                        biliTag.target = "_blank";
                        biliTag.style.textDecoration = "none";
                        biliTag.style.display = "flex";
                        biliTag.style.alignItems = "center";
                        const biliBadge = document.createElement("img");
                        biliBadge.alt = "Bilibili";
                        biliBadge.src = "https://img.shields.io/badge/b%E7%AB%99-%23E1E1E2?style=flat&logo=bilibili&logoColor=%2307A3D7";
                        biliBadge.style.display = "block";
                        biliBadge.style.height = "20px";
                        biliTag.appendChild(biliBadge);
                        cell.appendChild(biliTag);

                        // 抖音徽标
                        const douyinTag = document.createElement("a");
                        douyinTag.href = "https://v.douyin.com/iFhYw6e/";
                        douyinTag.target = "_blank";
                        douyinTag.style.textDecoration = "none";
                        douyinTag.style.display = "flex";
                        douyinTag.style.alignItems = "center";
                        const douyinBadge = document.createElement("img");
                        douyinBadge.alt = "Douyin";
                        douyinBadge.src = "https://img.shields.io/badge/%E6%8A%96%E9%9F%B3-%23E1E1E2?style=flat&logo=TikTok&logoColor=%23161823";
                        douyinBadge.style.display = "block";
                        douyinBadge.style.height = "20px";
                        douyinTag.appendChild(douyinBadge);
                        cell.appendChild(douyinTag);

                        row.appendChild(cell);
                        return row;
                    }
                }
            ]
        });

        logger.log("小助手设置注册成功");
        return true;
    } catch (error) {
        logger.error(`小助手设置注册失败: ${error.message}`);
        return false;
    }
}