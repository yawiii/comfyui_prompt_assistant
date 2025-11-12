/**
 * 小助手设置服务
 * 负责管理小助手的设置选项，提供开关控制功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { PromptAssistant, updateAutoTranslateIndicators } from "./PromptAssistant.js";
import { EventManager } from "../utils/eventManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { FEATURES, handleFeatureChange } from "../services/features.js";
import { tagConfigManager } from "./tagConfigManager.js";
import { apiConfigManager } from "./apiConfigManager.js";
import { rulesConfigManager } from "./rulesConfigManager.js";

// 标记是否是首次加载页面
let isFirstLoad = true;

/**
 * 创建通用的设置弹窗
 * @param {Object} options 弹窗配置选项
 * @param {string} options.title 弹窗标题
 * @param {Function} options.renderContent 渲染弹窗内容的函数
 * @param {Function} options.renderNotice 渲染通知区域的函数（可选，显示在标题和内容之间）
 * @param {Function} options.onSave 保存按钮点击回调
 * @param {Function} options.onCancel 取消按钮点击回调（可选）
 * @param {boolean} options.isConfirmDialog 是否是确认对话框（可选）
 * @param {string} options.saveButtonText 保存按钮文本（可选）
 * @param {string} options.cancelButtonText 取消按钮文本（可选）
 * @param {string} options.saveButtonIcon 保存按钮图标（可选）
 * @param {boolean} options.disableBackdropAndCloseOnClickOutside 禁用遮罩层和点击外部关闭（可选）
 */
