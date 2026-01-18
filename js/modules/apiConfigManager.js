/**
 * API配置管理器 v2.0
 * 支持动态服务商管理和多模型配置
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import {
    createSettingsDialog,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createHorizontalFormGroup,
    createSwitchControl,
    createConfirmPopup,
    createContextMenu,
    createTooltip,
    createMultiSelectListbox
} from "./uiComponents.js";
import { APIService } from "../services/api.js";

// Sortable库已通过script标签加载，直接使用全局变量

class APIConfigManager {
    // 预置服务商ID列表（不可编辑/删除）
    static PRESET_SERVICE_IDS = ['zhipu', 'xFlow', 'ollama'];

    constructor() {
        // 服务商数据
        this.services = [];
        this.currentServices = { llm: null, vlm: null };

        // 百度翻译配置
        this.baiduConfig = { app_id: '', secret_key: '' };
    }

    /**
     * 通知系统 API 配置已更新
     * 触发 pa-config-updated 事件，通知 settings.js 等模块刷新
     */
    notifyConfigChange() {
        logger.debug('分发 API 配置更新事件: pa-config-updated');
        window.dispatchEvent(new CustomEvent('pa-config-updated'));
    }

    /**
     * 显示API配置弹窗
     */
    async showAPIConfigModal() {
        try {
            logger.debug('打开API配置弹窗 v2.0');

            createSettingsDialog({
                title: '<i class="pi pi-cog" style="margin-right: 8px;"></i>API管理器',
                dialogClassName: 'api-config-dialog-v2',
                disableBackdropAndCloseOnClickOutside: true,
                hideFooter: true,  // 不显示底部的保存/取消按钮
                renderNotice: (noticeArea) => {
                    const subtitle = document.createElement('div');
                    subtitle.className = 'api-config-warning';
                    subtitle.textContent = '*免责声明：本插件仅提供 API 调用工具，第三方服务责任与本插件无关，插件所涉用户配置信息均存储于本地。对于因账号使用产生的任何问题，本插件不承担责任！';
                    noticeArea.appendChild(subtitle);
                },
                renderContent: async (container) => {
                    await this._loadAllConfigs();
                    this._createAPIConfigUI(container);
                },
                onSave: async () => {
                    // 不再需要手动保存，因为已经实时保存了
                }
            });
        } catch (error) {
            logger.error(`打开API配置弹窗失败: ${error.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "打开配置失败",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * 加载所有配置
     */
    async _loadAllConfigs() {
        try {
            // 加载服务商列表
            const servicesRes = await fetch(APIService.getApiUrl('/services'));
            const servicesData = await servicesRes.json();

            if (servicesData.success) {
                this.services = servicesData.services || [];
            }

            // 加载百度翻译配置
            const baiduRes = await fetch(APIService.getApiUrl('/config/baidu_translate'));
            this.baiduConfig = await baiduRes.json();

            // 加载当前服务配置以获取current_services
            const llmRes = await fetch(APIService.getApiUrl('/config/llm'));
            const llmConfig = await llmRes.json();
            if (llmConfig.provider) {
                this.currentServices.llm = llmConfig.provider;
            }

            const vlmRes = await fetch(APIService.getApiUrl('/config/vision'));
            const vlmConfig = await vlmRes.json();
            if (vlmConfig.provider) {
                this.currentServices.vlm = vlmConfig.provider;
            }

            logger.debug('配置加载完成', {
                services: this.services.length,
                currentLLM: this.currentServices.llm,
                currentVLM: this.currentServices.vlm
            });
        } catch (error) {
            logger.error('加载配置失败', error);
            throw error;
        }
    }

    /**
     * 保存所有配置
     */
    async _saveAllConfigs() {
        try {
            // 保存百度翻译配置
            await fetch(APIService.getApiUrl('/config/baidu_translate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.baiduConfig)
            });

            app.extensionManager.toast.add({
                severity: "success",
                summary: "配置已保存",
                life: 3000
            });
        } catch (error) {
            logger.error('保存配置失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "保存失败",
                detail: error.message,
                life: 3000
            });
            throw error;
        }
    }

    /**
     * 保存百度翻译配置
     */
    async _saveBaiduConfig() {
        try {
            await fetch(APIService.getApiUrl('/config/baidu_translate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.baiduConfig)
            });

            logger.debug('百度翻译配置已保存');

            // 触发配置同步事件
            this.notifyConfigChange();

            // 显示成功提示
            app.extensionManager.toast.add({
                severity: "success",
                summary: "百度翻译配置已保存",
                life: 2000
            });
        } catch (error) {
            logger.error('保存百度翻译配置失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "保存失败",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * 创建API配置UI
     */
    _createAPIConfigUI(container) {
        // 创建标签页容器
        const tabContainer = document.createElement('div');
        tabContainer.className = 'api-config-tabs';

        // 创建标签页头部（动态生成所有服务商标签）
        const tabHeader = this._createTabHeader();
        tabContainer.appendChild(tabHeader);

        // 创建标签页内容容器
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';

        // 创建百度翻译标签页
        const baiduContent = this._createBaiduTab();
        tabContent.appendChild(baiduContent);

        // 动态创建每个服务商的标签页内容
        this.services.forEach(service => {
            const serviceContent = this._createServiceContentTab(service);
            tabContent.appendChild(serviceContent);
        });

        tabContainer.appendChild(tabContent);
        container.appendChild(tabContainer);

        // 默认显示第一个标签页
        this._switchTab('baidu', tabHeader, tabContent);
    }

    /**
     * 创建标签页头部（包含所有服务商）
     */
    _createTabHeader() {
        const header = document.createElement('div');
        header.className = 'tab-header';

        // 百度翻译标签
        const baiduTab = this._createTabButton('baidu', '百度翻译', '机器翻译');
        header.appendChild(baiduTab);

        // 动态创建服务商标签
        this.services.forEach(service => {
            const tabButton = this._createTabButton(
                service.id,
                service.name || '未命名服务',
                service.description || ''
            );
            header.appendChild(tabButton);
        });

        // 创建"+"新增标签按钮
        const addButton = document.createElement('button');
        addButton.className = 'service-tab-add';
        addButton.innerHTML = '<i class="pi pi-plus"></i>';
        addButton.addEventListener('click', () => this._addNewService(header, header.nextElementSibling));
        header.appendChild(addButton);

        // 初始化拖拽排序
        new Sortable(header, {
            handle: '.tab-button',
            draggable: '.tab-button',
            filter: '.service-tab-add',  // 排除"+"按钮
            animation: 150,
            onEnd: async (evt) => {
                await this._updateServicesOrder();
            }
        });

        return header;
    }

    /**
     * 更新服务商顺序
     */
    async _updateServicesOrder() {
        try {
            // 从DOM读取当前标签顺序
            const header = document.querySelector('.tab-header');
            const buttons = header.querySelectorAll('.tab-button');
            const serviceIds = [];

            buttons.forEach(btn => {
                const tabId = btn.dataset.tab;
                // 排除特殊标签(如百度翻译)
                if (tabId && tabId !== 'baidu') {
                    serviceIds.push(tabId);
                }
            });

            // 调用后端API保存顺序
            const res = await fetch(APIService.getApiUrl('/services/order'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service_ids: serviceIds })
            });

            const result = await res.json();

            if (result.success) {
                // 更新本地服务列表顺序
                const orderedServices = [];
                serviceIds.forEach(id => {
                    const service = this.services.find(s => s.id === id);
                    if (service) {
                        orderedServices.push(service);
                    }
                });

                // 添加未在orderedServices中的服务
                this.services.forEach(s => {
                    if (!orderedServices.find(os => os.id === s.id)) {
                        orderedServices.push(s);
                    }
                });

                this.services = orderedServices;

                logger.debug('服务商顺序已更新', { order: serviceIds });

                // 触发配置同步事件
                this.notifyConfigChange();
            } else {
                throw new Error(result.error || '更新顺序失败');
            }
        } catch (error) {
            logger.error('更新服务商顺序失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "更新顺序失败",
                detail: error.message,
                life: 3000
            });
        }
    }


    /**
     * 创建单个标签按钮
     */
    _createTabButton(tabId, title, subtitle) {
        const button = document.createElement('button');
        button.className = 'tab-button';
        button.dataset.tab = tabId;

        // 标签标题
        const titleEl = document.createElement('div');
        titleEl.className = 'tab-title';
        titleEl.textContent = title;
        button.appendChild(titleEl);

        // 标签小字（介绍）
        if (subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'tab-subtitle';
            subtitleEl.textContent = subtitle;
            button.appendChild(subtitleEl);
        }

        // 点击切换标签
        button.addEventListener('click', () => {
            this._switchTab(tabId, button.parentElement, button.parentElement.nextElementSibling);
        });

        // 为服务商标签添加右键菜单（百度翻译和预置服务商除外）
        // 预置服务商不可编辑/删除，只有用户自定义的服务商才能使用右键菜单
        const isPresetService = APIConfigManager.PRESET_SERVICE_IDS.includes(tabId);
        if (tabId !== 'baidu' && !isPresetService) {
            this._attachServiceContextMenu(button, tabId, title);
        }

        return button;
    }

    /**
     * 切换标签页
     */
    _switchTab(tabId, header, contentContainer) {
        // 更新标签按钮状态
        header.querySelectorAll('.tab-button').forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 显示对应内容
        contentContainer.querySelectorAll('.tab-pane').forEach(pane => {
            pane.style.display = pane.dataset.tab === tabId ? 'block' : 'none';
        });
    }

    /**
     * 为服务标签附加右键菜单
     */
    _attachServiceContextMenu(button, serviceId, serviceName) {
        createContextMenu({
            target: button,
            items: [
                {
                    label: '修改服务商名称',
                    icon: 'pi-pencil',
                    onClick: () => {
                        this._editServiceName(button, serviceId, serviceName);
                    }
                },
                {
                    separator: true
                },
                {
                    label: '删除服务',
                    icon: 'pi-trash',
                    danger: true,  // 标记为危险操作，图标显示红色
                    onClick: () => {
                        this._deleteService(serviceId, serviceName);
                    }
                }
            ]
        });
    }

    /**
     * 修改服务商名称
     */
    _editServiceName(triggerButton, serviceId, currentName) {
        const service = this.services.find(s => s.id === serviceId);
        if (!service) return;

        createConfirmPopup({
            target: triggerButton,
            message: '修改服务商信息',
            icon: 'pi-pencil',
            position: 'bottom',
            confirmLabel: '保存',
            cancelLabel: '取消',
            renderFormContent: (formContainer) => {
                // 服务商名称输入框
                const nameInput = createInputGroup('服务商名称', '请输入服务商名称');
                nameInput.input.value = service.name || currentName;
                nameInput.input.dataset.fieldName = 'serviceName';
                formContainer.appendChild(nameInput.group);

                // 服务商介绍输入框
                const descInput = createInputGroup('服务商介绍', '请输入服务商介绍（可选）');
                descInput.input.value = service.description || '';
                descInput.input.dataset.fieldName = 'serviceDescription';
                formContainer.appendChild(descInput.group);
            },
            onConfirm: async (formContainer) => {
                try {
                    const nameInput = formContainer.querySelector('[data-field-name="serviceName"]');
                    const descInput = formContainer.querySelector('[data-field-name="serviceDescription"]');

                    const newName = nameInput.value.trim();
                    const newDescription = descInput.value.trim();

                    if (!newName) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: "请输入服务商名称",
                            life: 2000
                        });
                        throw new Error('服务商名称不能为空');
                    }

                    // 更新服务商信息
                    await this._updateService(serviceId, {
                        name: newName,
                        description: newDescription
                    });

                    // 更新按钮显示
                    const titleEl = triggerButton.querySelector('.tab-title');
                    const subtitleEl = triggerButton.querySelector('.tab-subtitle');

                    if (titleEl) {
                        titleEl.textContent = newName;
                    }

                    if (subtitleEl) {
                        subtitleEl.textContent = newDescription;
                    } else if (newDescription) {
                        // 如果之前没有副标题，现在添加一个
                        const newSubtitleEl = document.createElement('div');
                        newSubtitleEl.className = 'tab-subtitle';
                        newSubtitleEl.textContent = newDescription;
                        triggerButton.appendChild(newSubtitleEl);
                    }

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: "服务商信息已更新",
                        detail: `${newName} 更新成功`,
                        life: 2000
                    });
                } catch (error) {
                    logger.error('更新服务商信息失败', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "更新失败",
                        detail: error.message,
                        life: 3000
                    });
                    throw error;
                }
            }
        });
    }


    /**
     * 创建服务商内容标签页
     */
    _createServiceContentTab(service) {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = service.id;
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // 服务商配置卡片（复用现有的卡片创建逻辑）
        const card = this._createServiceCard(service);
        pane.appendChild(card);

        return pane;
    }

    /**
     * 新增服务商
     */
    async _addNewService(headerElement, contentElement) {
        // 获取触发按钮作为定位参考
        const triggerButton = headerElement.querySelector('.service-tab-add');

        // 显示确认气泡框
        createConfirmPopup({
            target: triggerButton,
            message: '创建新的服务商',
            icon: 'pi-plus-circle',
            position: 'left',
            confirmLabel: '创建',
            cancelLabel: '取消',
            renderFormContent: (formContainer) => {
                // 服务商名称输入框
                const nameInput = createInputGroup('服务商名称', '请输入服务商名称');
                nameInput.input.value = '新服务商';
                nameInput.input.dataset.fieldName = 'serviceName';
                formContainer.appendChild(nameInput.group);

                // 服务商介绍输入框
                const descInput = createInputGroup('服务商介绍', '请输入服务商介绍（可选）');
                descInput.input.dataset.fieldName = 'serviceDescription';
                formContainer.appendChild(descInput.group);
            },
            onConfirm: async (formContainer) => {
                try {
                    // 获取表单数据
                    const nameInput = formContainer.querySelector('[data-field-name="serviceName"]');
                    const descInput = formContainer.querySelector('[data-field-name="serviceDescription"]');

                    const serviceName = nameInput.value.trim();
                    const serviceDescription = descInput.value.trim();

                    if (!serviceName) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: "请输入服务商名称",
                            life: 2000
                        });
                        throw new Error('服务商名称不能为空');
                    }

                    // 创建服务商
                    const res = await fetch(APIService.getApiUrl('/services'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'openai_compatible',
                            name: serviceName,
                            description: serviceDescription,
                            base_url: 'https://api.example.com/v1',
                            api_key: ''
                        })
                    });

                    const result = await res.json();

                    if (result.success) {
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: "新服务商已创建",
                            detail: `${serviceName} 创建成功`,
                            life: 3000
                        });

                        // 重新加载配置
                        await this._loadAllConfigs();

                        // 获取新创建的服务
                        const newService = this.services.find(s => s.id === result.service_id);
                        if (newService) {
                            // 创建新标签按钮（插入到"+"按钮前）
                            const addButton = headerElement.querySelector('.service-tab-add');
                            const newTabButton = this._createTabButton(
                                newService.id,
                                newService.name || '未命名服务',
                                newService.description || ''
                            );
                            headerElement.insertBefore(newTabButton, addButton);

                            // 创建新内容标签页
                            const newContentPane = this._createServiceContentTab(newService);
                            contentElement.appendChild(newContentPane);

                            // 切换到新标签
                            this._switchTab(newService.id, headerElement, contentElement);
                        }

                        // 触发配置同步事件
                        this.notifyConfigChange();
                    } else {
                        throw new Error(result.error || '创建失败');
                    }
                } catch (error) {
                    logger.error('创建服务商失败', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "创建失败",
                        detail: error.message,
                        life: 3000
                    });
                    throw error;
                }
            }
        });
    }

    /**
     * 创建百度翻译标签页
     */
    _createBaiduTab() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'baidu';

        const section = createFormGroup('百度翻译配置', [
            { text: '开通百度翻译服务', url: 'https://fanyi-api.baidu.com/' }
        ]);
        section.classList.add('baidu-translate-section');

        // 为链接添加图标,与其他服务保持统一
        const linkElement = section.querySelector('.settings-service-link');
        if (linkElement) {
            const icon = document.createElement('i');
            icon.className = 'pi pi-star';
            icon.style.marginRight = '4px';
            linkElement.insertBefore(icon, linkElement.firstChild);
        }

        const appIdInput = createInputGroup('AppID', '请输入百度翻译 AppID');
        appIdInput.input.value = this.baiduConfig.app_id || '';
        appIdInput.input.addEventListener('input', (e) => {
            this.baiduConfig.app_id = e.target.value;
        });
        // 添加失焦保存
        appIdInput.input.addEventListener('blur', async () => {
            await this._saveBaiduConfig();
        });

        const secretInput = createInputGroup('Secret Key', '请输入百度翻译密钥');
        secretInput.input.type = 'password';
        secretInput.input.value = this.baiduConfig.secret_key || '';
        secretInput.input.addEventListener('input', (e) => {
            this.baiduConfig.secret_key = e.target.value;
        });
        // 添加失焦保存
        secretInput.input.addEventListener('blur', async () => {
            await this._saveBaiduConfig();
        });

        section.appendChild(appIdInput.group);
        section.appendChild(secretInput.group);
        pane.appendChild(section);

        return pane;
    }

    /**
     * 创建通用服务商标签页（二级标签页结构）
     */
    _createServicesTab() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane services-tab-pane';
        pane.dataset.tab = 'services';
        // 样式已移至CSS

        // 二级标签页导航
        const subTabNav = document.createElement('div');
        subTabNav.className = 'service-sub-tabs';
        // 样式已移至CSS

        // 二级标签页内容容器
        const subTabContent = document.createElement('div');
        subTabContent.className = 'service-sub-content';

        // 获取通用服务商
        const genericServices = this.services.filter(s => s.type === 'openai_compatible');

        // 创建服务商标签
        genericServices.forEach((service, index) => {
            // 创建标签按钮
            const tabButton = this._createServiceTabButton(service);
            subTabNav.appendChild(tabButton);

            // 创建标签内容
            const tabContentPane = this._createServiceTabContent(service);
            subTabContent.appendChild(tabContentPane);

            // 默认选中第一个
            if (index === 0) {
                tabButton.classList.add('active');
                tabContentPane.style.display = 'block';
            }
        });

        // 创建"+"新增标签按钮
        const addTabButton = document.createElement('button');
        addTabButton.className = 'service-tab-add';
        addTabButton.textContent = '+';
        addTabButton.addEventListener('click', () => this._addNewServiceTab(subTabNav, subTabContent));
        subTabNav.appendChild(addTabButton);

        // 如果没有任何服务商，显示空状态
        if (genericServices.length === 0) {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'empty-state-hint';
            emptyHint.innerHTML = `
                <div style="font-size: 48px; margin-bottom: 16px;">📦</div>
                <div style="font-size: 16px; margin-bottom: 8px;">暂无服务商</div>
                <div style="font-size: 14px;">点击右上角"+"按钮新增第一个服务商</div>
            `;
            subTabContent.appendChild(emptyHint);
        }

        pane.appendChild(subTabNav);
        pane.appendChild(subTabContent);
        return pane;
    }

    /**
     * 创建服务商标签按钮
     */
    _createServiceTabButton(service) {
        const button = document.createElement('button');
        button.className = 'service-tab-button';
        button.dataset.serviceId = service.id;

        // 标签标题
        const title = document.createElement('div');
        title.className = 'service-tab-title';
        title.textContent = service.name || '未命名服务';

        // 标签小字（介绍）
        const subtitle = document.createElement('div');
        subtitle.className = 'service-tab-subtitle';
        subtitle.textContent = service.description || '';

        button.appendChild(title);
        if (service.description) {
            button.appendChild(subtitle);
        }

        // 点击切换
        button.addEventListener('click', () => {
            this._switchServiceTab(service.id);
        });

        return button;
    }

    /**
     * 切换服务商标签
     */
    _switchServiceTab(serviceId) {
        const container = document.querySelector('.services-tab-pane');
        if (!container) return;

        // 更新标签按钮状态
        const buttons = container.querySelectorAll('.service-tab-button');
        buttons.forEach(btn => {
            if (btn.dataset.serviceId === serviceId) {
                btn.classList.add('active');
                btn.style.background = 'var(--p-primary-500)';
                btn.style.color = 'white';
                btn.querySelector('.service-tab-title').style.color = 'white';
                const subtitle = btn.querySelector('.service-tab-subtitle');
                if (subtitle) {
                    subtitle.style.color = 'rgba(255, 255, 255, 0.8)';
                }
            } else {
                btn.classList.remove('active');
                btn.style.background = 'transparent';
                btn.style.color = 'var(--p-text-color)';
                btn.querySelector('.service-tab-title').style.color = 'var(--p-text-color)';
                const subtitle = btn.querySelector('.service-tab-subtitle');
                if (subtitle) {
                    subtitle.style.color = 'var(--p-text-muted-color)';
                }
            }
        });

        // 更新内容显示
        const panes = container.querySelectorAll('.service-content-pane');
        panes.forEach(pane => {
            pane.style.display = pane.dataset.serviceId === serviceId ? 'block' : 'none';
        });
    }

    /**
     * 创建服务商标签内容
     */
    _createServiceTabContent(service) {
        const contentPane = document.createElement('div');
        contentPane.className = 'service-content-pane';
        contentPane.dataset.serviceId = service.id;
        contentPane.style.cssText = `
            display: none;
        `;

        // 这里先创建一个简单的占位内容，后续会完善
        const card = this._createServiceCard(service);
        contentPane.appendChild(card);

        return contentPane;
    }

    /**
     * 添加新服务商标签
     */
    async _addNewServiceTab(navContainer, contentContainer) {
        // 调用后端API创建新服务商
        try {
            const res = await fetch(APIService.getApiUrl('/services'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'openai_compatible',
                    name: '新服务商',
                    description: '',
                    base_url: 'https://api.example.com/v1',
                    api_key: ''
                })
            });

            const result = await res.json();

            if (result.success) {
                app.extensionManager.toast.add({
                    severity: "success",
                    summary: "新服务商已创建",
                    detail: "请填写配置信息",
                    life: 3000
                });

                // 重新加载配置
                await this._loadAllConfigs();

                // 获取新创建的服务
                const newService = this.services.find(s => s.id === result.service_id);
                if (newService) {
                    // 创建新标签按钮（插入到"+"按钮前）
                    const newTabButton = this._createServiceTabButton(newService);
                    const addButton = navContainer.querySelector('.service-tab-add');
                    navContainer.insertBefore(newTabButton, addButton);

                    // 创建新内容
                    const newContentPane = this._createServiceTabContent(newService);
                    contentContainer.appendChild(newContentPane);

                    // 移除空状态提示（如果有）
                    const emptyHint = contentContainer.querySelector('div[style*="暂无服务商"]');
                    if (emptyHint) {
                        emptyHint.remove();
                    }

                    // 切换到新标签
                    this._switchServiceTab(newService.id);
                }
            } else {
                throw new Error(result.error || '创建失败');
            }
        } catch (error) {
            logger.error('创建服务商失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "创建失败",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * 创建Ollama标签页
     */
    _createOllamaTab() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'ollama';
        // 样式已移至CSS

        const ollamaService = this.services.find(s => s.type === 'ollama');

        if (ollamaService) {
            const card = this._createServiceCard(ollamaService);
            pane.appendChild(card);
        } else {
            const hint = document.createElement('div');
            hint.className = 'empty-state-hint-small';
            hint.textContent = 'Ollama服务未配置';
            pane.appendChild(hint);
        }

        return pane;
    }

    /**
     * 创建服务商卡片
     */
    _createServiceCard(service) {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.dataset.serviceId = service.id;  // 添加serviceId到dataset

        // 服务商标题 - 根据服务名称检测是否需要添加外部链接
        const titleText = service.name || service.id;
        const descText = service.description ? ` 信息配置` : '';
        const fullTitle = `1️⃣ ${titleText}${descText}`;

        // 检测服务名称,添加对应的申请链接
        const links = [];
        const serviceName = (service.name || '').toLowerCase();
        const serviceId = (service.id || '').toLowerCase();
        const searchText = `${serviceName} ${serviceId}`.toLowerCase();

        // 智谱服务检测
        if (searchText.includes('智谱') || searchText.includes('zhipu')) {
            links.push({
                text: '开通智谱API服务',
                url: 'https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D',
                icon: 'pi-star'
            });
        }

        // 硅基流动服务检测
        if (searchText.includes('硅基') || searchText.includes('siliconflow') || searchText.includes('silicon')) {
            links.push({
                text: '开通硅基流动API服务',
                url: 'https://cloud.siliconflow.cn/i/FCDL2zBQ',
                icon: 'pi-star'
            });
        }

        // xflow服务检测
        if (searchText.includes('xflow')) {
            links.push({
                text: '开通xflow API服务',
                url: 'https://api.xflow.cc/register?aff=Z063',
                icon: 'pi-star'
            });
        }

        // 使用createFormGroup创建带链接的标题,或者普通标题
        let titleSection;
        if (links.length > 0) {
            titleSection = createFormGroup(fullTitle, links.map(link => ({
                text: link.text,
                url: link.url
            })));
            // 为链接添加图标
            const linkElements = titleSection.querySelectorAll('.settings-service-link');
            linkElements.forEach((linkElem, index) => {
                if (links[index] && links[index].icon) {
                    const icon = document.createElement('i');
                    icon.className = `pi ${links[index].icon}`;
                    icon.style.marginRight = '4px';
                    linkElem.insertBefore(icon, linkElem.firstChild);
                }
            });
        } else {
            // 没有链接时,创建普通标题
            titleSection = document.createElement('div');
            titleSection.className = 'settings-form-section';
            const titleElement = document.createElement('h3');
            titleElement.className = 'settings-form-section-title';
            titleElement.textContent = fullTitle;
            titleSection.appendChild(titleElement);
        }

        card.appendChild(titleSection);

        // 基本信息
        const baseUrlInput = createInputGroup('Base URL', 'https://api.example.com/v1');
        baseUrlInput.input.value = service.base_url || '';
        baseUrlInput.input.addEventListener('change', async (e) => {
            await this._updateService(service.id, { base_url: e.target.value });
        });

        // API Key输入框（简化版，直接使用明文）
        const apiKeyInput = createInputGroup('API Key', '请输入API Key');
        apiKeyInput.input.type = 'password';
        apiKeyInput.input.value = service.api_key || '';

        // 失焦时保存
        apiKeyInput.input.addEventListener('blur', async (e) => {
            const newApiKey = e.target.value.trim();
            if (newApiKey !== service.api_key) {
                await this._updateService(service.id, { api_key: newApiKey });
                service.api_key = newApiKey;
            }
        });

        card.appendChild(baseUrlInput.group);
        card.appendChild(apiKeyInput.group);

        // === 服务配置区域（简化版） ===
        // 创建配置项容器
        const settingsInlineContainer = document.createElement('div');
        settingsInlineContainer.className = 'service-settings-inline';

        // 思维链控制开关
        const thinkingContainer = document.createElement('div');
        thinkingContainer.className = 'service-setting-item';

        const thinkingLabel = document.createElement('span');
        thinkingLabel.className = 'service-setting-label';
        thinkingLabel.textContent = '关闭思维链';

        const thinkingIcon = document.createElement('i');
        thinkingIcon.className = 'pi pi-info-circle service-setting-info-icon';

        // 添加 tooltip
        createTooltip({
            target: thinkingIcon,
            content: '针对部分支持关闭思维链的模型进行关闭。⚠️：并不是所有模型都支持，关闭思维链的模型会在日志中的模型信息后面多出一个“✏️”符号。',
            position: 'top'
        });

        const thinkingLabelWrapper = document.createElement('div');
        thinkingLabelWrapper.className = 'service-setting-label-wrapper';
        thinkingLabelWrapper.appendChild(thinkingLabel);
        thinkingLabelWrapper.appendChild(thinkingIcon);

        // 创建开关
        const thinkingSwitchWrapper = document.createElement('label');
        thinkingSwitchWrapper.className = 'switch-wrapper';

        const thinkingInput = document.createElement('input');
        thinkingInput.type = 'checkbox';
        thinkingInput.checked = service.disable_thinking ?? true;

        const thinkingSlider = document.createElement('span');
        thinkingSlider.className = `switch-slider${thinkingInput.checked ? ' checked' : ''}`;

        const thinkingButton = document.createElement('span');
        thinkingButton.className = `switch-button${thinkingInput.checked ? ' checked' : ''}`;
        thinkingSlider.appendChild(thinkingButton);

        thinkingInput.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                thinkingSlider.classList.add('checked');
                thinkingButton.classList.add('checked');
            } else {
                thinkingSlider.classList.remove('checked');
                thinkingButton.classList.remove('checked');
            }
            await this._updateService(service.id, { disable_thinking: isChecked });
            service.disable_thinking = isChecked;
        });

        thinkingSwitchWrapper.appendChild(thinkingInput);
        thinkingSwitchWrapper.appendChild(thinkingSlider);

        thinkingContainer.appendChild(thinkingLabelWrapper);
        thinkingContainer.appendChild(thinkingSwitchWrapper);
        settingsInlineContainer.appendChild(thinkingContainer);

        // ---启用高级参数开关---
        const advancedParamsContainer = document.createElement('div');
        advancedParamsContainer.className = 'service-setting-item';

        const advancedParamsLabel = document.createElement('span');
        advancedParamsLabel.className = 'service-setting-label';
        advancedParamsLabel.textContent = '启用高级参数';

        const advancedParamsIcon = document.createElement('i');
        advancedParamsIcon.className = 'pi pi-info-circle service-setting-info-icon';

        // 添加 tooltip
        createTooltip({
            target: advancedParamsIcon,
            content: '启用后将发送 temperature、top_p、max_tokens 参数以精细控制模型行为,限制最大tonken数来提升速度。如果关闭则可以提升兼容性。',
            position: 'top'
        });

        const advancedParamsLabelWrapper = document.createElement('div');
        advancedParamsLabelWrapper.className = 'service-setting-label-wrapper';
        advancedParamsLabelWrapper.appendChild(advancedParamsLabel);
        advancedParamsLabelWrapper.appendChild(advancedParamsIcon);

        // 创建开关
        const advancedParamsSwitchWrapper = document.createElement('label');
        advancedParamsSwitchWrapper.className = 'switch-wrapper';

        const advancedParamsInput = document.createElement('input');
        advancedParamsInput.type = 'checkbox';
        advancedParamsInput.checked = service.enable_advanced_params ?? false;

        const advancedParamsSlider = document.createElement('span');
        advancedParamsSlider.className = `switch-slider${advancedParamsInput.checked ? ' checked' : ''}`;

        const advancedParamsButton = document.createElement('span');
        advancedParamsButton.className = `switch-button${advancedParamsInput.checked ? ' checked' : ''}`;
        advancedParamsSlider.appendChild(advancedParamsButton);

        advancedParamsInput.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                advancedParamsSlider.classList.add('checked');
                advancedParamsButton.classList.add('checked');
            } else {
                advancedParamsSlider.classList.remove('checked');
                advancedParamsButton.classList.remove('checked');
            }
            await this._updateService(service.id, { enable_advanced_params: isChecked });
            service.enable_advanced_params = isChecked;
        });

        advancedParamsSwitchWrapper.appendChild(advancedParamsInput);
        advancedParamsSwitchWrapper.appendChild(advancedParamsSlider);

        advancedParamsContainer.appendChild(advancedParamsLabelWrapper);
        advancedParamsContainer.appendChild(advancedParamsSwitchWrapper);
        settingsInlineContainer.appendChild(advancedParamsContainer);

        // ---过滤思维链输出开关---
        const filterThinkingContainer = document.createElement('div');
        filterThinkingContainer.className = 'service-setting-item';

        const filterThinkingLabel = document.createElement('span');
        filterThinkingLabel.className = 'service-setting-label';
        filterThinkingLabel.textContent = '过滤思维链输出';

        const filterThinkingIcon = document.createElement('i');
        filterThinkingIcon.className = 'pi pi-info-circle service-setting-info-icon';

        // 添加 tooltip
        createTooltip({
            target: filterThinkingIcon,
            content: '针对无法关闭思维链模型，移除思考过程内容。默认开启。',
            position: 'top'
        });

        const filterThinkingLabelWrapper = document.createElement('div');
        filterThinkingLabelWrapper.className = 'service-setting-label-wrapper';
        filterThinkingLabelWrapper.appendChild(filterThinkingLabel);
        filterThinkingLabelWrapper.appendChild(filterThinkingIcon);

        // 创建开关
        const filterThinkingSwitchWrapper = document.createElement('label');
        filterThinkingSwitchWrapper.className = 'switch-wrapper';

        const filterThinkingInput = document.createElement('input');
        filterThinkingInput.type = 'checkbox';
        filterThinkingInput.checked = service.filter_thinking_output ?? true;

        const filterThinkingSlider = document.createElement('span');
        filterThinkingSlider.className = `switch-slider${filterThinkingInput.checked ? ' checked' : ''}`;

        const filterThinkingButton = document.createElement('span');
        filterThinkingButton.className = `switch-button${filterThinkingInput.checked ? ' checked' : ''}`;
        filterThinkingSlider.appendChild(filterThinkingButton);

        filterThinkingInput.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                filterThinkingSlider.classList.add('checked');
                filterThinkingButton.classList.add('checked');
            } else {
                filterThinkingSlider.classList.remove('checked');
                filterThinkingButton.classList.remove('checked');
            }
            await this._updateService(service.id, { filter_thinking_output: isChecked });
            service.filter_thinking_output = isChecked;
        });

        filterThinkingSwitchWrapper.appendChild(filterThinkingInput);
        filterThinkingSwitchWrapper.appendChild(filterThinkingSlider);

        filterThinkingContainer.appendChild(filterThinkingLabelWrapper);
        filterThinkingContainer.appendChild(filterThinkingSwitchWrapper);
        settingsInlineContainer.appendChild(filterThinkingContainer);
        
        const debugModeContainer = document.createElement('div');
        debugModeContainer.className = 'service-setting-item';
        
        const debugModeLabel = document.createElement('span');
        debugModeLabel.className = 'service-setting-label';
        debugModeLabel.textContent = '调试模式';
        
        const debugModeIcon = document.createElement('i');
        debugModeIcon.className = 'pi pi-info-circle service-setting-info-icon';
        
        createTooltip({
            target: debugModeIcon,
            content: '启用后将把请求JSON与响应JSON写入后端文件（debug_logs/api_debug_*.log），便于排查 OpenRouter/Gemini 等兼容问题。',
            position: 'top'
        });
        
        const debugModeLabelWrapper = document.createElement('div');
        debugModeLabelWrapper.className = 'service-setting-label-wrapper';
        debugModeLabelWrapper.appendChild(debugModeLabel);
        debugModeLabelWrapper.appendChild(debugModeIcon);
        
        const debugModeSwitchWrapper = document.createElement('label');
        debugModeSwitchWrapper.className = 'switch-wrapper';
        
        const debugModeInput = document.createElement('input');
        debugModeInput.type = 'checkbox';
        debugModeInput.checked = service.debug_mode ?? false;
        
        const debugModeSlider = document.createElement('span');
        debugModeSlider.className = `switch-slider${debugModeInput.checked ? ' checked' : ''}`;
        
        const debugModeButton = document.createElement('span');
        debugModeButton.className = `switch-button${debugModeInput.checked ? ' checked' : ''}`;
        debugModeSlider.appendChild(debugModeButton);
        
        debugModeInput.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                debugModeSlider.classList.add('checked');
                debugModeButton.classList.add('checked');
            } else {
                debugModeSlider.classList.remove('checked');
                debugModeButton.classList.remove('checked');
            }
            await this._updateService(service.id, { debug_mode: isChecked });
            service.debug_mode = isChecked;
        });
        
        debugModeSwitchWrapper.appendChild(debugModeInput);
        debugModeSwitchWrapper.appendChild(debugModeSlider);
        
        debugModeContainer.appendChild(debugModeLabelWrapper);
        debugModeContainer.appendChild(debugModeSwitchWrapper);
        settingsInlineContainer.appendChild(debugModeContainer);

        // Ollama专属:自动释放模型开关(仅前端UI)
        if (service.type === 'ollama') {
            const autoUnloadContainer = document.createElement('div');
            autoUnloadContainer.className = 'service-setting-item';

            const autoUnloadLabel = document.createElement('span');
            autoUnloadLabel.className = 'service-setting-label';
            autoUnloadLabel.textContent = '自动释放模型';

            const autoUnloadIcon = document.createElement('i');
            autoUnloadIcon.className = 'pi pi-info-circle service-setting-info-icon';

            // 添加 tooltip
            createTooltip({
                target: autoUnloadIcon,
                content: '请求完成后自动卸载模型以释放显存。⚠️该选项对针对前端小助手生效，节点有独立的选项。',
                position: 'top'
            });

            const autoUnloadLabelWrapper = document.createElement('div');
            autoUnloadLabelWrapper.className = 'service-setting-label-wrapper';
            autoUnloadLabelWrapper.appendChild(autoUnloadLabel);
            autoUnloadLabelWrapper.appendChild(autoUnloadIcon);

            // 创建开关
            const autoUnloadSwitchWrapper = document.createElement('label');
            autoUnloadSwitchWrapper.className = 'switch-wrapper';

            const autoUnloadInput = document.createElement('input');
            autoUnloadInput.type = 'checkbox';
            autoUnloadInput.checked = service.auto_unload !== false;

            const autoUnloadSlider = document.createElement('span');
            autoUnloadSlider.className = `switch-slider${autoUnloadInput.checked ? ' checked' : ''}`;

            const autoUnloadButton = document.createElement('span');
            autoUnloadButton.className = `switch-button${autoUnloadInput.checked ? ' checked' : ''}`;
            autoUnloadSlider.appendChild(autoUnloadButton);

            autoUnloadInput.addEventListener('change', async (e) => {
                const isChecked = e.target.checked;
                if (isChecked) {
                    autoUnloadSlider.classList.add('checked');
                    autoUnloadButton.classList.add('checked');
                } else {
                    autoUnloadSlider.classList.remove('checked');
                    autoUnloadButton.classList.remove('checked');
                }
                await this._updateService(service.id, { auto_unload: isChecked });
                service.auto_unload = isChecked;
            });

            autoUnloadSwitchWrapper.appendChild(autoUnloadInput);
            autoUnloadSwitchWrapper.appendChild(autoUnloadSlider);

            autoUnloadContainer.appendChild(autoUnloadLabelWrapper);
            autoUnloadContainer.appendChild(autoUnloadSwitchWrapper);
            settingsInlineContainer.appendChild(autoUnloadContainer);
        }

        card.appendChild(settingsInlineContainer);
        
        // LLM模型部分
        const llmSection = this._createModelSection(service, 'llm');
        card.appendChild(llmSection);

        // VLM模型部分
        const vlmSection = this._createModelSection(service, 'vlm');
        card.appendChild(vlmSection);

        return card;
    }


    /**
     * 创建模型配置部分
     */
    _createModelSection(service, modelType) {
        const section = document.createElement('div');
        section.className = 'settings-form-section';
        section.style.marginTop = '16px';

        // 标题行（包含模型类型和+按钮）
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        `;

        const title = document.createElement('h5');
        title.className = 'settings-form-section-title';
        title.textContent = modelType === 'llm' ? '2️⃣ 添加翻译、提示词优化的大语言模型 (LLM)' : '3️⃣ 添加图像、视频反推的视觉模型 (VLM)';
        title.style.margin = '0';

        // 添加模型按钮
        const addButton = document.createElement('button');
        addButton.className = 'p-button p-component p-button-sm';
        addButton.innerHTML = '<span class="p-button-icon-left pi pi-plus"></span><span class="p-button-label">添加模型</span>';
        addButton.addEventListener('click', () => this._showAddModelDialog(service, modelType, modelsContainer));

        titleRow.appendChild(title);
        titleRow.appendChild(addButton);
        section.appendChild(titleRow);

        // 模型标签容器（可拖动排序）
        const modelsContainer = document.createElement('div');
        modelsContainer.className = 'models-container';
        modelsContainer.dataset.serviceId = service.id;
        modelsContainer.dataset.modelType = modelType;

        const models = modelType === 'llm' ? service.llm_models : service.vlm_models;

        if (models && models.length > 0) {
            models.forEach((model) => {
                const modelTag = this._createModelTag(model, service, modelType);
                modelsContainer.appendChild(modelTag);
            });

            // 初始化Sortable拖动排序并保存实例
            modelsContainer.sortableInstance = new Sortable(modelsContainer, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                handle: '.model-tag',  // 整个标签都可以拖动
                onEnd: async (evt) => {
                    // 拖动结束后更新模型顺序
                    await this._updateModelOrder(service.id, modelType, modelsContainer);
                }
            });
        } else {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'empty-hint';
            emptyHint.textContent = '暂无配置模型，点击"+ 添加模型"开始配置';
            emptyHint.style.cssText = `
                font-size: 12px;
                color: var(--p-text-muted-color);
                padding: 8px;
            `;
            modelsContainer.appendChild(emptyHint);
        }

        section.appendChild(modelsContainer);

        // 移除固定的高级设置区域 - 现在点击模型标签时弹出气泡框编辑

        return section;
    }

    /**
     * 创建模型标签
     */
    _createModelTag(model, service, modelType) {
        const tag = document.createElement('div');
        tag.className = `model-tag${model.is_default ? ' default' : ''}`;
        tag.dataset.modelName = model.name;
        tag.dataset.selected = 'false';

        // 模型图标
        const iconSpan = document.createElement('i');
        iconSpan.className = 'pi pi-sparkles model-tag-icon';
        tag.appendChild(iconSpan);

        // 模型名称
        const nameSpan = document.createElement('span');
        nameSpan.className = 'model-tag-name';
        nameSpan.textContent = model.name;
        tag.appendChild(nameSpan);

        // 默认标记
        if (model.is_default) {
            const defaultBadge = document.createElement('span');
            defaultBadge.className = 'model-tag-badge';
            defaultBadge.textContent = '默认';
            tag.appendChild(defaultBadge);
        }

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '×';
        deleteBtn.className = 'model-delete-btn';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._deleteModel(service, modelType, model.name, tag);
        });
        tag.appendChild(deleteBtn);

        // ---点击选中状态---
        tag.addEventListener('click', (e) => {
            // 如果点击的是删除按钮,不触发选中
            if (e.target.closest('.model-delete-btn')) {
                return;
            }
            // 移除同容器内其他标签的选中状态
            const container = tag.parentElement;
            if (container) {
                container.querySelectorAll('.model-tag.selected').forEach(t => {
                    t.classList.remove('selected');
                });
            }
            // 添加当前标签的选中状态
            tag.classList.add('selected');
        });

        // ---右键菜单---
        // 使用函数形式动态获取菜单项,确保每次显示菜单时都能获取最新的模型状态
        const getMenuItems = () => {
            // 从本地数据中获取最新的模型状态
            const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
            const currentModel = models.find(m => m.name === model.name);
            const isDefault = currentModel ? currentModel.is_default : false;

            return [
                {
                    label: '设为默认模型',
                    icon: 'pi-star',
                    disabled: isDefault, // 动态获取当前是否为默认模型
                    onClick: () => {
                        this._setDefaultModel(service, modelType, model.name, tag);
                    }
                },
                { separator: true }, // 分隔线
                {
                    label: '修改模型参数设置',
                    icon: 'pi-cog',
                    onClick: () => {
                        this._selectModelForEdit(service, modelType, model.name, tag);
                    }
                }
            ];
        };

        createContextMenu({
            target: tag,
            items: getMenuItems
        });

        return tag;
    }

    /**
     * 选中模型进行编辑（弹出气泡框）
     */
    _selectModelForEdit(service, modelType, modelName, tagElement) {
        // 保存this引用
        const self = this;

        // 获取模型数据
        const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
        const selectedModel = models.find(m => m.name === modelName);

        if (!selectedModel) return;

        // 弹出气泡框编辑参数
        createConfirmPopup({
            target: tagElement,
            message: `模型参数设置`,
            icon: 'pi-cog',
            position: 'top',
            confirmLabel: '保存',
            cancelLabel: '取消',
            renderFormContent: (formContainer) => {
                // 为表单容器添加横向布局类
                formContainer.classList.add('model-params-form');
                formContainer.style.flexWrap = 'wrap';

                const createSendToggleRow = (fieldName, checked) => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.alignItems = 'center';
                    row.style.justifyContent = 'space-between';
                    row.style.marginTop = '8px';
                    row.style.fontSize = '12px';
                    row.style.opacity = '0.9';

                    const label = document.createElement('span');
                    label.textContent = '发送';

                    const switchWrapper = document.createElement('label');
                    switchWrapper.className = 'switch-wrapper';
                    switchWrapper.style.marginLeft = '0';

                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = checked;
                    input.dataset.fieldName = fieldName;

                    const slider = document.createElement('span');
                    slider.className = `switch-slider${checked ? ' checked' : ''}`;

                    const button = document.createElement('span');
                    button.className = `switch-button${checked ? ' checked' : ''}`;
                    slider.appendChild(button);

                    input.addEventListener('change', (e) => {
                        const isChecked = e.target.checked;
                        if (isChecked) {
                            slider.classList.add('checked');
                            button.classList.add('checked');
                        } else {
                            slider.classList.remove('checked');
                            button.classList.remove('checked');
                        }
                    });

                    switchWrapper.appendChild(input);
                    switchWrapper.appendChild(slider);

                    row.appendChild(label);
                    row.appendChild(switchWrapper);
                    return row;
                };

                // 温度 (Temperature)
                const tempInput = createInputGroup('温度 (Temperature)', '0.0 - 2.0', 'number');
                tempInput.input.min = '0';
                tempInput.input.max = '2';
                tempInput.input.step = '0.1';
                tempInput.input.value = selectedModel.temperature ?? 0.7;
                tempInput.input.dataset.fieldName = 'temperature';
                tempInput.group.style.width = '135px';
                tempInput.group.appendChild(createSendToggleRow('send_temperature', selectedModel.send_temperature ?? true));
                formContainer.appendChild(tempInput.group);

                // 核采样 (Top-P)
                const topPInput = createInputGroup('核采样 (Top-P)', '0.0 - 1.0', 'number');
                topPInput.input.min = '0';
                topPInput.input.max = '1';
                topPInput.input.step = '0.1';
                topPInput.input.value = selectedModel.top_p ?? 0.9;
                topPInput.input.dataset.fieldName = 'top_p';
                topPInput.group.style.width = '135px';
                topPInput.group.appendChild(createSendToggleRow('send_top_p', selectedModel.send_top_p ?? true));
                formContainer.appendChild(topPInput.group);

                // 最大Token数
                const maxTokensInput = createInputGroup('最大Token数', '1 - 8192', 'number');
                maxTokensInput.input.min = '1';
                maxTokensInput.input.max = '8192';
                maxTokensInput.input.step = '1';
                maxTokensInput.input.value = selectedModel.max_tokens ?? 1024;
                maxTokensInput.input.dataset.fieldName = 'max_tokens';
                maxTokensInput.group.style.width = '135px';
                maxTokensInput.group.appendChild(createSendToggleRow('send_max_tokens', selectedModel.send_max_tokens ?? true));
                formContainer.appendChild(maxTokensInput.group);

                const customParamsGroup = document.createElement('div');
                customParamsGroup.className = 'settings-form-group';
                customParamsGroup.style.flexBasis = '100%';
                customParamsGroup.style.marginTop = '12px';

                const customParamsLabelWrapper = document.createElement('div');
                customParamsLabelWrapper.className = 'service-setting-label-wrapper';

                const customParamsLabel = document.createElement('label');
                customParamsLabel.className = 'settings-form-label';
                customParamsLabel.textContent = '自定义请求参数(JSON)';

                const customParamsIcon = document.createElement('i');
                customParamsIcon.className = 'pi pi-info-circle service-setting-info-icon';
                customParamsIcon.style.marginTop = '2px';

                createTooltip({
                    target: customParamsIcon,
                    content: '以 JSON 形式追加到请求体中（不会覆盖 model/messages/stream）。示例：{"provider":{"order":["google"]}}',
                    position: 'top'
                });

                customParamsLabelWrapper.appendChild(customParamsLabel);
                customParamsLabelWrapper.appendChild(customParamsIcon);

                const customParamsTextarea = document.createElement('textarea');
                customParamsTextarea.className = 'p-inputtext p-component settings-form-textarea';
                customParamsTextarea.rows = 6;
                customParamsTextarea.placeholder = '{"provider":{"order":["google"]}}';
                customParamsTextarea.value = selectedModel.custom_params ?? service.custom_params ?? '';
                customParamsTextarea.dataset.fieldName = 'custom_params';

                customParamsGroup.appendChild(customParamsLabelWrapper);
                customParamsGroup.appendChild(customParamsTextarea);
                formContainer.appendChild(customParamsGroup);
            },
            onConfirm: async (formContainer) => {
                try {
                    // 获取表单数据
                    const temperature = parseFloat(formContainer.querySelector('[data-field-name="temperature"]').value);
                    const top_p = parseFloat(formContainer.querySelector('[data-field-name="top_p"]').value);
                    const max_tokens = parseInt(formContainer.querySelector('[data-field-name="max_tokens"]').value);
                    const send_temperature = !!formContainer.querySelector('[data-field-name="send_temperature"]').checked;
                    const send_top_p = !!formContainer.querySelector('[data-field-name="send_top_p"]').checked;
                    const send_max_tokens = !!formContainer.querySelector('[data-field-name="send_max_tokens"]').checked;
                    const custom_params = formContainer.querySelector('[data-field-name="custom_params"]').value || '';

                    // 验证数据
                    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: "温度值无效",
                            detail: "温度值应在 0 到 2 之间",
                            life: 2000
                        });
                        throw new Error('温度值无效');
                    }

                    if (isNaN(top_p) || top_p < 0 || top_p > 1) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: "核采样值无效",
                            detail: "核采样值应在 0 到 1 之间",
                            life: 2000
                        });
                        throw new Error('核采样值无效');
                    }

                    if (isNaN(max_tokens) || max_tokens < 1 || max_tokens > 8192) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: "最大Token数无效",
                            detail: "最大Token数应在 1 到 8192 之间",
                            life: 2000
                        });
                        throw new Error('最大Token数无效');
                    }

                    // 使用self代替this来调用方法
                    await self._updateModelParams(service.id, modelType, modelName, {
                        temperature,
                        top_p,
                        max_tokens,
                        send_temperature,
                        send_top_p,
                        send_max_tokens,
                        custom_params
                    });

                    // 更新本地数据
                    selectedModel.temperature = temperature;
                    selectedModel.top_p = top_p;
                    selectedModel.max_tokens = max_tokens;
                    selectedModel.send_temperature = send_temperature;
                    selectedModel.send_top_p = send_top_p;
                    selectedModel.send_max_tokens = send_max_tokens;
                    selectedModel.custom_params = custom_params;

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: "参数已更新",
                        detail: `${modelName} 的参数已保存`,
                        life: 2000
                    });
                } catch (error) {
                    logger.error('更新模型参数失败', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "更新失败",
                        detail: error.message,
                        life: 3000
                    });
                    throw error;
                }
            }
        });
    }

    /**
     * 批量更新模型参数
     */
    async _updateModelParams(serviceId, modelType, modelName, params) {
        if (!serviceId) {
            logger.error("更新模型参数失败: serviceId为空");
            throw new Error("服务ID不能为空");
        }
        try {
            // 依次更新每个参数
            for (const [paramName, paramValue] of Object.entries(params)) {
                const url = APIService.getApiUrl(`/services/${encodeURIComponent(serviceId)}/models/parameter`);
                logger.debug(`[v2] 正在更新参数: ${url}`, { modelType, modelName, paramName, paramValue });

                const res = await fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model_type: modelType,
                        model_name: modelName,
                        parameter_name: paramName,
                        parameter_value: paramValue
                    })
                });

                if (!res.ok) {
                    const text = await res.text();
                    logger.error(`更新参数请求失败: ${res.status} ${res.statusText}`, text);
                    throw new Error(`请求失败: ${res.status} ${res.statusText}`);
                }

                const text = await res.text();
                try {
                    const result = JSON.parse(text);
                    if (!result.success) {
                        throw new Error(result.error || '更新参数失败');
                    }
                } catch (e) {
                    logger.error(`解析响应JSON失败: ${text}`, e);
                    throw new Error(`解析响应失败: ${e.message}`);
                }
            }

            logger.debug(`已批量更新模型参数: ${modelName}`, params);

        } catch (error) {
            logger.error('批量更新模型参数失败', error);
            throw error;
        }
    }


    /**
     * 获取可用模型列表
     */
    async _getAvailableModels(service, modelType) {
        try {
            // 调用后端API获取模型列表
            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models?model_type=${modelType}`));
            const result = await res.json();

            // 返回结果包含success、models或error
            return result;

        } catch (error) {
            logger.error(`获取模型列表异常: ${error.message}`);
            return {
                success: false,
                error: `网络错误: ${error.message}`
            };
        }
    }

    /**
     * 显示添加模型列表框（使用多选组件）
     */
    _showAddModelDialog(service, modelType, container) {
        // 获取触发按钮
        const addBtn = event.target.closest('button');

        // 使用新的多选listbox组件
        createMultiSelectListbox({
            triggerElement: addBtn,
            placeholder: `搜索${modelType === 'llm' ? 'LLM' : 'VLM'}模型...`,
            fetchItems: async () => {
                const result = await this._getAvailableModels(service, modelType);

                if (!result.success) {
                    throw new Error(result.error || '获取模型列表失败');
                }

                return result.models[modelType] || [];
            },
            onConfirm: async (selectedModels, searchInputValue) => {
                // 如果没有勾选模型,但搜索框有内容,则将搜索框内容作为模型名称添加
                if (selectedModels.length === 0 && searchInputValue && searchInputValue.trim()) {
                    const modelName = searchInputValue.trim();
                    await this._addModel(service, modelType, modelName, container);
                } else {
                    // 批量添加选中的模型
                    for (const modelName of selectedModels) {
                        await this._addModel(service, modelType, modelName, container);
                    }
                }
            }
        });
    }

    /**
     * 获取推荐模型列表（已移除，返回空数组）
     */
    async _getRecommendedModels(modelType) {
        // 推荐模型已移除，所有模型从服务商API获取
        return [];
    }

    /**
     * 添加模型
     */
    async _addModel(service, modelType, modelName, container) {
        try {
            // 调用后端API添加模型
            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_type: modelType,
                    model_name: modelName,
                    temperature: 0.7,
                    top_p: 0.9,
                    max_tokens: 1024
                })
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || '添加模型失败');
            }

            // 更新本地数据
            const modelList = modelType === 'llm' ? service.llm_models : service.vlm_models;
            if (!modelList) {
                if (modelType === 'llm') {
                    service.llm_models = [];
                } else {
                    service.vlm_models = [];
                }
            }

            const updatedList = modelType === 'llm' ? service.llm_models : service.vlm_models;
            updatedList.push({
                name: modelName,
                is_default: updatedList.length === 0,
                temperature: 0.7,
                top_p: 0.9,
                max_tokens: 1024,
                send_temperature: true,
                send_top_p: true,
                send_max_tokens: true,
                custom_params: ''
            });

            // 移除空提示
            const emptyHint = container.querySelector('.empty-hint');
            if (emptyHint) {
                emptyHint.remove();
            }

            // 添加新标签
            const newTag = this._createModelTag({
                name: modelName,
                is_default: updatedList.length === 1
            }, service, modelType);
            container.appendChild(newTag);

            // 初始化或更新Sortable（确保新添加的标签可以拖动）
            // 先销毁旧的Sortable实例（如果存在）
            if (container.sortableInstance) {
                container.sortableInstance.destroy();
            }

            // 创建新的Sortable实例
            container.sortableInstance = new Sortable(container, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                handle: '.model-tag',
                onEnd: async (evt) => {
                    await this._updateModelOrder(service.id, modelType, container);
                }
            });

            app.extensionManager.toast.add({
                severity: "success",
                summary: "模型已添加",
                life: 2000
            });

        } catch (error) {
            logger.error('添加模型失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "添加失败",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * 删除模型
     */
    async _deleteModel(service, modelType, modelName, tagElement) {
        // 使用createSettingsDialog创建确认窗口
        createSettingsDialog({
            title: '<i class="pi pi-exclamation-triangle" style="margin-right: 8px; color: var(--p-orange-500);"></i>确认删除',
            isConfirmDialog: true,
            dialogClassName: 'confirm-dialog',
            saveButtonText: '删除',
            saveButtonIcon: 'pi-trash',
            isDangerButton: true,
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.className = 'confirm-dialog-content-simple';

                const confirmMessage = document.createElement('p');
                confirmMessage.className = 'confirm-dialog-message-simple';
                confirmMessage.textContent = `确定要删除模型"${modelName}"吗？`;

                content.appendChild(confirmMessage);
            },
            onSave: async () => {
                try {
                    // 调用后端API删除模型
                    const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models/${modelType}/${encodeURIComponent(modelName)}`), {
                        method: 'DELETE'
                    });

                    const result = await res.json();

                    if (!result.success) {
                        throw new Error(result.error || '删除模型失败');
                    }

                    // 更新本地数据
                    const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
                    const index = models.findIndex(m => m.name === modelName);
                    if (index >= 0) {
                        models.splice(index, 1);
                    }

                    // 移除标签
                    tagElement.remove();

                    // 如果删除后为空，显示空提示
                    const container = tagElement.parentElement;
                    if (container && container.children.length === 0) {
                        const emptyHint = document.createElement('div');
                        emptyHint.className = 'empty-hint';
                        emptyHint.textContent = '暂无配置模型，点击"+ 添加模型"开始配置';
                        emptyHint.style.cssText = `
                            font-size: 12px;
                            color: var(--p-text-muted-color);
                            padding: 8px;
                        `;
                        container.appendChild(emptyHint);
                    }

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: "模型已删除",
                        life: 2000
                    });

                    return true; // 允许关闭对话框

                } catch (error) {
                    logger.error('删除模型失败', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "删除失败",
                        detail: error.message,
                        life: 3000
                    });
                    return false; // 阻止关闭对话框
                }
            }
        });
    }

    /**
     * 设置默认模型
     */
    async _setDefaultModel(service, modelType, modelName, tagElement) {
        try {
            // 调用后端API设置默认模型
            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models/default`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_type: modelType,
                    model_name: modelName
                })
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || '设置默认模型失败');
            }

            // 更新本地数据
            const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
            models.forEach(m => {
                m.is_default = m.name === modelName;
            });

            // ---直接更新DOM，无需重新加载---
            const container = tagElement?.parentElement;
            if (container) {
                // 移除所有标签的默认状态
                container.querySelectorAll('.model-tag').forEach(tag => {
                    tag.classList.remove('default');
                    // 移除旧的默认标记
                    const oldBadge = tag.querySelector('.model-tag-badge');
                    if (oldBadge) {
                        oldBadge.remove();
                    }
                });

                // 为新的默认模型添加样式和标记
                if (tagElement) {
                    tagElement.classList.add('default');
                    // 在名称后面添加默认标记
                    const nameSpan = tagElement.querySelector('.model-tag-name');
                    if (nameSpan) {
                        const defaultBadge = document.createElement('span');
                        defaultBadge.className = 'model-tag-badge';
                        defaultBadge.textContent = '默认';
                        nameSpan.after(defaultBadge);
                    }
                }
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: `已设置"${modelName}"为默认模型`,
                life: 2000
            });

        } catch (error) {
            logger.error('设置默认模型失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "设置失败",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * 更新模型顺序
     */
    async _updateModelOrder(serviceId, modelType, container) {
        try {
            const modelTags = container.querySelectorAll('.model-tag');
            const newOrder = Array.from(modelTags).map(tag => tag.dataset.modelName);

            // 调用后端API更新顺序
            const res = await fetch(APIService.getApiUrl(`/services/${serviceId}/models/order`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_type: modelType,
                    model_names: newOrder
                })
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || '更新模型顺序失败');
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: "模型顺序已更新",
                life: 2000
            });

        } catch (error) {
            logger.error('更新模型顺序失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "更新失败",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * 删除服务商
     */
    async _deleteService(serviceId) {
        // 查找服务名称
        const service = this.services.find(s => s.id === serviceId);
        const serviceName = service ? service.name : serviceId;

        // 使用createSettingsDialog创建确认窗口
        createSettingsDialog({
            title: '<i class="pi pi-exclamation-triangle" style="margin-right: 8px; color: var(--p-orange-500);"></i>确认删除',
            isConfirmDialog: true,
            dialogClassName: 'confirm-dialog',
            saveButtonText: '删除',
            saveButtonIcon: 'pi-trash',
            isDangerButton: true,
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.className = 'confirm-dialog-content-simple';

                const confirmMessage = document.createElement('p');
                confirmMessage.className = 'confirm-dialog-message-simple';
                confirmMessage.textContent = `确定要删除服务商"${serviceName}"吗？`;

                content.appendChild(confirmMessage);
            },
            onSave: async () => {
                try {
                    const res = await fetch(APIService.getApiUrl(`/services/${serviceId}`), {
                        method: 'DELETE'
                    });

                    const result = await res.json();

                    if (result.success) {
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: "删除成功",
                            life: 3000
                        });

                        // 重新加载配置并刷新UI
                        await this._loadAllConfigs();

                        // 查找并移除对应的标签和内容
                        const tabButton = document.querySelector(`.tab-button[data-tab="${serviceId}"]`);
                        if (tabButton) {
                            tabButton.remove();
                        }

                        const tabPane = document.querySelector(`.tab-pane[data-tab="${serviceId}"]`);
                        if (tabPane) {
                            tabPane.remove();
                        }

                        // 自动切换到百度翻译标签
                        const header = document.querySelector('.tab-header');
                        const contentContainer = document.querySelector('.tab-content');
                        if (header && contentContainer) {
                            this._switchTab('baidu', header, contentContainer);
                        }

                        // 如果是最后一个服务商，显示空提示
                        const listContainer = document.querySelector('.services-list');
                        if (listContainer && this.services.length === 0) {
                            const emptyHint = document.createElement('div');
                            emptyHint.style.cssText = `
                                text-align: center;
                                padding: 40px;
                                color: var(--p-text-muted-color);
                            `;
                            emptyHint.textContent = '暂无服务商，点击"新增服务商"开始配置';
                            listContainer.appendChild(emptyHint);
                        }

                        // 触发配置同步事件
                        this.notifyConfigChange();

                        return true; // 允许关闭对话框
                    } else {
                        throw new Error(result.error || '删除失败');
                    }
                } catch (error) {
                    logger.error('删除服务商失败', error);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "删除失败",
                        detail: error.message,
                        life: 3000
                    });
                    return false; // 阻止关闭对话框
                }
            }
        });
    }

    /**
     * 更新服务商配置
     */
    async _updateService(serviceId, updates) {
        try {
            const res = await fetch(APIService.getApiUrl(`/services/${serviceId}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || '更新失败');
            }

            // 同步更新本地内存中的服务商数据
            const service = this.services.find(s => s.id === serviceId);
            if (service) {
                Object.assign(service, updates);
            }

            // 触发配置同步事件
            this.notifyConfigChange();

            logger.debug('服务商配置已更新', serviceId);

            // 显示成功提示
            app.extensionManager.toast.add({
                severity: "success",
                summary: "服务商配置已更新",
                life: 2000
            });
        } catch (error) {
            logger.error('更新服务商失败', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "更新失败",
                detail: error.message,
                life: 3000
            });
        }
    }



    /**
     * 加载掩码后的API Key
     * @param {string} serviceId 服务商ID
     * @returns {Promise<string|null>} 掩码后的API Key
     */
    async _loadMaskedApiKey(serviceId) {
        try {
            const res = await fetch(APIService.getApiUrl(`/services/${serviceId}/masked`));
            const result = await res.json();

            if (result.success && result.service) {
                return result.service.api_key_masked || null;
            }

            return null;
        } catch (error) {
            logger.error('加载掩码API Key失败', error);
            return null;
        }
    }
}

// 导出API配置管理器实例
export const apiConfigManager = new APIConfigManager(); 
