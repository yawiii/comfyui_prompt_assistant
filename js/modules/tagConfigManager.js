/**
 * 标签配置管理器
 * 负责管理标签配置弹窗和标签数据的增删改查
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { ResourceManager } from "../utils/resourceManager.js";
import {
    createSettingsDialog,
    closeModalWithAnimation,
    createFormGroup,
    createInputGroup,
    createSelectGroup,
    createHorizontalFormGroup
} from "./settings.js";

class TagConfigManager {
    constructor() {
        this.tagsData = {};
        this.tooltipElements = [];
        this.categorySortable = null;
        this.tagSortables = new Map();
        this.Sortable = null;
        this.isDirty = false; // 跟踪未保存的更改
        this.initialTagsData = null; // 打开时备份初始数据
    }

    /**
     * 初始化 Sortable.js
     * @private
     */
    async _initSortableLib() {
        if (this.Sortable) {
            return;
        }
        try {
            this.Sortable = await ResourceManager.getSortable();
        } catch (error) {
            logger.error('Sortable.js 加载失败，拖拽功能将不可用。', error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "组件加载失败",
                detail: "拖拽功能可能无法正常工作",
                life: 3000
            });
        }
    }

    /**
     * 显示标签配置弹窗
     */
    async showTagsConfigModal() {
        try {
            await this._initSortableLib();
            logger.debug('打开标签配置弹窗');
            this._createTagsConfigDialog();
        } catch (error) {
            logger.error(`打开标签配置弹窗失败: ${error.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "打开配置失败",
                detail: error.message || "打开配置弹窗过程中发生错误",
                life: 3000
            });
        }
    }

    /**
     * 初始化标签tooltip功能
     * 为有data-tooltip-content属性的元素添加tooltip
     */
    _initTooltips() {
        // 清理之前的tooltip事件监听
        this._cleanupTooltips();

        // 查找所有带有tooltip内容属性的元素
        const tooltipElements = document.querySelectorAll('.has-tooltip');

        tooltipElements.forEach(element => {
            // 保存引用以便清理
            this.tooltipElements.push(element);

            let tooltipTimeout = null;
            let activeTooltip = null;

            // 鼠标进入时创建tooltip
            element.addEventListener('mouseenter', e => {
                tooltipTimeout = setTimeout(() => {
                    const content = element.getAttribute('data-tooltip-content');
                    if (!content) return;

                    // 创建tooltip元素
                    const tooltip = document.createElement('div');
                    tooltip.className = 'tag_tooltip';
                    tooltip.innerHTML = content;
                    document.body.appendChild(tooltip);

                    // 计算位置
                    const rect = element.getBoundingClientRect();
                    tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
                    tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8}px`;

                    // 保存当前tooltip引用
                    activeTooltip = tooltip;
                }, 300);
            });

            // 鼠标离开时移除tooltip
            element.addEventListener('mouseleave', () => {
                clearTimeout(tooltipTimeout);
                if (activeTooltip) {
                    activeTooltip.remove();
                    activeTooltip = null;
                }
            });
        });
    }

    /**
     * 清理tooltip事件监听
     */
    _cleanupTooltips() {
        // 移除所有tooltip元素
        const tooltips = document.querySelectorAll('.tag_tooltip');
        tooltips.forEach(tooltip => tooltip.remove());

        // 清空保存的元素引用
        this.tooltipElements = [];
    }

    /**
     * 加载用户标签数据
     * @returns {Promise<Object>} 用户标签数据
     */
    async _loadTagsData() {
        try {
            const response = await fetch('/prompt_assistant/api/config/tags_user');
            if (!response.ok) {
                throw new Error(`加载用户标签配置失败: ${response.status} ${response.statusText}`);
            }
            this.tagsData = await response.json();
            // 确保至少有一个默认分类
            if (Object.keys(this.tagsData).length === 0) {
                this.tagsData = {
                    "默认分类": {}
                };
            }
            // 备份初始数据并重置脏状态
            this.initialTagsData = JSON.parse(JSON.stringify(this.tagsData));
            this.isDirty = false;
            return this.tagsData;
        } catch (error) {
            logger.error("加载用户标签配置失败:", error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "加载失败",
                detail: error.message || "加载用户标签配置过程中发生错误",
                life: 3000
            });
            // 返回默认分类
            this.tagsData = {
                "默认分类": {}
            };
            // 备份初始数据并重置脏状态
            this.initialTagsData = JSON.parse(JSON.stringify(this.tagsData));
            this.isDirty = false;
            return this.tagsData;
        }
    }

    /**
     * 保存用户标签数据
     * @param {Object} data 要保存的标签数据
     * @returns {Promise<boolean>} 是否保存成功
     */
    async _saveTagsData(data) {
        try {
            const response = await fetch('/prompt_assistant/api/config/tags_user', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                throw new Error(`保存用户标签配置失败: ${response.status} ${response.statusText}`);
            }
            return true;
        } catch (error) {
            logger.error("保存用户标签配置失败:", error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "保存失败",
                detail: error.message || "保存用户标签配置过程中发生错误",
                life: 3000
            });
            return false;
        }
    }

    /**
     * 初始化拖拽排序
     * @param {HTMLElement} container 容器元素
     * @param {HTMLElement} tagContainer 标签容器
     * @param {string} categoryName 分类名称
     * @private
     */
    _initSortable(container, tagContainer, categoryName) {
        if (!this.Sortable) {
            return;
        }

        const tagSortable = new this.Sortable(tagContainer, {
            group: 'tags',
            animation: 250, // 增加动画时长，使过渡更平滑
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)', // 调整缓动函数，避免缩放效果
            ghostClass: 'tag-ghost',
            chosenClass: 'tag-chosen',
            dragClass: 'tag-drag',
            // 添加拖拽时的延迟，防止意外触发
            delay: 50,
            delayOnTouchOnly: true,
            // 添加动画捕获状态，确保动画正确执行
            onChoose: function (evt) {
                // 不再修改transition，避免影响缩放
            },
            onUnchoose: function (evt) {
                // 不再修改transition，避免影响缩放
            },
            // 添加动画相关事件处理
            onStart: function (evt) {
                // 拖动开始时添加效果
                evt.item.classList.add('tag-dragging');
            },
            onEnd: (evt) => {
                // 拖动结束时移除效果
                evt.item.classList.remove('tag-dragging');

                const { from, to } = evt;
                const fromCategory = from.closest('.tag_accordion').getAttribute('data-category');
                const toCategory = to.closest('.tag_accordion').getAttribute('data-category');
                const tagName = evt.item.getAttribute('data-name');

                // 从旧分类中移除（内存中）
                const tagData = this.tagsData[fromCategory][tagName];
                delete this.tagsData[fromCategory][tagName];

                // 添加到新分类（内存中），并根据DOM顺序重构
                const newTags = {};
                Array.from(to.children).forEach(tag => {
                    const name = tag.getAttribute('data-name');
                    const value = tag.getAttribute('data-value');
                    newTags[name] = this.tagsData[toCategory]?.[name] || tagData;
                });

                this.tagsData[toCategory] = newTags;
                this.isDirty = true;
            }
        });

        this.tagSortables.set(categoryName, tagSortable);
    }

    /**
     * 初始化分类排序
     * @param {HTMLElement} container 容器元素
     * @private
     */
    _initCategorySortable(container) {
        if (!this.Sortable) {
            return;
        }

        if (this.categorySortable) {
            this.categorySortable.destroy();
        }

        this.categorySortable = new this.Sortable(container, {
            animation: 250, // 增加动画时长，使过渡更平滑
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)', // 调整缓动函数，避免缩放效果
            handle: '.tag_accordion_header',
            ghostClass: 'category-ghost',
            chosenClass: 'category-chosen',
            dragClass: 'category-drag',
            // 添加拖拽时的延迟，防止意外触发
            delay: 50,
            delayOnTouchOnly: true,
            // 添加动画捕获状态，确保动画正确执行
            onChoose: function (evt) {
                // 不再修改transition，避免影响缩放
            },
            onUnchoose: function (evt) {
                // 不再修改transition，避免影响缩放
            },
            // 添加动画相关事件处理
            onStart: function (evt) {
                // 拖动开始时添加效果
                evt.item.classList.add('category-dragging');
            },
            onEnd: (evt) => {
                // 拖动结束时移除效果
                evt.item.classList.remove('category-dragging');

                // 根据DOM顺序重构数据
                const newData = {};
                Array.from(container.children).forEach(accordion => {
                    const categoryName = accordion.getAttribute('data-category');
                    newData[categoryName] = { ...this.tagsData[categoryName] };
                });

                this.tagsData = newData;
                this.isDirty = true;
            }
        });
    }

    /**
     * 创建标签手风琴
     * @param {Object} tagsData 标签数据
     * @param {HTMLElement} container 容器元素
     */
    _createTagAccordion(tagsData, container) {
        // 清空容器
        container.innerHTML = '';

        // 遍历所有分类，使用Object.entries保持原始顺序
        Object.entries(tagsData).forEach(([categoryName, categoryTags]) => {
            // 创建分类手风琴
            const accordion = document.createElement('div');
            accordion.className = 'tag_accordion';
            accordion.setAttribute('data-category', categoryName);

            // 创建头部
            const header = document.createElement('div');
            header.className = 'tag_accordion_header active'; // 默认设置为active状态

            // 创建标题
            const title = document.createElement('div');
            title.className = 'tag_accordion_title';
            title.textContent = categoryName;

            // 创建图标容器
            const iconContainer = document.createElement('div');
            iconContainer.className = 'tag_accordion_icon';

            // 添加编辑按钮 - 为所有分类添加
            const editButton = document.createElement('button');
            editButton.className = 'tag_edit_button small'; // 使用新的编辑按钮样式
            editButton.title = '编辑分类';

            const editIcon = document.createElement('span');
            editIcon.className = 'pi pi-pencil tag_edit_icon small'; // 使用新的编辑图标样式
            editButton.appendChild(editIcon);

            editButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showCategoryDialog(container, categoryName);
            });
            iconContainer.appendChild(editButton);

            // 添加删除按钮
            const deleteButton = document.createElement('button');
            deleteButton.className = 'tag_delete_button small'; // 添加small类名
            deleteButton.title = '删除分类';

            // 添加删除图标
            const deleteIcon = document.createElement('span');
            deleteIcon.className = 'pi pi-times tag_action_icon small';
            deleteButton.appendChild(deleteIcon);

            // 添加删除事件
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();

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
                        confirmMessage.textContent = `确定要删除分类"${categoryName}"吗？`;
                        confirmMessage.style.margin = '0';
                        confirmMessage.style.fontSize = '1rem';

                        content.appendChild(confirmMessage);
                    },
                    onSave: () => {
                        // 删除分类
                        logger.debug(`正在尝试删除分类: "${categoryName}"`);
                        if (this.tagsData[categoryName]) {
                            delete this.tagsData[categoryName];
                            this.isDirty = true;

                            logger.debug(`分类"${categoryName}"已删除，重新渲染界面`);

                            // 确保重新渲染使用最新的数据
                            setTimeout(() => {
                                this._createTagAccordion(this.tagsData, container);
                                this._initTooltips(); // 重新初始化tooltips
                            }, 0);
                        } else {
                            logger.warn(`无法找到分类: ${categoryName}`);
                        }
                        return true; // 确保弹窗关闭
                    }
                });
            });

            iconContainer.appendChild(deleteButton);

            // 添加箭头图标（移到最后）
            const arrowIcon = document.createElement('span');
            arrowIcon.className = 'pi pi-chevron-down accordion_arrow_icon rotate-180'; // 默认旋转箭头
            arrowIcon.style.fontSize = '12px'; // 设置图标大小
            iconContainer.appendChild(arrowIcon);

            header.appendChild(title);
            header.appendChild(iconContainer);

            // 添加内容区域
            const content = document.createElement('div');
            content.className = 'tag_accordion_content active'; // 默认设置为active状态
            content.style.maxHeight = 'none'; // 默认展开

            // 添加标签列表
            const tagContainer = document.createElement('div');
            tagContainer.className = 'tags_container';

            // 添加标签
            for (const [tagName, tagValue] of Object.entries(categoryTags)) {
                const tagItem = document.createElement('div');
                tagItem.className = 'tag_item';
                tagItem.setAttribute('data-name', tagName);
                tagItem.setAttribute('data-value', tagValue);

                // 添加标签文本
                const tagText = document.createElement('span');
                tagText.className = 'tag_item_text';
                tagText.textContent = tagName;

                // 添加编辑按钮
                const editButton = document.createElement('button');
                editButton.className = 'tag_edit_button small'; // 使用新的编辑按钮样式
                editButton.title = '编辑标签';
                const editIcon = document.createElement('span');
                editIcon.className = 'pi pi-pencil tag_edit_icon small'; // 使用新的编辑图标样式
                editButton.appendChild(editIcon);

                editButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._showTagDialog(container, categoryName, tagName);
                });

                // 添加删除按钮
                const deleteButton = document.createElement('button');
                deleteButton.className = 'tag_delete_button small';
                deleteButton.title = '删除标签';

                // 添加删除图标
                const deleteIcon = document.createElement('span');
                deleteIcon.className = 'pi pi-times tag_action_icon small';
                deleteButton.appendChild(deleteIcon);

                // 添加删除事件
                deleteButton.addEventListener('click', (e) => {
                    e.stopPropagation();

                    const thisName = tagName; // 保存当前的tagName，避免在闭包中引用循环变量
                    const thisCategory = categoryName; // 保存当前的categoryName

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
                            confirmMessage.textContent = `确定要删除标签"${thisName}"吗？`;
                            confirmMessage.style.margin = '0';
                            confirmMessage.style.fontSize = '1rem';

                            content.appendChild(confirmMessage);
                        },
                        onSave: () => {
                            // 删除标签
                            logger.debug(`正在尝试删除标签: "${thisName}" (分类: "${thisCategory}")`);
                            if (this.tagsData[thisCategory] && this.tagsData[thisCategory][thisName]) {
                                delete this.tagsData[thisCategory][thisName];
                                this.isDirty = true;

                                logger.debug(`标签 "${thisName}" 已从分类 "${thisCategory}" 中删除，重新渲染界面`);

                                // 确保重新渲染使用最新的数据
                                setTimeout(() => {
                                    this._createTagAccordion(this.tagsData, container);
                                    this._initTooltips(); // 重新初始化tooltips
                                }, 0);
                            } else {
                                logger.warn(`无法找到标签: ${thisName} 在分类 ${thisCategory} 中`);
                            }
                            return true; // 确保弹窗关闭
                        }
                    });
                });

                // 添加tooltip功能
                tagItem.title = tagValue;
                tagItem.setAttribute('data-tooltip-content', `<span class="tooltip_path">${tagValue}</span>`);
                tagItem.classList.add('has-tooltip');

                tagItem.appendChild(tagText);
                tagItem.appendChild(editButton);
                tagItem.appendChild(deleteButton);
                tagContainer.appendChild(tagItem);
            }

            content.appendChild(tagContainer);

            // 添加手风琴切换事件
            header.addEventListener('click', (e) => {
                if (e.target.closest('.tag_delete_button')) return;

                const isActive = !header.classList.contains('active');
                header.classList.toggle('active');
                content.classList.toggle('active');

                // 添加过渡效果
                if (isActive) {
                    // 先设置一个固定高度，确保动画效果
                    content.style.maxHeight = content.scrollHeight + 'px';
                    arrowIcon.classList.add('rotate-180');

                    // 处理滚动容器定位，确保展开内容可见
                    setTimeout(() => {
                        // 计算手风琴的位置
                        const accordionTop = accordion.offsetTop;
                        const scrollTop = container.closest('.tags-scroll-container').scrollTop;
                        const containerHeight = container.closest('.tags-scroll-container').clientHeight;

                        // 如果手风琴底部超出可视区域，滚动到合适位置
                        const accordionBottom = accordionTop + header.offsetHeight + content.scrollHeight - scrollTop;
                        if (accordionBottom > containerHeight) {
                            // 确保手风琴标题仍在可视区域顶部
                            container.closest('.tags-scroll-container').scrollTo({
                                top: Math.max(accordionTop - 20, 0),
                                behavior: 'smooth'
                            });
                        }
                    }, 50);
                } else {
                    content.style.maxHeight = '0';
                    arrowIcon.classList.remove('rotate-180');
                }
            });

            // 默认所有手风琴都是展开状态
            header.classList.add('active');
            content.classList.add('active');
            content.style.maxHeight = 'none'; // 默认不限制高度，完全展开
            content.style.overflow = 'visible'; // 确保内容可见
            arrowIcon.classList.add('rotate-180'); // 箭头朝上表示展开状态

            accordion.appendChild(header);
            accordion.appendChild(content);
            container.appendChild(accordion);

            // 初始化标签排序
            this._initSortable(container, tagContainer, categoryName);
        });

        // 初始化分类排序
        this._initCategorySortable(container);
    }

    /**
     * 创建标签配置弹窗
     * @private
     */
    _createTagsConfigDialog() {
        // 创建一个变量来存储原始的isDirty值
        const originalIsDirty = this.isDirty;
        // 创建一个变量来存储表单修改状态设置函数
        let setFormModified = null;

        const dialog = createSettingsDialog({
            title: '标签管理器',
            dialogClassName: 'tags-config-dialog',
            disableBackdropAndCloseOnClickOutside: true,
            renderContent: (container) => {
                // 弹窗容器的整体设置
                container.className += ' tags-config-container';
                container.style.width = '100%';

                // 创建表单
                const form = document.createElement('form');
                form.onsubmit = (e) => e.preventDefault();
                form.className = 'tags-config-form';
                form.style.width = '100%';

                // 创建一个隐藏的输入字段，用于标记表单修改状态
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'modified_marker';
                hiddenInput.value = 'initial';
                form.appendChild(hiddenInput);

                // 定义表单修改状态设置函数
                setFormModified = () => {
                    // 修改隐藏字段的值，这会触发表单变化检测
                    hiddenInput.value = 'modified_' + Date.now();
                    // 触发change事件
                    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                };

                // 覆盖isDirty的setter，在设置为true时触发表单修改状态
                Object.defineProperty(this, 'isDirty', {
                    get: function () {
                        return this._isDirty;
                    },
                    set: function (value) {
                        // 保存值
                        this._isDirty = value;
                        // 如果设置为true，则标记表单已修改
                        if (value && setFormModified) {
                            setFormModified();
                        }
                    }
                });
                // 初始化_isDirty
                this._isDirty = originalIsDirty;

                // 创建标签管理部分
                const tagsSection = createFormGroup('标签管理');
                tagsSection.className += ' tag-management-section';
                tagsSection.style.width = '100%';

                const tagsHeader = tagsSection.querySelector('.settings-form-section-header');

                // 添加操作按钮容器 - 使用透明容器
                const actionContainer = document.createElement('div');
                actionContainer.className = 'tags-action-container';
                actionContainer.style.display = 'flex';
                actionContainer.style.gap = '8px';

                // 添加分类按钮
                const addCategoryButton = document.createElement('button');
                addCategoryButton.className = 'p-button p-component p-button-secondary p-button-sm settings-action-btn';
                addCategoryButton.title = '添加分类';
                addCategoryButton.innerHTML = '<span class="p-button-icon p-button-icon-left pi pi-plus"></span><span class="p-button-label">添加分类</span>';
                addCategoryButton.onclick = () => this._showCategoryDialog(tagsContainer);

                // 添加标签按钮
                const addTagButton = document.createElement('button');
                addTagButton.className = 'p-button p-component p-button-secondary p-button-sm settings-action-btn';
                addTagButton.title = '添加标签';
                addTagButton.innerHTML = '<span class="p-button-icon p-button-icon-left pi pi-tag"></span><span class="p-button-label">添加标签</span>';
                addTagButton.onclick = () => this._showTagDialog(tagsContainer);

                // 添加按钮到容器
                actionContainer.appendChild(addCategoryButton);
                actionContainer.appendChild(addTagButton);
                tagsHeader.appendChild(actionContainer);

                // 创建标签容器
                const tagsContainer = document.createElement('div');
                tagsContainer.className = 'tags-manager-container';
                tagsContainer.style.width = '100%';

                // 创建一个固定高度的滚动容器
                const scrollContainer = document.createElement('div');
                scrollContainer.className = 'tags-scroll-container';
                scrollContainer.style.width = '100%';
                scrollContainer.appendChild(tagsContainer);

                tagsSection.appendChild(scrollContainer);

                // 加载标签数据并渲染
                this._loadTagsData().then(data => {
                    this._createTagAccordion(data, tagsContainer);
                    // 初始化tooltip功能
                    setTimeout(() => this._initTooltips(), 100);
                });

                form.appendChild(tagsSection);
                container.appendChild(form);
            },
            onSave: async (content) => {
                // 如果没有更改，直接关闭
                if (!this.isDirty) {
                    return true;
                }

                // 保存标签数据
                try {
                    const success = await this._saveTagsData(this.tagsData);
                    if (success) {
                        // 保存成功后，强制刷新用户标签缓存
                        ResourceManager.getUserTagData(true);

                        // 更新初始数据并重置脏状态
                        this.initialTagsData = JSON.parse(JSON.stringify(this.tagsData));
                        this.isDirty = false;
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: "标签配置已更新",
                            detail: "用户自定义标签已保存",
                            life: 3000
                        });
                        // 恢复原始属性定义
                        if (Object.getOwnPropertyDescriptor(this, 'isDirty').set) {
                            delete this.isDirty;
                            this.isDirty = this._isDirty;
                            delete this._isDirty;
                        }
                        return true;
                    } else {
                        throw new Error("保存失败");
                    }
                } catch (error) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "保存失败",
                        detail: error.message || "标签保存过程中发生错误",
                        life: 3000
                    });
                    throw error;
                }
            },
            onCancel: () => {
                // 如果有未保存的更改，通用确认对话框会自动处理
                if (this.isDirty) {
                    // 恢复初始数据
                    this.tagsData = JSON.parse(JSON.stringify(this.initialTagsData));
                    this.isDirty = false;
                }

                // 清理tooltips资源
                this._cleanupTooltips();

                // 恢复原始属性定义
                if (Object.getOwnPropertyDescriptor(this, 'isDirty').set) {
                    delete this.isDirty;
                    this.isDirty = this._isDirty;
                    delete this._isDirty;
                }

                return true; // 允许关闭
            }
        });

        return dialog;
    }

    /**
     * 显示分类对话框（添加/编辑）
     * @param {HTMLElement} container 标签容器
     * @param {string} [oldCategoryName] 如果是编辑模式，则传入旧的分类名
     */
    _showCategoryDialog(container, oldCategoryName = null) {
        const isEdit = !!oldCategoryName;
        createSettingsDialog({
            title: isEdit ? '编辑分类' : '添加分类',
            isConfirmDialog: true,
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: isEdit ? '保存' : '添加',
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.className += ' dialog-form-content';
                content.style.padding = '1rem';

                const categoryInput = createInputGroup('分类名称', '请输入分类名称');
                categoryInput.group.style.marginBottom = '0';

                if (isEdit) {
                    categoryInput.input.value = oldCategoryName;
                }

                content.appendChild(categoryInput.group);

                // 聚焦输入框
                setTimeout(() => {
                    categoryInput.input.focus();
                }, 100);

                content.categoryInput = categoryInput.input;
            },
            onSave: (content) => {
                const categoryName = content.categoryInput.value.trim();
                if (!categoryName) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? "编辑失败" : "添加失败",
                        detail: "分类名称不能为空",
                        life: 3000
                    });
                    return;
                }

                // 检查是否已存在（排除编辑时的自身）
                if (!isEdit && this.tagsData[categoryName] ||
                    (isEdit && categoryName !== oldCategoryName && this.tagsData[categoryName])) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? "编辑失败" : "添加失败",
                        detail: "该分类已存在",
                        life: 3000
                    });
                    return;
                }

                if (isEdit && categoryName !== oldCategoryName) {
                    // 创建一个新的对象来保持顺序
                    const newData = {};
                    // 遍历现有数据，在适当的位置替换分类名
                    Object.entries(this.tagsData).forEach(([name, content]) => {
                        if (name === oldCategoryName) {
                            newData[categoryName] = content;
                        } else {
                            newData[name] = content;
                        }
                    });
                    this.tagsData = newData;
                } else if (!isEdit) {
                    // 添加新分类
                    this.tagsData[categoryName] = {};
                }

                this.isDirty = true;
                this._createTagAccordion(this.tagsData, container);

                app.extensionManager.toast.add({
                    severity: "success",
                    summary: isEdit ? "编辑成功" : "添加成功",
                    detail: isEdit ? `已更新分类"${categoryName}"` : `已添加分类"${categoryName}"`,
                    life: 3000
                });

                return true;
            }
        });
    }

    /**
     * 显示标签对话框（添加/编辑）
     * @param {HTMLElement} container 标签容器
     * @param {string} [categoryName] 如果是编辑模式，则传入分类名
     * @param {string} [oldTagName] 如果是编辑模式，则传入旧的标签名
     */
    _showTagDialog(container, categoryName = null, oldTagName = null) {
        const isEdit = !!oldTagName;
        const oldTagValue = isEdit ? this.tagsData[categoryName][oldTagName] : '';

        createSettingsDialog({
            title: isEdit ? '编辑标签' : '添加标签',
            isConfirmDialog: true,
            disableBackdropAndCloseOnClickOutside: true,
            saveButtonText: isEdit ? '保存' : '添加',
            cancelButtonText: '取消',
            renderContent: (content) => {
                content.className += ' dialog-form-content';
                content.style.padding = '1rem';

                // 创建分类选择器（编辑和添加模式都显示）
                const categories = Object.keys(this.tagsData).map(cat => ({ value: cat, text: cat }));
                const categorySelect = createSelectGroup('选择分类', categories, isEdit ? categoryName : null);
                categorySelect.group.style.marginBottom = '10px';
                content.appendChild(categorySelect.group);
                content.categorySelect = categorySelect.select;

                // 创建标签名称输入框
                const tagNameInput = createInputGroup('标签名称', '请输入标签显示名称');
                tagNameInput.group.style.marginBottom = '10px';
                if (isEdit) {
                    tagNameInput.input.value = oldTagName;
                }

                // 创建标签内容输入框
                const tagValueInput = createInputGroup('标签内容', '请输入标签插入内容');
                tagValueInput.group.style.marginBottom = '0';
                if (isEdit) {
                    tagValueInput.input.value = oldTagValue;
                }

                content.appendChild(tagNameInput.group);
                content.appendChild(tagValueInput.group);

                content.tagNameInput = tagNameInput.input;
                content.tagValueInput = tagValueInput.input;

                // 聚焦标签名称输入框
                setTimeout(() => {
                    tagNameInput.input.focus();
                }, 100);
            },
            onSave: (content) => {
                const targetCategory = content.categorySelect.value;
                const tagName = content.tagNameInput.value.trim();
                const tagValue = content.tagValueInput.value.trim();

                if (!targetCategory || !tagName || !tagValue) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? "编辑失败" : "添加失败",
                        detail: "分类、标签名称和标签内容不能为空",
                        life: 3000
                    });
                    return;
                }

                // 检查标签是否已存在
                const isSameCategory = isEdit && targetCategory === categoryName;
                const isTagNameChanged = isEdit && tagName !== oldTagName;

                // 在以下情况下检查重复：
                // 1. 添加新标签时
                // 2. 编辑时改变了标签名（在同一分类内）
                // 3. 移动到其他分类且目标分类已有同名标签
                if ((!isEdit && this.tagsData[targetCategory][tagName]) ||
                    (isEdit && (
                        (isSameCategory && isTagNameChanged && this.tagsData[targetCategory][tagName]) ||
                        (!isSameCategory && this.tagsData[targetCategory][tagName])
                    ))) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: isEdit ? "编辑失败" : "添加失败",
                        detail: `标签"${tagName}"已存在于分类"${targetCategory}"中`,
                        life: 3000
                    });
                    return;
                }

                if (isEdit) {
                    // 如果分类发生了更改，我们需要从旧分类中移除标签
                    if (targetCategory !== categoryName) {
                        const originalCategoryTags = {};
                        Object.entries(this.tagsData[categoryName]).forEach(([name, value]) => {
                            if (name !== oldTagName) {
                                originalCategoryTags[name] = value;
                            }
                        });
                        this.tagsData[categoryName] = originalCategoryTags;
                    }

                    // 更新目标分类
                    const newTargetTags = {};
                    const tagsToIterate = (targetCategory === categoryName)
                        ? this.tagsData[targetCategory]
                        : (this.tagsData[targetCategory] || {});

                    Object.entries(tagsToIterate).forEach(([name, value]) => {
                        // 在同一个分类中重命名时，要跳过旧的标签名
                        if (targetCategory === categoryName && name === oldTagName) {
                            newTargetTags[tagName] = tagValue;
                        } else {
                            newTargetTags[name] = value;
                        }
                    });

                    // 如果是移动到新分类，在末尾添加标签
                    if (targetCategory !== categoryName) {
                        newTargetTags[tagName] = tagValue;
                    }

                    this.tagsData[targetCategory] = newTargetTags;

                } else {
                    // 添加新标签
                    this.tagsData[targetCategory][tagName] = tagValue;
                }

                this.isDirty = true;
                this._createTagAccordion(this.tagsData, container);

                app.extensionManager.toast.add({
                    severity: "success",
                    summary: isEdit ? "编辑成功" : "添加成功",
                    detail: isEdit ?
                        (targetCategory === categoryName ?
                            `已更新标签"${tagName}"` :
                            `已将标签"${tagName}"移动到分类"${targetCategory}"`) :
                        `已添加标签"${tagName}"到分类"${targetCategory}"中`,
                    life: 3000
                });

                return true;
            }
        });
    }
}

// 导出实例
const tagConfigManager = new TagConfigManager();
export { TagConfigManager, tagConfigManager }; 