export function createSettingsDialog(options) {
    try {
        const {
            title,
            renderContent,
            renderNotice = null,
            onSave,
            onCancel = null,
            isConfirmDialog = false,
            saveButtonText = '保存',
            cancelButtonText = '取消',
            saveButtonIcon = 'pi-check',
            dialogClassName = null,
            disableBackdropAndCloseOnClickOutside = false,
        } = options;

        let overlay = null;
        if (!disableBackdropAndCloseOnClickOutside) {
            // 创建遮罩层
            overlay = document.createElement('div');
            overlay.className = 'settings-modal-overlay';
            document.body.appendChild(overlay);
        }


        // 创建弹窗
        const modal = document.createElement('div');
        modal.className = 'settings-modal';

        // 如果提供了额外的对话框类名，添加到modal
        if (dialogClassName) {
            modal.classList.add(dialogClassName);
        }

        // 如果是确认对话框，设置特殊样式
        if (isConfirmDialog) {
            // 只有在没有提供自定义类名的情况下才设置默认宽度
            if (!dialogClassName) {
                modal.style.width = 'min(90vw, 400px)';
            }
            modal.style.minHeight = 'auto';
            // 确保确认对话框显示在其他弹窗上方
            if (overlay) {
                overlay.style.zIndex = 'calc(var(--settings-modal-z-index) + 10)';
            }
            modal.style.zIndex = 'calc(var(--settings-modal-z-index) + 11)';
        }

        // 表单修改状态
        let isFormModified = false;

        // 处理关闭弹窗的逻辑
        const handleCloseModal = async (saveAction) => {
            // 如果是保存操作，直接保存并关闭，不弹出确认对话框
            if (saveAction) {
                try {
                    await onSave(content);
                    closeModalWithAnimation(modal, overlay);
                } catch (error) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "保存失败",
                        detail: error.message,
                        life: 3000
                    });
                }
                return;
            }

            // 只有在表单被修改且不是确认对话框时才显示确认对话框
            if (isFormModified && !isConfirmDialog) {
                // 创建确认对话框
                createSettingsDialog({
                    title: '确认操作',
                    isConfirmDialog: true,
                    saveButtonText: '返回',
                    saveButtonIcon: 'pi-undo',
                    cancelButtonText: '关闭',
                    renderContent: (content) => {
                        content.style.textAlign = 'center';
                        content.style.padding = '1rem';

                        const confirmMessage = document.createElement('p');
                        confirmMessage.textContent = '配置已修改，是否保存？';
                        confirmMessage.style.margin = '0';
                        confirmMessage.style.fontSize = '1rem';

                        content.appendChild(confirmMessage);
                    },
                    onSave: () => {
                        // 返回按钮只关闭确认对话框，不执行保存操作
                        // 这里不需要做任何操作，因为默认的对话框关闭逻辑会在点击按钮后执行
                    },
                    onCancel: () => {
                        // 如果定义了onCancel回调，则执行它
                        if (onCancel) {
                            onCancel();
                        }
                        // 关闭主对话框
                        closeModalWithAnimation(modal, overlay);
                    }
                });
            } else {
                // 没有修改或是确认对话框，直接关闭
                if (onCancel && !isConfirmDialog) {
                    onCancel();
                }
                closeModalWithAnimation(modal, overlay);
            }
        };

        if (!disableBackdropAndCloseOnClickOutside) {
            // 点击遮罩层关闭弹窗
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    handleCloseModal(false);
                }
            });
        }

        // 创建弹窗头部
        const header = document.createElement('div');
        header.className = 'p-dialog-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'p-dialog-title';
        titleSpan.textContent = title;

        const closeButton = document.createElement('button');
        closeButton.className = 'p-dialog-header-icon p-dialog-header-close p-link';
        closeButton.setAttribute('aria-label', '关闭');
        closeButton.innerHTML = '<span class="pi pi-times"></span>';
        closeButton.onclick = () => {
            handleCloseModal(false);
        };

        const headerIcons = document.createElement('div');
        headerIcons.className = 'p-dialog-header-icons';
        headerIcons.appendChild(closeButton);

        header.appendChild(titleSpan);
        header.appendChild(headerIcons);

        // 创建通知区域（在标题和内容之间）
        let noticeArea = null;
        if (renderNotice) {
            noticeArea = document.createElement('div');
            noticeArea.className = 'p-dialog-notice';
            renderNotice(noticeArea);
        }

        // 创建弹窗内容
        const content = document.createElement('div');
        content.className = 'p-dialog-content';

        // 监听表单变化
        const trackFormChanges = (formElement) => {
            // 为所有输入元素添加变更监听
            const inputs = formElement.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                const originalValue = input.type === 'checkbox' ? input.checked : input.value;

                input.addEventListener('change', () => {
                    const currentValue = input.type === 'checkbox' ? input.checked : input.value;
                    // 只有当值真正改变时才标记为已修改
                    if (currentValue !== originalValue) {
                        isFormModified = true;
                    }
                });

                if (input.tagName.toLowerCase() === 'textarea' || input.type === 'text') {
                    input.addEventListener('input', () => {
                        const currentValue = input.value;
                        // 只有当值真正改变时才标记为已修改
                        if (currentValue !== originalValue) {
                            isFormModified = true;
                        }
                    });
                }
            });

            // 监听自定义下拉框变化
            const dropdowns = formElement.querySelectorAll('.p-dropdown');
            dropdowns.forEach(dropdown => {
                // 存储原始选中值
                const hiddenSelect = dropdown.querySelector('select');
                const originalValue = hiddenSelect ? hiddenSelect.value : '';

                const observer = new MutationObserver(() => {
                    const currentValue = hiddenSelect ? hiddenSelect.value : '';
                    // 只有当值真正改变时才标记为已修改
                    if (currentValue !== originalValue) {
                        isFormModified = true;
                    }
                });
                observer.observe(dropdown, { attributes: true, childList: true, subtree: true });
            });
        };

        // 渲染内容并跟踪变化
        renderContent(content);

        // 如果不是确认对话框且内容中有表单，添加变更跟踪
        if (!isConfirmDialog) {
            const forms = content.querySelectorAll('form');
            forms.forEach(trackFormChanges);

            // 如果没有找到表单，则监视整个内容区域
            if (forms.length === 0) {
                trackFormChanges(content);
            }
        }

        // 创建弹窗底部
        const footer = document.createElement('div');
        footer.className = 'p-dialog-footer';

        const cancelButton = document.createElement('button');
        cancelButton.className = 'p-button p-component p-button-secondary';
        cancelButton.innerHTML = `<span class="p-button-icon-left pi pi-times"></span><span class="p-button-label">${cancelButtonText}</span>`;

        // 为不同类型的对话框设置不同的关闭行为
        if (isConfirmDialog) {
            cancelButton.onclick = () => {
                // 对于确认对话框，“关闭”按钮应执行onCancel回调（该回调负责关闭主窗口），然后关闭自己
                if (onCancel) {
                    onCancel();
                }
                closeModalWithAnimation(modal, overlay);
            };
        } else {
            cancelButton.onclick = () => {
                // 对于普通对话框，使用标准的关闭处理逻辑
                handleCloseModal(false);
            };
        }

        const saveButton = document.createElement('button');
        saveButton.className = 'p-button p-component';
        saveButton.innerHTML = `<span class="p-button-icon-left pi ${saveButtonIcon}"></span><span class="p-button-label">${saveButtonText}</span>`;
        saveButton.onclick = () => {
            // 如果是确认对话框中的返回按钮，直接关闭确认对话框
            if (isConfirmDialog) {
                try {
                    // 对于确认对话框，先执行onSave回调，然后关闭弹窗
                    const result = onSave && onSave(content);
                    // 如果onSave返回Promise，等待其完成
                    if (result instanceof Promise) {
                        result.then(() => {
                            closeModalWithAnimation(modal, overlay);
                        }).catch(error => {
                            logger.error(`确认对话框处理失败: ${error.message}`);
                            closeModalWithAnimation(modal, overlay);
                        });
                    } else {
                        // 普通返回值，直接关闭
                        closeModalWithAnimation(modal, overlay);
                    }
                } catch (error) {
                    logger.error(`确认对话框处理失败: ${error.message}`);
                    closeModalWithAnimation(modal, overlay);
                }
            } else {
                handleCloseModal(true);
            }
        };

        footer.appendChild(cancelButton);
        footer.appendChild(saveButton);

        // 添加拖动功能
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;

        const startDragging = (e) => {
            if (e.target === closeButton || closeButton.contains(e.target)) return;

            e.preventDefault();
            isDragging = true;

            // 获取鼠标相对于弹窗的偏移量
            const rect = modal.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            // 移除居中定位
            modal.style.transform = 'none';
            modal.style.left = rect.left + 'px';
            modal.style.top = rect.top + 'px';

            // 添加拖动状态
            modal.classList.add('dragging');

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDragging);
        };

        const onDrag = (e) => {
            if (!isDragging) return;
            e.preventDefault();

            // 计算新位置（考虑鼠标在弹窗内的偏移量）
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;

            // 获取视口和弹窗尺寸
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const modalRect = modal.getBoundingClientRect();
            const modalWidth = modalRect.width;
            const modalHeight = modalRect.height;

            // 边界检查（保持10px边距）
            const margin = 10;
            newLeft = Math.max(margin, Math.min(newLeft, viewportWidth - modalWidth - margin));
            newTop = Math.max(margin, Math.min(newTop, viewportHeight - modalHeight - margin));

            // 更新位置
            modal.style.left = `${newLeft}px`;
            modal.style.top = `${newTop}px`;
        };

        const stopDragging = () => {
            isDragging = false;
            modal.classList.remove('dragging');
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDragging);
        };

        header.addEventListener('mousedown', startDragging);

        // 组装弹窗
        modal.appendChild(header);
        if (noticeArea) {
            modal.appendChild(noticeArea);
        }
        modal.appendChild(content);
        modal.appendChild(footer);

        // 显示弹窗和遮罩层
        document.body.appendChild(modal);

        // 添加显示动画
        requestAnimationFrame(() => {
            modal.classList.add('modal-show');
            if (overlay) {
                overlay.classList.add('overlay-show');
            }
        });

        return modal;
    } catch (error) {
        logger.error(`创建设置弹窗失败: ${error.message}`);
        app.extensionManager.toast.add({
            severity: "error",
            summary: "创建弹窗失败",
            detail: error.message || "创建设置弹窗过程中发生错误",
            life: 3000
        });
    }
}

