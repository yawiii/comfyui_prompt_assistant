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
                    type: "hidden",
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
                    name: "清理历史、翻译缓存",
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

                                // 清除1.0.3以前版本遗留的三项配置信息，避免泄露
                                localStorage.removeItem("PromptAssistant_Settings_llm_api_key");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_secret");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_appid");

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
                        appIdInput.placeholder = "请输入AppID";
                        appIdInput.title = "请输入百度翻译API的AppID";
                        appIdInput.style.flex = "1";
                        appIdInput.style.minWidth = "120px";
                        // --- 优化：聚焦时隐藏占位符，失焦时根据配置恢复 ---
                        let appIdPlaceholder = appIdInput.placeholder;
                        let appIdConfigured = false;
                        appIdInput.addEventListener("focus", () => {
                            appIdInput.placeholder = "";
                        });
                        appIdInput.addEventListener("blur", () => {
                            appIdInput.placeholder = appIdConfigured ? "***************" : appIdPlaceholder;
                        });

                        // 密钥输入框
                        const secretInput = document.createElement("input");
                        secretInput.type = "text";
                        secretInput.className = "p-inputtext";
                        secretInput.placeholder = "请输入密钥";
                        secretInput.title = "请输入百度翻译API的密钥";
                        secretInput.style.flex = "1";
                        secretInput.style.minWidth = "120px";
                        // --- 优化：聚焦时隐藏占位符，失焦时根据配置恢复 ---
                        let secretPlaceholder = secretInput.placeholder;
                        let secretConfigured = false;
                        secretInput.addEventListener("focus", () => {
                            secretInput.placeholder = "";
                        });
                        secretInput.addEventListener("blur", () => {
                            secretInput.placeholder = secretConfigured ? "*****************" : secretPlaceholder;
                        });

                        // 加载已有配置
                        fetch('/prompt_assistant/api/config/baidu_translate')
                            .then(response => response.json())
                            .then(config => {
                                appIdConfigured = !!config.app_id;
                                secretConfigured = !!config.secret_key;
                                if (appIdConfigured) {
                                    appIdInput.placeholder = "*************";
                                }
                                if (secretConfigured) {
                                    secretInput.placeholder = "*************";
                                }
                            })
                            .catch(error => {
                                logger.error("加载百度翻译配置失败:", error);
                            });

                        // 更新AppID配置的函数
                        const updateAppId = async () => {
                            const app_id = appIdInput.value.trim();

                            if (!app_id) {
                                app.extensionManager.toast.add({
                                    severity: "error",
                                    summary: "配置错误",
                                    detail: "AppID不能为空",
                                    life: 3000
                                });
                                return;
                            }

                            try {
                                const response = await fetch('/prompt_assistant/api/config/baidu_translate', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ app_id })
                                });

                                if (!response.ok) {
                                    throw new Error('保存配置失败');
                                }

                                // 清空输入框并更新占位符
                                appIdInput.value = '';
                                appIdInput.placeholder = "****************";

                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: "百度翻译AppID已更新",
                                    life: 3000
                                });
                            } catch (error) {
                                app.extensionManager.toast.add({
                                    severity: "error",
                                    summary: "保存配置失败",
                                    detail: error.message,
                                    life: 3000
                                });
                            }
                        };

                        // 更新密钥配置的函数
                        const updateSecretKey = async () => {
                            const secret_key = secretInput.value.trim();

                            if (!secret_key) {
                                app.extensionManager.toast.add({
                                    severity: "error",
                                    summary: "配置错误",
                                    detail: "密钥不能为空",
                                    life: 3000
                                });
                                return;
                            }

                            try {
                                const response = await fetch('/prompt_assistant/api/config/baidu_translate', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ secret_key })
                                });

                                if (!response.ok) {
                                    throw new Error('保存配置失败');
                                }

                                // 清空输入框并更新占位符
                                secretInput.value = '';
                                secretInput.placeholder = "****************";

                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: "百度翻译密钥已更新",
                                    life: 3000
                                });
                            } catch (error) {
                                app.extensionManager.toast.add({
                                    severity: "error",
                                    summary: "保存配置失败",
                                    detail: error.message,
                                    life: 3000
                                });
                            }
                        };

                        // 添加事件监听器
                        appIdInput.addEventListener("change", updateAppId);
                        secretInput.addEventListener("change", updateSecretKey);

                        inputCell.appendChild(appIdInput);
                        inputCell.appendChild(secretInput);
                        row.appendChild(inputCell);

                        return row;
                    }
                },

                // LLM API 配置
                {
                    id: "PromptAssistant.Settings.LLM",
                    name: "LLM 配置",
                    category: ["✨提示词小助手", "翻译和扩写配置", "LLM"],
                    tooltip: "配置大语言模型的相关参数，如API Key, Base URL等。",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const cell = document.createElement("td");
                        cell.colSpan = 2;
                        
                        const container = document.createElement("div");
                        container.style.display = "flex";
                        container.style.flexDirection = "column";
                        container.style.gap = "8px";
                        container.style.width = "100%";

                        // --- Helper function to update config ---
                        const updateLLMConfig = async (body, successMessage) => {
                             try {
                                const response = await fetch('/prompt_assistant/api/config/llm', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(body)
                                });
                                if (!response.ok) throw new Error('保存配置失败');
                                
                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: successMessage,
                                    life: 3000
                                });
                                return true;
                            } catch (error) {
                                app.extensionManager.toast.add({
                                    severity: "error",
                                    summary: "保存配置失败",
                                    detail: error.message,
                                    life: 3000
                                });
                                return false;
                            }
                        };

                        // --- Helper to create a setting row (label + input) ---
                        const createSetting = (label, key, placeholder, isPassword = false) => {
                            const wrapper = document.createElement("div");
                            wrapper.style.display = "flex";
                            wrapper.style.alignItems = "center";
                            wrapper.style.gap = "8px";

                            const labelEl = document.createElement("label");
                            labelEl.textContent = label;
                            labelEl.style.width = "100px";
                            labelEl.style.flexShrink = "0";

                            const inputEl = document.createElement("input");
                            inputEl.type = "text";
                            inputEl.className = "p-inputtext";
                            inputEl.placeholder = placeholder;
                            inputEl.style.width = "100%";

                            inputEl.addEventListener("change", () => {
                                const body = {};
                                const value = inputEl.value.trim();
                                body[key] = value;
                                updateLLMConfig(body, `${label} 已更新`).then(success => {
                                    if (success && isPassword && value) {
                                        inputEl.value = '';
                                        inputEl.placeholder = "****************";
                                    }
                                });
                            });
                            
                            wrapper.appendChild(labelEl);
                            wrapper.appendChild(inputEl);
                            return { wrapper, input: inputEl };
                        };

                        const apiKeySetting = createSetting("API Key", "api_key", "请输入API Key", true);
                        const baseUrlSetting = createSetting("Base URL", "base_url", "https://open.bigmodel.cn/api/paas/v4/chat/completions");
                        const modelSetting = createSetting("Model", "model", "glm-4-flash");
                        const visionModelSetting = createSetting("Vision Model", "vision_model", "glm-4v-flash");
                        
                        container.appendChild(apiKeySetting.wrapper);
                        container.appendChild(baseUrlSetting.wrapper);
                        container.appendChild(modelSetting.wrapper);
                        container.appendChild(visionModelSetting.wrapper);

                        // --- Load initial data ---
                        fetch('/prompt_assistant/api/config/llm')
                            .then(res => res.json())
                            .then(config => {
                                if (config.api_key) { apiKeySetting.input.placeholder = "****************"; }
                                if (config.base_url) { baseUrlSetting.input.value = config.base_url; }
                                if (config.model) { modelSetting.input.value = config.model; }
                                if (config.vision_model) { visionModelSetting.input.value = config.vision_model; }
                            })
                            .catch(error => logger.error("加载LLM配置失败:", error));
                        
                        cell.appendChild(container);
                        row.appendChild(cell);
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
                            versionBadge.src = `https://img.shields.io/badge/%E7%89%88%E6%9C%AC-%E6%9C%AA%E7%9F%A5-red?style=flat`;
                        } else {
                            const version = window.PromptAssistant_Version;
                            versionBadge.src = `https://img.shields.io/badge/%E7%89%88%E6%9C%AC-${version}-green?style=flat`;
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
                        // const separator = document.createElement("div");
                        // separator.style.width = "20px"; // 设置间距宽度
                        // cell.appendChild(separator);

                        // // 插件介绍文本
                        // const introText = document.createElement("span");
                        // introText.textContent = "插件介绍:";
                        // introText.style.marginRight = "10px"; // 与右侧徽标保持间距
                        // introText.style.fontWeight = "500"; // 稍微加粗
                        // introText.style.color = "var(--p-text-muted-color)"; // 使用系统文本颜色
                        // cell.appendChild(introText);
                        // B站徽标
                        const biliTag = document.createElement("a");
                        biliTag.href = "https://space.bilibili.com/520680644";
                        biliTag.target = "_blank";
                        biliTag.style.textDecoration = "none";
                        biliTag.style.display = "flex";
                        biliTag.style.alignItems = "center";
                        const biliBadge = document.createElement("img");
                        biliBadge.alt = "Bilibili";
                        biliBadge.src = "https://img.shields.io/badge/B%E7%AB%99-%E6%8F%92%E4%BB%B6%E4%BB%8B%E7%BB%8D-blue?logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF";
                        biliBadge.style.display = "block";
                        biliBadge.style.height = "20px";
                        biliTag.appendChild(biliBadge);
                        cell.appendChild(biliTag);

                        // // 抖音徽标
                        // const douyinTag = document.createElement("a");
                        // douyinTag.href = "https://v.douyin.com/iFhYw6e/";
                        // douyinTag.target = "_blank";
                        // douyinTag.style.textDecoration = "none";
                        // douyinTag.style.display = "flex";
                        // douyinTag.style.alignItems = "center";
                        // const douyinBadge = document.createElement("img");
                        // douyinBadge.alt = "Douyin";
                        // douyinBadge.src = "https://img.shields.io/badge/%E6%8A%96%E9%9F%B3-%23E1E1E2?style=flat&logo=TikTok&logoColor=%23161823";
                        // douyinBadge.style.display = "block";
                        // douyinBadge.style.height = "20px";
                        // douyinTag.appendChild(douyinBadge);
                        // cell.appendChild(douyinTag);

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