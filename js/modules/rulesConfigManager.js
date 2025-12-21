/**
 * 规则配置管理器
 * 负责管理规则规则配置弹窗和相关功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import {
    createSettingsDialog,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createTextareaGroup,
    createComboBoxGroup,
    createSelectButtonGroup
} from "./uiComponents.js";
import { APIService } from "../services/api.js";



class RulesConfigManager {
    constructor() {
        this.systemPrompts = null;
        // ---存储规则列表数据---
        this.expandPrompts = [];
        this.zhVisionPrompts = [];
        this.enVisionPrompts = [];
        this.videoPrompts = [];
        // ---当前激活的规则ID---
        this.activeExpandPromptId = null;
        this.activeZhVisionPromptId = null;
        this.activeEnVisionPromptId = null;
        this.activeVideoPromptId = null;

        this.isDirty = false;
        this.initialState = null; // 用于存储状态备份
    }

    /**
     * 备份当前状态
     */
    _backupState() {
        this.initialState = {
            expandPrompts: JSON.parse(JSON.stringify(this.expandPrompts)),
            translatePrompts: JSON.parse(JSON.stringify(this.translatePrompts || [])),
            zhVisionPrompts: JSON.parse(JSON.stringify(this.zhVisionPrompts)),
            enVisionPrompts: JSON.parse(JSON.stringify(this.enVisionPrompts)),
            videoPrompts: JSON.parse(JSON.stringify(this.videoPrompts || [])),
            activeExpandPromptId: this.activeExpandPromptId,
            activeZhVisionPromptId: this.activeZhVisionPromptId,
            activeEnVisionPromptId: this.activeEnVisionPromptId,
            activeVideoPromptId: this.activeVideoPromptId,
        };
        this.isDirty = false;
        // 标记表单未修改
        const form = document.querySelector('.rules-config-dialog .rules-config-form');
        if (form && form.elements.modified_marker) {
            form.elements.modified_marker.value = 'initial';
        }
    }

    /**
     * 从备份恢复状态
     */
    _restoreState() {
        if (this.initialState) {
            this.expandPrompts = JSON.parse(JSON.stringify(this.initialState.expandPrompts));
            this.translatePrompts = JSON.parse(JSON.stringify(this.initialState.translatePrompts || []));
            this.zhVisionPrompts = JSON.parse(JSON.stringify(this.initialState.zhVisionPrompts));
            this.enVisionPrompts = JSON.parse(JSON.stringify(this.initialState.enVisionPrompts));
            this.videoPrompts = JSON.parse(JSON.stringify(this.initialState.videoPrompts || []));
            this.activeExpandPromptId = this.initialState.activeExpandPromptId;
            this.activeZhVisionPromptId = this.initialState.activeZhVisionPromptId;
            this.activeEnVisionPromptId = this.initialState.activeEnVisionPromptId;
            this.activeVideoPromptId = this.initialState.activeVideoPromptId;
        }
        this.isDirty = false;
    }


    /**
     * 标记配置已修改
     */
    _setDirty() {
        this.isDirty = true;
        // 触发表单修改，以便通用对话框检测到未保存的更改
        const form = document.querySelector('.rules-config-dialog .rules-config-form');
        if (form && form.elements.modified_marker) {
            form.elements.modified_marker.value = 'modified_' + Date.now();
            form.elements.modified_marker.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * 显示规则配置弹窗
     */
    showRulesConfigModal() {
        try {
            logger.debug('打开规则配置弹窗');

            createSettingsDialog({
                title: '<i class="pi pi-list" style="margin-right: 8px;"></i>规则管理器',
                dialogClassName: 'rules-config-dialog',
                disableBackdropAndCloseOnClickOutside: true,
                renderContent: (container) => {
                    this._createRulesConfigUI(container);
                },
                onSave: async () => {
                    if (this.isDirty) {
                        try {
                            await this._saveConfigToServer();
                            this._backupState(); // 保存成功后更新备份
                            app.extensionManager.toast.add({
                                severity: "success",
                                summary: "配置已保存",
                                detail: "所有更改已成功保存到服务器",
                                life: 3000
                            });
                        } catch (error) {
                            // 错误提示已在 _saveConfigToServer 中处理
                            return false; // 保存失败时阻止关闭对话框
                        }
                    } else {
                        app.extensionManager.toast.add({
                            severity: "info",
                            summary: "无更改",
                            detail: "配置没有未保存的更改",
                            life: 3000
                        });
                    }
                    return true; // 关闭对话框
                },
                onCancel: () => {
                    // createSettingsDialog 的通用逻辑会处理确认
                    // 如果用户确认取消，我们在这里恢复状态
                    if (this.isDirty) {
                        this._restoreState();
                        this._renderPromptLists(); // 重新渲染以显示恢复后的状态
                    }
                    return true; // 允许关闭
                }
            });
        } catch (error) {
            logger.error(`打开规则配置弹窗失败: ${error.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "打开配置失败",
                detail: error.message || "打开配置弹窗过程中发生错误",
                life: 3000
            });
        }
    }

    /**
     * 创建规则配置UI
     * @param {HTMLElement} container 容器元素
     */
    _createRulesConfigUI(container) {
        const form = document.createElement('form');
        form.onsubmit = (e) => e.preventDefault();
        form.className = 'rules-config-form';

        // 添加一个隐藏输入，用于脏检查
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'modified_marker';
        hiddenInput.value = 'initial';
        form.appendChild(hiddenInput);

        // ---创建标签页容器---
        const tabContainer = document.createElement('div');
        tabContainer.className = 'rules-config-tabs';

        // ---创建标签页头部包装容器（包含标签按钮和添加按钮）---
        const tabHeaderWrapper = document.createElement('div');
        tabHeaderWrapper.className = 'tab-header-wrapper';

        // ---创建标签页头部---
        const tabHeader = document.createElement('div');
        tabHeader.className = 'tab-header';

        // ---创建添加按钮容器---
        const addButtonContainer = document.createElement('div');
        addButtonContainer.className = 'tab-header-actions';

        // 定义标签页配置（包含是否有添加按钮）
        const tabs = [
            { id: 'expand', title: '提示词优化规则', subtitle: '提示词优化润色提示词', addLabel: '添加提示词优化规则' },
            { id: 'zhVision', title: '中文反推', subtitle: '图像反推中文提示词', addLabel: '添加中文反推规则' },
            { id: 'enVision', title: '英文反推', subtitle: '图像反推英文提示词', addLabel: '添加英文反推规则' },
            { id: 'video', title: '视频反推', subtitle: '将视频反推提示词', addLabel: '添加视频反推规则' },
            { id: 'translate', title: '翻译规则', subtitle: '大模型翻译规则', addLabel: null }
        ];

        // 创建标签按钮
        tabs.forEach((tab, index) => {
            const button = this._createRuleTabButton(tab.id, tab.title, tab.subtitle);
            if (index === 0) {
                button.classList.add('active');
            }
            tabHeader.appendChild(button);
        });

        // 创建各标签页对应的添加按钮（初始只显示第一个）
        tabs.forEach((tab, index) => {
            if (tab.addLabel) {
                const addButton = document.createElement('button');
                addButton.className = 'p-button p-component p-button-sm tab-add-button';
                addButton.type = 'button';
                addButton.dataset.tab = tab.id;
                addButton.innerHTML = `<span class="p-button-icon-left pi pi-plus"></span><span class="p-button-label">${tab.addLabel}</span>`;
                addButton.onclick = () => {
                    this._showPromptEditDialog(tab.id, null);
                };
                // 只显示第一个标签页的按钮
                addButton.style.display = index === 0 ? 'inline-flex' : 'none';
                addButtonContainer.appendChild(addButton);
            }
        });

        tabHeaderWrapper.appendChild(tabHeader);
        tabHeaderWrapper.appendChild(addButtonContainer);
        tabContainer.appendChild(tabHeaderWrapper);

        // ---创建标签页内容容器---
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';

        // 创建各个标签页内容
        const expandPane = this._createExpandTabPane();
        const zhVisionPane = this._createVisionTabPane('zhVision', '中文反推规则');
        const enVisionPane = this._createVisionTabPane('enVision', '英文反推规则');
        const videoPane = this._createVideoTabPane();
        const translatePane = this._createTranslateTabPane();

        tabContent.appendChild(expandPane);
        tabContent.appendChild(zhVisionPane);
        tabContent.appendChild(enVisionPane);
        tabContent.appendChild(videoPane);
        tabContent.appendChild(translatePane);

        tabContainer.appendChild(tabContent);
        form.appendChild(tabContainer);
        container.appendChild(form);

        // 默认显示第一个标签页
        this._switchRuleTab('expand', tabHeader, tabContent);

        // 加载系统规则配置
        this._loadSystemPrompts();
    }

    /**
     * 创建规则标签按钮
     * @param {string} tabId 标签ID
     * @param {string} title 标签标题
     * @param {string} subtitle 标签副标题
     * @returns {HTMLElement} 标签按钮元素
     */
    _createRuleTabButton(tabId, title, subtitle) {
        const button = document.createElement('button');
        button.className = 'tab-button';
        button.dataset.tab = tabId;
        button.type = 'button';

        const titleEl = document.createElement('div');
        titleEl.className = 'tab-title';
        titleEl.textContent = title;
        button.appendChild(titleEl);

        if (subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'tab-subtitle';
            subtitleEl.textContent = subtitle;
            button.appendChild(subtitleEl);
        }

        // 点击切换标签
        button.addEventListener('click', () => {
            const tabHeader = button.parentElement;
            // tabHeader 在 tab-header-wrapper 内，tabContent 是 wrapper 的下一个兄弟元素
            const tabHeaderWrapper = tabHeader.parentElement;
            const tabContent = tabHeaderWrapper.nextElementSibling;
            this._switchRuleTab(tabId, tabHeader, tabContent);
        });

        return button;
    }

    /**
     * 切换规则标签页
     * @param {string} tabId 标签ID
     * @param {HTMLElement} header 标签头部容器
     * @param {HTMLElement} contentContainer 内容容器
     */
    _switchRuleTab(tabId, header, contentContainer) {
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

        // 切换添加按钮的显示状态
        const actionsContainer = header.parentElement?.querySelector('.tab-header-actions');
        if (actionsContainer) {
            actionsContainer.querySelectorAll('.tab-add-button').forEach(btn => {
                btn.style.display = btn.dataset.tab === tabId ? 'inline-flex' : 'none';
            });
        }
    }

    /**
     * 创建扩写规则标签页内容
     * @returns {HTMLElement} 标签页内容元素
     */
    _createExpandTabPane() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'expand';
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // 创建规则列表容器
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">状态</div>
            <div class="prompt-list-cell name-cell">规则名称</div>
            <div class="prompt-list-cell content-cell">规则内容</div>
            <div class="prompt-list-cell action-cell">操作</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);

        // 存储列表引用
        this.expandScrollList = scrollList;

        return pane;
    }

    /**
     * 创建翻译规则标签页内容（只读编辑模式）
     * @returns {HTMLElement} 标签页内容元素
     */
    _createTranslateTabPane() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'translate';
        pane.style.display = 'none';
        pane.style.padding = '16px';



        // 创建翻译规则列表容器
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell name-cell">规则名称</div>
            <div class="prompt-list-cell content-cell">规则内容</div>
            <div class="prompt-list-cell action-cell">操作</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);
        // 创建提示信息
        const notice = document.createElement('div');
        notice.className = 'rule-pane-notice';
        notice.innerHTML = '<i class="pi pi-info-circle"></i> 翻译规则仅支持编辑，不支持新增和删除';
        pane.appendChild(notice);

        // 存储列表引用
        this.translateScrollList = scrollList;

        return pane;
    }

    /**
     * 创建反推规则标签页内容
     * @param {string} type 类型 (zhVision/enVision)
     * @param {string} title 标题
     * @returns {HTMLElement} 标签页内容元素
     */
    _createVisionTabPane(type, title) {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = type;
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // 创建规则列表容器
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container vision-prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">状态</div>
            <div class="prompt-list-cell name-cell">规则名称</div>
            <div class="prompt-list-cell content-cell">规则内容</div>
            <div class="prompt-list-cell action-cell">操作</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);

        // 存储列表引用
        if (type === 'zhVision') {
            this.zhVisionScrollList = scrollList;
        } else {
            this.enVisionScrollList = scrollList;
        }

        return pane;
    }

    /**
     * 创建视频反推规则标签页内容
     * @returns {HTMLElement} 标签页内容元素
     */
    _createVideoTabPane() {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.dataset.tab = 'video';
        pane.style.display = 'none';
        pane.style.padding = '16px';

        // 创建规则列表容器
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container video-prompt-list-container';

        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">状态</div>
            <div class="prompt-list-cell name-cell">规则名称</div>
            <div class="prompt-list-cell content-cell">规则内容</div>
            <div class="prompt-list-cell action-cell">操作</div>
        `;
        this._addHeaderResizers(listHeader);

        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        pane.appendChild(listContainer);

        // 存储列表引用
        this.videoScrollList = scrollList;

        return pane;
    }

    /**
     * 加载系统规则配置
     */
    async _loadSystemPrompts() {
        try {
            const response = await fetch(APIService.getApiUrl('/config/system_prompts'));
            if (!response.ok) {
                throw new Error(`加载系统规则配置失败: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            this.systemPrompts = data;

            // 获取激活的规则ID
            const activePrompts = data.active_prompts || {};
            const activeExpandId = activePrompts.expand;
            const activeZhVisionId = activePrompts.vision_zh;
            const activeEnVisionId = activePrompts.vision_en;

            // 输出加载的激活ID
            logger.debug(`加载的激活规则ID | expand:${activeExpandId || '无'} | vision_zh:${activeZhVisionId || '无'} | vision_en:${activeEnVisionId || '无'}`);

            // 转换扩写规则数据
            this.expandPrompts = [];
            if (data.expand_prompts) {
                // 保存原始顺序，以便在保存时恢复
                this.originalExpandOrder = Object.keys(data.expand_prompts);

                // 使用原始顺序遍历键
                this.originalExpandOrder.forEach(key => {
                    const prompt = data.expand_prompts[key];
                    // 使用配置中的键作为ID，而不是生成新的ID
                    this.expandPrompts.push({
                        id: key,
                        name: prompt.name || key, // 如果没有名称，使用键作为名称
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeExpandId, // 根据active_prompts判断是否激活
                        order: this.originalExpandOrder.indexOf(key) // 保存原始顺序
                    });
                });

                // 如果没有找到激活的规则，则激活第一个
                if (!activeExpandId && this.expandPrompts.length > 0) {
                    this.expandPrompts[0].isActive = true;
                    this.activeExpandPromptId = this.expandPrompts[0].id;
                } else {
                    this.activeExpandPromptId = activeExpandId;
                }

                // 按原始顺序排序
                this.expandPrompts.sort((a, b) => a.order - b.order);
            }

            // 转换反推规则数据
            this.zhVisionPrompts = [];
            this.enVisionPrompts = [];
            if (data.vision_prompts) {
                // 保存原始顺序
                this.originalVisionOrder = Object.keys(data.vision_prompts);

                // 分别存储中文和英文规则的键
                const zhKeys = [];
                const enKeys = [];

                // 先分类所有键
                this.originalVisionOrder.forEach(key => {
                    const prompt = data.vision_prompts[key];
                    // 根据ID或内容判断是中文还是英文
                    const isChinese = key.includes('zh') || /[\u4e00-\u9fa5]/.test(prompt.content);

                    if (isChinese) {
                        zhKeys.push(key);
                    } else {
                        enKeys.push(key);
                    }
                });

                // 处理中文规则
                zhKeys.forEach((key, index) => {
                    const prompt = data.vision_prompts[key];
                    this.zhVisionPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeZhVisionId,
                        order: this.originalVisionOrder.indexOf(key) // 保存原始顺序
                    });
                });

                // 处理英文规则
                enKeys.forEach((key, index) => {
                    const prompt = data.vision_prompts[key];
                    this.enVisionPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeEnVisionId,
                        order: this.originalVisionOrder.indexOf(key) // 保存原始顺序
                    });
                });

                // 按原始顺序排序
                this.zhVisionPrompts.sort((a, b) => a.order - b.order);
                this.enVisionPrompts.sort((a, b) => a.order - b.order);

                // 如果没有找到激活的中文规则，则激活第一个
                if (!activeZhVisionId && this.zhVisionPrompts.length > 0) {
                    this.zhVisionPrompts[0].isActive = true;
                    this.activeZhVisionPromptId = this.zhVisionPrompts[0].id;
                } else {
                    this.activeZhVisionPromptId = activeZhVisionId;
                }

                // 如果没有找到激活的英文规则，则激活第一个
                if (!activeEnVisionId && this.enVisionPrompts.length > 0) {
                    this.enVisionPrompts[0].isActive = true;
                    this.activeEnVisionPromptId = this.enVisionPrompts[0].id;
                } else {
                    this.activeEnVisionPromptId = activeEnVisionId;
                }
            }

            // 转换翻译规则数据（只读编辑模式）
            this.translatePrompts = [];
            if (data.translate_prompts) {
                Object.keys(data.translate_prompts).forEach(key => {
                    const prompt = data.translate_prompts[key];
                    this.translatePrompts.push({
                        id: key,
                        name: key, // 使用键作为名称
                        content: prompt.content,
                        role: prompt.role || 'system',
                        isReadOnly: true // 标记为只读（不可增删）
                    });
                });
            }

            // 转换视频反推规则数据
            this.videoPrompts = [];
            const activeVideoId = activePrompts.video;
            if (data.video_prompts) {
                const videoKeys = Object.keys(data.video_prompts);
                videoKeys.forEach((key, index) => {
                    const prompt = data.video_prompts[key];
                    this.videoPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        tags: prompt.tags || [],
                        category: prompt.category || '',
                        showIn: prompt.showIn || ['frontend', 'node'],
                        content: prompt.content,
                        isActive: key === activeVideoId,
                        order: index
                    });
                });

                // 如果没有找到激活的视频反推规则，则激活第一个
                if (!activeVideoId && this.videoPrompts.length > 0) {
                    this.videoPrompts[0].isActive = true;
                    this.activeVideoPromptId = this.videoPrompts[0].id;
                } else {
                    this.activeVideoPromptId = activeVideoId;
                }
            }

            // 备份初始状态
            this._backupState();

            // 渲染列表
            this._renderPromptLists();

        } catch (error) {
            logger.error("加载系统规则配置失败:", error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "加载失败",
                detail: error.message || "加载系统规则配置过程中发生错误",
                life: 3000
            });
        }
    }

    /**
     * 渲染规则列表
     */
    _renderPromptLists() {
        logger.debug(`开始渲染规则列表 | 提示词优化规则:${this.expandPrompts.length}个 | 翻译规则:${this.translatePrompts?.length || 0}个 | 中文反推:${this.zhVisionPrompts.length}个 | 英文反推:${this.enVisionPrompts.length}个`);

        // 渲染扩写规则列表
        if (this.expandScrollList) {
            this._renderPromptList(this.expandScrollList, this.expandPrompts, 'expand');
            logger.debug(`渲染提示词优化规则列表完成`);
        } else {
            logger.error(`提示词优化规则列表容器不存在`);
        }

        // 渲染翻译规则列表（只读编辑模式）
        if (this.translateScrollList) {
            this._renderTranslateList(this.translateScrollList, this.translatePrompts || []);
            logger.debug(`渲染翻译规则列表完成`);
        }

        // 渲染中文反推规则列表
        if (this.zhVisionScrollList) {
            this._renderPromptList(this.zhVisionScrollList, this.zhVisionPrompts, 'zhVision');
            logger.debug(`渲染中文反推规则列表完成`);
        } else {
            logger.error(`中文反推规则列表容器不存在`);
        }

        // 渲染英文反推规则列表
        if (this.enVisionScrollList) {
            this._renderPromptList(this.enVisionScrollList, this.enVisionPrompts, 'enVision');
            logger.debug(`渲染英文反推规则列表完成`);
        } else {
            logger.error(`英文反推规则列表容器不存在`);
        }

        // 渲染视频反推规则列表
        if (this.videoScrollList) {
            this._renderPromptList(this.videoScrollList, this.videoPrompts || [], 'video');
            logger.debug(`渲染视频反推规则列表完成`);
        }
    }


    /**
     * 渲染翻译规则列表（只读编辑模式）
     * @param {HTMLElement} container 列表容器
     * @param {Array} prompts 翻译规则数组
     */
    _renderTranslateList(container, prompts) {
        container.innerHTML = '';

        prompts.forEach(prompt => {
            const row = document.createElement('div');
            row.className = 'prompt-list-row translate-row';
            row.dataset.promptId = prompt.id;
            row.dataset.type = 'translate';

            // 名称列
            const nameCell = document.createElement('div');
            nameCell.className = 'prompt-list-cell name-cell';
            nameCell.textContent = prompt.name;
            nameCell.title = prompt.name;

            // 内容列
            const contentCell = document.createElement('div');
            contentCell.className = 'prompt-list-cell content-cell';
            contentCell.textContent = prompt.content;
            contentCell.title = prompt.content;

            // 操作列（只有编辑按钮）
            const actionCell = document.createElement('div');
            actionCell.className = 'prompt-list-cell action-cell';

            const editBtn = document.createElement('button');
            editBtn.className = 'prompt-action-btn edit-btn';
            editBtn.innerHTML = '<span class="pi pi-pencil"></span>';
            editBtn.title = '编辑翻译规则';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                this._showTranslateEditDialog(prompt.id);
            };

            actionCell.appendChild(editBtn);

            row.appendChild(nameCell);
            row.appendChild(contentCell);
            row.appendChild(actionCell);

            container.appendChild(row);
        });
    }

    /**
     * 显示翻译规则编辑对话框
     * @param {string} promptId 翻译规则ID
     */
    _showTranslateEditDialog(promptId) {
        const prompt = (this.translatePrompts || []).find(p => p.id === promptId);
        if (!prompt) {
            logger.error(`找不到翻译规则: ${promptId}`);
            return;
        }

        createSettingsDialog({
            title: '<i class="pi pi-pencil" style="margin-right: 8px;"></i>编辑翻译规则',
            isConfirmDialog: true,
            dialogClassName: 'translate-edit-dialog',
            renderContent: (content) => {
                content.className += ' dialog-form-content';
                content.style.padding = '1rem';
                content.style.display = 'flex';
                content.style.flexDirection = 'column';
                content.style.flex = '1';

                // 显示规则名称（只读）
                const nameGroup = document.createElement('div');
                nameGroup.className = 'settings-form-group-item';
                nameGroup.innerHTML = `
                    <label class="settings-form-label">规则名称</label>
                    <div class="settings-input-wrapper">
                        <input type="text" class="settings-input" value="${prompt.name}" disabled style="opacity: 0.7;" />
                    </div>
                `;
                nameGroup.style.marginBottom = '10px';

                // 创建内容编辑区
                const contentTextarea = createTextareaGroup('规则内容', '请输入翻译规则内容', 10);
                contentTextarea.group.style.flex = '1';
                contentTextarea.group.style.display = 'flex';
                contentTextarea.group.style.flexDirection = 'column';
                contentTextarea.textarea.value = prompt.content || '';

                content.appendChild(nameGroup);
                content.appendChild(contentTextarea.group);

                content.contentTextarea = contentTextarea.textarea;
            },
            onSave: (content) => {
                const newContent = content.contentTextarea.value.trim();

                if (!newContent) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "编辑失败",
                        detail: "规则内容不能为空",
                        life: 3000
                    });
                    return false;
                }

                // 更新翻译规则内容
                prompt.content = newContent;

                // 标记为已修改
                this._setDirty();

                // 重新渲染列表
                this._renderPromptLists();

                return true;
            }
        });
    }

    /**
     * 渲染单个规则列表
     * @param {HTMLElement} container 列表容器
     * @param {Array} prompts 规则数组
     * @param {string} type 类型
     */
    _renderPromptList(container, prompts, type) {
        container.innerHTML = '';

        prompts.forEach(prompt => {
            const row = document.createElement('div');
            row.className = 'prompt-list-row';
            row.dataset.promptId = prompt.id;
            row.dataset.type = type;
            row.dataset.order = prompt.order; // 添加顺序属性到DOM元素，方便调试

            // 状态列 - 可点击切换状态
            const statusCell = document.createElement('div');
            statusCell.className = 'prompt-list-cell status-cell';
            const statusIcon = document.createElement('span');
            statusIcon.className = prompt.isActive ? 'pi pi-check-circle active-status' : 'pi pi-circle-off inactive-status';
            statusIcon.title = prompt.isActive ? '当前使用中，点击取消激活' : '未激活，点击激活';
            statusCell.appendChild(statusIcon);
            statusCell.onclick = (e) => {
                e.stopPropagation();
                this._togglePromptActive(type, prompt.id);
            };

            // 名称列
            const nameCell = document.createElement('div');
            nameCell.className = 'prompt-list-cell name-cell';
            // 使用name属性显示名称，而不是id
            nameCell.textContent = prompt.name;
            nameCell.title = prompt.name;

            // 添加列宽调整手柄
            const nameResizer = document.createElement('div');
            nameResizer.className = 'column-resizer';
            nameCell.appendChild(nameResizer);
            this._addColumnResizer(nameResizer, nameCell);

            // 内容列
            const contentCell = document.createElement('div');
            contentCell.className = 'prompt-list-cell content-cell';
            const contentPreview = prompt.content.length > 50 ?
                prompt.content.substring(0, 50) + '...' : prompt.content;
            contentCell.textContent = contentPreview;
            contentCell.title = prompt.content;

            // 添加列宽调整手柄
            const contentResizer = document.createElement('div');
            contentResizer.className = 'column-resizer';
            contentCell.appendChild(contentResizer);
            this._addColumnResizer(contentResizer, contentCell);

            // 操作列
            const actionCell = document.createElement('div');
            actionCell.className = 'prompt-list-cell action-cell';

            // 编辑按钮
            const editButton = document.createElement('button');
            editButton.className = 'prompt-action-btn edit-btn';
            editButton.innerHTML = '<span class="pi pi-pencil"></span>';
            editButton.title = '编辑';
            editButton.onclick = (e) => {
                e.stopPropagation();
                this._showPromptEditDialog(type, prompt.id);
            };

            // 删除按钮
            const deleteButton = document.createElement('button');
            deleteButton.className = 'prompt-action-btn delete-btn';
            deleteButton.innerHTML = '<span class="pi pi-trash"></span>';
            deleteButton.title = '删除';
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                this._deletePrompt(type, prompt.id);
            };

            actionCell.appendChild(editButton);
            actionCell.appendChild(deleteButton);

            row.appendChild(statusCell);
            row.appendChild(nameCell);
            row.appendChild(contentCell);
            row.appendChild(actionCell);

            container.appendChild(row);
        });

        // 初始化拖拽排序
        this._initSortable(container, type);
    }

    /**
     * 获取已存在的分类列表
     * 从所有规则类型中提取已使用的分类
     * @returns {Array<{value: string, text: string}>} 分类选项列表
     */
    _getExistingCategories() {
        const categories = new Set();

        // 从所有规则类型中提取分类
        const allPrompts = [
            ...this.expandPrompts,
            ...this.zhVisionPrompts,
            ...this.enVisionPrompts,
            ...this.videoPrompts
        ];

        allPrompts.forEach(prompt => {
            if (prompt.category && typeof prompt.category === 'string') {
                categories.add(prompt.category);
            }
        });

        // 转换为下拉选项格式
        return Array.from(categories)
            .sort() // 按字母顺序排序
            .map(cat => ({ value: cat, text: cat }));
    }

    /**
     * 显示规则编辑对话框
     * @param {string} type 类型
     * @param {string|null} promptId 规则ID，null表示新建
     */
    _showPromptEditDialog(type, promptId) {
        this._showPromptConfigDialog(type, promptId);
    }



    /**
     * 显示通用的规则配置弹窗
     * @param {string} defaultType 默认类型
     * @param {string|null} promptId 规则ID，null表示新建
     */
    _showPromptConfigDialog(defaultType = 'expand', promptId = null) {
        const isEdit = !!promptId;
        let editData = null;

        // 如果是编辑模式，查找对应的数据
        if (isEdit) {
            if (defaultType === 'expand') {
                editData = this.expandPrompts.find(p => p.id === promptId);
            } else if (defaultType === 'zhVision') {
                editData = this.zhVisionPrompts.find(p => p.id === promptId);
            } else if (defaultType === 'enVision') {
                editData = this.enVisionPrompts.find(p => p.id === promptId);
            } else if (defaultType === 'video') {
                editData = this.videoPrompts.find(p => p.id === promptId);
            }
        }

        createSettingsDialog({
            title: isEdit ? '编辑规则' : '添加规则',
            isConfirmDialog: true,
            dialogClassName: 'prompt-edit-dialog',
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: isEdit ? '保存' : '添加',
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.className += ' dialog-form-content';
                content.style.padding = '10px 40px'; // 增加两侧留白
                content.style.display = 'flex';
                content.style.flexDirection = 'column';
                content.style.flex = '1';
                content.style.overflow = 'hidden'; // 整体不滚动，内部 textarea 滚动

                // 创建规则名称输入框
                const nameInput = createInputGroup('规则名称', '请输入规则名称');
                nameInput.group.style.marginBottom = '10px';
                if (isEdit && editData) {
                    nameInput.input.value = editData.name || '';
                }

                // 创建规则类型下拉框
                const typeOptions = [
                    { value: 'expand', text: '提示词优化' },
                    { value: 'zhVision', text: '反推（中文）' },
                    { value: 'enVision', text: '反推（英文）' },
                    { value: 'video', text: '视频反推' }
                ];
                const typeSelect = createSelectGroup('规则类型', typeOptions, defaultType);
                typeSelect.group.style.marginBottom = '10px';

                // 创建分类选择框（可输入）
                const categoryOptions = this._getExistingCategories();
                const initialCategory = (isEdit && editData) ? (editData.category || '') : '';
                const categoryComboBox = createComboBoxGroup('分类', categoryOptions, initialCategory, {
                    placeholder: '输入或选择分类（可留空）',
                    emptyText: '暂无分类'
                });
                categoryComboBox.group.style.flex = '1';
                categoryComboBox.group.style.marginBottom = '0';

                // 创建显示位置选择组件
                const showInOptions = [
                    { value: 'frontend', label: '小助手上显示' },
                    { value: 'node', label: '节点上显示' }
                ];
                // 获取初始值：编辑时从规则数据读取，新建时默认都选中
                const initialShowIn = (isEdit && editData && editData.showIn)
                    ? editData.showIn
                    : ['frontend', 'node'];
                const showInSelectButton = createSelectButtonGroup('', showInOptions, initialShowIn, {
                    mode: 'multiple',
                    size: 'small',
                    allowEmpty: true
                });
                showInSelectButton.group.style.marginBottom = '0';

                // 创建行容器放置分类和显示位置组件
                const categoryRow = document.createElement('div');
                categoryRow.style.display = 'flex';
                categoryRow.style.flexDirection = 'row';
                categoryRow.style.alignItems = 'flex-end';
                categoryRow.style.gap = '1rem';
                categoryRow.style.marginBottom = '10px';
                categoryRow.appendChild(categoryComboBox.group);
                categoryRow.appendChild(showInSelectButton.group);

                // 创建规则内容多行输入框
                const contentTextarea = createTextareaGroup('规则内容', '请输入规则内容');
                contentTextarea.group.style.marginBottom = '0';
                contentTextarea.group.style.flex = '1';
                contentTextarea.group.style.display = 'flex';
                contentTextarea.group.style.flexDirection = 'column';

                // 确保 textarea 填充容器
                const textareaContainer = contentTextarea.group.querySelector('.float-label-container');
                if (textareaContainer) {
                    textareaContainer.style.flex = '1';
                    textareaContainer.style.display = 'flex';
                    textareaContainer.style.flexDirection = 'column';
                    contentTextarea.textarea.style.flex = '1';
                }

                if (isEdit && editData) {
                    contentTextarea.textarea.value = editData.content || '';
                }

                content.appendChild(nameInput.group);
                content.appendChild(typeSelect.group);
                content.appendChild(categoryRow);
                content.appendChild(contentTextarea.group);

                content.nameInput = nameInput.input;
                content.typeSelect = typeSelect.select;
                content.categoryInput = categoryComboBox.input;
                content.showInSelectButton = showInSelectButton;
                content.contentTextarea = contentTextarea.textarea;

                // 聚焦名称输入框
                setTimeout(() => {
                    nameInput.input.focus();
                }, 100);
            },
            onSave: (content) => {
                const name = content.nameInput.value.trim();
                const type = content.typeSelect.value;
                const category = content.categoryInput.value.trim();
                const showIn = content.showInSelectButton.getValue();
                const promptContent = content.contentTextarea.value.trim();

                if (!name || !promptContent) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? "编辑失败" : "添加失败",
                        detail: "规则名称和内容不能为空",
                        life: 3000
                    });
                    return;
                }

                // 根据类型获取对应的数组
                let targetArray;
                if (type === 'expand') {
                    targetArray = this.expandPrompts;
                } else if (type === 'zhVision') {
                    targetArray = this.zhVisionPrompts;
                } else if (type === 'enVision') {
                    targetArray = this.enVisionPrompts;
                } else if (type === 'video') {
                    targetArray = this.videoPrompts;
                } else {
                    logger.error(`未知的规则类型: ${type}`);
                    return;
                }

                // 检查名称是否重复（排除编辑时的自身）
                const isDuplicate = targetArray.some(p =>
                    (p.name === name || p.id === name) && (!isEdit || p.id !== promptId)
                );

                if (isDuplicate) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? "编辑失败" : "添加失败",
                        detail: `规则名称"${name}"已存在`,
                        life: 3000
                    });
                    return;
                }

                if (isEdit) {
                    // 编辑模式：更新现有数据
                    if (editData) {
                        // 如果类型发生变化，需要从原数组中移除，添加到新数组
                        if (type !== defaultType) {
                            // 从原数组中移除
                            let originalArray;
                            if (defaultType === 'expand') {
                                originalArray = this.expandPrompts;
                            } else if (defaultType === 'zhVision') {
                                originalArray = this.zhVisionPrompts;
                            } else if (defaultType === 'enVision') {
                                originalArray = this.enVisionPrompts;
                            }
                            const index = originalArray.findIndex(p => p.id === promptId);
                            if (index !== -1) {
                                originalArray.splice(index, 1);
                            }

                            // 添加到新数组
                            // 为不同类型的规则设置不同的ID前缀
                            let newId;
                            if (type === 'expand') {
                                newId = 'expand_' + name.replace(/\s+/g, '_');
                            } else if (type === 'zhVision') {
                                newId = 'vision_zh_' + name.replace(/\s+/g, '_');
                            } else if (type === 'enVision') {
                                newId = 'vision_en_' + name.replace(/\s+/g, '_');
                            } else {
                                newId = this._generateId();
                            }

                            const newPrompt = {
                                id: newId,
                                name: name,
                                category: category,
                                showIn: showIn,
                                content: promptContent,
                                isActive: false,
                                order: targetArray.length // 设置顺序为当前数组长度
                            };
                            targetArray.push(newPrompt);
                            logger.debug(`跨类型编辑规则 | 原类型:${defaultType} | 新类型:${type} | 新ID:${newId}`);
                        } else {
                            // 同类型编辑，直接更新
                            const oldName = editData.name;
                            editData.name = name;
                            editData.category = category;
                            editData.showIn = showIn;
                            editData.content = promptContent;

                            // 如果名称发生了变化，则更新ID
                            if (oldName !== name) {
                                const oldId = editData.id;
                                let newId;

                                // 根据类型设置不同的ID前缀
                                if (type === 'expand') {
                                    newId = 'expand_' + name.replace(/\s+/g, '_');
                                } else if (type === 'zhVision') {
                                    newId = 'vision_zh_' + name.replace(/\s+/g, '_');
                                } else if (type === 'enVision') {
                                    newId = 'vision_en_' + name.replace(/\s+/g, '_');
                                } else if (type === 'video') {
                                    newId = 'video_' + name.replace(/\s+/g, '_');
                                } else {
                                    newId = name;
                                }

                                editData.id = newId;
                                logger.debug(`更新规则ID | 类型:${type} | 旧ID:${oldId} | 新ID:${newId}`);
                            }
                        }
                    }
                } else {
                    // 添加模式：创建新数据
                    // 根据类型设置不同的ID前缀
                    let newId;
                    if (type === 'expand') {
                        newId = 'expand_' + name.replace(/\s+/g, '_');
                    } else if (type === 'zhVision') {
                        newId = 'vision_zh_' + name.replace(/\s+/g, '_');
                    } else if (type === 'enVision') {
                        newId = 'vision_en_' + name.replace(/\s+/g, '_');
                    } else if (type === 'video') {
                        newId = 'video_' + name.replace(/\s+/g, '_');
                    } else {
                        newId = name;
                    }

                    const newPrompt = {
                        id: newId,
                        name: name,
                        category: category,
                        showIn: showIn,
                        content: promptContent,
                        isActive: false, // 默认不激活
                        order: targetArray.length // 设置顺序为当前数组长度，确保添加到末尾
                    };
                    targetArray.push(newPrompt);

                    // 输出调试信息
                    logger.debug(`添加新规则 | 类型:${type} | ID:${newId} | 顺序:${newPrompt.order} | 数组长度:${targetArray.length}`);
                }

                // 标记为已修改
                this._setDirty();

                // 重新渲染对应的列表
                this._renderPromptLists();

                return true;
            }
        });
    }

    /**
     * 生成唯一ID
     * @returns {string} 唯一ID
     */
    _generateId() {
        return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 刷新所有规则列表
     * 注意：为了保持一致性，建议直接使用_renderPromptLists方法
     */
    _refreshPromptLists() {
        // 直接调用_renderPromptLists方法，确保一致性
        this._renderPromptLists();
    }

    /**
     * 切换规则激活状态
     * @param {string} type 类型
     * @param {string} promptId 规则ID
     */
    _togglePromptActive(type, promptId) {
        // 获取对应的数据数组
        let dataArray;
        let activeIdProperty;
        let configKey; // 用于保存到配置中的键名

        switch (type) {
            case 'expand':
                dataArray = this.expandPrompts;
                activeIdProperty = 'activeExpandPromptId';
                configKey = 'expand';
                break;
            case 'zhVision':
                dataArray = this.zhVisionPrompts;
                activeIdProperty = 'activeZhVisionPromptId';
                configKey = 'vision_zh';
                break;
            case 'enVision':
                dataArray = this.enVisionPrompts;
                activeIdProperty = 'activeEnVisionPromptId';
                configKey = 'vision_en';
                break;
            case 'video':
                dataArray = this.videoPrompts;
                activeIdProperty = 'activeVideoPromptId';
                configKey = 'video';
                break;
            default:
                return;
        }


        // 找到目标规则
        const targetPrompt = dataArray.find(p => p.id === promptId);
        if (!targetPrompt) return;

        // 记录之前的激活状态
        const oldActiveId = this[activeIdProperty];
        const wasActive = targetPrompt.isActive;

        // 如果当前规则已激活，则取消激活
        if (targetPrompt.isActive) {
            targetPrompt.isActive = false;
            this[activeIdProperty] = null;
            logger.debug(`取消激活规则 | 类型:${type} | ID:${promptId} | 配置键:${configKey}`);
        } else {
            // 取消其他规则的激活状态
            dataArray.forEach(p => p.isActive = false);
            // 激活当前规则
            targetPrompt.isActive = true;
            this[activeIdProperty] = promptId;
            logger.debug(`激活规则 | 类型:${type} | ID:${promptId} | 配置键:${configKey} | 旧ID:${oldActiveId}`);
        }

        // 标记为已修改
        this._setDirty();

        // 重新渲染列表
        this._renderPromptLists();

        // 输出激活状态变化
        logger.debug(`激活状态变化 | 类型:${type} | 规则:${targetPrompt.name} | ID:${promptId} | 旧状态:${wasActive} | 新状态:${targetPrompt.isActive} | 实例属性:${this[activeIdProperty]}`);

        // 如果系统规则对象存在，直接更新其中的active_prompts
        if (this.systemPrompts && this.systemPrompts.active_prompts) {
            const oldValue = this.systemPrompts.active_prompts[configKey];
            this.systemPrompts.active_prompts[configKey] = targetPrompt.isActive ? promptId : null;
            logger.debug(`更新系统规则对象 | 配置键:${configKey} | 旧值:${oldValue} | 新值:${this.systemPrompts.active_prompts[configKey]}`);
        }

        logger.debug(`${type} 规则状态切换: ${promptId} -> ${targetPrompt.isActive ? '激活' : '取消激活'}`);
    }

    /**
     * 删除规则
     * @param {string} type 类型
     * @param {string} promptId 规则ID
     */
    _deletePrompt(type, promptId) {
        // 获取对应的数据数组
        let dataArray;
        switch (type) {
            case 'expand':
                dataArray = this.expandPrompts;
                break;
            case 'zhVision':
                dataArray = this.zhVisionPrompts;
                break;
            case 'enVision':
                dataArray = this.enVisionPrompts;
                break;
            case 'video':
                dataArray = this.videoPrompts;
                break;
            default:
                return;
        }

        // 找到要删除的规则索引
        const index = dataArray.findIndex(p => p.id === promptId);
        if (index === -1) return;

        // 获取规则名称用于提示
        const promptName = dataArray[index].name;

        // 创建确认对话框（使用危险按钮样式）
        createSettingsDialog({
            title: '<i class="pi pi-exclamation-triangle" style="margin-right: 8px; color: var(--p-orange-500);"></i>确认删除',
            isConfirmDialog: true,
            dialogClassName: 'confirm-dialog',
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: '删除',
            saveButtonIcon: 'pi-trash',
            isDangerButton: true,
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.style.textAlign = 'center';
                content.style.padding = '1rem';

                const confirmMessage = document.createElement('p');
                confirmMessage.textContent = `确定要删除规则"${promptName}"吗？`;
                confirmMessage.style.margin = '0';
                confirmMessage.style.fontSize = '1rem';

                content.appendChild(confirmMessage);
            },
            onSave: () => {
                // 从数组中删除规则
                dataArray.splice(index, 1);

                // 标记为已修改
                this._setDirty();

                // 重新渲染列表
                this._renderPromptLists();

                return true;
            }
        });
    }


    /**
     * 将当前配置保存到服务器
     * @returns {Promise} 保存操作的Promise
     */
    async _saveConfigToServer() {
        try {
            // 获取原始版本号（从加载时保存的 systemPrompts 获取）
            const configVersion = this.systemPrompts?.__config_version || '2.0';

            // 构建系统规则配置（保留版本号）
            const systemPrompts = {
                __config_version: configVersion,
                expand_prompts: {},
                translate_prompts: {},
                vision_prompts: {},
                video_prompts: {},
                active_prompts: {
                    expand: null,
                    vision_zh: null,
                    vision_en: null,
                    video: null
                }
            };

            // 添加翻译规则（从 this.translatePrompts 动态构建）
            (this.translatePrompts || []).forEach(prompt => {
                systemPrompts.translate_prompts[prompt.id] = {
                    role: prompt.role || 'system',
                    content: prompt.content
                };
            });


            // 创建一个有序的规则列表
            const orderedExpandPrompts = [...this.expandPrompts].sort((a, b) => a.order - b.order);

            // 添加扩写规则，并记录激活的规则ID
            orderedExpandPrompts.forEach(prompt => {
                systemPrompts.expand_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // 记录激活的规则ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.expand = prompt.id;
                    logger.debug(`保存激活的提示词优化规则ID: ${prompt.id}`);
                }
            });

            // 如果没有找到激活的扩写规则，使用实例属性中保存的ID
            if (!systemPrompts.active_prompts.expand && this.activeExpandPromptId) {
                systemPrompts.active_prompts.expand = this.activeExpandPromptId;
                logger.debug(`使用实例属性中的提示词优化规则ID: ${this.activeExpandPromptId}`);
            }

            // 创建有序的中文和英文反推规则列表
            const orderedZhVisionPrompts = [...this.zhVisionPrompts].sort((a, b) => a.order - b.order);
            const orderedEnVisionPrompts = [...this.enVisionPrompts].sort((a, b) => a.order - b.order);

            // 添加中文反推规则
            orderedZhVisionPrompts.forEach(prompt => {
                systemPrompts.vision_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // 记录激活的规则ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.vision_zh = prompt.id;
                    logger.debug(`保存激活的中文反推规则ID: ${prompt.id}`);
                }
            });

            // 如果没有找到激活的中文反推规则，使用实例属性中保存的ID
            if (!systemPrompts.active_prompts.vision_zh && this.activeZhVisionPromptId) {
                systemPrompts.active_prompts.vision_zh = this.activeZhVisionPromptId;
                logger.debug(`使用实例属性中的中文反推规则ID: ${this.activeZhVisionPromptId}`);
            }

            // 添加英文反推规则
            orderedEnVisionPrompts.forEach(prompt => {
                systemPrompts.vision_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // 记录激活的规则ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.vision_en = prompt.id;
                    logger.debug(`保存激活的英文反推规则ID: ${prompt.id}`);
                }
            });

            // 如果没有找到激活的英文反推规则，使用实例属性中保存的ID
            if (!systemPrompts.active_prompts.vision_en && this.activeEnVisionPromptId) {
                systemPrompts.active_prompts.vision_en = this.activeEnVisionPromptId;
                logger.debug(`使用实例属性中的英文反推规则ID: ${this.activeEnVisionPromptId}`);
            }

            // 添加视频反推规则
            const orderedVideoPrompts = [...(this.videoPrompts || [])].sort((a, b) => a.order - b.order);
            orderedVideoPrompts.forEach(prompt => {
                systemPrompts.video_prompts[prompt.id] = {
                    name: prompt.name,
                    tags: prompt.tags || [],
                    category: prompt.category || '',
                    showIn: prompt.showIn || ['frontend', 'node'],
                    role: "system",
                    content: prompt.content
                };

                // 记录激活的规则ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.video = prompt.id;
                    logger.debug(`保存激活的视频反推规则ID: ${prompt.id}`);
                }
            });

            // 如果没有找到激活的视频反推规则，使用实例属性中保存的ID
            if (!systemPrompts.active_prompts.video && this.activeVideoPromptId) {
                systemPrompts.active_prompts.video = this.activeVideoPromptId;
                logger.debug(`使用实例属性中的视频反推规则ID: ${this.activeVideoPromptId}`);
            }

            // 输出最终的激活状态
            logger.debug(`最终激活的规则ID: expand=${systemPrompts.active_prompts.expand}, vision_zh=${systemPrompts.active_prompts.vision_zh}, vision_en=${systemPrompts.active_prompts.vision_en}, video=${systemPrompts.active_prompts.video}`);


            const response = await fetch(APIService.getApiUrl('/config/system_prompts'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(systemPrompts)
            });

            if (!response.ok) {
                throw new Error(`保存失败: ${response.status} ${response.statusText}`);
            }

            logger.debug('配置已成功保存到服务器');
            return true;
        } catch (error) {
            logger.error(`保存系统规则配置失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 为头部单元格添加列宽调整手柄
     * @param {HTMLElement} headerRow 头部行元素
     */
    _addHeaderResizers(headerRow) {
        const cells = headerRow.querySelectorAll('.prompt-list-cell');
        // 为前三列添加调整手柄（最后一列操作列不需要）
        for (let i = 0; i < cells.length - 1; i++) {
            const cell = cells[i];
            const resizer = document.createElement('div');
            resizer.className = 'column-resizer';
            cell.appendChild(resizer);
            this._addColumnResizer(resizer, cell);
        }
    }

    /**
     * 添加列宽调整功能
     * @param {HTMLElement} resizer 调整手柄元素
     * @param {HTMLElement} column 列元素
     */
    _addColumnResizer(resizer, column) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(document.defaultView.getComputedStyle(column).width, 10);

            // 添加拖拽状态样式
            resizer.classList.add('resizing');
            document.body.classList.add('column-resizing');

            // 添加事件监听器
            document.addEventListener('mousemove', handleMouseMove, { capture: true });
            document.addEventListener('mouseup', handleMouseUp, { capture: true });

            e.preventDefault();
            e.stopPropagation();
        });

        const handleMouseMove = (e) => {
            if (!isResizing) return;

            e.preventDefault();
            e.stopPropagation();

            const deltaX = e.clientX - startX;
            const newWidth = startWidth + deltaX;

            // 设置最小和最大宽度限制
            const minWidth = 80;
            const maxWidth = 500;

            if (newWidth >= minWidth && newWidth <= maxWidth) {
                // 获取列的类名以确定是哪一列
                const columnClass = Array.from(column.classList).find(cls =>
                    cls.includes('-cell') && cls !== 'prompt-list-cell'
                );

                if (columnClass) {
                    // 同时调整所有相同类型的列
                    const allColumns = document.querySelectorAll(`.${columnClass}`);
                    allColumns.forEach(col => {
                        col.style.width = newWidth + 'px';
                        col.style.flexShrink = '0';
                        col.style.flexGrow = '0';
                        col.style.flexBasis = newWidth + 'px';
                    });
                } else {
                    // 如果没有找到特定类名，只调整当前列
                    column.style.width = newWidth + 'px';
                    column.style.flexShrink = '0';
                    column.style.flexGrow = '0';
                    column.style.flexBasis = newWidth + 'px';
                }
            }
        };

        const handleMouseUp = (e) => {
            if (!isResizing) return;

            isResizing = false;

            // 获取列的类名以确定是哪一列
            const columnClass = Array.from(column.classList).find(cls =>
                cls.includes('-cell') && cls !== 'prompt-list-cell'
            );

            // 重置 flex 属性，允许下次调整
            if (columnClass) {
                const allColumns = document.querySelectorAll(`.${columnClass}`);
                allColumns.forEach(col => {
                    col.style.flexShrink = '';
                    col.style.flexGrow = '';
                    col.style.flexBasis = '';
                });
            } else {
                column.style.flexShrink = '';
                column.style.flexGrow = '';
                column.style.flexBasis = '';
            }

            // 移除拖拽状态样式
            resizer.classList.remove('resizing');
            document.body.classList.remove('column-resizing');

            // 移除事件监听器
            document.removeEventListener('mousemove', handleMouseMove, { capture: true });
            document.removeEventListener('mouseup', handleMouseUp, { capture: true });

            e.preventDefault();
            e.stopPropagation();
        };

        // 添加鼠标进入和离开事件以增强视觉反馈
        resizer.addEventListener('mouseenter', () => {
            if (!isResizing) {
                resizer.style.opacity = '0.6';
            }
        });

        resizer.addEventListener('mouseleave', () => {
            if (!isResizing) {
                resizer.style.opacity = '';
            }
        });
    }

    /**
     * 初始化拖拽排序功能
     * @param {HTMLElement} container 列表容器
     * @param {string} type 类型
     */
    _initSortable(container, type) {
        // 检查是否已加载Sortable库
        if (typeof Sortable === 'undefined') {
            this._loadSortableLibrary().then(() => {
                this._createSortableInstance(container, type);
            }).catch(error => {
                logger.error('加载Sortable库失败:', error);
            });
        } else {
            this._createSortableInstance(container, type);
        }
    }

    /**
     * 加载Sortable库
     * @returns {Promise}
     */
    _loadSortableLibrary() {
        return new Promise((resolve, reject) => {
            if (typeof Sortable !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = '/custom_nodes/comfyui_prompt_assistant/js/lib/Sortable.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Sortable library'));
            document.head.appendChild(script);
        });
    }

    /**
     * 创建Sortable实例
     * @param {HTMLElement} container 列表容器
     * @param {string} type 类型
     */
    _createSortableInstance(container, type) {
        new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            handle: '.prompt-list-row',
            // 移除 handle 限制，允许整行拖拽
            // handle: '.prompt-list-row',
            // 禁用固定项目，确保所有项目都可以拖拽
            filter: '',
            preventOnFilter: false,
            onStart: (evt) => {
                logger.debug(`开始拖拽: 类型=${type}, 索引=${evt.oldIndex}`);
            },
            onEnd: (evt) => {
                logger.debug(`结束拖拽: 类型=${type}, 旧索引=${evt.oldIndex}, 新索引=${evt.newIndex}`);
                this._handleSortEnd(evt, type);
            }
        });
    }

    /**
     * 处理拖拽排序结束事件
     * @param {Event} evt 排序事件
     * @param {string} type 类型
     */
    _handleSortEnd(evt, type) {
        const { oldIndex, newIndex } = evt;
        if (oldIndex === newIndex) return;

        // 获取对应的数据数组
        let dataArray;
        switch (type) {
            case 'expand':
                dataArray = this.expandPrompts;
                break;
            case 'zhVision':
                dataArray = this.zhVisionPrompts;
                break;
            case 'enVision':
                dataArray = this.enVisionPrompts;
                break;
            case 'video':
                dataArray = this.videoPrompts;
                break;
            default:
                return;
        }

        // 输出排序前的顺序信息
        logger.debug(`排序前数据: ${JSON.stringify(dataArray.map(item => ({ id: item.id, order: item.order })))}`);

        // 重新排序数据
        const movedItem = dataArray.splice(oldIndex, 1)[0];
        dataArray.splice(newIndex, 0, movedItem);

        // 更新所有项目的顺序属性
        dataArray.forEach((item, index) => {
            item.order = index;
        });

        // 输出排序后的顺序信息
        logger.debug(`排序后数据: ${JSON.stringify(dataArray.map(item => ({ id: item.id, order: item.order })))}`);
        logger.debug(`${type} 列表排序已更新: ${oldIndex} -> ${newIndex} | 移动项ID: ${movedItem.id}`);

        // 标记为已修改
        this._setDirty();
    }
}

// 导出规则配置管理器实例
export const rulesConfigManager = new RulesConfigManager();