/**
 * 关闭弹窗时添加动画效果
 * @param {HTMLElement} modal 弹窗元素
 * @param {HTMLElement} overlay 遮罩层元素
 */
export function closeModalWithAnimation(modal, overlay) {
    // 添加关闭动画类
    modal.classList.remove('modal-show');
    modal.classList.add('modal-hide');
    if (overlay) {
        overlay.classList.remove('overlay-show');
        overlay.classList.add('overlay-hide');
    }

    // 等待动画完成后移除弹窗和遮罩层
    setTimeout(() => {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }, 300); // 与 CSS transition 时间相匹配
}

/**
 * 创建表单组
 * @param {string} title 表单组标题
 * @param {Array<{text: string, url: string}>} links 标题右侧的链接数组
 * @param {Object} [options] 额外可选项
 * @param {string} [options.prefixText] 链接前的前缀纯文本（不作为链接，不包在标签内）
 * @returns {HTMLElement} 表单组容器
 */
export function createFormGroup(title, links = [], options = {}) {
    const { prefixText = null } = options;

    const group = document.createElement('div');
    group.className = 'settings-form-section';

    const titleContainer = document.createElement('div');
    titleContainer.className = 'settings-form-section-header';
    titleContainer.style.display = 'flex';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.justifyContent = 'space-between';
    titleContainer.style.marginBottom = '10px';

    const titleElem = document.createElement('h3');
    titleElem.className = 'settings-form-section-title';
    titleElem.textContent = title;
    titleElem.style.margin = '0';

    const linksContainer = document.createElement('div');
    linksContainer.style.display = 'flex';
    linksContainer.style.gap = '8px';
    linksContainer.style.alignItems = 'center';

    if (links.length > 0) {
        const serviceLinksContainer = document.createElement('div');
        serviceLinksContainer.className = 'settings-service-links';

        // 可选的前缀文本，保持与链接字号一致（不包在<a>标签内）
        if (prefixText) {
            const prefix = document.createElement('span');
            prefix.className = 'settings-service-prefix';
            prefix.textContent = prefixText;
            serviceLinksContainer.appendChild(prefix);
        }

        links.forEach((linkInfo, index) => {
            if (index > 0) {
                // 添加分隔符
                const separator = document.createElement('span');
                separator.textContent = '｜';
                separator.className = 'settings-service-separator';
                serviceLinksContainer.appendChild(separator);
            }

            const link = document.createElement('a');
            link.href = linkInfo.url;
            link.target = '_blank';
            link.textContent = linkInfo.text;
            link.className = 'settings-service-link';

            serviceLinksContainer.appendChild(link);
        });

        linksContainer.appendChild(serviceLinksContainer);
    }

    titleContainer.appendChild(titleElem);
    titleContainer.appendChild(linksContainer);
    group.appendChild(titleContainer);

    return group;
}

