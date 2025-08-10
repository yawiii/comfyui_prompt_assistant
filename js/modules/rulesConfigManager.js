/**
 * 规则配置管理器
 * 负责管理提示词规则配置弹窗和相关功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import {
    createSettingsDialog,
    createFormGroup,
    createInputGroup,
    createSelectGroup
} from "./settings.js";



class RulesConfigManager {
    constructor() {
        this.systemPrompts = null;
        // ---存储提示词列表数据---
        this.expandPrompts = [];
        this.zhVisionPrompts = [];
        this.enVisionPrompts = [];
        // ---当前激活的提示词ID---
        this.activeExpandPromptId = null;
        this.activeZhVisionPromptId = null;
        this.activeEnVisionPromptId = null;

        this.isDirty = false;
        this.initialState = null; // 用于存储状态备份
    }

    /**
     * 备份当前状态
     */
    _backupState() {
        this.initialState = {
            expandPrompts: JSON.parse(JSON.stringify(this.expandPrompts)),
            zhVisionPrompts: JSON.parse(JSON.stringify(this.zhVisionPrompts)),
            enVisionPrompts: JSON.parse(JSON.stringify(this.enVisionPrompts)),
            activeExpandPromptId: this.activeExpandPromptId,
            activeZhVisionPromptId: this.activeZhVisionPromptId,
            activeEnVisionPromptId: this.activeEnVisionPromptId,
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
            this.zhVisionPrompts = JSON.parse(JSON.stringify(this.initialState.zhVisionPrompts));
            this.enVisionPrompts = JSON.parse(JSON.stringify(this.initialState.enVisionPrompts));
            this.activeExpandPromptId = this.initialState.activeExpandPromptId;
            this.activeZhVisionPromptId = this.initialState.activeZhVisionPromptId;
            this.activeEnVisionPromptId = this.initialState.activeEnVisionPromptId;
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
                title: '规则管理器',
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

        // 1. 扩写规则配置
        const expandSection = this._createExpandSection();

        // 2. 反推规则配置
        const visionSection = this._createVisionSection();

        form.appendChild(expandSection);
        form.appendChild(visionSection);
        container.appendChild(form);

        // 加载系统提示词配置
        this._loadSystemPrompts();
    }

    /**
     * 创建扩写规则配置部分
     * @returns {HTMLElement} 扩写规则配置部分的DOM元素
     */
    _createExpandSection() {
        // 扩写规则配置
        const expandSection = createFormGroup('扩写规则配置');
        const expandHeader = expandSection.querySelector('.settings-form-section-header');

        // 创建添加按钮
        const addButton = document.createElement('div');
        addButton.className = 'settings-refresh-button';
        addButton.title = '添加新提示词';

        const addIcon = document.createElement('span');
        addIcon.className = 'pi pi-plus refresh-icon';
        addButton.appendChild(addIcon);

        const addText = document.createElement('span');
        addText.textContent = '添加提示词';
        addButton.appendChild(addText);
        expandHeader.appendChild(addButton);

        // 创建提示词列表容器
        const listContainer = document.createElement('div');
        listContainer.className = 'prompt-list-container';

        // 创建列表头部
        const listHeader = document.createElement('div');
        listHeader.className = 'prompt-list-header';
        listHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">状态</div>
            <div class="prompt-list-cell name-cell">提示词名称</div>
            <div class="prompt-list-cell content-cell">提示词内容</div>
            <div class="prompt-list-cell action-cell">操作</div>
        `;

        // 为头部单元格添加列宽调整手柄
        this._addHeaderResizers(listHeader);

        // 创建滚动列表
        const scrollList = document.createElement('div');
        scrollList.className = 'prompt-scroll-list';

        listContainer.appendChild(listHeader);
        listContainer.appendChild(scrollList);
        expandSection.appendChild(listContainer);

        // 存储列表引用
        this.expandScrollList = scrollList;

        // 添加调试信息
        logger.debug('扩写提示词列表容器已创建');

        // 处理添加按钮点击
        addButton.onclick = () => {
            this._showPromptEditDialog('expand', null);
        };

        return expandSection;
    }

    /**
     * 创建反推规则配置部分
     * @returns {HTMLElement} 反推规则配置部分的DOM元素
     */
    _createVisionSection() {
        // 反推规则配置
        const visionSection = createFormGroup('反推规则配置');
        const visionHeader = visionSection.querySelector('.settings-form-section-header');

        // 创建添加按钮并添加到标题栏
        const addButton = document.createElement('div');
        addButton.className = 'settings-refresh-button';
        addButton.title = '添加提示词';

        const addIcon = document.createElement('span');
        addIcon.className = 'pi pi-plus refresh-icon';
        addButton.appendChild(addIcon);

        const addText = document.createElement('span');
        addText.textContent = '添加提示词';
        addButton.appendChild(addText);
        visionHeader.appendChild(addButton);

        // Tab容器
        const tabContainer = document.createElement('div');
        tabContainer.className = 'popup_tabs_container';
        const tabsScroll = document.createElement('div');
        tabsScroll.className = 'popup_tabs_scroll';
        const tabs = document.createElement('div');
        tabs.className = 'popup_tabs';
        const tabZH = document.createElement('div');
        tabZH.className = 'popup_tab active';
        tabZH.textContent = '中文反推规则';
        const tabEN = document.createElement('div');
        tabEN.className = 'popup_tab';
        tabEN.textContent = '英文反推规则';
        tabs.appendChild(tabZH);
        tabs.appendChild(tabEN);
        tabsScroll.appendChild(tabs);
        tabContainer.appendChild(tabsScroll);

        // 中文反推规则内容
        const tabContentZH = document.createElement('div');
        tabContentZH.className = 'popup_tab_content active';

        // 中文列表容器
        const zhListContainer = document.createElement('div');
        zhListContainer.className = 'prompt-list-container vision-prompt-list-container';

        const zhListHeader = document.createElement('div');
        zhListHeader.className = 'prompt-list-header';
        zhListHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">状态</div>
            <div class="prompt-list-cell name-cell">提示词名称</div>
            <div class="prompt-list-cell content-cell">提示词内容</div>
            <div class="prompt-list-cell action-cell">操作</div>
        `;

        // 为头部单元格添加列宽调整手柄
        this._addHeaderResizers(zhListHeader);

        const zhScrollList = document.createElement('div');
        zhScrollList.className = 'prompt-scroll-list';

        zhListContainer.appendChild(zhListHeader);
        zhListContainer.appendChild(zhScrollList);

        tabContentZH.appendChild(zhListContainer);

        // 存储中文列表引用
        this.zhVisionScrollList = zhScrollList;

        // 添加调试信息
        logger.debug('中文反推提示词列表容器已创建');

        // 英文反推规则内容
        const tabContentEN = document.createElement('div');
        tabContentEN.className = 'popup_tab_content';

        // 英文列表容器
        const enListContainer = document.createElement('div');
        enListContainer.className = 'prompt-list-container vision-prompt-list-container';

        const enListHeader = document.createElement('div');
        enListHeader.className = 'prompt-list-header';
        enListHeader.innerHTML = `
            <div class="prompt-list-cell status-cell">状态</div>
            <div class="prompt-list-cell name-cell">提示词名称</div>
            <div class="prompt-list-cell content-cell">提示词内容</div>
            <div class="prompt-list-cell action-cell">操作</div>
        `;

        // 为头部单元格添加列宽调整手柄
        this._addHeaderResizers(enListHeader);

        const enScrollList = document.createElement('div');
        enScrollList.className = 'prompt-scroll-list';

        enListContainer.appendChild(enListHeader);
        enListContainer.appendChild(enScrollList);

        tabContentEN.appendChild(enListContainer);

        // 存储英文列表引用
        this.enVisionScrollList = enScrollList;

        // 添加调试信息
        logger.debug('英文反推提示词列表容器已创建');

        // 设置Tab切换逻辑
        tabZH.onclick = () => {
            tabZH.classList.add('active');
            tabEN.classList.remove('active');
            tabContentZH.classList.add('active');
            tabContentEN.classList.remove('active');
        };

        tabEN.onclick = () => {
            tabEN.classList.add('active');
            tabZH.classList.remove('active');
            tabContentEN.classList.add('active');
            tabContentZH.classList.remove('active');
        };

        visionSection.appendChild(tabContainer);
        visionSection.appendChild(tabContentZH);
        visionSection.appendChild(tabContentEN);

        // 处理添加按钮点击 - 根据当前激活的tab决定类型
        addButton.onclick = () => {
            const activeTab = tabs.querySelector('.popup_tab.active');
            const isZhActive = activeTab && activeTab.textContent === '中文反推规则';
            this._showPromptEditDialog(isZhActive ? 'zhVision' : 'enVision', null);
        };

        return visionSection;
    }

    /**
     * 加载系统提示词配置
     */
    async _loadSystemPrompts() {
        try {
            const response = await fetch('/prompt_assistant/api/config/system_prompts');
            if (!response.ok) {
                throw new Error(`加载系统提示词配置失败: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            this.systemPrompts = data;

            // 获取激活的提示词ID
            const activePrompts = data.active_prompts || {};
            const activeExpandId = activePrompts.expand;
            const activeZhVisionId = activePrompts.vision_zh;
            const activeEnVisionId = activePrompts.vision_en;

            // 输出加载的激活ID
            logger.debug(`加载的激活提示词ID | expand:${activeExpandId || '无'} | vision_zh:${activeZhVisionId || '无'} | vision_en:${activeEnVisionId || '无'}`);

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
                        content: prompt.content,
                        isActive: key === activeExpandId, // 根据active_prompts判断是否激活
                        order: this.originalExpandOrder.indexOf(key) // 保存原始顺序
                    });
                });

                // 如果没有找到激活的提示词，则激活第一个
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

                // 分别存储中文和英文提示词的键
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

                // 处理中文提示词
                zhKeys.forEach((key, index) => {
                    const prompt = data.vision_prompts[key];
                    this.zhVisionPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        content: prompt.content,
                        isActive: key === activeZhVisionId,
                        order: this.originalVisionOrder.indexOf(key) // 保存原始顺序
                    });
                });

                // 处理英文提示词
                enKeys.forEach((key, index) => {
                    const prompt = data.vision_prompts[key];
                    this.enVisionPrompts.push({
                        id: key,
                        name: prompt.name || key,
                        content: prompt.content,
                        isActive: key === activeEnVisionId,
                        order: this.originalVisionOrder.indexOf(key) // 保存原始顺序
                    });
                });

                // 按原始顺序排序
                this.zhVisionPrompts.sort((a, b) => a.order - b.order);
                this.enVisionPrompts.sort((a, b) => a.order - b.order);

                // 如果没有找到激活的中文提示词，则激活第一个
                if (!activeZhVisionId && this.zhVisionPrompts.length > 0) {
                    this.zhVisionPrompts[0].isActive = true;
                    this.activeZhVisionPromptId = this.zhVisionPrompts[0].id;
                } else {
                    this.activeZhVisionPromptId = activeZhVisionId;
                }

                // 如果没有找到激活的英文提示词，则激活第一个
                if (!activeEnVisionId && this.enVisionPrompts.length > 0) {
                    this.enVisionPrompts[0].isActive = true;
                    this.activeEnVisionPromptId = this.enVisionPrompts[0].id;
                } else {
                    this.activeEnVisionPromptId = activeEnVisionId;
                }
            }

            // 备份初始状态
            this._backupState();

            // 渲染列表
            this._renderPromptLists();
        } catch (error) {
            logger.error("加载系统提示词配置失败:", error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "加载失败",
                detail: error.message || "加载系统提示词配置过程中发生错误",
                life: 3000
            });
        }
    }

    /**
     * 渲染提示词列表
     */
    _renderPromptLists() {
        logger.debug(`开始渲染提示词列表 | 扩写提示词:${this.expandPrompts.length}个 | 中文反推:${this.zhVisionPrompts.length}个 | 英文反推:${this.enVisionPrompts.length}个`);

        // 渲染扩写规则列表
        if (this.expandScrollList) {
            this._renderPromptList(this.expandScrollList, this.expandPrompts, 'expand');
            logger.debug(`渲染扩写提示词列表完成`);
        } else {
            logger.error(`扩写提示词列表容器不存在`);
        }

        // 渲染中文反推规则列表
        if (this.zhVisionScrollList) {
            this._renderPromptList(this.zhVisionScrollList, this.zhVisionPrompts, 'zhVision');
            logger.debug(`渲染中文反推提示词列表完成`);
        } else {
            logger.error(`中文反推提示词列表容器不存在`);
        }

        // 渲染英文反推规则列表
        if (this.enVisionScrollList) {
            this._renderPromptList(this.enVisionScrollList, this.enVisionPrompts, 'enVision');
            logger.debug(`渲染英文反推提示词列表完成`);
        } else {
            logger.error(`英文反推提示词列表容器不存在`);
        }
    }

    /**
     * 渲染单个提示词列表
     * @param {HTMLElement} container 列表容器
     * @param {Array} prompts 提示词数组
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
     * 显示提示词编辑对话框
     * @param {string} type 类型
     * @param {string|null} promptId 提示词ID，null表示新建
     */
    _showPromptEditDialog(type, promptId) {
        this._showPromptConfigDialog(type, promptId);
    }

    /**
     * 创建多行文本输入框组
     * @param {string} label 标签文本
     * @param {string} placeholder 占位符文本
     * @returns {Object} 包含 group 和 textarea 的对象
     */
    _createTextareaGroup(label, placeholder) {
        const group = document.createElement('div');
        group.className = 'settings-form-group';

        const labelElem = document.createElement('label');
        labelElem.className = 'settings-form-label';
        labelElem.textContent = label;

        const textarea = document.createElement('textarea');
        textarea.className = 'p-inputtext p-component settings-form-textarea';
        textarea.placeholder = placeholder;
        textarea.rows = 8;
        textarea.style.resize = 'vertical';
        textarea.style.minHeight = '150px';
        textarea.style.height = 'calc(100% - 30px)';

        group.appendChild(labelElem);
        group.appendChild(textarea);

        return { group, textarea };
    }

    /**
     * 显示通用的提示词配置弹窗
     * @param {string} defaultType 默认类型
     * @param {string|null} promptId 提示词ID，null表示新建
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
            }
        }

        createSettingsDialog({
            title: isEdit ? '编辑提示词' : '添加提示词',
            isConfirmDialog: true,
            dialogClassName: 'prompt-edit-dialog',
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: isEdit ? '保存' : '添加',
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.className += ' dialog-form-content';
                content.style.padding = '1rem';
                content.style.display = 'flex';
                content.style.flexDirection = 'column';
                content.style.flex = '1';

                // 创建提示词名称输入框
                const nameInput = createInputGroup('提示词名称', '请输入提示词名称');
                nameInput.group.style.marginBottom = '10px';
                if (isEdit && editData) {
                    nameInput.input.value = editData.name || '';
                }

                // 创建提示词类型下拉框
                const typeOptions = [
                    { value: 'expand', text: '扩写' },
                    { value: 'zhVision', text: '反推（中文）' },
                    { value: 'enVision', text: '反推（英文）' }
                ];
                const typeSelect = createSelectGroup('提示词类型', typeOptions, defaultType);
                typeSelect.group.style.marginBottom = '10px';

                // 创建提示词内容多行输入框
                const contentTextarea = this._createTextareaGroup('提示词内容', '请输入提示词内容');
                contentTextarea.group.style.marginBottom = '0';
                contentTextarea.group.style.flex = '1';
                contentTextarea.group.style.display = 'flex';
                contentTextarea.group.style.flexDirection = 'column';
                if (isEdit && editData) {
                    contentTextarea.textarea.value = editData.content || '';
                }

                content.appendChild(nameInput.group);
                content.appendChild(typeSelect.group);
                content.appendChild(contentTextarea.group);

                content.nameInput = nameInput.input;
                content.typeSelect = typeSelect.select;
                content.contentTextarea = contentTextarea.textarea;

                // 聚焦名称输入框
                setTimeout(() => {
                    nameInput.input.focus();
                }, 100);
            },
            onSave: (content) => {
                const name = content.nameInput.value.trim();
                const type = content.typeSelect.value;
                const promptContent = content.contentTextarea.value.trim();

                if (!name || !promptContent) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? "编辑失败" : "添加失败",
                        detail: "提示词名称和内容不能为空",
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
                } else {
                    logger.error(`未知的提示词类型: ${type}`);
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
                        detail: `提示词名称"${name}"已存在`,
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
                            // 为不同类型的提示词设置不同的ID前缀
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
                                content: promptContent,
                                isActive: false,
                                order: targetArray.length // 设置顺序为当前数组长度
                            };
                            targetArray.push(newPrompt);
                            logger.debug(`跨类型编辑提示词 | 原类型:${defaultType} | 新类型:${type} | 新ID:${newId}`);
                        } else {
                            // 同类型编辑，直接更新
                            const oldName = editData.name;
                            editData.name = name;
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
                                } else {
                                    newId = name;
                                }

                                editData.id = newId;
                                logger.debug(`更新提示词ID | 类型:${type} | 旧ID:${oldId} | 新ID:${newId}`);
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
                    } else {
                        newId = name;
                    }

                    const newPrompt = {
                        id: newId,
                        name: name,
                        content: promptContent,
                        isActive: false, // 默认不激活
                        order: targetArray.length // 设置顺序为当前数组长度，确保添加到末尾
                    };
                    targetArray.push(newPrompt);

                    // 输出调试信息
                    logger.debug(`添加新提示词 | 类型:${type} | ID:${newId} | 顺序:${newPrompt.order} | 数组长度:${targetArray.length}`);
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
     * 刷新所有提示词列表
     * 注意：为了保持一致性，建议直接使用_renderPromptLists方法
     */
    _refreshPromptLists() {
        // 直接调用_renderPromptLists方法，确保一致性
        this._renderPromptLists();
    }

    /**
     * 切换提示词激活状态
     * @param {string} type 类型
     * @param {string} promptId 提示词ID
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
            default:
                return;
        }

        // 找到目标提示词
        const targetPrompt = dataArray.find(p => p.id === promptId);
        if (!targetPrompt) return;

        // 记录之前的激活状态
        const oldActiveId = this[activeIdProperty];
        const wasActive = targetPrompt.isActive;

        // 如果当前提示词已激活，则取消激活
        if (targetPrompt.isActive) {
            targetPrompt.isActive = false;
            this[activeIdProperty] = null;
            logger.debug(`取消激活提示词 | 类型:${type} | ID:${promptId} | 配置键:${configKey}`);
        } else {
            // 取消其他提示词的激活状态
            dataArray.forEach(p => p.isActive = false);
            // 激活当前提示词
            targetPrompt.isActive = true;
            this[activeIdProperty] = promptId;
            logger.debug(`激活提示词 | 类型:${type} | ID:${promptId} | 配置键:${configKey} | 旧ID:${oldActiveId}`);
        }

        // 标记为已修改
        this._setDirty();

        // 重新渲染列表
        this._renderPromptLists();

        // 输出激活状态变化
        logger.debug(`激活状态变化 | 类型:${type} | 提示词:${targetPrompt.name} | ID:${promptId} | 旧状态:${wasActive} | 新状态:${targetPrompt.isActive} | 实例属性:${this[activeIdProperty]}`);

        // 如果系统提示词对象存在，直接更新其中的active_prompts
        if (this.systemPrompts && this.systemPrompts.active_prompts) {
            const oldValue = this.systemPrompts.active_prompts[configKey];
            this.systemPrompts.active_prompts[configKey] = targetPrompt.isActive ? promptId : null;
            logger.debug(`更新系统提示词对象 | 配置键:${configKey} | 旧值:${oldValue} | 新值:${this.systemPrompts.active_prompts[configKey]}`);
        }

        logger.debug(`${type} 提示词状态切换: ${promptId} -> ${targetPrompt.isActive ? '激活' : '取消激活'}`);
    }

    /**
     * 删除提示词
     * @param {string} type 类型
     * @param {string} promptId 提示词ID
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
            default:
                return;
        }

        // 找到要删除的提示词索引
        const index = dataArray.findIndex(p => p.id === promptId);
        if (index === -1) return;

        // 获取提示词名称用于提示
        const promptName = dataArray[index].name;

        // 创建确认对话框
        createSettingsDialog({
            title: '确认删除',
            isConfirmDialog: true,
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: '确认',
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.style.textAlign = 'center';
                content.style.padding = '1rem';

                const confirmMessage = document.createElement('p');
                confirmMessage.textContent = `确定要删除提示词"${promptName}"吗？`;
                confirmMessage.style.margin = '0';
                confirmMessage.style.fontSize = '1rem';

                content.appendChild(confirmMessage);
            },
            onSave: () => {
                // 从数组中删除提示词
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
            // 构建系统提示词配置
            const systemPrompts = {
                expand_prompts: {},
                translate_prompts: {
                    ZH: {
                        role: "system",
                        content: "你是一名AI绘画领域的提示词翻译专家，负责将用户提供的文本内容由{src_lang}准确地翻译成{dst_lang}。要求：1.完整翻译用户提供的所有文本，不要遗漏；2.保持格式，不要改变原文的书写结构、标点符号、权重标记格式【如(文本内容:1.2)】等；2.准确原文，使用准确、地道的{dst_lang}表达词汇和AI绘画领域的专业的术语；5.直接输出翻译结果，无需注释、说明。"
                    }
                },
                vision_prompts: {},
                active_prompts: {
                    expand: null,
                    vision_zh: null,
                    vision_en: null
                }
            };

            // 创建一个有序的提示词列表
            const orderedExpandPrompts = [...this.expandPrompts].sort((a, b) => a.order - b.order);

            // 添加扩写提示词，并记录激活的提示词ID
            orderedExpandPrompts.forEach(prompt => {
                // 使用提示词ID作为键，而不是名称
                systemPrompts.expand_prompts[prompt.id] = {
                    name: prompt.name,
                    role: "system",
                    content: prompt.content
                };

                // 记录激活的提示词ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.expand = prompt.id;
                    logger.debug(`保存激活的扩写提示词ID: ${prompt.id}`);
                }
            });

            // 如果没有找到激活的扩写提示词，使用实例属性中保存的ID
            if (!systemPrompts.active_prompts.expand && this.activeExpandPromptId) {
                systemPrompts.active_prompts.expand = this.activeExpandPromptId;
                logger.debug(`使用实例属性中的扩写提示词ID: ${this.activeExpandPromptId}`);
            }

            // 创建有序的中文和英文反推提示词列表
            const orderedZhVisionPrompts = [...this.zhVisionPrompts].sort((a, b) => a.order - b.order);
            const orderedEnVisionPrompts = [...this.enVisionPrompts].sort((a, b) => a.order - b.order);

            // 添加中文反推提示词
            orderedZhVisionPrompts.forEach(prompt => {
                systemPrompts.vision_prompts[prompt.id] = {
                    name: prompt.name,
                    role: "system",
                    content: prompt.content
                };

                // 记录激活的提示词ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.vision_zh = prompt.id;
                    logger.debug(`保存激活的中文反推提示词ID: ${prompt.id}`);
                }
            });

            // 如果没有找到激活的中文反推提示词，使用实例属性中保存的ID
            if (!systemPrompts.active_prompts.vision_zh && this.activeZhVisionPromptId) {
                systemPrompts.active_prompts.vision_zh = this.activeZhVisionPromptId;
                logger.debug(`使用实例属性中的中文反推提示词ID: ${this.activeZhVisionPromptId}`);
            }

            // 添加英文反推提示词
            orderedEnVisionPrompts.forEach(prompt => {
                systemPrompts.vision_prompts[prompt.id] = {
                    name: prompt.name,
                    role: "system",
                    content: prompt.content
                };

                // 记录激活的提示词ID
                if (prompt.isActive) {
                    systemPrompts.active_prompts.vision_en = prompt.id;
                    logger.debug(`保存激活的英文反推提示词ID: ${prompt.id}`);
                }
            });

            // 如果没有找到激活的英文反推提示词，使用实例属性中保存的ID
            if (!systemPrompts.active_prompts.vision_en && this.activeEnVisionPromptId) {
                systemPrompts.active_prompts.vision_en = this.activeEnVisionPromptId;
                logger.debug(`使用实例属性中的英文反推提示词ID: ${this.activeEnVisionPromptId}`);
            }

            // 输出最终的激活状态
            logger.debug(`最终激活的提示词ID: expand=${systemPrompts.active_prompts.expand}, vision_zh=${systemPrompts.active_prompts.vision_zh}, vision_en=${systemPrompts.active_prompts.vision_en}`);

            const response = await fetch('/prompt_assistant/api/config/system_prompts', {
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
            logger.error(`保存系统提示词配置失败: ${error.message}`);
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