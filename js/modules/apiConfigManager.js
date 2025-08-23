/**
 * API配置管理器
 * 负责管理API配置弹窗和API相关设置
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import {
    createSettingsDialog,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createHorizontalFormGroup
} from "./settings.js";

class APIConfigManager {
    constructor() {
        this.llmAllProviders = {};
        this.visionAllProviders = {};
        this.llmModel = null;
        this.llmApiKey = null;
        this.llmBaseUrl = null;
        this.visionModel = null;
        this.visionApiKey = null;
        this.visionBaseUrl = null;
    }

    /**
     * 显示API配置弹窗
     */
    showAPIConfigModal() {
        try {
            logger.debug('打开API配置弹窗');

            createSettingsDialog({
                title: 'API管理器',
                dialogClassName: 'api-config-dialog',
                disableBackdropAndCloseOnClickOutside: true,
                renderContent: (container) => {
                    this._createAPIConfigUI(container);
                },
                onSave: async () => {
                    try {
                        const container = document.querySelector('.settings-modal .p-dialog-content');
                        const controls = container.formControls;

                        // 先保存当前显示的提供商配置
                        const currentLLMProvider = controls.llm.provider.value;
                        this._saveLLMProviderConfig(currentLLMProvider);

                        const currentVisionProvider = controls.vision.provider.value;
                        this._saveVisionProviderConfig(currentVisionProvider);

                        // 处理百度翻译配置
                        const baiduConfig = {
                            app_id: controls.baidu.appId.value.trim(),
                        };
                        const baiduSecretEl = controls.baidu.secret;
                        const baiduSecretValue = baiduSecretEl.value.trim();
                        const isBaiduMasked = baiduSecretValue === '••••••••••••••••••••••••••••••••••••••••••••••••';

                        // 只有当密钥不是掩码，或者掩码不代表现有密钥时，才包含secret_key
                        if (!isBaiduMasked || baiduSecretEl.dataset.hasKey !== 'true') {
                            baiduConfig.secret_key = baiduSecretValue;
                        }

                        // 获取配置值
                        const config = {
                            baidu: baiduConfig,
                            llm: {
                                current_provider: currentLLMProvider,
                                providers: this.llmAllProviders || {}
                            },
                            vision: {
                                current_provider: currentVisionProvider,
                                providers: this.visionAllProviders || {}
                            }
                        };

                        // 确保每个提供商都有配置
                        const providerList = ["zhipu", "siliconflow", "custom"];
                        providerList.forEach(provider => {
                            // 确保LLM提供商配置存在
                            if (!config.llm.providers[provider]) {
                                config.llm.providers[provider] = {
                                    model: provider === "zhipu" ? "glm-4-flash-250414" :
                                        (provider === "siliconflow" ? "Qwen/Qwen2.5-7B-Instruct" : ""),
                                    base_url: provider === "zhipu" ? "https://open.bigmodel.cn/api/paas/v4/chat/completions" :
                                        (provider === "siliconflow" ? "https://api.siliconflow.cn/v1/chat/completions" : ""),
                                    api_key: "",
                                    temperature: 0.7,
                                    max_tokens: 2000,
                                    top_p: 0.9
                                };
                            }

                            // 确保视觉模型提供商配置存在
                            if (!config.vision.providers[provider]) {
                                config.vision.providers[provider] = {
                                    model: provider === "zhipu" ? "glm-4v-flash" :
                                        (provider === "siliconflow" ? "THUDM/GLM-4.1V-9B-Thinking" : ""),
                                    base_url: provider === "zhipu" ? "https://open.bigmodel.cn/api/paas/v4/chat/completions" :
                                        (provider === "siliconflow" ? "https://api.siliconflow.cn/v1/chat/completions" : ""),
                                    api_key: "",
                                    temperature: 0.7,
                                    max_tokens: 2000,
                                    top_p: 0.9
                                };
                            }
                        });

                        console.log("保存配置:", JSON.stringify(config));  // 调试信息

                        // 保存配置
                        await Promise.all([
                            fetch('/prompt_assistant/api/config/baidu_translate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(config.baidu)
                            }),
                            fetch('/prompt_assistant/api/config/llm', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(config.llm)
                            }),
                            fetch('/prompt_assistant/api/config/vision', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(config.vision)
                            })
                        ]).then(responses => {
                            // 检查所有响应是否成功
                            const failedResponses = responses.filter(response => !response.ok);
                            if (failedResponses.length > 0) {
                                // 至少有一个请求失败
                                throw new Error(`配置保存失败，服务器返回错误: ${failedResponses[0].status}`);
                            }

                            // 所有请求成功
                            app.extensionManager.toast.add({
                                severity: "success",
                                summary: "配置已更新",
                                life: 3000
                            });
                        }).catch(error => {
                            // 显示错误提示
                            app.extensionManager.toast.add({
                                severity: "error",
                                summary: "配置保存失败",
                                detail: error.message || "保存配置时发生错误",
                                life: 3000
                            });

                            // 重新抛出错误，以便外层catch可以处理
                            throw error;
                        });
                    } catch (error) {
                        // 这里捕获的是其他类型的错误，如代码执行错误
                        app.extensionManager.toast.add({
                            severity: "error",
                            summary: "配置保存失败",
                            detail: error.message || "保存配置时发生错误",
                            life: 3000
                        });
                        throw error;
                    }
                }
            });
        } catch (error) {
            logger.error(`打开API配置弹窗失败: ${error.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "打开配置失败",
                detail: error.message || "打开配置弹窗过程中发生错误",
                life: 3000
            });
        }
    }

    /**
     * 创建API配置UI
     * @param {HTMLElement} container 容器元素
     */
    _createAPIConfigUI(container) {
        // 创建表单
        const form = document.createElement('form');
        form.onsubmit = (e) => e.preventDefault();
        form.className = 'api-config-form';

        // 1. 百度翻译 API 配置
        const baiduSection = this._createBaiduSection();

        // 2. LLM 配置
        const llmSection = this._createLLMSection();

        // 3. 视觉模型配置
        const visionSection = this._createVisionSection();

        // 添加所有部分到表单
        form.appendChild(baiduSection);
        form.appendChild(llmSection);
        form.appendChild(visionSection);
        container.appendChild(form);

        // 加载已有配置
        this._loadAPIConfig(container);
    }

    /**
     * 创建百度翻译API配置部分
     * @returns {HTMLElement} 百度翻译API配置部分的DOM元素
     */
    _createBaiduSection() {
        // 百度翻译 API 配置
        const baiduSection = createFormGroup('百度翻译配置', [
            { text: '百度翻译API申请', url: 'https://fanyi-api.baidu.com/' }
        ]);

        // 创建输入框
        const baiduAppId = createInputGroup('', '请输入百度翻译 AppID');
        const baiduSecret = createInputGroup('', '请输入百度翻译密钥');

        // 创建水平布局组
        const baiduGroup = createHorizontalFormGroup([
            { label: 'AppID', element: baiduAppId.input },
            { label: 'Secret Key', element: baiduSecret.input }
        ]);

        baiduSection.appendChild(baiduGroup);

        // 保存输入框引用，便于后续获取值
        this.baiduAppId = baiduAppId.input;
        this.baiduSecret = baiduSecret.input;

        return baiduSection;
    }

    /**
     * 创建LLM配置部分
     * @returns {HTMLElement} LLM配置部分的DOM元素
     */
    _createLLMSection() {
        // LLM 配置
        const llmSection = createFormGroup('大模型配置', [
            { text: '智谱API申请', url: 'https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D' },
            { text: '硅基流动API申请', url: 'https://cloud.siliconflow.cn/i/FCDL2zBQ' }
        ]);

        // 创建选择器和输入框
        const llmProvider = createSelectGroup('', [
            { value: 'zhipu', text: '智谱' },
            { value: 'siliconflow', text: '硅基流动' },
            { value: 'custom', text: '自定义' }
        ]);
        const llmModelInput = createInputGroup('', '请输入模型名称');
        this.llmModel = llmModelInput.input; // 保存引用以供外部函数使用

        // 创建base_url输入框（初始隐藏）
        const llmBaseUrlInput = createInputGroup('Base URL', '请输入API基础URL，例如: https://api.example.com/v1');
        this.llmBaseUrl = llmBaseUrlInput.input; // 保存引用以供外部函数使用
        llmBaseUrlInput.group.style.display = 'none'; // 初始隐藏

        // 在base_url输入框下添加提示信息
        const llmBaseUrlHint = document.createElement('div');
        llmBaseUrlHint.className = 'base-url-hint';
        llmBaseUrlHint.style.fontSize = '12px';
        llmBaseUrlHint.style.color = '#666';
        llmBaseUrlHint.style.marginTop = '4px';
        llmBaseUrlHint.style.marginBottom = '8px';
        llmBaseUrlHint.textContent = '注意: 请输入基础URL，不要包含/chat/completions路径';
        llmBaseUrlInput.group.appendChild(llmBaseUrlHint);

        // 创建水平布局组
        const llmProviderGroup = createHorizontalFormGroup([
            { label: '模型提供商', element: llmProvider.group },
            { label: '模型名称', element: this.llmModel }
        ]);

        // API Key 保持单独一行
        const llmApiKeyInput = createInputGroup('API Key', '请输入模型 API Key');
        this.llmApiKey = llmApiKeyInput.input; // 保存引用以供外部函数使用

        // ---模型参数配置---
        // 创建温度和最大token输入框
        const llmTemperatureInput = createInputGroup('', '0.1-2.0，控制输出随机性');
        llmTemperatureInput.input.type = 'number';
        llmTemperatureInput.input.min = '0.1';
        llmTemperatureInput.input.max = '2.0';
        llmTemperatureInput.input.step = '0.1';
        llmTemperatureInput.input.value = '0.7'; // 默认值
        this.llmTemperature = llmTemperatureInput.input;

        const llmMaxTokensInput = createInputGroup('', '1-32000，控制最大输出长度');
        llmMaxTokensInput.input.type = 'number';
        llmMaxTokensInput.input.min = '1';
        llmMaxTokensInput.input.max = '32000';
        llmMaxTokensInput.input.step = '1';
        llmMaxTokensInput.input.value = '2000'; // 默认值
        this.llmMaxTokens = llmMaxTokensInput.input;

        const llmTopPInput = createInputGroup('', '0.1-1.0，控制核采样范围');
        llmTopPInput.input.type = 'number';
        llmTopPInput.input.min = '0.1';
        llmTopPInput.input.max = '1.0';
        llmTopPInput.input.step = '0.1';
        llmTopPInput.input.value = '0.9'; // 默认值
        this.llmTopP = llmTopPInput.input;

        // 创建模型参数水平布局组（三个参数在同一行）
        const llmParamsGroup = createHorizontalFormGroup([
            { label: '温度 (Temperature)', element: this.llmTemperature },
            { label: '核采样 (Top-P)', element: this.llmTopP },
            { label: '最大Token数', element: this.llmMaxTokens }
        ]);

        llmSection.appendChild(llmProviderGroup);
        llmSection.appendChild(llmBaseUrlInput.group); // 添加base_url输入框
        llmSection.appendChild(llmApiKeyInput.group);
        llmSection.appendChild(llmParamsGroup); // 添加模型参数配置（三个参数在同一行）

        // 监听LLM提供商选择变化
        llmProvider.select.addEventListener('change', () => {
            const oldProvider = llmProvider.select.dataset.previousValue;
            const provider = llmProvider.select.value;

            // 如果存在旧提供商，保存其配置
            if (oldProvider) {
                this._saveLLMProviderConfig(oldProvider);
            }

            // 根据是否选择自定义类型显示/隐藏base_url输入框
            llmBaseUrlInput.group.style.display = provider === 'custom' ? 'block' : 'none';

            // 加载选定提供商的配置
            if (this.llmAllProviders && this.llmAllProviders[provider]) {
                const providerConfig = this.llmAllProviders[provider];
                this.llmModel.value = providerConfig.model || '';

                // 设置API密钥（使用掩码）
                if (providerConfig.api_key || providerConfig.has_key) {
                    this._setMaskedValue(this.llmApiKey, providerConfig.api_key || "dummy-key");
                } else {
                    this.llmApiKey.value = '';
                    this.llmApiKey.dataset.hasKey = 'false';
                }

                // 加载模型参数
                this.llmTemperature.value = providerConfig.temperature || '0.7';
                this.llmMaxTokens.value = providerConfig.max_tokens || '2000';
                this.llmTopP.value = providerConfig.top_p || '0.9';

                if (provider === 'custom') {
                    this.llmBaseUrl.value = providerConfig.base_url || '';
                }
            } else {
                // 设置默认模型名称
                if (provider === 'zhipu') {
                    this.llmModel.value = 'glm-4-flash-250414';
                } else if (provider === 'siliconflow') {
                    this.llmModel.value = 'Qwen/Qwen2.5-7B-Instruct';
                } else {
                    this.llmModel.value = '';
                }
                // 清空API Key和base_url
                this.llmApiKey.value = '';
                this.llmApiKey.dataset.hasKey = 'false';
                // 设置默认模型参数
                this.llmTemperature.value = '0.7';
                this.llmMaxTokens.value = '2000';
                this.llmTopP.value = '0.9';
                if (provider === 'custom') {
                    this.llmBaseUrl.value = '';
                }
            }

            // 记录当前选择的提供商
            llmProvider.select.dataset.previousValue = provider;
        });

        // 保存选择器引用，便于后续获取值
        this.llmProvider = llmProvider.select;

        return llmSection;
    }

    /**
     * 创建视觉模型配置部分
     * @returns {HTMLElement} 视觉模型配置部分的DOM元素
     */
    _createVisionSection() {
        // 视觉模型配置
        const visionSection = createFormGroup('视觉模型配置', []);

        // 创建选择器和输入框
        const visionProvider = createSelectGroup('', [
            { value: 'zhipu', text: '智谱' },
            { value: 'siliconflow', text: '硅基流动' },
            { value: 'custom', text: '自定义' }
        ]);
        const visionModelInput = createInputGroup('', '请输入模型名称');
        this.visionModel = visionModelInput.input; // 保存引用以供外部函数使用

        // 创建base_url输入框（初始隐藏）
        const visionBaseUrlInput = createInputGroup('Base URL', '请输入API基础URL，例如: https://api.example.com/v1');
        this.visionBaseUrl = visionBaseUrlInput.input; // 保存引用以供外部函数使用
        visionBaseUrlInput.group.style.display = 'none'; // 初始隐藏

        // 在base_url输入框下添加提示信息
        const visionBaseUrlHint = document.createElement('div');
        visionBaseUrlHint.className = 'base-url-hint';
        visionBaseUrlHint.style.fontSize = '12px';
        visionBaseUrlHint.style.color = '#666';
        visionBaseUrlHint.style.marginTop = '4px';
        visionBaseUrlHint.style.marginBottom = '8px';
        visionBaseUrlHint.textContent = '注意: 请输入基础URL，不要包含/chat/completions路径';
        visionBaseUrlInput.group.appendChild(visionBaseUrlHint);

        // 创建水平布局组
        const visionProviderGroup = createHorizontalFormGroup([
            { label: '模型提供商', element: visionProvider.group },
            { label: '模型名称', element: this.visionModel }
        ]);

        // API Key 保持单独一行
        const visionApiKeyInput = createInputGroup('API Key', '请输入模型 API Key');
        this.visionApiKey = visionApiKeyInput.input; // 保存引用以供外部函数使用

        // ---视觉模型参数配置---
        // 创建温度和最大token输入框
        const visionTemperatureInput = createInputGroup('', '0.1-2.0，控制输出随机性');
        visionTemperatureInput.input.type = 'number';
        visionTemperatureInput.input.min = '0.1';
        visionTemperatureInput.input.max = '2.0';
        visionTemperatureInput.input.step = '0.1';
        visionTemperatureInput.input.value = '0.7'; // 默认值
        this.visionTemperature = visionTemperatureInput.input;

        const visionMaxTokensInput = createInputGroup('', '1-32000，控制最大输出长度');
        visionMaxTokensInput.input.type = 'number';
        visionMaxTokensInput.input.min = '1';
        visionMaxTokensInput.input.max = '32000';
        visionMaxTokensInput.input.step = '1';
        visionMaxTokensInput.input.value = '2000'; // 默认值
        this.visionMaxTokens = visionMaxTokensInput.input;

        const visionTopPInput = createInputGroup('', '0.1-1.0，控制核采样范围');
        visionTopPInput.input.type = 'number';
        visionTopPInput.input.min = '0.1';
        visionTopPInput.input.max = '1.0';
        visionTopPInput.input.step = '0.1';
        visionTopPInput.input.value = '0.9'; // 默认值
        this.visionTopP = visionTopPInput.input;

        // 创建视觉模型参数水平布局组（三个参数在同一行）
        const visionParamsGroup = createHorizontalFormGroup([
            { label: '温度 (Temperature)', element: this.visionTemperature },
            { label: '核采样 (Top-P)', element: this.visionTopP },
            { label: '最大Token数', element: this.visionMaxTokens }
        ]);

        visionSection.appendChild(visionProviderGroup);
        visionSection.appendChild(visionBaseUrlInput.group); // 添加base_url输入框
        visionSection.appendChild(visionApiKeyInput.group);
        visionSection.appendChild(visionParamsGroup); // 添加视觉模型参数配置（三个参数在同一行）

        // 监听视觉模型提供商选择变化
        visionProvider.select.addEventListener('change', () => {
            const oldProvider = visionProvider.select.dataset.previousValue;
            const provider = visionProvider.select.value;

            // 如果存在旧提供商，保存其配置
            if (oldProvider) {
                this._saveVisionProviderConfig(oldProvider);
            }

            // 根据是否选择自定义类型显示/隐藏base_url输入框
            visionBaseUrlInput.group.style.display = provider === 'custom' ? 'block' : 'none';

            // 加载选定提供商的配置
            if (this.visionAllProviders && this.visionAllProviders[provider]) {
                const providerConfig = this.visionAllProviders[provider];
                this.visionModel.value = providerConfig.model || '';

                // 设置API密钥（使用掩码）
                if (providerConfig.api_key || providerConfig.has_key) {
                    this._setMaskedValue(this.visionApiKey, providerConfig.api_key || "dummy-key");
                } else {
                    this.visionApiKey.value = '';
                    this.visionApiKey.dataset.hasKey = 'false';
                }

                // 加载模型参数
                this.visionTemperature.value = providerConfig.temperature || '0.7';
                this.visionMaxTokens.value = providerConfig.max_tokens || '2000';
                this.visionTopP.value = providerConfig.top_p || '0.9';

                if (provider === 'custom') {
                    this.visionBaseUrl.value = providerConfig.base_url || '';
                }
            } else {
                // 设置默认模型名称
                if (provider === 'zhipu') {
                    this.visionModel.value = 'glm-4v-flash';
                } else if (provider === 'siliconflow') {
                    this.visionModel.value = 'THUDM/GLM-4.1V-9B-Thinking';
                } else {
                    this.visionModel.value = '';
                }
                // 清空API Key和base_url
                this.visionApiKey.value = '';
                this.visionApiKey.dataset.hasKey = 'false';
                // 设置默认模型参数
                this.visionTemperature.value = '0.7';
                this.visionMaxTokens.value = '2000';
                this.visionTopP.value = '0.9';
                if (provider === 'custom') {
                    this.visionBaseUrl.value = '';
                }
            }

            // 记录当前选择的提供商
            visionProvider.select.dataset.previousValue = provider;
        });

        // 保存选择器引用，便于后续获取值
        this.visionProvider = visionProvider.select;

        return visionSection;
    }

    /**
     * 设置掩码值，同时保存原始状态
     * @param {HTMLInputElement} input 输入元素
     * @param {string} value 原始值
     */
    _setMaskedValue(input, value) {
        const hasValue = value && value.trim() !== '';

        if (hasValue) {
            // 显示掩码
            input.value = '••••••••••••••••••••••••••••••••••••••••••••••••';
            // 标记为已设置
            input.dataset.hasKey = 'true';
        } else {
            input.value = '';
            input.dataset.hasKey = 'false';
        }

        // 添加焦点事件处理
        if (!input._maskedHandlersAdded) {
            input.addEventListener('focus', function () {
                if (this.dataset.hasKey === 'true' && this.value === '••••••••••••••••••••••••••••••••••••••••••••••••') {
                    this.value = '';
                }
            });

            input.addEventListener('blur', function () {
                if (this.dataset.hasKey === 'true' && this.value === '') {
                    this.value = '••••••••••••••••••••••••••••••••••••••••••••••••';
                }
            });

            input._maskedHandlersAdded = true;
        }
    }

    /**
     * 加载API配置
     * @param {HTMLElement} container 容器元素
     */
    async _loadAPIConfig(container) {
        try {
            const [baiduConfig, llmConfig, visionConfig] = await Promise.all([
                fetch('/prompt_assistant/api/config/baidu_translate').then(r => r.json()),
                fetch('/prompt_assistant/api/config/llm').then(r => r.json()),
                fetch('/prompt_assistant/api/config/vision').then(r => r.json())
            ]);

            // 设置百度翻译配置
            if (baiduConfig.app_id) {
                this.baiduAppId.value = baiduConfig.app_id;
            }
            if (baiduConfig.secret_key) {
                // 使用掩码显示密钥
                this._setMaskedValue(this.baiduSecret, baiduConfig.secret_key);
            }

            // 存储所有提供商的配置
            this.llmAllProviders = llmConfig.providers || {};
            this.visionAllProviders = visionConfig.providers || {};

            // 为所有提供商预处理API密钥状态
            const providerList = ["zhipu", "siliconflow", "custom"];

            // 处理LLM提供商的API密钥
            providerList.forEach(provider => {
                if (this.llmAllProviders[provider] && this.llmAllProviders[provider].api_key) {
                    // 保留API密钥值，但不在此处设置掩码（在切换提供商时会设置）
                    this.llmAllProviders[provider].has_key = true;
                }
            });

            // 处理视觉模型提供商的API密钥
            providerList.forEach(provider => {
                if (this.visionAllProviders[provider] && this.visionAllProviders[provider].api_key) {
                    // 保留API密钥值，但不在此处设置掩码（在切换提供商时会设置）
                    this.visionAllProviders[provider].has_key = true;
                }
            });

            // 设置 LLM 配置
            if (llmConfig.provider) {
                this.llmProvider.value = llmConfig.provider;
                this.llmProvider.dispatchEvent(new Event('change'));
            }
            if (llmConfig.model) {
                this.llmModel.value = llmConfig.model;
            }
            if (llmConfig.api_key) {
                // 使用掩码显示密钥
                this._setMaskedValue(this.llmApiKey, llmConfig.api_key);
            }
            // 加载模型参数
            if (llmConfig.temperature !== undefined) {
                this.llmTemperature.value = llmConfig.temperature;
            }
            if (llmConfig.max_tokens !== undefined) {
                this.llmMaxTokens.value = llmConfig.max_tokens;
            }
            if (llmConfig.top_p !== undefined) {
                this.llmTopP.value = llmConfig.top_p;
            }
            if (llmConfig.base_url && llmConfig.provider === 'custom') {
                this.llmBaseUrl.value = llmConfig.base_url;
            }

            // 设置视觉模型配置
            if (visionConfig.provider) {
                this.visionProvider.value = visionConfig.provider;
                this.visionProvider.dispatchEvent(new Event('change'));
            }
            if (visionConfig.model) {
                this.visionModel.value = visionConfig.model;
            }
            if (visionConfig.api_key) {
                // 使用掩码显示密钥
                this._setMaskedValue(this.visionApiKey, visionConfig.api_key);
            }
            // 加载视觉模型参数
            if (visionConfig.temperature !== undefined) {
                this.visionTemperature.value = visionConfig.temperature;
            }
            if (visionConfig.max_tokens !== undefined) {
                this.visionMaxTokens.value = visionConfig.max_tokens;
            }
            if (visionConfig.top_p !== undefined) {
                this.visionTopP.value = visionConfig.top_p;
            }
            if (visionConfig.base_url && visionConfig.provider === 'custom') {
                this.visionBaseUrl.value = visionConfig.base_url;
            }

            // 将表单控件暴露给保存回调
            container.formControls = {
                baidu: { appId: this.baiduAppId, secret: this.baiduSecret },
                llm: {
                    provider: this.llmProvider,
                    temperature: this.llmTemperature,
                    top_p: this.llmTopP,
                    max_tokens: this.llmMaxTokens
                },
                vision: {
                    provider: this.visionProvider,
                    temperature: this.visionTemperature,
                    top_p: this.visionTopP,
                    max_tokens: this.visionMaxTokens
                }
            };
        } catch (error) {
            logger.error("加载API配置失败:", error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "加载失败",
                detail: error.message || "加载API配置过程中发生错误",
                life: 3000
            });
        }
    }

    /**
     * 保存LLM提供商配置
     * @param {string} provider 提供商名称
     */
    _saveLLMProviderConfig(provider) {
        if (!this.llmAllProviders) this.llmAllProviders = {};

        // 获取当前配置
        let baseUrl = '';
        if (provider === 'custom') {
            baseUrl = this.llmBaseUrl ? this.llmBaseUrl.value.trim() : '';
            // 确保base_url不以/结尾
            if (baseUrl && baseUrl.endsWith('/')) {
                baseUrl = baseUrl.slice(0, -1);
            }
            // 确保base_url不以/chat/completions结尾
            if (baseUrl && baseUrl.endsWith('/chat/completions')) {
                baseUrl = baseUrl.slice(0, -16); // 移除'/chat/completions'
            }
        } else {
            baseUrl = provider === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' :
                (provider === 'siliconflow' ? 'https://api.siliconflow.cn/v1' : '');
        }

        // 检查API密钥是否为掩码
        let apiKey = this.llmApiKey.value.trim();
        const isMasked = apiKey === '••••••••••••••••••••••••••••••••••••••••••••••••';

        // 创建提供商配置对象
        const providerConfig = {
            model: this.llmModel.value.trim(),
            base_url: baseUrl,
            temperature: parseFloat(this.llmTemperature.value) || 0.7,
            max_tokens: parseInt(this.llmMaxTokens.value) || 2000,
            top_p: parseFloat(this.llmTopP.value) || 0.9
        };

        // 保留现有配置中的has_key标记
        if (this.llmAllProviders[provider] && this.llmAllProviders[provider].has_key) {
            providerConfig.has_key = true;
        }

        // 只有当API密钥不是掩码时才更新
        if (!isMasked || this.llmApiKey.dataset.hasKey !== 'true') {
            providerConfig.api_key = apiKey;
            // 如果输入了新的API密钥，设置has_key标记
            if (apiKey) {
                providerConfig.has_key = true;
            } else {
                // 如果清空了API密钥，移除has_key标记
                providerConfig.has_key = false;
            }
        }

        // 更新配置
        this.llmAllProviders[provider] = providerConfig;

        logger.debug(`已保存 ${provider} 提供商的LLM配置`);
    }

    /**
     * 保存视觉模型提供商配置
     * @param {string} provider 提供商名称
     */
    _saveVisionProviderConfig(provider) {
        if (!this.visionAllProviders) this.visionAllProviders = {};

        // 获取当前配置
        let baseUrl = '';
        if (provider === 'custom') {
            baseUrl = this.visionBaseUrl ? this.visionBaseUrl.value.trim() : '';
            // 确保base_url不以/结尾
            if (baseUrl && baseUrl.endsWith('/')) {
                baseUrl = baseUrl.slice(0, -1);
            }
            // 确保base_url不以/chat/completions结尾
            if (baseUrl && baseUrl.endsWith('/chat/completions')) {
                baseUrl = baseUrl.slice(0, -16); // 移除'/chat/completions'
            }
        } else {
            baseUrl = provider === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' :
                (provider === 'siliconflow' ? 'https://api.siliconflow.cn/v1' : '');
        }

        // 检查API密钥是否为掩码
        let apiKey = this.visionApiKey.value.trim();
        const isMasked = apiKey === '••••••••••••••••••••••••••••••••••••••••••••••••';

        // 创建提供商配置对象
        const providerConfig = {
            model: this.visionModel.value.trim(),
            base_url: baseUrl,
            temperature: parseFloat(this.visionTemperature.value) || 0.7,
            max_tokens: parseInt(this.visionMaxTokens.value) || 2000,
            top_p: parseFloat(this.visionTopP.value) || 0.9
        };

        // 保留现有配置中的has_key标记
        if (this.visionAllProviders[provider] && this.visionAllProviders[provider].has_key) {
            providerConfig.has_key = true;
        }

        // 只有当API密钥不是掩码时才更新
        if (!isMasked || this.visionApiKey.dataset.hasKey !== 'true') {
            providerConfig.api_key = apiKey;
            // 如果输入了新的API密钥，设置has_key标记
            if (apiKey) {
                providerConfig.has_key = true;
            } else {
                // 如果清空了API密钥，移除has_key标记
                providerConfig.has_key = false;
            }
        }

        // 更新配置
        this.visionAllProviders[provider] = providerConfig;

        logger.debug(`已保存 ${provider} 提供商的视觉模型配置`);
    }
}

// 导出API配置管理器实例
export const apiConfigManager = new APIConfigManager(); 