/**
 * 创建输入框组
 * @param {string} label 标签文本
 * @param {string} placeholder 占位符文本
 * @param {string} type 输入框类型
 * @returns {Object} 包含 group 和 input 的对象
 */
export function createInputGroup(label, placeholder, type = 'text') {
    const group = document.createElement('div');
    group.className = 'settings-form-group';

    const labelElem = document.createElement('label');
    labelElem.className = 'settings-form-label';
    labelElem.textContent = label;

    const input = document.createElement('input');
    input.className = 'p-inputtext p-component flex-1';
    input.type = type;
    input.placeholder = placeholder;

    group.appendChild(labelElem);
    group.appendChild(input);

    return { group, input };
}

/**
 * 创建下拉选择框组
 * @param {string} label 标签文本
 * @param {Array<{value: string, text: string}>} options 选项列表
 * @param {string} [initialValue=null] 初始选中的值
 * @returns {Object} 包含 group 和 select 的对象
 */
export function createSelectGroup(label, options, initialValue = null) {
    const group = document.createElement('div');
    group.className = 'settings-form-group';

    const labelElem = document.createElement('label');
    labelElem.className = 'settings-form-label';
    labelElem.textContent = label;

    // Main Container
    const dropdownContainer = document.createElement('div');
    // 增加自定义样式类 pa-dropdown，保留 p-dropdown 以兼容现有逻辑（如脏检查与布局选择器）
    dropdownContainer.className = 'pa-dropdown p-dropdown p-component w-full';
    dropdownContainer.style.position = 'relative'; // Needed for panel positioning

    // Hidden select for form data and accessibility
    const select = document.createElement('select');
    const hiddenContainer = document.createElement('div');
    hiddenContainer.className = 'p-hidden-accessible';
    hiddenContainer.appendChild(select);

    // Visible Part: Label and Trigger
    const dropdownLabel = document.createElement('span');
    dropdownLabel.className = 'pa-dropdown-label p-dropdown-label p-inputtext';

    const dropdownTrigger = document.createElement('div');
    dropdownTrigger.className = 'pa-dropdown-trigger p-dropdown-trigger';
    dropdownTrigger.innerHTML = '<span class="p-dropdown-trigger-icon pi pi-chevron-down"></span>';

    // Dropdown Panel (the menu)
    const dropdownPanel = document.createElement('div');
    dropdownPanel.className = 'pa-dropdown-panel p-dropdown-panel p-component settings-modal-dropdown-panel';
    dropdownPanel.style.display = 'none'; // Initially hidden
    dropdownPanel.style.zIndex = '10001'; // 确保层级足够高

    const dropdownItemsWrapper = document.createElement('div');
    dropdownItemsWrapper.className = 'p-dropdown-items-wrapper';

    const dropdownList = document.createElement('ul');
    dropdownList.className = 'p-dropdown-items';
    dropdownList.setAttribute('role', 'listbox');

    // Populate options
    options.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.text;
        select.appendChild(optionEl);

        const itemEl = document.createElement('li');
        itemEl.className = 'p-dropdown-item';
        itemEl.textContent = opt.text;
        itemEl.dataset.value = opt.value;
        itemEl.setAttribute('role', 'option');

        itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            // Update highlight
            dropdownList.querySelectorAll('.p-dropdown-item').forEach(el => el.classList.remove('p-highlight'));
            itemEl.classList.add('p-highlight');

            select.value = opt.value;
            closePanel();
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        dropdownList.appendChild(itemEl);
    });

    // Set initial display value
    const valueToSet = initialValue !== null && options.some(o => o.value === initialValue)
        ? initialValue
        : (options.length > 0 ? options[0].value : null);

    if (valueToSet !== null) {
        const selectedOption = options.find(o => o.value === valueToSet);
        if (selectedOption) {
            dropdownLabel.textContent = selectedOption.text;
            select.value = selectedOption.value;
            // Set initial highlight
            const initialItem = dropdownList.querySelector(`.p-dropdown-item[data-value="${select.value}"]`);
            if (initialItem) {
                initialItem.classList.add('p-highlight');
            }
        }
    } else {
        dropdownLabel.textContent = ' '; // Placeholder
    }

    // Assemble dropdown
    dropdownItemsWrapper.appendChild(dropdownList);
    dropdownPanel.appendChild(dropdownItemsWrapper);

    dropdownContainer.appendChild(hiddenContainer);
    dropdownContainer.appendChild(dropdownLabel);
    dropdownContainer.appendChild(dropdownTrigger);

    group.appendChild(labelElem);
    group.appendChild(dropdownContainer);

    // --- Event Handling ---
    let isOpen = false;

    // 更新面板位置的函数
    const updatePanelPosition = () => {
        if (!isOpen) return;

        const rect = dropdownContainer.getBoundingClientRect();
        dropdownPanel.style.top = rect.bottom + 'px';
        dropdownPanel.style.left = rect.left + 'px';
        dropdownPanel.style.width = rect.width + 'px';
    };

    const closePanel = () => {
        if (!isOpen) return;
        isOpen = false;

        dropdownPanel.classList.add('p-hidden');
        dropdownPanel.classList.remove('p-enter-active');
        dropdownContainer.classList.remove('p-dropdown-open', 'p-focus');

        // 移除事件监听器
        window.removeEventListener('resize', updatePanelPosition);
        window.removeEventListener('scroll', updatePanelPosition, true);

        // 等待动画完成后再移除面板和事件监听
        setTimeout(() => {
            if (dropdownPanel.parentNode === document.body) {
                document.body.removeChild(dropdownPanel);
            }
            document.removeEventListener('click', handleOutsideClick, true);
        }, 120); // 与CSS中的transition时间相匹配
    };

    const openPanel = () => {
        isOpen = true;

        // 将面板临时附加到 body 上以避免裁切
        document.body.appendChild(dropdownPanel);

        // 计算下拉框相对于视口的位置
        const rect = dropdownContainer.getBoundingClientRect();

        // 设置面板样式
        dropdownPanel.style.position = 'fixed';
        dropdownPanel.style.display = 'block';
        dropdownPanel.style.top = rect.bottom + 'px';
        dropdownPanel.style.left = rect.left + 'px';
        dropdownPanel.style.width = rect.width + 'px';
        // 样式由 CSS 中的 .pa-dropdown-panel 接管，避免依赖 PrimeVue 变量

        dropdownPanel.classList.remove('p-hidden');
        // 强制重排，确保动画生效
        dropdownPanel.offsetHeight;
        dropdownPanel.classList.add('p-enter-active');
        dropdownContainer.classList.add('p-dropdown-open', 'p-focus');

        document.addEventListener('click', handleOutsideClick, true);

        // 添加窗口大小变化和滚动事件监听器，以便重新定位面板
        window.addEventListener('resize', updatePanelPosition);
        window.addEventListener('scroll', updatePanelPosition, true);
    };

    const handleOutsideClick = (e) => {
        // 如果点击的是下拉框本身，切换状态
        if (dropdownContainer.contains(e.target)) {
            e.stopPropagation();
            if (isOpen) {
                closePanel();
            } else {
                openPanel();
            }
            return;
        }
        // 如果点击的是其他区域，关闭面板
        closePanel();
    };

    // 初始化面板状态
    dropdownPanel.classList.add('p-hidden');
    dropdownContainer.addEventListener('click', handleOutsideClick);

    select.addEventListener('change', () => {
        const selectedOption = options.find(o => o.value === select.value);
        if (selectedOption) {
            dropdownLabel.textContent = selectedOption.text;
            // Update highlight
            dropdownList.querySelectorAll('.p-dropdown-item').forEach(el => {
                if (el.dataset.value === select.value) {
                    el.classList.add('p-highlight');
                } else {
                    el.classList.remove('p-highlight');
                }
            });
        }
    });

    return { group, select };
}

/**
 * 创建水平布局的表单组
 * @param {Array<{label: string, element: HTMLElement}>} items 表单项数组
 * @returns {HTMLElement} 水平布局的表单组
 */
export function createHorizontalFormGroup(items) {
    const group = document.createElement('div');
    group.className = 'settings-form-group horizontal';

    items.forEach(item => {
        const container = document.createElement('div');

        const label = document.createElement('label');
        label.className = 'settings-form-label';
        label.textContent = item.label;

        container.appendChild(label);
        container.appendChild(item.element);

        group.appendChild(container);
    });

    return group;
}

/**
 * 显示API配置弹窗
 */
function showAPIConfigModal() {
    try {
        // 调用API配置管理器的显示弹窗方法
        apiConfigManager.showAPIConfigModal();
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
 * 显示规则配置弹窗
 */
function showRulesConfigModal() {
    try {
        // 调用规则配置管理器的显示弹窗方法
        rulesConfigManager.showRulesConfigModal();
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
 * 显示标签配置弹窗
 */
function showTagsConfigModal() {
    try {
        logger.debug('打开标签配置弹窗');
        // 使用tagConfigManager实例显示标签配置弹窗
        tagConfigManager.showTagsConfigModal();
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

// ====================== 设置管理 ======================

/**
 * 创建加载按钮
 */
function createLoadingButton(text, onClick, showSuccessToast = true) {
    const button = document.createElement('button');
    button.className = 'p-button p-component p-button-primary';
    button.style.width = '208px'; // 相当于w-52
    button.innerHTML = `<span class="p-button-label">${text}</span>`;

    button.addEventListener('click', async () => {
        if (button.disabled) return;

        // 开始加载状态
        button.disabled = true;
        button.classList.add('p-disabled');

        try {
            await onClick();

            // 只有在 showSuccessToast 为 true 时才显示成功提示
            if (showSuccessToast) {
                app.extensionManager.toast.add({
                    severity: "success",
                    summary: "清理已清理完成",
                    life: 3000
                });
            }

        } catch (error) {
            // 显示错误提示
            app.extensionManager.toast.add({
                severity: "error",
                summary: "操作失败",
                detail: error.message || "操作过程中发生错误",
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
                    category: ["✨提示词小助手", "小助手功能开关", "总开关"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "关闭后，提示词小助手所有功能将禁用",
                    onChange: async (value) => {
                        try {
                            // 获取当前状态，用于判断是否是初始化
                            const currentState = window.FEATURES.enabled;

                            // 只有状态真正变化时才输出日志
                            if (currentState !== value) {
                                logger.log(`总开关状态变更 | 状态:${value ? "启用" : "禁用"}`);
                            } else {
                                // 如果状态没有变化，使用调试级别日志
                                logger.debug(`总开关状态保持不变 | 状态:${value ? "启用" : "禁用"}`);
                            }

                            // 更新全局状态
                            window.FEATURES.enabled = value;

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
                                await promptAssistantInstance.toggleGlobalFeature(true, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(true, currentState !== value);
                                }

                                // 只在状态真正变化且不是首次加载时记录日志和显示提示
                                if (currentState !== value) {
                                    logger.debug("功能启用完成");
                                    // 只在状态发生变化且不是首次加载时显示提示
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "info",
                                            summary: "提示词小助手已启用",
                                            life: 3000
                                        });
                                    }
                                }
                            } else {
                                // 禁用功能
                                await promptAssistantInstance.toggleGlobalFeature(false, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(false, currentState !== value);
                                }

                                // 只在状态真正变化且不是首次加载时记录日志和显示提示
                                if (currentState !== value) {
                                    logger.debug("功能禁用完成");
                                    // 只在状态发生变化且不是首次加载时显示提示
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "warn",
                                            summary: "提示词小助手已禁用",
                                            life: 3000
                                        });
                                    }
                                }
                            }

                            // 设置首次加载标志为 false，表示已经完成首次加载
                            isFirstLoad = false;
                        } catch (error) {
                            logger.error(`总开关切换异常 | 错误:${error.message}`);
                        }
                    }
                },

                // API 配置按钮
                {
                    id: "PromptAssistant.Features.APIConfig",
                    name: "百度和大语言模型API配置",
                    category: ["✨提示词小助手", " 配置", "API配置"],
                    tooltip: "配置或修改API信息",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton("API管理器", async () => {
                            showAPIConfigModal();
                        }, false); // 设置 showSuccessToast 为 false

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

                // 跳过代理直连开关
                {
                    id: "PromptAssistant.Settings.BypassProxy",
                    name: "跳过代理直连",
                    category: ["✨提示词小助手", " 配置", "网络设置"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "仅当开启代理时，智谱和硅基流动等国内服务使用报错时，再尝试打开。",
                    onChange: (value) => {
                        logger.log(`跳过代理直连 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 强制使用HTTP方式请求开关
                {
                    id: "PromptAssistant.Settings.ForceHTTP",
                    name: " HTTP API 接口",
                    category: ["✨提示词小助手", " 配置", "HTTP-API"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，制使用HTTP API接口请求。绕过OpenAI SDK的请求。",
                    onChange: (value) => {
                        logger.log(`强制使用HTTP方式请求 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 历史功能（包含历史、撤销、重做按钮）
                {
                    id: "PromptAssistant.Features.History",
                    name: "启用历史功能",
                    category: ["✨提示词小助手", "小助手功能开关", "历史功能"],
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
                    name: "启用标签工具",
                    category: ["✨提示词小助手", "小助手功能开关", "标签功能"],
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
                    name: "启用扩写功能",
                    category: ["✨提示词小助手", "小助手功能开关", "扩写功能"],
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
                    name: "启用翻译功能",
                    category: ["✨提示词小助手", "小助手功能开关", "翻译功能"],
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

                // 使用翻译缓存功能
                {
                    id: "PromptAssistant.Features.UseTranslateCache",
                    name: "使用翻译缓存",
                    category: ["✨提示词小助手", " 翻译功能设置", "翻译缓存"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启后，如果翻译内容翻译过，则使用历史翻译结果，避免相同内容重复翻译改变原意。如果需要重新翻译，请随便加一个空格即可跳过缓存。",
                    onChange: (value) => {
                        const oldValue = FEATURES.useTranslateCache;
                        FEATURES.useTranslateCache = value;
                        logger.log(`使用翻译缓存 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 翻译格式化选项
                {
                    id: "PromptAssistant.Features.TranslateFormatPunctuation",
                    name: "始终使用半角标点符号",
                    category: ["✨提示词小助手", " 翻译功能设置", "标点处理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会自动将中文标点符号替换成英文标点符号",
                    onChange: (value) => {
                        FEATURES.translateFormatPunctuation = value;
                        logger.log(`标点符号转换 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatSpace",
                    name: "自动移除多余空格",
                    category: ["✨提示词小助手", " 翻译功能设置", "空格处理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会自动移除多余空格",
                    onChange: (value) => {
                        FEATURES.translateFormatSpace = value;
                        logger.log(`移除多余空格 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatDots",
                    name: "移除多余连续点号",
                    category: ["✨提示词小助手", " 翻译功能设置", "点号处理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会将多余的“......”统一为“...”",
                    onChange: (value) => {
                        FEATURES.translateFormatDots = value;
                        logger.log(`处理连续点号 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatNewline",
                    name: "保留换行符",
                    category: ["✨提示词小助手", " 翻译功能设置", "换行处理"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "打开后，翻译结果会尽量保持原文的换行，避免翻译后丢失段落",
                    onChange: (value) => {
                        FEATURES.translateFormatNewline = value;
                        logger.log(`保留换行符 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 自动翻译功能 - 暂时禁用
                /*
                {
                    id: "PromptAssistant.Features.AutoTranslate",
                    name: "自动翻译",
                    category: ["✨提示词小助手", " 翻译功能设置", "自动翻译"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "开启后，工作流运行时将自动翻译CLIP节点的中文文本，前端显示保持不变",
                    onChange: (value) => {
                        const oldValue = FEATURES.autoTranslate;
                        FEATURES.autoTranslate = value;
                        handleFeatureChange('自动翻译', value, oldValue);
                        updateAutoTranslateIndicators(value);

                        logger.log(`自动翻译 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                */

                // 图像反推功能
                {
                    id: "PromptAssistant.Features.ImageCaption",
                    name: "启用图像反推功能",
                    category: ["✨提示词小助手", "小助手功能开关", "图像反推"],
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
                    category: ["✨提示词小助手", "系统", "日志级别"],
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
                    id: "PromptAssistant.Settings.IconOpacity",
                    name: " 小助手图标不透明度",
                    category: ["✨提示词小助手", "界面", "小助手图标"],
                    type: "slider",
                    min: 0,
                    max: 100,
                    step: 1,
                    defaultValue: 30,
                    tooltip: "设置折叠后小助手图标的不透明度",
                    onChange: (value) => {
                        // 将0-100的值转换为0-1的透明度
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.log(`小助手图标不透明度已更新 | 值:${value}% | 透明度:${opacity}`);
                    },
                    onLoad: (value) => {
                        // 初始化时应用默认值
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.debug(`小助手图标不透明度初始化 | 值:${value}% | 透明度:${opacity}`);
                    }
                },

                {
                    id: "PromptAssistant.Settings.ClearCache",
                    name: "清理历史、标签、翻译缓存",
                    category: ["✨提示词小助手", "系统", "清理缓存"],
                    tooltip: "清理所有缓存，包括历史记录、标签、翻译缓存",
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
                                TagCacheService.clearAllTagCache();

                                // 清理翻译缓存
                                TranslateCacheService.clearAllTranslateCache();

                                // 清理旧版本的标签缓存（以PromptAssistant_tag_cache_开头的所有记录）
                                Object.keys(localStorage)
                                    .filter(key => key.startsWith('PromptAssistant_tag_cache_'))
                                    .forEach(key => localStorage.removeItem(key));

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

                // 翻译方法选择
                {
                    id: "PromptAssistant.Settings.TranslateType",
                    name: "翻译方法",
                    category: ["✨提示词小助手", " 翻译功能设置", "翻译方法"],
                    type: "combo",
                    defaultValue: "baidu",
                    options: [
                        { text: "百度翻译", value: "baidu" },
                        { text: "大语言模型翻译", value: "llm" }
                    ],
                    tooltip: "可选百度机翻或者大语言模型翻译，注意：大语言模型翻译速度比较慢，格式可能会发生变化。",
                    onChange: (value) => {
                        // 直接修改 app.settings 对象
                        if (!app.settings) {
                            app.settings = {};
                        }
                        app.settings["PromptAssistant.Settings.TranslateType"] = value;
                        logger.debug("翻译方式已更新：" + value);
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
                        authorBadge.src = "https://img.shields.io/badge/Github-Yawiii-blue?style=flat&logo=github&logoColor=black&labelColor=%23FFFFFF&color=%2307A3D7";
                        authorBadge.style.display = "block";
                        authorBadge.style.height = "20px";
                        authorTag.appendChild(authorBadge);
                        cell.appendChild(authorTag);

                        // B站徽标
                        const biliTag = document.createElement("a");
                        biliTag.href = "https://space.bilibili.com/520680644";
                        biliTag.target = "_blank";
                        biliTag.style.textDecoration = "none";
                        biliTag.style.display = "flex";
                        biliTag.style.alignItems = "center";
                        const biliBadge = document.createElement("img");
                        biliBadge.alt = "Bilibili";
                        biliBadge.src = "https://img.shields.io/badge/%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7";
                        biliBadge.style.display = "block";
                        biliBadge.style.height = "20px";
                        biliTag.appendChild(biliBadge);
                        cell.appendChild(biliTag);
                        // 交流群徽标
                        const wechatTag = document.createElement("a");
                        // 取消跳转；点击不再打开链接，避免本地缓存链接
                        wechatTag.href = 'javascript:void(0)';
                        wechatTag.addEventListener('click', (e) => { e.preventDefault(); toggleWechatQr(); });
                        wechatTag.style.textDecoration = "none";
                        wechatTag.style.display = "flex";
                        wechatTag.style.alignItems = "center";
                        wechatTag.classList.add("has-tooltip", "pa-wechat-badge");
                        const wechatBadge = document.createElement("img");
                        wechatBadge.alt = "交流反馈群";
                        wechatBadge.src = "https://img.shields.io/badge/%E4%BA%A4%E6%B5%81%E5%8F%8D%E9%A6%88-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7";
                        wechatBadge.style.display = "block";
                        wechatBadge.style.height = "20px";
                        wechatTag.appendChild(wechatBadge);

                        // 悬浮显示二维码
                        const wechatQr = document.createElement("div");
                        wechatQr.className = "pa-wechat-qr";
                        const wechatQrImg = document.createElement("img");
                        // 优先加载远程二维码，失败则回退到本地备用图
                        const remoteQrUrl = 'http://data.xflow.cc/wechat.png';
                        let qrFallbackTimer = null;
                        const localQrUrl = ResourceManager.getAssetUrl('wechat.png');

                        // 每次显示时强制重新加载远程二维码（带时间戳），避免缓存
                        const loadWechatQr = () => {
                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                            wechatQrImg.dataset.fallbackApplied = '';
                            wechatQrImg.dataset.source = 'remote';
                            wechatQrImg.src = `${remoteQrUrl}?t=${Date.now()}`;
                            // 超时回退到本地，但需要判断图片是否已开始加载
                            qrFallbackTimer = setTimeout(() => {
                                // 检查是否已标记为已回退
                                if (wechatQrImg.dataset.fallbackApplied === '1') return;
                                
                                // 检查图片是否已开始加载（naturalHeight > 0 说明图片正在加载）
                                if (wechatQrImg.naturalHeight > 0) {
                                    Logger.log(2, '远程二维码加载中，延长等待时间');
                                    // 图片已开始加载，继续等待 onload，取消超时回退
                                    if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                                } else {
                                    // 图片未开始加载，可能是网络问题，回退到本地
                                    Logger.log(1, '远程二维码加载超时，切换到本地备用图');
                                    loadLocalQr();
                                }
                            }, 3000); // 延长到 3 秒，给远程图片更多加载时间
                        };
                        // 手动切换到本地二维码（带时间戳），清理超时
                        const loadLocalQr = () => {
                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                            wechatQrImg.dataset.fallbackApplied = '1';
                            wechatQrImg.dataset.source = 'local';
                            wechatQrImg.src = localQrUrl; // 本地图片固定，不加时间戳
                        };

                        // 点击徽标时在远程/本地之间来回切换
                        const toggleWechatQr = () => {
                            if (wechatQrImg.dataset.source === 'local') {
                                loadWechatQr();
                            } else {
                                loadLocalQr();
                            }
                        };


                        wechatQrImg.alt = "微信交流群二维码";
                        wechatQrImg.className = "pa-wechat-qr-img";

                        // 加载成功清理超时定时器
                        wechatQrImg.onload = () => { if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; } };

                        // 远程加载失败时回退到本地备用图（也带时间戳避免缓存）
                        wechatQrImg.onerror = () => {
                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
                            if (wechatQrImg.dataset.fallbackApplied !== '1') {
                                loadLocalQr();
                            }
                        };

                        // 初次渲染和每次鼠标进入都触发重新加载
                        loadWechatQr();
                        wechatTag.addEventListener('mouseenter', loadWechatQr);

                        wechatQr.appendChild(wechatQrImg);
                        wechatTag.appendChild(wechatQr);

                        cell.appendChild(wechatTag);

                        row.appendChild(cell);
                        return row;
                    }
                },

                // 规则配置按钮
                {
                    id: "PromptAssistant.Features.RulesConfig",
                    name: "扩写和反推规则修改",
                    category: ["✨提示词小助手", " 配置", "规则"],
                    tooltip: "可以自定义扩写规则，和反推提示词规则，使得提示词生成更加符合你的需求",
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton("规则管理器", async () => {
                            showRulesConfigModal();
                        }, false);

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
                        return row;
                    }
                },

                // 标签配置按钮
                {
                    id: "PromptAssistant.Features.TagsConfig",
                    name: "自定义和标签管理",
                    category: ["✨提示词小助手", " 配置", "标签管理"],
                    type: () => {
                        const row = document.createElement("tr");
                        row.className = "promptwidget-settings-row";

                        const labelCell = document.createElement("td");
                        labelCell.className = "comfy-menu-label";
                        row.appendChild(labelCell);

                        const buttonCell = document.createElement("td");
                        const button = createLoadingButton("标签管理器", async () => {
                            showTagsConfigModal();
                        }, false);

                        buttonCell.appendChild(button);
                        row.appendChild(buttonCell);
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