/**
 * 标签管理器
 * 负责管理标签的显示和操作
 */

import { logger } from '../utils/logger.js';
import { CacheService, TagCacheService } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { PopupManager } from "../utils/popupManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { EventManager } from "../utils/eventManager.js";
import { PromptFormatter } from "../utils/promptFormatter.js";
import { createSettingsDialog, showContextMenu, createConfirmPopup } from "./uiComponents.js";
/**
 * 标签管理器类
 * 管理标签弹窗和标签选择
 */
class TagManager {
    // ---UI状态持久化配置---
    static LAST_TAB_KEY = 'PromptAssistant_TagPopup_LastTab';           // 上次激活的标签页
    static ACCORDION_STATE_KEY = 'PromptAssistant_TagPopup_AccordionState'; // 手风琴展开状态
    static POPUP_SIZE_KEY = 'PromptAssistant_TagPopup_Size';            // 弹窗尺寸

    /**
     * 获取上次激活的标签页（分类名）
     */
    static getLastActiveTab() {
        try {
            return CacheService.get(this.LAST_TAB_KEY) || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 记录本次激活的标签页（分类名）
     */
    static setLastActiveTab(category) {
        try {
            if (category && typeof category === 'string') {
                CacheService.set(this.LAST_TAB_KEY, category);
            }
        } catch (e) { }
    }

    /**
     * 获取手风琴展开状态
     * @returns {Object} { tabName: { accordionPath: isExpanded } }
     */
    static getAccordionState() {
        try {
            const state = CacheService.get(this.ACCORDION_STATE_KEY);
            return state ? JSON.parse(state) : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * 保存手风琴展开状态
     * @param {string} tabName 标签页名称
     * @param {string} accordionPath 手风琴路径（用分类名表示）
     * @param {boolean} isExpanded 是否展开
     */
    static setAccordionState(tabName, accordionPath, isExpanded) {
        try {
            const state = this.getAccordionState();
            if (!state[tabName]) {
                state[tabName] = {};
            }
            state[tabName][accordionPath] = isExpanded;
            CacheService.set(this.ACCORDION_STATE_KEY, JSON.stringify(state));
        } catch (e) {
            logger.error(`保存手风琴状态失败: ${e.message}`);
        }
    }

    /**
     * 获取保存的弹窗尺寸
     * @returns {Object|null} { width: number, height: number }
     */
    static getPopupSize() {
        try {
            const size = CacheService.get(this.POPUP_SIZE_KEY);
            return size ? JSON.parse(size) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 保存弹窗尺寸
     * @param {number} width 宽度
     * @param {number} height 高度
     */
    static setPopupSize(width, height) {
        try {
            const size = { width, height };
            CacheService.set(this.POPUP_SIZE_KEY, JSON.stringify(size));
        } catch (e) {
            logger.error(`保存窗口大小失败: ${e.message}`);
        }
    }

    /**
     * 递归查找分类对象
     * @param {Object} obj 数据对象
     * @param {string} catName 分类名称
     * @returns {Object|null} 找到的分类对象或 null
     * @note 对于虚拟分类"标签"（仅在没有实际分类时使用），返回根对象本身
     */
    static _findCategoryRecursively(obj, catName) {
        if (!obj || typeof obj !== 'object') return null;
        // 虚拟分类"标签"代表根级别，返回根对象本身
        // 这个分类仅在 CSV 中没有任何实际分类，只有根标签时使用
        if (catName === "" || catName === "标签") return obj;

        for (const [key, value] of Object.entries(obj)) {
            if (key === catName && typeof value === 'object' && value !== null) {
                return value;
            }
            if (typeof value === 'object' && value !== null) {
                const result = this._findCategoryRecursively(value, catName);
                if (result) return result;
            }
        }
        return null;
    }

    /**
     * 递归查找标签及其父对象
     * @param {Object} obj 数据对象
     * @param {string} tagName 标签名称
     * @param {string} tagValue 标签值
     * @returns {Object|null} 包含 {parent, key} 的对象或 null
     */
    static _findTagRecursively(obj, tagName, tagValue) {
        if (!obj || typeof obj !== 'object') return null;

        for (const [key, value] of Object.entries(obj)) {
            if (key === tagName && value === tagValue) {
                return { parent: obj, key: key };
            }
            if (typeof value === 'object' && value !== null) {
                const result = this._findTagRecursively(value, tagName, tagValue);
                if (result) return result;
            }
        }
        return null;
    }
    static popupInstance = null;
    static onCloseCallback = null;  // 添加关闭回调存储
    static eventCleanups = [];      // 事件清理函数数组
    static searchTimeout = null;    // 搜索延迟定时器
    static currentNodeId = null;
    static currentInputId = null;
    static activeTooltip = null;
    static usedTags = new Map();    // 存储已使用标签的Map: key为标签值，value为对应的DOM元素
    static currentCsvFile = null;   // 当前选中的CSV文件
    static favorites = {};          // 收藏列表缓存 {name: value}
    static tagLookup = new Map();   // 标签值到名称的映射表
    static Sortable = null;         // Sortable 库引用
    static sortables = [];          // 存储 sortable 实例以供清理
    static tagData = null;          // 当前CSV文件的标签数据

    /**
     * 初始化 Sortable
     */
    static async _initSortable() {
        if (this.Sortable) return;
        try {
            this.Sortable = await ResourceManager.getSortable();
        } catch (error) {
            logger.warn('Sortable library not loaded', error);
        }
    }


    /**
     * 检查标签是否已插入到输入框中
     */
    static isTagUsed(tagValue, nodeId, inputId) {
        const mappingKey = `${nodeId}_${inputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];
        if (!mapping || !mapping.inputEl) return false;

        // 检查输入框内容是否包含标签的任一格式
        const inputValue = mapping.inputEl.value;
        return TagCacheService.isTagInInput(nodeId, inputId, tagValue, inputValue);
    }

    /**
     * 更新标签状态
     */
    static updateTagState(tagElement, isUsed) {
        if (isUsed) {
            tagElement.classList.add('used');
        } else {
            tagElement.classList.remove('used');
        }
    }

    /**
     * 处理标签点击
     */
    static handleTagClick(tagElement, tagName, tagValue, e) {
        // 阻止事件冒泡，确保弹窗不会关闭
        e.stopPropagation();

        // 获取输入框信息
        const mappingKey = `${this.currentNodeId}_${this.currentInputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];
        if (!mapping || !mapping.inputEl) return;

        const inputEl = mapping.inputEl;
        const inputValue = inputEl.value;

        // 判断标签是否已使用
        const isUsed = this.isTagUsed(tagValue, this.currentNodeId, this.currentInputId);

        try {
            if (isUsed) {
                // 标签已使用，移除
                // 确保移除tooltip
                this._hideTooltip();
                this.removeTag(tagValue, this.currentNodeId, this.currentInputId, true);
                this.updateTagState(tagElement, false);
                this.usedTags.delete(tagValue);

                // 立即更新所有标签页中的标签状态
                this.updateAllTagsState(this.currentNodeId, this.currentInputId);
                // 如果当前在搜索状态，也要更新搜索结果中的标签状态
                const searchResultList = document.querySelector('.tag_search_result_list');
                if (searchResultList) {
                    this.refreshSearchResultsState();
                }

                // logger.debug(`标签操作 | 动作:移除 | 标签:"${tagName}" | 原始值:"${tagValue}"`);
            } else {
                // 标签未使用，插入
                // 获取光标位置前后的文本
                const cursorPos = inputEl.selectionStart;
                const beforeText = inputValue.substring(0, cursorPos);
                const afterText = inputValue.substring(cursorPos);

                // 确定使用哪种格式
                const formatType = PromptFormatter.determineFormatType(beforeText, afterText);

                // 获取或创建标签格式
                let formats;
                const existingFormats = TagCacheService.getTagFormats(this.currentNodeId, this.currentInputId, tagValue);
                if (existingFormats) {
                    // 如果缓存中已有该标签的格式，直接使用缓存的格式
                    formats = existingFormats;
                } else {
                    // 如果缓存中没有，创建新的格式
                    formats = PromptFormatter.formatTag(tagValue);
                }

                // 根据formatType选择要插入的格式
                let insertFormat;
                switch (formatType) {
                    case 1:
                        insertFormat = formats.format1;
                        break;
                    case 2:
                        insertFormat = formats.format2;
                        break;
                    case 3:
                        insertFormat = formats.format3;
                        break;
                    case 4:
                        insertFormat = formats.format4;
                        break;
                    default:
                        insertFormat = formats.format2; // 默认使用格式2
                }

                // 如果是新创建的格式，添加到缓存
                if (!existingFormats) {
                    formats.insertedFormat = insertFormat;
                    TagCacheService.addTag(this.currentNodeId, this.currentInputId, tagValue, formats);
                } else {
                    // 如果是已存在的格式，更新insertedFormat
                    TagCacheService.updateInsertedFormat(this.currentNodeId, this.currentInputId, tagValue, insertFormat);
                }

                // 插入到光标位置
                UIToolkit.insertAtCursor(insertFormat, this.currentNodeId, this.currentInputId, {
                    highlight: true,
                    keepFocus: true
                });

                // 更新光标位置到插入内容之后
                setTimeout(() => {
                    if (inputEl === document.activeElement) {
                        const newPos = cursorPos + insertFormat.length;
                        inputEl.setSelectionRange(newPos, newPos);
                        inputEl.focus();
                    }
                }, 0);

                // 更新标签状态
                this.updateTagState(tagElement, true);
                this.usedTags.set(tagValue, tagElement);

                // 立即更新所有标签页中的标签状态
                this.updateAllTagsState(this.currentNodeId, this.currentInputId);
                // 如果当前在搜索状态，也要更新搜索结果中的标签状态
                const searchResultList = document.querySelector('.tag_search_result_list');
                if (searchResultList) {
                    this.refreshSearchResultsState();
                }

                // logger.debug(`标签操作 | 动作:插入 | 标签:"${tagName}" | 原始值:"${tagValue}" | 格式类型:${formatType} | 插入格式:"${insertFormat}"`);
            }
        } catch (error) {
            logger.error(`标签操作失败 | 标签:"${tagName}" | 错误:${error.message}`);
        }
    }

    /**
     * 从输入框中移除标签
     */
    static removeTag(tagValue, nodeId, inputId, keepFocus = true) {
        const mappingKey = `${nodeId}_${inputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];

        if (mapping && mapping.inputEl) {
            const inputEl = mapping.inputEl;
            const currentValue = inputEl.value;

            // 获取标签的所有格式
            const formatInfo = TagCacheService.getTagFormats(nodeId, inputId, tagValue);
            if (!formatInfo) return false;

            // 优先使用insertedFormat进行精确匹配
            if (formatInfo.insertedFormat) {
                const tagIndex = currentValue.indexOf(formatInfo.insertedFormat);
                if (tagIndex !== -1) {
                    // 直接使用精确替换，不进行额外的清理
                    const newValue = currentValue.substring(0, tagIndex) +
                        currentValue.substring(tagIndex + formatInfo.insertedFormat.length);

                    // 更新输入框值
                    inputEl.value = newValue;

                    // 触发事件
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                    if (keepFocus) {
                        inputEl.focus();
                    }

                    logger.debug(`标签移除 | 方式:精确匹配 | 标签:${tagValue} | 格式:"${formatInfo.insertedFormat}"`);
                    return true;
                }
            }

            // 如果insertedFormat不存在或未找到，按优先级尝试其他格式
            const removeOrder = ['format4', 'format3', 'format2', 'format1'];

            for (const formatKey of removeOrder) {
                const format = formatInfo[formatKey];
                if (!format) continue;

                const tagIndex = currentValue.indexOf(format);
                if (tagIndex !== -1) {
                    // 检查是否是独立的标签（前后是空格或标点）
                    const isValidRemoval = this._isValidTagRemoval(currentValue, tagIndex, format);
                    if (isValidRemoval) {
                        // 直接使用精确替换，不进行额外的清理
                        const newValue = currentValue.substring(0, tagIndex) +
                            currentValue.substring(tagIndex + format.length);

                        // 更新输入框值
                        inputEl.value = newValue;

                        // 触发事件
                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                        if (keepFocus) {
                            inputEl.focus();
                        }

                        logger.debug(`标签移除 | 方式:格式匹配 | 标签:${tagValue} | 格式:${formatKey}`);
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * 检查标签移除是否有效
     */
    static _isValidTagRemoval(value, index, format) {
        // 获取标签前后的字符
        const beforeChar = index > 0 ? value[index - 1] : '';
        const afterChar = index + format.length < value.length ? value[index + format.length] : '';

        // 检查前后字符是否是空格或标点
        const isValidChar = char => !char || char === ' ' || char === ',' || char === '.' || char === ';';

        return isValidChar(beforeChar) && isValidChar(afterChar);
    }

    /**
     * 清理标签移除后的文本
     */
    static _cleanupAfterRemoval(text, removePosition, removeLength) {
        // 获取移除位置前后的一小段文本进行清理
        const cleanRange = 10; // 清理范围（前后各10个字符）
        const startClean = Math.max(0, removePosition - cleanRange);
        const endClean = Math.min(text.length, removePosition + cleanRange);

        // 分割文本为三部分：前段、清理段、后段
        const beforeText = text.substring(0, startClean);
        let cleanText = text.substring(startClean, endClean);
        const afterText = text.substring(endClean);

        // 只清理中间部分
        cleanText = cleanText
            // 移除连续的逗号
            .replace(/,\s*,/g, ',')
            // 确保逗号后有一个空格
            .replace(/,(\S)/g, ', $1')
            // 移除多余的空格
            .replace(/\s+/g, ' ')
            .trim();

        // 重新组合文本
        let result = beforeText + cleanText + afterText;

        // 处理首尾
        if (removePosition === 0) {
            result = result.replace(/^\s*,\s*/, ''); // 如果标签在开头，移除开头的逗号和空格
        }
        if (removePosition + removeLength >= text.length) {
            result = result.replace(/\s*,\s*$/, ''); // 如果标签在结尾，移除结尾的逗号和空格
        }

        return result;
    }

    /**
     * 创建并显示tooltip
     */
    static _showTooltip(target, text) {
        // 移除已存在的tooltip
        this._hideTooltip();

        // 创建tooltip元素
        const tooltip = document.createElement('div');
        tooltip.className = 'tag_tooltip';
        tooltip.innerHTML = text; // 使用 innerHTML 以支持 HTML 内容
        document.body.appendChild(tooltip);

        // 获取目标元素的位置和尺寸
        const rect = target.getBoundingClientRect();

        // 计算tooltip位置
        const tooltipRect = tooltip.getBoundingClientRect();
        const left = rect.left + (rect.width - tooltipRect.width) / 2;
        const top = rect.top - tooltipRect.height - 8; // 8px的间距

        // 设置tooltip位置
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        // 保存当前tooltip引用
        this.activeTooltip = tooltip;
    }

    /**
     * 隐藏tooltip
     */
    static _hideTooltip() {
        if (this.activeTooltip) {
            this.activeTooltip.remove();
            this.activeTooltip = null;
        }
    }

    /**
     * 优化的手风琴切换方法 - 使用动态高度计算，解决跳帧问题
     */
    static _toggleAccordion(header, content, headerIcon) {
        const isExpanding = !header.classList.contains('active');

        // 防止重复触发动画
        if (content.dataset.animating === 'true') {
            return;
        }

        // 标记动画状态
        content.dataset.animating = 'true';

        if (isExpanding) {
            // 展开手风琴
            header.classList.add('active');
            content.classList.add('active');

            // 临时移除过渡效果来测量高度
            content.style.transition = 'none';
            content.style.maxHeight = 'none';
            content.style.overflow = 'visible';
            content.style.padding = '2px 0'; // 确保padding正确

            // 强制回流并获取准确高度
            void content.offsetHeight;
            const contentHeight = content.scrollHeight;

            // 设置动画起始状态
            content.style.maxHeight = '0px';
            content.style.padding = '0';
            content.style.overflow = 'hidden';

            // 再次强制回流
            void content.offsetHeight;

            // 启用过渡效果并开始动画
            content.style.transition = 'max-height 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), padding 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

            // 使用requestAnimationFrame确保动画平滑
            requestAnimationFrame(() => {
                content.style.maxHeight = contentHeight + 'px';
                content.style.padding = '2px 0';
            });

            // 监听动画结束事件
            const handleTransitionEnd = (e) => {
                if (e.target === content && e.propertyName === 'max-height') {
                    content.removeEventListener('transitionend', handleTransitionEnd);

                    // 动画完成后的清理工作
                    if (content.classList.contains('active')) {
                        content.style.maxHeight = 'none';
                        content.style.overflow = 'visible';
                        content.style.transition = '';
                    }

                    // 清除动画状态标记
                    content.dataset.animating = 'false';
                }
            };

            content.addEventListener('transitionend', handleTransitionEnd);

            // 备用清理机制（防止事件未触发）
            setTimeout(() => {
                if (content.dataset.animating === 'true') {
                    content.dataset.animating = 'false';
                    if (content.classList.contains('active')) {
                        content.style.maxHeight = 'none';
                        content.style.overflow = 'visible';
                        content.style.transition = '';
                    }
                }
            }, 250); // 调整为0.2s + 50ms缓冲

        } else {
            // 收起手风琴
            // 立即移除header的active类以更新视觉状态
            header.classList.remove('active');

            // 获取当前高度作为动画起点
            const currentHeight = content.scrollHeight;

            // 设置起始状态
            content.style.transition = 'none';
            content.style.maxHeight = currentHeight + 'px';
            content.style.overflow = 'hidden';

            // 强制回流
            void content.offsetHeight;

            // 启用过渡效果
            content.style.transition = 'max-height 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), padding 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

            // 使用requestAnimationFrame确保动画平滑
            requestAnimationFrame(() => {
                content.style.maxHeight = '0px';
                content.style.padding = '0';
            });

            // 监听动画结束事件
            const handleTransitionEnd = (e) => {
                if (e.target === content && e.propertyName === 'max-height') {
                    content.removeEventListener('transitionend', handleTransitionEnd);

                    // 动画完成后移除active类和清理样式
                    content.classList.remove('active');
                    content.style.transition = '';
                    content.style.maxHeight = '';
                    content.style.padding = '';
                    content.style.overflow = '';

                    // 清除动画状态标记
                    content.dataset.animating = 'false';
                }
            };

            content.addEventListener('transitionend', handleTransitionEnd);

            // 备用清理机制（防止事件未触发）
            setTimeout(() => {
                if (content.dataset.animating === 'true') {
                    content.dataset.animating = 'false';
                    content.classList.remove('active');
                    content.style.transition = '';
                    content.style.maxHeight = '';
                    content.style.padding = '';
                    content.style.overflow = '';
                }
            }, 250); // 调整为0.2s + 50ms缓冲
        }

        // 切换图标旋转
        const arrowIcon = headerIcon.querySelector('.pi.pi-chevron-down, .accordion_arrow_icon');
        if (arrowIcon) {
            arrowIcon.classList.toggle('rotate-180');
        }
    }

    /**
     * 递归创建标签结构
     * @param {Object} data 数据对象
     * @param {string} level 层级
     * @param {string} tabName 标签页名称（用于恢复状态）
     */
    static _createAccordionContent(data, level = '0', tabName = null, categoryName = null) {
        // 如果是顶级（一级分类），则创建标签页结构
        if (level === '0') {
            // 创建外层容器
            const container = document.createElement('div');
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.height = '100%';
            container.style.overflow = 'hidden';

            // 创建标签页容器
            const tabsContainer = document.createElement('div');
            tabsContainer.className = 'popup_tabs_container';

            // 创建标签滚动区域
            const tabsScroll = document.createElement('div');
            tabsScroll.className = 'popup_tabs_scroll';

            // 创建标签栏
            const tabs = document.createElement('div');
            tabs.className = 'popup_tabs';

            // 创建内容区域
            const tabContents = document.createElement('div');
            tabContents.className = 'tag_category_container';
            tabContents.style.overflow = 'hidden';
            tabContents.style.display = 'flex';
            tabContents.style.flexDirection = 'column';
            tabContents.style.flex = '1'; // 确保内容区域占满剩余空间
            tabContents.style.minHeight = '0'; // 允许flex收缩
            tabContents.style.flex = '1'; // 确保内容区域占满剩余空间
            tabContents.style.minHeight = '0'; // 允许flex收缩

            // 获取所有一级分类和标签
            const categories = Object.keys(data);

            // 分离根级别标签（字符串值）和实际分类（对象值）
            // 注意：我们只在渲染时分离，不修改原始 data 对象
            const rootTags = {};
            const actualCategories = [];
            categories.forEach(key => {
                if (typeof data[key] === 'string') {
                    rootTags[key] = data[key];
                } else {
                    actualCategories.push(key);
                }
            });

            // 如果没有分类且没有根标签，返回空容器
            if (actualCategories.length === 0 && Object.keys(rootTags).length === 0) {
                const emptyContainer = document.createElement('div');
                emptyContainer.className = 'tag_category_container';
                return emptyContainer;
            }

            // 创建左右滚动指示器
            const leftIndicator = document.createElement('div');
            leftIndicator.className = 'tabs_scroll_indicator left';

            // 添加图标
            const leftIconSpan = document.createElement('span');
            leftIconSpan.className = 'pi pi-angle-left scroll_indicator_icon';
            leftIndicator.appendChild(leftIconSpan);
            leftIndicator.style.display = 'none'; // 初始隐藏

            const rightIndicator = document.createElement('div');
            rightIndicator.className = 'tabs_scroll_indicator right';

            // 添加图标
            const rightIconSpan = document.createElement('span');
            rightIconSpan.className = 'pi pi-angle-right scroll_indicator_icon';
            rightIndicator.appendChild(rightIconSpan);
            rightIndicator.style.display = 'none'; // 初始隐藏

            // 更新指示器状态的函数
            const updateIndicators = () => {
                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
                if (!canScroll) {
                    leftIndicator.style.display = 'none';
                    rightIndicator.style.display = 'none';
                    return;
                }
                // 使用更大的阈值（5像素）确保边界情况下能正确隐藏
                const scrollLeft = tabsScroll.scrollLeft;
                const maxScroll = tabsScroll.scrollWidth - tabsScroll.clientWidth;

                // 移除高频滚动调试日志

                leftIndicator.style.display = scrollLeft > 5 ? 'flex' : 'none';
                rightIndicator.style.display = scrollLeft < (maxScroll - 5) ? 'flex' : 'none';
            };

            // 添加指示器点击事件 - 每次滚动一个标签
            const leftClickCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
                // 获取所有标签
                const allTabs = tabs.querySelectorAll('.popup_tab');
                if (allTabs.length === 0) return;

                // 找到当前第一个可见的标签
                const scrollRect = tabsScroll.getBoundingClientRect();
                let firstVisibleTab = null;

                for (const tab of allTabs) {
                    const tabRect = tab.getBoundingClientRect();
                    // 如果标签的右边缘在可视区域内，说明它至少部分可见
                    if (tabRect.right > scrollRect.left + 10) {
                        firstVisibleTab = tab;
                        break;
                    }
                }

                // 找到前一个标签
                if (firstVisibleTab) {
                    const currentIndex = Array.from(allTabs).indexOf(firstVisibleTab);
                    if (currentIndex > 0) {
                        const prevTab = allTabs[currentIndex - 1];
                        prevTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                        // 滚动完成后更新指示器状态（使用更长的延迟确保动画完成）
                        setTimeout(updateIndicators, 600);
                    }
                }
            });

            const rightClickCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
                // 获取所有标签
                const allTabs = tabs.querySelectorAll('.popup_tab');
                if (allTabs.length === 0) return;

                // 找到当前最后一个可见的标签
                const scrollRect = tabsScroll.getBoundingClientRect();
                let lastVisibleTab = null;

                for (let i = allTabs.length - 1; i >= 0; i--) {
                    const tab = allTabs[i];
                    const tabRect = tab.getBoundingClientRect();
                    // 如果标签的左边缘在可视区域内，说明它至少部分可见
                    if (tabRect.left < scrollRect.right - 10) {
                        lastVisibleTab = tab;
                        break;
                    }
                }

                // 找到下一个标签
                if (lastVisibleTab) {
                    const currentIndex = Array.from(allTabs).indexOf(lastVisibleTab);
                    if (currentIndex < allTabs.length - 1) {
                        const nextTab = allTabs[currentIndex + 1];
                        nextTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
                        // 滚动完成后更新指示器状态（使用更长的延迟确保动画完成）
                        setTimeout(updateIndicators, 600);
                    }
                }
            });

            // 监听滚动事件，显示/隐藏滚动指示器
            const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', updateIndicators);

            // 监听窗口大小调整事件
            const resizeObserver = new ResizeObserver(() => {
                updateIndicators();
            });
            resizeObserver.observe(popup);

            // 添加清理函数
            const resizeCleanup = () => {
                resizeObserver.disconnect();
            };

            this.eventCleanups.push(leftClickCleanup, rightClickCleanup, scrollCleanup, resizeCleanup);

            // 初始检测是否需要滚动指示器，并自动定位到激活的标签页
            setTimeout(() => {
                // 检查是否需要滚动
                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;

                if (canScroll) {
                    // 找到激活的标签页
                    const activeTab = tabs.querySelector('.popup_tab.active');
                    if (activeTab) {
                        // 将激活的标签页滚动到可见区域
                        activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
                    }

                    // 等待滚动完成后，更新滚动指示器显示状态
                    setTimeout(updateIndicators, 50);
                }
            }, 100);

            // 如果没有实际分类但有根标签，创建一个默认 Tab 来显示它们
            const finalCategories = actualCategories.length > 0 ? actualCategories : (Object.keys(rootTags).length > 0 ? ["标签"] : []);

            // 为每个分类创建标签和内容
            finalCategories.forEach((category, index) => {
                // 创建标签
                const tab = document.createElement('div');
                tab.className = 'popup_tab';
                tab.textContent = category;
                tab.setAttribute('data-category', category);

                // 第一个标签默认激活
                if (index === 0) {
                    tab.classList.add('active');
                }

                // 添加标签点击事件
                const tabClickCleanup = EventManager.addDOMListener(tab, 'click', (e) => {
                    // 获取当前激活的标签
                    const currentActiveTab = tabs.querySelector('.popup_tab.active');

                    // 如果点击的是当前激活的标签，不做任何处理
                    if (currentActiveTab === tab) return;

                    // 为当前激活的标签添加退出动画
                    if (currentActiveTab) {
                        currentActiveTab.classList.add('exiting');
                        // 监听动画结束
                        const animationEndHandler = () => {
                            currentActiveTab.classList.remove('active', 'exiting');
                            currentActiveTab.removeEventListener('transitionend', animationEndHandler);
                        };
                        currentActiveTab.addEventListener('transitionend', animationEndHandler);
                    }

                    // 移除所有内容的active类
                    tabContents.querySelectorAll('.popup_tab_content').forEach(c => {
                        c.classList.remove('active');
                        c.style.display = 'none';
                    });

                    // 添加当前标签的active类
                    tab.classList.add('active');

                    // 添加对应内容的active类
                    const contentId = tab.getAttribute('data-category');
                    const content = tabContents.querySelector(`.popup_tab_content[data-category="${contentId}"]`);
                    if (content) {
                        content.classList.add('active');
                        content.style.display = 'flex';
                        content.style.flexDirection = 'column';
                    }

                    // 改进滚动逻辑：确保选中的标签完全可见
                    const tabRect = tab.getBoundingClientRect();
                    const scrollRect = tabsScroll.getBoundingClientRect();

                    // 检查标签是否完全在可视区域内
                    const isFullyVisible =
                        tabRect.left >= scrollRect.left &&
                        tabRect.right <= scrollRect.right;

                    if (!isFullyVisible) {
                        // 如果标签在左侧不完全可见
                        if (tabRect.left < scrollRect.left) {
                            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                        }
                        // 如果标签在右侧不完全可见
                        else if (tabRect.right > scrollRect.right) {
                            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
                        }
                    }
                });

                this.eventCleanups.push(tabClickCleanup);
                tabs.appendChild(tab);

                // 创建对应的内容区域
                const content = document.createElement('div');
                content.className = 'popup_tab_content';
                content.setAttribute('data-category', category);
                content.style.flex = '1';
                content.style.display = 'none';
                content.style.minHeight = '0'; // 允许flex收缩
                content.style.overflow = 'auto'; // 确保内容溢出时显示滚动条

                // 第一个内容默认显示
                if (index === 0) {
                    content.classList.add('active');
                    content.style.display = 'flex';
                    content.style.flexDirection = 'column';
                }

                // 获取该分类的数据
                // 如果是"标签"虚拟分类（仅在没有实际分类时使用），使用根标签作为数据
                const categoryData = category === "标签" ? rootTags : data[category];

                if (typeof categoryData === 'object' && categoryData !== null) {
                    // 使用 _createInnerAccordion，它已经支持混合内容（标签+子分类）
                    const innerContent = this._createInnerAccordion(categoryData, '1', category, category);
                    content.appendChild(innerContent);
                }

                tabContents.appendChild(content);
            });

            // ---在 Tab 栏末尾添加"新建分类"按钮---
            const addTabButton = document.createElement('div');
            addTabButton.className = 'popup_tab add_category_tab';
            addTabButton.title = '新建分类';

            const addTabIcon = document.createElement('span');
            addTabIcon.className = 'pi pi-plus';
            addTabButton.appendChild(addTabIcon);

            const addTabClickCleanup = EventManager.addDOMListener(addTabButton, 'click', (e) => {
                e.stopPropagation();
                this._handleAddCategory(addTabButton, null, tabs, tabContents, data);
            });
            this.eventCleanups.push(addTabClickCleanup);
            tabs.appendChild(addTabButton);

            // 组装标签页结构
            tabsScroll.appendChild(tabs);
            tabsContainer.appendChild(leftIndicator);
            tabsContainer.appendChild(tabsScroll);
            tabsContainer.appendChild(rightIndicator);

            // 组装容器
            container.appendChild(tabsContainer);
            container.appendChild(tabContents);

            return container;
        } else {
            // 非顶级分类使用普通容器
            const container = document.createElement('div');
            container.className = 'tag_category_container';
            container.style.overflow = 'visible'; // 移除滚动条，让父容器处理

            // 跟踪当前层级的第一个手风琴
            let isFirstAccordionInLevel = true;

            for (const [key, value] of Object.entries(data)) {
                // 如果值是字符串，说明是标签
                if (typeof value === 'string') {
                    const tagItem = this._createTagElement(key, value, categoryName);
                    container.appendChild(tagItem);
                }
                // 递归处理下一级
                else if (typeof value === 'object' && value !== null) {
                    const accordion = document.createElement('div');
                    accordion.className = 'tag_accordion';
                    accordion.setAttribute('data-category', key);
                    accordion.setAttribute('data-level', level);

                    const header = document.createElement('div');
                    header.className = 'tag_accordion_header';

                    const headerTitle = document.createElement('div');
                    headerTitle.className = 'tag_accordion_title';
                    headerTitle.textContent = key;

                    const headerIcon = document.createElement('div');
                    headerIcon.className = 'tag_accordion_icon';

                    // 添加加号图标（创建新标签）
                    const addIconSpan = document.createElement('span');
                    addIconSpan.className = 'pi pi-plus accordion_add_icon';
                    addIconSpan.title = '在此分类下创建新标签';
                    headerIcon.appendChild(addIconSpan);

                    // 添加箭头图标
                    const arrowIconSpan = document.createElement('span');
                    arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
                    headerIcon.appendChild(arrowIconSpan);

                    // 添加加号图标点击事件
                    const addIconCleanup = EventManager.addDOMListener(addIconSpan, 'click', (e) => {
                        e.stopPropagation(); // 阻止事件冒泡，避免触发手风琴展开/收起
                        this._handleAddTag(key, categoryName || key);
                    });
                    this.eventCleanups.push(addIconCleanup);

                    header.appendChild(headerTitle);
                    header.appendChild(headerIcon);

                    // 添加拖拽时自动展开功能
                    let hoverTimer = null;
                    const dragOverCleanup = EventManager.addDOMListener(header, 'dragover', (e) => {
                        e.preventDefault(); // 必须阻止默认行为才能响应 drop/dragover
                        // 检查是否有正在拖拽的标签
                        const draggingTag = document.querySelector('.tag_item.tag-dragging');
                        if (draggingTag && !header.classList.contains('active')) {
                            if (!hoverTimer) {
                                hoverTimer = setTimeout(() => {
                                    logger.debug(`[AutoExpand] 拖拽悬停自动展开: ${key}`);
                                    header.click();
                                    hoverTimer = null;
                                }, 500); // 500ms 延迟
                            }
                        }
                    });

                    const dragLeaveCleanup = EventManager.addDOMListener(header, 'dragleave', () => {
                        if (hoverTimer) {
                            clearTimeout(hoverTimer);
                            hoverTimer = null;
                        }
                    });
                    // 还要处理 drop 事件，防止计时器残留
                    const dropCleanup = EventManager.addDOMListener(header, 'drop', () => {
                        if (hoverTimer) {
                            clearTimeout(hoverTimer);
                            hoverTimer = null;
                        }
                    });

                    this.eventCleanups.push(dragOverCleanup, dragLeaveCleanup, dropCleanup);

                    const content = document.createElement('div');
                    content.className = 'tag_accordion_content';

                    // 递归创建子内容，传递 tabName
                    const childContent = this._createAccordionContent(value, (parseInt(level) + 1).toString(), tabName, key);
                    content.appendChild(childContent);

                    // 根据保存的状态或默认行为确定是否展开
                    const accordionState = this.getAccordionState();
                    const shouldExpand = tabName && accordionState[tabName]?.[key] !== undefined
                        ? accordionState[tabName][key]  // 使用保存的状态
                        : isFirstAccordionInLevel;       // 默认展开第一个

                    if (shouldExpand) {
                        header.classList.add('active');
                        content.classList.add('active');
                        const arrowIconSpan = headerIcon.querySelector('.accordion_arrow_icon');
                        if (arrowIconSpan) {
                            arrowIconSpan.classList.add('rotate-180');
                        }
                        if (!tabName || !accordionState[tabName]?.[key]) {
                            // 只有在使用默认行为时才更新标志
                            isFirstAccordionInLevel = false;
                        }
                    }

                    // 添加手风琴切换事件
                    const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
                        e.stopPropagation();

                        // 获取当前手风琴的层级
                        const currentLevel = accordion.getAttribute('data-level');
                        // 获取当前标签页下的所有同级手风琴
                        const parentTab = header.closest('.popup_tab_content');
                        if (parentTab) {
                            // 只关闭同级别的其他手风琴
                            const siblingAccordions = parentTab.querySelectorAll(`.tag_accordion[data-level="${currentLevel}"] .tag_accordion_header.active`);
                            if (!header.classList.contains('active')) {
                                siblingAccordions.forEach(otherHeader => {
                                    if (otherHeader !== header) {
                                        // 获取父级手风琴
                                        const parentAccordion = otherHeader.closest('.tag_accordion');
                                        // 确保是同级的手风琴
                                        if (parentAccordion && parentAccordion.getAttribute('data-level') === currentLevel) {
                                            const otherContent = otherHeader.nextElementSibling;
                                            const otherHeaderIcon = otherHeader.querySelector('.tag_accordion_icon');
                                            // 使用优化的切换方法关闭其他手风琴
                                            if (otherHeader.classList.contains('active')) {
                                                this._toggleAccordion(otherHeader, otherContent, otherHeaderIcon);
                                                // 保存关闭状态
                                                const otherAccordionCategory = parentAccordion.getAttribute('data-category');
                                                const otherTabName = parentTab.getAttribute('data-category');
                                                if (otherTabName && otherAccordionCategory) {
                                                    this.setAccordionState(otherTabName, otherAccordionCategory, false);
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                        }

                        // 使用优化的切换方法切换当前手风琴
                        this._toggleAccordion(header, content, headerIcon);

                        // 保存当前手风琴状态
                        const accordionCategory = accordion.getAttribute('data-category');
                        const tabName = parentTab?.getAttribute('data-category');
                        if (tabName && accordionCategory) {
                            const isExpanded = header.classList.contains('active');
                            this.setAccordionState(tabName, accordionCategory, isExpanded);
                        }
                    });

                    this.eventCleanups.push(accordionCleanup);

                    accordion.appendChild(header);
                    accordion.appendChild(content);
                    container.appendChild(accordion);
                }
            }

            // 初始化拖拽排序（如果有 Sortable）
            // 分别处理手风琴排序和标签排序
            if (this.Sortable) {
                // 检测容器内容类型
                const hasAccordions = container.querySelector(':scope > .tag_accordion') !== null;
                const hasTags = container.querySelector(':scope > .tag_item') !== null;

                // 手风琴排序
                if (hasAccordions) {
                    const accordionSortable = new this.Sortable(container, {
                        group: { name: 'accordions', pull: false, put: false },
                        animation: 150,
                        ghostClass: 'tag-ghost',
                        handle: '.tag_accordion_header',
                        draggable: '.tag_accordion',
                        delay: 50,
                        onEnd: async (evt) => {
                            const { oldIndex, newIndex } = evt;
                            if (oldIndex === newIndex) return;

                            const newOrderKeys = [];
                            Array.from(container.children).forEach(el => {
                                if (el.classList.contains('tag_accordion')) {
                                    const cat = el.getAttribute('data-category');
                                    if (cat) newOrderKeys.push(cat);
                                }
                            });

                            const tempObj = { ...data };
                            for (const key in data) delete data[key];

                            newOrderKeys.forEach(key => {
                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                    data[key] = tempObj[key];
                                }
                            });

                            for (const key in tempObj) {
                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                    data[key] = tempObj[key];
                                }
                            }

                            await this._saveTagOrder(data, tabName, categoryName);
                        }
                    });
                    this.sortables.push(accordionSortable);
                }

                // 标签排序（支持跨分类拖拽）
                // 始终初始化标签 Sortable，确保空分类或只有子分类的容器也能接收标签
                if (true) {
                    // 为容器添加分类标识，用于跨分类拖拽时识别
                    container.setAttribute('data-sortable-category', categoryName || tabName);
                    // 确保容器有最小高度，以便空容器也能因 drop-zone 样式而被看到
                    container.style.minHeight = '10px';

                    const tagSortable = new this.Sortable(container, {
                        group: {
                            name: 'tags',
                            pull: true,
                            put: function (to) {
                                // 如果目标容器包含手风琴，则不允许放入标签
                                return to.el.querySelector(':scope > .tag_accordion') === null;
                            }
                        }, // 允许跨分类拖拽
                        animation: 150,
                        ghostClass: 'tag-ghost',
                        draggable: '.tag_item',
                        delay: 50,
                        onStart: function (evt) {
                            evt.item.classList.add('tag-dragging');
                            // 高亮所有可放置的分类容器（仅限底层容器）
                            document.querySelectorAll('[data-sortable-category]').forEach(el => {
                                if (el !== evt.from && !el.querySelector(':scope > .tag_accordion')) {
                                    el.classList.add('tag-drop-zone');
                                }
                            });
                        },
                        onEnd: async (evt) => {
                            evt.item.classList.remove('tag-dragging');
                            // 移除高亮
                            document.querySelectorAll('.tag-drop-zone').forEach(el => {
                                el.classList.remove('tag-drop-zone');
                            });

                            // 如果是跨分类移动，由 onAdd 处理
                            if (evt.from !== evt.to) return;

                            const { oldIndex, newIndex } = evt;
                            if (oldIndex === newIndex) return;

                            const newOrderKeys = [];
                            Array.from(container.children).forEach(el => {
                                if (el.classList.contains('tag_item')) {
                                    const name = el.getAttribute('data-name');
                                    if (name) newOrderKeys.push(name);
                                }
                            });

                            const tempObj = { ...data };
                            for (const key in data) delete data[key];

                            newOrderKeys.forEach(key => {
                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                    data[key] = tempObj[key];
                                }
                            });

                            for (const key in tempObj) {
                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                    data[key] = tempObj[key];
                                }
                            }

                            await this._saveTagOrder(data, tabName, categoryName);
                        },
                        onAdd: async (evt) => {
                            // 跨分类移动标签
                            const tagItem = evt.item;
                            const tagName = tagItem.getAttribute('data-name');
                            const tagValue = tagItem.getAttribute('data-value');
                            const fromCategory = evt.from.getAttribute('data-sortable-category');
                            const toCategory = evt.to.getAttribute('data-sortable-category');

                            logger.debug(`[onAdd(root)] 开始移动标签: ${tagName}, 从: ${fromCategory}, 到: ${toCategory}`);

                            // 更新标签元素的分类属性
                            tagItem.setAttribute('data-category', toCategory);

                            // 调用移动函数 (不立即保存，等待排序)
                            const success = await this._moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, false);

                            logger.debug(`[onAdd(root)] 移动结果: ${success}`);

                            if (!success) {
                                // 如果移动失败，将标签移回原位置
                                logger.warn(`[onAdd(root)] 移动失败，回滚 DOM`);
                                evt.from.appendChild(tagItem);
                            } else {
                                // 移动成功，现在根据 DOM 顺序重新排序并保存

                                // 获取新的 DOM 顺序
                                const newOrderKeys = [];
                                Array.from(evt.to.children).forEach(el => {
                                    if (el.classList.contains('tag_item')) {
                                        const name = el.getAttribute('data-name');
                                        if (name) newOrderKeys.push(name);
                                    }
                                });

                                // 重构 data 对象
                                const tempObj = { ...data };
                                for (const key in data) delete data[key];

                                newOrderKeys.forEach(key => {
                                    if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                        data[key] = tempObj[key];
                                    }
                                });

                                // 确保没有遗漏
                                for (const key in tempObj) {
                                    if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                        data[key] = tempObj[key];
                                    }
                                }

                                // 保存排序后的数据
                                await this._saveTagOrder(data, tabName, toCategory);

                                // 显示成功提示
                                logger.debug(`[标签移动(root)] 成功并排序 | 标签: ${tagName} | 到: ${toCategory}`);
                                app.extensionManager.toast.add({
                                    severity: "success",
                                    summary: "移动成功",
                                    detail: `标签 "${tagName}" 已移动到 "${toCategory}"`,
                                    life: 2000
                                });
                            }
                        }
                    });
                    this.sortables.push(tagSortable);
                }
            }

            return container;
        }
    }

    /**
     * 为二级分类创建手风琴元素
     */
    static _createAccordionElement(key, value, level) {
        const accordion = document.createElement('div');
        accordion.className = 'tag_accordion';

        accordion.setAttribute('data-category', key);

        const header = document.createElement('div');
        header.className = 'tag_accordion_header';

        const headerTitle = document.createElement('div');
        headerTitle.className = 'tag_accordion_title';
        headerTitle.textContent = key;

        const headerIcon = document.createElement('div');
        headerIcon.className = 'tag_accordion_icon';

        // 创建图标元素
        const arrowIconSpan = document.createElement('span');
        arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
        headerIcon.appendChild(arrowIconSpan);

        header.appendChild(headerTitle);
        header.appendChild(headerIcon);

        const content = document.createElement('div');
        content.className = 'tag_accordion_content';

        // 递归创建子内容
        const childContent = this._createInnerAccordion(data, (parseInt(level) + 1).toString(), tabName, categoryName);
        accordion.appendChild(childContent);

        // 添加手风琴切换事件，包含关闭其他手风琴的逻辑
        const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
            e.stopPropagation();
            // 获取当前标签页下的所有手风琴
            const parentTab = header.closest('.popup_tab_content');
            if (parentTab) {
                if (!header.classList.contains('active')) {
                    const otherAccordions = parentTab.querySelectorAll('.tag_accordion_header.active');
                    otherAccordions.forEach(otherHeader => {
                        if (otherHeader !== header) {
                            otherHeader.classList.remove('active');
                            const otherContent = otherHeader.nextElementSibling;
                            if (otherContent && otherContent.classList.contains('active')) {
                                otherContent.classList.remove('active');
                            }
                            const otherIcon = otherHeader.querySelector('.accordion_arrow_icon');
                            if (otherIcon) {
                                otherIcon.classList.add('rotate-180');
                            }
                        }
                    });
                }
            }
            // 切换当前手风琴状态
            header.classList.toggle('active');
            content.classList.toggle('active');
            // 图标旋转
            const toggleArrowIcon = headerIcon.querySelector('.accordion_arrow_icon');
            if (toggleArrowIcon) {
                if (header.classList.contains('active')) {
                    toggleArrowIcon.classList.add('rotate-180');
                } else {
                    toggleArrowIcon.classList.remove('rotate-180');
                }
            }
        });
        this.eventCleanups.push(accordionCleanup);

        accordion.appendChild(header);
        accordion.appendChild(content);

        // 默认展开第一个手风琴（根据父元素的位置）
        if (accordion.parentElement && accordion.parentElement.firstChild === accordion) {
            header.classList.add('active');
            content.classList.add('active');
        }

        return accordion;
    }

    /**
     * 为二级分类创建内容
     * @param {Object} data 数据对象
     * @param {string} level 层级
     * @param {string} tabName 标签页名称（用于恢复状态）
     */
    static _createInnerAccordion(data, level, tabName = null, categoryName = null) {
        const container = document.createElement('div');
        container.className = 'tag_category_container';
        container.style.flex = '1';
        container.style.overflow = 'visible'; // 移除滚动条，让父容器处理
        container.style.minHeight = '0'; // 允许flex收缩

        // 跟踪是否为第一个手风琴
        let isFirstAccordion = true;

        for (const [key, value] of Object.entries(data)) {
            // 如果值是对象，创建新的手风琴
            if (typeof value === 'object' && value !== null) {
                const accordion = document.createElement('div');
                accordion.className = 'tag_accordion';
                accordion.setAttribute('data-category', key);
                const header = document.createElement('div');
                header.className = 'tag_accordion_header';

                const headerTitle = document.createElement('div');
                headerTitle.className = 'tag_accordion_title';
                headerTitle.textContent = key;

                const headerIcon = document.createElement('div');
                headerIcon.className = 'tag_accordion_icon';

                // 添加加号图标（创建新标签）- 收藏页面不显示
                if (tabName !== 'favorites') {
                    const addIconSpan = document.createElement('span');
                    addIconSpan.className = 'pi pi-plus accordion_add_icon';
                    addIconSpan.title = '在此分类下创建新标签';
                    headerIcon.appendChild(addIconSpan);

                    // 添加加号图标点击事件
                    const addIconCleanup = EventManager.addDOMListener(addIconSpan, 'click', (e) => {
                        e.stopPropagation(); // 阻止事件冒泡，避免触发手风琴展开/收起
                        this._handleAddTag(key, categoryName || key, addIconSpan);
                    });
                    this.eventCleanups.push(addIconCleanup);
                }

                // 添加箭头图标
                const arrowIconSpan = document.createElement('span');
                arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
                headerIcon.appendChild(arrowIconSpan);

                header.appendChild(headerTitle);
                header.appendChild(headerIcon);

                // 添加右键菜单事件（收藏页面不显示）
                if (tabName !== 'favorites') {
                    const headerContextMenuCleanup = EventManager.addDOMListener(header, 'contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._showCategoryContextMenu(e, key, false, tabName);
                    });
                    this.eventCleanups.push(headerContextMenuCleanup);
                }

                // 添加拖拽时自动展开功能
                let hoverTimer = null;
                const dragOverCleanup = EventManager.addDOMListener(header, 'dragover', (e) => {
                    e.preventDefault(); // 必须阻止默认行为才能响应 drop/dragover
                    // 检查是否有正在拖拽的标签
                    const draggingTag = document.querySelector('.tag_item.tag-dragging');
                    if (draggingTag && !header.classList.contains('active')) {
                        if (!hoverTimer) {
                            hoverTimer = setTimeout(() => {
                                logger.debug(`[AutoExpand] 拖拽悬停自动展开: ${key}`);
                                header.click();
                                hoverTimer = null;
                            }, 500); // 500ms 延迟
                        }
                    }
                });

                const dragLeaveCleanup = EventManager.addDOMListener(header, 'dragleave', () => {
                    if (hoverTimer) {
                        clearTimeout(hoverTimer);
                        hoverTimer = null;
                    }
                });
                // 还要处理 drop 事件，防止计时器残留
                const dropCleanup = EventManager.addDOMListener(header, 'drop', () => {
                    if (hoverTimer) {
                        clearTimeout(hoverTimer);
                        hoverTimer = null;
                    }
                });

                this.eventCleanups.push(dragOverCleanup, dragLeaveCleanup, dropCleanup);

                const content = document.createElement('div');
                content.className = 'tag_accordion_content';

                // 递归创建子内容
                // 传递当前手风琴的分类名称（key）作为 categoryName，而不是父分类名称
                // 这样每个容器的 data-sortable-category 才能正确标识其所属分类
                const childContent = this._createInnerAccordion(value, (parseInt(level) + 1).toString(), tabName, key);
                childContent.style.flex = '1'; // 让子内容占满可用空间
                childContent.style.minHeight = '0'; // 允许flex收缩
                content.appendChild(childContent);

                // 根据保存的状态或默认行为确定是否展开
                let shouldExpand;
                const accordionState = this.getAccordionState();

                if (tabName === 'favorites') {
                    // 收藏页特殊处理：默认展开当前CSV对应的分类
                    // 获取当前CSV文件名（无扩展名）
                    let currentCsvName = this.currentCsvFile || "";
                    currentCsvName = currentCsvName.replace(/\.(csv|json|yaml|yml)$/i, '');

                    // 检查当前key是否匹配当前CSV (key就是分类名)
                    const isCurrentCsv = key === currentCsvName;

                    // 检查是否存在匹配的分类
                    const hasCurrentCsv = Object.keys(data).includes(currentCsvName);

                    // 如果当前Key匹配当前CSV，展开
                    // 或者如果没有对应的CSV分类，且这是第一个，展开
                    shouldExpand = isCurrentCsv || (!hasCurrentCsv && isFirstAccordion);

                    // console.log(`[AutoExpand] Key: ${key}, Current: ${currentCsvName}, Match: ${isCurrentCsv}, HasCurrent: ${hasCurrentCsv}, Should: ${shouldExpand}`);
                } else {
                    // 普通页逻辑：优先使用保存状态，否则默认展开第一个
                    shouldExpand = tabName && accordionState[tabName]?.[key] !== undefined
                        ? accordionState[tabName][key]
                        : isFirstAccordion;
                }

                if (shouldExpand) {
                    header.classList.add('active');
                    content.classList.add('active');
                    const firstArrowIcon = headerIcon.querySelector('.pi.pi-chevron-down');
                    if (firstArrowIcon) {
                        firstArrowIcon.classList.add('rotate-180');
                    }
                    if (!tabName || !accordionState[tabName]?.[key]) {
                        // 只有在使用默认行为时才更新标志
                        isFirstAccordion = false;
                    }
                }

                // 添加手风琴切换事件，包含关闭同级其他手风琴的逻辑
                const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
                    e.stopPropagation();

                    // 获取当前手风琴的父容器（而不是整个标签页）
                    const parentContainer = accordion.parentElement;
                    const parentTab = header.closest('.popup_tab_content');

                    if (parentContainer) {
                        if (!header.classList.contains('active')) {
                            // 只查找同一父容器内的直接子手风琴（同级手风琴），而不是所有层级
                            const siblingAccordions = parentContainer.querySelectorAll(':scope > .tag_accordion > .tag_accordion_header.active');
                            siblingAccordions.forEach(otherHeader => {
                                if (otherHeader !== header) {
                                    const otherContent = otherHeader.nextElementSibling;
                                    const otherHeaderIcon = otherHeader.querySelector('.tag_accordion_icon');
                                    // 使用优化的切换方法关闭同级其他手风琴
                                    if (otherHeader.classList.contains('active')) {
                                        this._toggleAccordion(otherHeader, otherContent, otherHeaderIcon);
                                        // 保存关闭状态
                                        const otherAccordion = otherHeader.closest('.tag_accordion');
                                        const otherAccordionCategory = otherAccordion?.getAttribute('data-category');
                                        const tabName = parentTab?.getAttribute('data-category');
                                        if (tabName && otherAccordionCategory) {
                                            this.setAccordionState(tabName, otherAccordionCategory, false);
                                        }
                                    }
                                }
                            });
                        }
                    }
                    // 使用优化的切换方法切换当前手风琴
                    this._toggleAccordion(header, content, headerIcon);

                    // 保存当前手风琴状态
                    const accordionCategory = accordion.getAttribute('data-category');
                    const tabName = parentTab?.getAttribute('data-category');
                    if (tabName && accordionCategory) {
                        const isExpanded = header.classList.contains('active');
                        this.setAccordionState(tabName, accordionCategory, isExpanded);
                    }
                });

                this.eventCleanups.push(accordionCleanup);

                accordion.appendChild(header);
                accordion.appendChild(content);
                container.appendChild(accordion);
            } else if (typeof value === 'string') {
                // 如果值是字符串，创建标签项
                const tagItem = this._createTagElement(key, value, categoryName);
                container.appendChild(tagItem);
            }
        }

        // ---在手风琴列表末尾添加"新建子分类"按钮（仅限 level='1'，即第一级手风琴）---
        if (level === '1' && tabName !== 'favorites') {
            const addSubCategoryBtn = document.createElement('div');
            addSubCategoryBtn.className = 'add_subcategory_button';
            addSubCategoryBtn.title = '新建子分类';

            const addSubCategoryIcon = document.createElement('span');
            addSubCategoryIcon.className = 'pi pi-plus';
            addSubCategoryBtn.appendChild(addSubCategoryIcon);

            const addSubCategoryClickCleanup = EventManager.addDOMListener(addSubCategoryBtn, 'click', (e) => {
                e.stopPropagation();
                this._handleAddCategory(addSubCategoryBtn, tabName, null, null, data, categoryName);
            });
            this.eventCleanups.push(addSubCategoryClickCleanup);
            container.appendChild(addSubCategoryBtn);
        }

        // 初始化拖拽排序（如果有 Sortable）
        // 分别处理手风琴排序和标签排序，避免拖拽标签时误触发手风琴排序
        if (this.Sortable) {
            // 检测容器内容类型（只检测直接子元素）
            const hasAccordions = container.querySelector(':scope > .tag_accordion') !== null;
            const hasTags = container.querySelector(':scope > .tag_item') !== null;

            // 手风琴排序：只有手风琴头部可以触发，且只排序手风琴元素
            if (hasAccordions) {
                const accordionSortable = new this.Sortable(container, {
                    group: { name: 'accordions', pull: false, put: false }, // 独立分组，不与标签混排
                    animation: 150,
                    ghostClass: 'tag-ghost',
                    handle: '.tag_accordion_header', // 只有手风琴头部可以拖拽
                    draggable: '.tag_accordion', // 只排序手风琴元素
                    delay: 50,
                    onEnd: async (evt) => {
                        const { oldIndex, newIndex } = evt;
                        if (oldIndex === newIndex) return;

                        // 获取新顺序（只处理手风琴）
                        const newOrderKeys = [];
                        Array.from(container.children).forEach(el => {
                            if (el.classList.contains('tag_accordion')) {
                                const cat = el.getAttribute('data-category');
                                if (cat) newOrderKeys.push(cat);
                            }
                        });

                        // 重构 data 对象
                        const tempObj = { ...data };
                        for (const key in data) delete data[key];

                        newOrderKeys.forEach(key => {
                            if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                data[key] = tempObj[key];
                            }
                        });

                        // 保留未在DOM中的数据
                        for (const key in tempObj) {
                            if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                data[key] = tempObj[key];
                            }
                        }

                        // 保存排序
                        await this._saveTagOrder(data, tabName, categoryName);
                    }
                });
                this.sortables.push(accordionSortable);
            }


            // 标签排序（支持跨分类拖拽）
            // 始终初始化标签 Sortable，确保空分类或只有子分类的容器也能接收标签
            if (true) {
                // 为容器添加分类标识，用于跨分类拖拽时识别
                container.setAttribute('data-sortable-category', categoryName || tabName);
                // 确保容器有最小高度，以便空容器也能因 drop-zone 样式而被看到
                container.style.minHeight = '10px';

                const tagSortable = new this.Sortable(container, {
                    group: {
                        name: 'tags',
                        pull: true,
                        put: function (to) {
                            // 如果目标容器包含手风琴（由 .tag_accordion 子元素判断），则不允许放入标签
                            // 标签只能放入最底层的分类容器（即手风琴的内容区域）
                            return to.el.querySelector(':scope > .tag_accordion') === null;
                        }
                    }, // 允许跨分类拖拽
                    animation: 150,
                    ghostClass: 'tag-ghost',
                    draggable: '.tag_item',
                    delay: 50,
                    onStart: function (evt) {
                        evt.item.classList.add('tag-dragging');
                        // 高亮所有可放置的分类容器（仅限底层容器）
                        document.querySelectorAll('[data-sortable-category]').forEach(el => {
                            if (el !== evt.from && !el.querySelector(':scope > .tag_accordion')) {
                                el.classList.add('tag-drop-zone');
                            }
                        });
                    },
                    onEnd: async (evt) => {
                        evt.item.classList.remove('tag-dragging');
                        // 移除高亮
                        document.querySelectorAll('.tag-drop-zone').forEach(el => {
                            el.classList.remove('tag-drop-zone');
                        });

                        // 如果是跨分类移动，由 onAdd 处理
                        if (evt.from !== evt.to) return;

                        const { oldIndex, newIndex } = evt;
                        if (oldIndex === newIndex) return;

                        const newOrderKeys = [];
                        Array.from(container.children).forEach(el => {
                            if (el.classList.contains('tag_item')) {
                                const name = el.getAttribute('data-name');
                                if (name) newOrderKeys.push(name);
                            }
                        });

                        const tempObj = { ...data };
                        for (const key in data) delete data[key];

                        // 先添加排序后的标签
                        newOrderKeys.forEach(key => {
                            if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                data[key] = tempObj[key];
                            }
                        });

                        // 补回其他键（即该层级下的子分类）
                        for (const key in tempObj) {
                            if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                data[key] = tempObj[key];
                            }
                        }

                        await this._saveTagOrder(data, tabName, categoryName);
                    },
                    onAdd: async (evt) => {
                        // 跨分类移动标签
                        const tagItem = evt.item;
                        const tagName = tagItem.getAttribute('data-name');
                        const tagValue = tagItem.getAttribute('data-value');
                        const fromCategory = evt.from.getAttribute('data-sortable-category');
                        const toCategory = evt.to.getAttribute('data-sortable-category');

                        logger.debug(`[onAdd] 开始移动标签: ${tagName}, 从: ${fromCategory}, 到: ${toCategory}`);

                        // 更新标签元素的分类属性
                        tagItem.setAttribute('data-category', toCategory);

                        // 调用移动函数 (不立即保存，等待排序)
                        const success = await this._moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, false);

                        logger.debug(`[onAdd] 移动结果: ${success}`);

                        if (!success) {
                            // 如果移动失败，将标签移回原位置
                            logger.warn(`[onAdd] 移动失败，回滚 DOM`);
                            evt.from.appendChild(tagItem);
                        } else {
                            // 移动成功，现在根据 DOM 顺序重新排序并保存

                            // 获取新的 DOM 顺序
                            const newOrderKeys = [];
                            Array.from(evt.to.children).forEach(el => {
                                if (el.classList.contains('tag_item')) {
                                    const name = el.getAttribute('data-name');
                                    if (name) newOrderKeys.push(name);
                                }
                            });

                            // 重构 data 对象
                            const tempObj = { ...data };
                            for (const key in data) delete data[key];

                            // 先添加排序后的标签
                            newOrderKeys.forEach(key => {
                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
                                    data[key] = tempObj[key];
                                }
                            });

                            // 补回其他键（即该层级下的子分类/原本就在此处的子分类）
                            for (const key in tempObj) {
                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
                                    data[key] = tempObj[key];
                                }
                            }


                            // 保存排序后的数据
                            await this._saveTagOrder(data, tabName, toCategory);

                            // 显示成功提示
                            logger.debug(`[标签移动] 成功并排序 | 标签: ${tagName} | 到: ${toCategory}`);
                            app.extensionManager.toast.add({
                                severity: "success",
                                summary: "移动成功",
                                detail: `标签 "${tagName}" 已移动到 "${toCategory}"`,
                                life: 2000
                            });
                        }
                    }
                });
                this.sortables.push(tagSortable);
            }
        }

        return container;
    }

    /**
     * 保存标签排序
     * @param {Object} data 数据对象
     * @param {string} tabName 标签页名称
     * @param {string} categoryName 分类名称
     */
    static async _saveTagOrder(data, tabName, categoryName) {
        try {
            let success = false;
            const isFavorites = tabName === 'favorites' || categoryName === 'favorites';

            if (isFavorites) {
                // 保存到 tags_user.json
                const userTagData = await ResourceManager.getUserTagData();
                if (!userTagData.favorites) {
                    userTagData.favorites = {};
                }
                userTagData.favorites = TagManager.favorites;

                success = await ResourceManager.saveUserTags(userTagData);
                if (success) {
                    logger.debug(`[标签排序] 收藏排序已保存`);
                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: "排序保存成功",
                        detail: "收藏标签顺序已更新",
                        life: 2000
                    });
                }
            } else {
                // 保存到 CSV
                if (TagManager.currentCsvFile && TagManager.tagData) {
                    success = await ResourceManager.saveTagsCsv(TagManager.currentCsvFile, TagManager.tagData);
                    if (success) {
                        logger.debug(`[标签排序] CSV排序已保存 | 文件: ${TagManager.currentCsvFile}`);
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: "排序保存成功",
                            detail: "标签文件顺序已更新",
                            life: 2000
                        });
                    }
                }
            }

            if (!success) {
                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "保存失败",
                    detail: "排序未能保存到服务器",
                    life: 3000
                });
            }
        } catch (err) {
            logger.error(`[标签排序] 保存出错: ${err.message}`);
        }
    }

    /**
     * 移动标签到新分类
     * @param {string} tagName 标签名称
     * @param {string} tagValue 标签值
     * @param {string} fromCategory 原分类名
     * @param {string} toCategory 目标分类名
     * @param {string} tabName 标签页名称
     */
    static async _moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, shouldSave = true) {
        try {
            // 收藏页不支持跨分类移动
            if (tabName === 'favorites' || fromCategory === 'favorites' || toCategory === 'favorites') {
                logger.debug('[标签移动] 收藏页标签不支持跨分类移动');
                return false;
            }

            // 如果源分类和目标分类相同，不处理
            if (fromCategory === toCategory) {
                return false;
            }

            const filename = this.currentCsvFile;
            if (!filename || !TagManager.tagData) {
                logger.error('[标签移动] 无法获取当前CSV文件或标签数据');
                return false;
            }

            // 获取源分类和目标分类
            const sourceCategory = TagManager._findCategoryRecursively(TagManager.tagData, fromCategory);
            const targetCategory = TagManager._findCategoryRecursively(TagManager.tagData, toCategory);

            if (!sourceCategory) {
                logger.error(`[标签移动] 找不到源分类: ${fromCategory}`);
                return false;
            }

            if (!targetCategory) {
                logger.error(`[标签移动] 找不到目标分类: ${toCategory}`);
                return false;
            }

            // 检查目标分类是否已存在同名标签
            if (targetCategory.hasOwnProperty(tagName)) {
                app.extensionManager.toast.add({
                    severity: "warn",
                    summary: "移动失败",
                    detail: `目标分类中已存在同名标签 "${tagName}"`,
                    life: 3000
                });
                return false;
            }

            // 从源分类删除标签
            delete sourceCategory[tagName];

            // 添加到目标分类
            targetCategory[tagName] = tagValue;

            if (!shouldSave) {
                return true;
            }

            // 保存到 CSV
            const success = await ResourceManager.saveTagsCsv(filename, TagManager.tagData);

            if (success) {
                logger.debug(`[标签移动] 成功 | 标签: ${tagName} | 从: ${fromCategory} | 到: ${toCategory}`);
                app.extensionManager.toast.add({
                    severity: "success",
                    summary: "移动成功",
                    detail: `标签 "${tagName}" 已移动到 "${toCategory}"`,
                    life: 2000
                });
                return true;
            } else {
                // 回滚操作
                targetCategory[tagName] && delete targetCategory[tagName];
                sourceCategory[tagName] = tagValue;

                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "移动失败",
                    detail: "保存到服务器失败",
                    life: 3000
                });
                return false;
            }
        } catch (err) {
            logger.error(`[标签移动] 出错: ${err.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "移动失败",
                detail: err.message,
                life: 3000
            });
            return false;
        }
    }

    /**
     * 检查标签是否已收藏
     */
    static _isTagFavorited(tagValue, category = null) {
        if (!this.favorites) return false;

        // 如果提供了分类，优先检查该分类
        if (category) {
            // 标准化分类名称（去除扩展名）
            const normalize = (name) => name.replace(/\.(csv|json|yaml|yml)$/i, '');
            const targetCat = normalize(category);

            // 检查直接匹配
            if (this.favorites[targetCat]) {
                return Object.values(this.favorites[targetCat]).includes(tagValue);
            }

            // 如果没找到直接匹配的Key，可能需要遍历Keys进行模糊匹配?
            // 目前假设 Keys 都是已标准化。
            // 但如果 favorites 还是旧结构（平铺），直接检查 values
            const isOldStructure = Object.values(this.favorites).some(v => typeof v !== 'object');
            if (isOldStructure) {
                // 旧结构忽略 category
                return Object.values(this.favorites).includes(tagValue);
            }

            return false;
        }

        // 如果没有提供分类（比如全局搜索），则递归检查
        // 递归查找值
        const checkRecursive = (obj) => {
            if (typeof obj !== 'object' || obj === null) return false;

            for (const value of Object.values(obj)) {
                if (typeof value === 'object' && value !== null) {
                    if (checkRecursive(value)) return true;
                } else if (value === tagValue) {
                    return true;
                }
            }
            return false;
        };

        return checkRecursive(this.favorites);
    }

    /**
     * 创建标签元素
     */
    static _createTagElement(tagName, tagValue, categoryName = null) {
        const tagItem = document.createElement('div');
        tagItem.className = 'tag_item';
        tagItem.setAttribute('data-name', tagName);
        tagItem.setAttribute('data-value', tagValue);
        if (categoryName) {
            tagItem.setAttribute('data-category', categoryName);
        }

        // 检查标签是否已使用
        if (this.isTagUsed(tagValue, this.currentNodeId, this.currentInputId)) {
            tagItem.classList.add('used');
            this.usedTags.set(tagValue, tagItem);
        }

        const tagText = document.createElement('span');
        tagText.className = 'tag_item_text';

        // 检查是否已收藏 (考虑分类)
        // 如果是收藏页，TagElement的 categoryName 本身就是 SourceCategory
        // 如果是常规页，categoryName 就是 SourceCategory

        // 注意：categoryName 在这里通常是文件名，比如 "foo.csv" 或 "foo"
        // 我们后端/缓存的 key 通常是去掉了扩展名的。
        // _isTagFavorited 内部会尝试处理，但最好我们传进去的是原始 categoryName，在内部处理。
        const isFavorited = this._isTagFavorited(tagValue, categoryName);
        tagText.textContent = isFavorited ? `⭐️ ${tagName}` : tagName;

        tagItem.appendChild(tagText);

        // 添加鼠标事件监听
        const mouseEnterCleanup = EventManager.addDOMListener(tagItem, 'mouseenter', () => {
            this._showTooltip(tagItem, tagValue);
        });

        const mouseLeaveCleanup = EventManager.addDOMListener(tagItem, 'mouseleave', () => {
            this._hideTooltip();
        });

        // 添加点击事件
        const tagClickCleanup = EventManager.addDOMListener(tagItem, 'click', (e) => {
            // 先隐藏tooltip
            this._hideTooltip();
            this.handleTagClick(tagItem, tagName, tagValue, e);
            // 移除后，重新加载已插入标签
            setTimeout(() => {
                // 重新加载已插入标签页
                const insertedTabContent = document.querySelector('.popup_tab_content[data-category="已插入"]');
                if (insertedTabContent && insertedTabContent.classList.contains('active')) {
                    this._loadInsertedTagsContent(insertedTabContent);
                }
                // 更新所有标签页中的标签状态
                this.updateAllTagsState(this.currentNodeId, this.currentInputId);
                // 如果当前在搜索状态，也要更新搜索结果中的标签状态
                const searchResultList = document.querySelector('.tag_search_result_list');
                if (searchResultList) {
                    this.refreshSearchResultsState();
                }
            }, 0);
        });

        // 添加右键菜单
        const contextMenuCleanup = EventManager.addDOMListener(tagItem, 'contextmenu', (e) => {
            e.preventDefault();
            this._showContextMenu(e, tagValue, tagName, categoryName);
        });

        this.eventCleanups.push(mouseEnterCleanup, mouseLeaveCleanup, tagClickCleanup, contextMenuCleanup);



        return tagItem;
    }

    /**
     * 显示右键菜单
     */
    static _showContextMenu(e, tagValue, tagName, category = null) {
        // 检查是否已收藏 (使用传入的 category)
        const isFavorited = this._isTagFavorited(tagValue, category);

        // 查找触发右键的标签元素
        const tagItem = e.target.closest('.tag_item') || e.currentTarget;

        // ---为收藏标签提供简化菜单---
        // 收藏标签（⭐️）是引用类型，不应该被编辑或删除，只能取消收藏
        const menuItems = isFavorited ? [
            // 收藏标签：仅显示取消收藏选项
            {
                label: '取消收藏',
                icon: 'pi-minus-circle',
                onClick: async () => {
                    // 使用CSV文件名作为分类名
                    let targetCategory = this.currentCsvFile || "默认";
                    targetCategory = targetCategory.replace(/\.(csv|json|yaml|yml)$/i, '');

                    const success = await ResourceManager.removeFavorite(tagValue, targetCategory);
                    if (success) {
                        // 移除本地缓存 (favorites 是嵌套对象 {category: {name: value}})
                        if (this.favorites && this.favorites[targetCategory]) {
                            const catData = this.favorites[targetCategory];
                            for (const key in catData) {
                                if (catData[key] === tagValue) {
                                    delete catData[key];
                                    break;
                                }
                            }
                        }

                        // 更新UI状态
                        this.updateTagFavoriteState(tagValue, false);

                        // 如果当前在收藏页，刷新收藏页
                        const activeTab = document.querySelector('.popup_tab.active');
                        if (activeTab && activeTab.getAttribute('data-category') === 'favorites') {
                            const content = document.querySelector('.popup_tab_content.active');
                            if (content) {
                                content.removeAttribute('data-loaded');
                                this._loadCategoryContent(content, this.favorites, 'favorites');
                            }
                        }
                    }
                }
            }
        ] : [
            // 常规标签：显示完整菜单选项
            {
                label: '收藏标签',
                icon: 'pi-star',
                onClick: async () => {
                    // 使用CSV文件名作为分类名
                    let targetCategory = this.currentCsvFile || "默认";
                    targetCategory = targetCategory.replace(/\.(csv|json|yaml|yml)$/i, '');

                    const success = await ResourceManager.addFavorite(tagValue, tagName, targetCategory);
                    if (success) {
                        if (!this.favorites) this.favorites = {};

                        // 添加到本地缓存
                        if (!this.favorites[targetCategory]) {
                            this.favorites[targetCategory] = {};
                        }
                        this.favorites[targetCategory][tagName] = tagValue;

                        // 更新UI状态
                        this.updateTagFavoriteState(tagValue, true);

                        // 立即刷新收藏页（如果在）
                        const activeTab = document.querySelector('.popup_tab.active');
                        if (activeTab && activeTab.getAttribute('data-category') === 'favorites') {
                            const content = document.querySelector('.popup_tab_content.active');
                            if (content) {
                                // 强制移除 data-loaded 属性
                                content.removeAttribute('data-loaded');
                                this._loadCategoryContent(content, this.favorites, 'favorites');
                            }
                        }
                    }
                }
            },
            {
                label: '编辑标签',
                icon: 'pi-pencil',
                onClick: () => {
                    // 使用识别出的 tagItem 执行编辑
                    this._handleEditTag(tagItem, tagName, tagValue, category);
                }
            },
            {
                separator: true
            },
            {
                label: '删除标签',
                icon: 'pi-trash',
                danger: true,
                onClick: () => {
                    // 使用识别出的 tagItem 执行删除
                    this._handleDeleteTag(tagItem, tagName, tagValue);
                }
            }
        ];

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: menuItems
        });
    }

    /**
     * 处理添加新分类
     * @param {HTMLElement} triggerElement 触发元素（按钮）
     * @param {string|null} parentTabName 父 Tab 名称（如果是添加子分类）
     * @param {HTMLElement|null} tabsContainer Tab 容器（如果是添加顶级分类）
     * @param {HTMLElement|null} tabContentsContainer Tab 内容容器（如果是添加顶级分类）
     * @param {Object} data 当前数据对象
     * @param {string|null} parentCategory 父分类名称（如果是添加子分类）
     */
    static _handleAddCategory(triggerElement, parentTabName, tabsContainer, tabContentsContainer, data, parentCategory = null) {
        const isTopLevel = parentTabName === null; // 是否创建顶级分类（Tab）

        // 创建表单内容渲染函数
        const renderForm = (container) => {
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '16px';
            container.style.minWidth = '250px';

            // 分类名输入组 - 使用浮动标签样式
            const nameGroup = document.createElement('div');
            nameGroup.className = 'settings-form-group';

            const nameFloatContainer = document.createElement('div');
            nameFloatContainer.className = 'float-label-container';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'p-inputtext p-component';
            nameInput.placeholder = ' ';

            const nameLabel = document.createElement('label');
            nameLabel.textContent = '分类名称';

            nameFloatContainer.appendChild(nameInput);
            nameFloatContainer.appendChild(nameLabel);
            nameGroup.appendChild(nameFloatContainer);
            container.appendChild(nameGroup);

            // 返回引用以便获取值
            return { nameInput };
        };

        let inputs = {};

        createConfirmPopup({
            target: triggerElement,
            message: isTopLevel ? '创建新的标签页分类' : `在 "${parentTabName}" 下创建子分类`,
            icon: 'pi-plus',
            position: 'top',
            confirmLabel: '创建',
            renderFormContent: (container) => {
                inputs = renderForm(container);
            },
            onConfirm: async () => {
                const categoryName = inputs.nameInput.value.trim();

                if (!categoryName) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "输入无效",
                        detail: "分类名称不能为空",
                        life: 3000
                    });
                    throw new Error("Validation failed");
                }

                // 检查分类名是否已存在
                const targetData = isTopLevel ? TagManager.tagData : data;
                if (targetData && targetData.hasOwnProperty(categoryName)) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "创建失败",
                        detail: `分类 "${categoryName}" 已存在`,
                        life: 3000
                    });
                    throw new Error("Category already exists");
                }

                // 保存新分类
                await this._saveNewCategory(categoryName, isTopLevel, parentTabName, parentCategory);
            }
        });
    }

    /**
     * 保存新分类到 CSV
     * @param {string} categoryName 分类名称
     * @param {boolean} isTopLevel 是否为顶级分类
     * @param {string|null} parentTabName 父 Tab 名称
     * @param {string|null} parentCategory 父分类名称
     */
    static async _saveNewCategory(categoryName, isTopLevel, parentTabName, parentCategory) {
        try {
            // 使用 loadTagsCsv 加载当前 CSV 文件的最新数据
            const filename = this.currentCsvFile || await ResourceManager.getSelectedTagFile();
            if (!filename) {
                throw new Error("无法确定当前 CSV 文件");
            }

            const data = await ResourceManager.loadTagsCsv(filename);
            if (!data) {
                throw new Error("加载标签数据失败");
            }

            // 确定目标位置并添加新分类
            if (isTopLevel) {
                // 检查顶级分类是否已存在
                if (data.hasOwnProperty(categoryName)) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "分类已存在",
                        detail: `分类 "${categoryName}" 已存在`,
                        life: 3000
                    });
                    throw new Error("Category already exists");
                }
                // 添加顶级分类（空分类需要有一个占位标签才能保存）
                data[categoryName] = { "__placeholder__": "__empty__" };
            } else {
                // 查找父分类
                const parentData = this._findCategoryRecursively(data, parentTabName);
                if (!parentData) {
                    throw new Error(`找不到父分类: ${parentTabName}`);
                }
                // 检查子分类是否已存在
                if (parentData.hasOwnProperty(categoryName)) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "分类已存在",
                        detail: `分类 "${categoryName}" 已存在于 "${parentTabName}" 下`,
                        life: 3000
                    });
                    throw new Error("Category already exists");
                }
                // 添加子分类（空分类需要有一个占位标签才能保存）
                parentData[categoryName] = { "__placeholder__": "__empty__" };
            }

            // 保存到 CSV 文件
            await ResourceManager.saveTagsCsv(filename, data);

            // 重新加载 CSV 数据以刷新缓存
            const newData = await ResourceManager.loadTagsCsv(filename);

            // 更新静态数据引用
            TagManager.tagData = newData;

            // 实时刷新 UI
            if (isTopLevel) {
                // 顶级分类：在 Tab 栏中添加新 Tab（在"添加分类"按钮之前）
                const tabs = document.querySelector('.popup_tabs');
                const tabContents = document.querySelector('.tag_category_container');
                const addCategoryBtn = tabs?.querySelector('.add_category_tab');

                if (tabs && tabContents && addCategoryBtn) {
                    // 创建新 Tab
                    const tab = document.createElement('div');
                    tab.className = 'popup_tab';
                    tab.textContent = categoryName;
                    tab.setAttribute('data-category', categoryName);

                    // 创建内容区域
                    const content = document.createElement('div');
                    content.className = 'popup_tab_content';
                    content.setAttribute('data-category', categoryName);
                    content.style.flex = '1';
                    content.style.display = 'none';

                    // 添加 Tab 点击事件
                    const tabClickCleanup = EventManager.addDOMListener(tab, 'click', () => {
                        // 取消所有 Tab 激活状态
                        tabs.querySelectorAll('.popup_tab').forEach(t => t.classList.remove('active'));
                        tabContents.querySelectorAll('.popup_tab_content').forEach(c => {
                            c.classList.remove('active');
                            c.style.display = 'none';
                        });

                        // 激活当前 Tab
                        tab.classList.add('active');
                        content.classList.add('active');
                        content.style.display = 'block';

                        // 记忆当前选择的标签页
                        TagManager.setLastActiveTab(categoryName);

                        // 懒加载内容
                        if (content.getAttribute('data-loaded') !== 'true') {
                            this._loadCategoryContent(content, newData[categoryName], categoryName);
                            content.setAttribute('data-loaded', 'true');
                        }
                    });
                    this.eventCleanups.push(tabClickCleanup);

                    // 在"添加分类"按钮之前插入新 Tab
                    tabs.insertBefore(tab, addCategoryBtn);
                    tabContents.appendChild(content);

                    // 自动激活新创建的分类
                    tab.click();
                }
            } else {
                // 子分类：刷新当前 Tab 的内容
                const activeTab = document.querySelector('.popup_tab.active');
                const content = document.querySelector('.popup_tab_content.active');
                if (activeTab && content) {
                    const cat = activeTab.getAttribute('data-category');
                    content.innerHTML = '';
                    content.removeAttribute('data-loaded');
                    this._loadCategoryContent(content, newData[cat], cat);
                }
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: "创建成功",
                detail: `分类 "${categoryName}" 已创建`,
                life: 3000
            });

        } catch (error) {
            if (error.message !== "Validation failed" && error.message !== "Category already exists") {
                logger.error(`创建分类失败: ${error.message}`);
                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "创建失败",
                    detail: error.message,
                    life: 3000
                });
            }
        }
    }

    /**
     * 显示分类右键菜单
     * @param {Event} e 鼠标事件
     * @param {string} categoryName 分类名称
     * @param {boolean} isTopLevel 是否为顶级分类
     * @param {string|null} parentCategory 父分类名称（对于手风琴）
     */
    static _showCategoryContextMenu(e, categoryName, isTopLevel, parentCategory = null) {
        // 特殊分类不允许修改或删除
        const specialCategories = ['⭐️', 'favorites', '已插入', '标签'];
        if (specialCategories.includes(categoryName)) {
            return;
        }

        // 保存触发元素以便后续使用
        const targetElement = e.target.closest('.popup_tab') || e.target.closest('.tag_accordion_header') || e.target;

        const menuItems = [
            {
                label: '修改名称',
                icon: 'pi-pencil',
                onClick: () => {
                    // 从 DOM 获取最新的分类名称
                    const currentName = isTopLevel
                        ? targetElement.getAttribute('data-category') || targetElement.textContent.trim()
                        : targetElement.closest('.tag_accordion')?.getAttribute('data-category') || categoryName;
                    this._handleEditCategory(targetElement, currentName, isTopLevel, parentCategory);
                }
            },
            {
                separator: true
            },
            {
                label: '删除分类',
                icon: 'pi-trash',
                danger: true,
                onClick: () => {
                    // 从 DOM 获取最新的分类名称
                    const currentName = isTopLevel
                        ? targetElement.getAttribute('data-category') || targetElement.textContent.trim()
                        : targetElement.closest('.tag_accordion')?.getAttribute('data-category') || categoryName;
                    this._handleDeleteCategory(targetElement, currentName, isTopLevel, parentCategory);
                }
            }
        ];

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: menuItems
        });
    }

    /**
     * 处理编辑分类名称
     * @param {HTMLElement} target 触发元素
     * @param {string} oldName 原分类名称
     * @param {boolean} isTopLevel 是否为顶级分类
     * @param {string|null} parentCategory 父分类名称
     */
    static _handleEditCategory(target, oldName, isTopLevel, parentCategory) {
        // 创建表单内容渲染函数
        const renderForm = (container) => {
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '16px';
            container.style.minWidth = '250px';

            const nameGroup = document.createElement('div');
            nameGroup.className = 'settings-form-group';

            const nameFloatContainer = document.createElement('div');
            nameFloatContainer.className = 'float-label-container';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'p-inputtext p-component';
            nameInput.placeholder = ' ';
            nameInput.value = oldName;

            const nameLabel = document.createElement('label');
            nameLabel.textContent = '分类名称';

            nameFloatContainer.appendChild(nameInput);
            nameFloatContainer.appendChild(nameLabel);
            nameGroup.appendChild(nameFloatContainer);
            container.appendChild(nameGroup);

            // 自动聚焦并选中文本
            setTimeout(() => {
                nameInput.focus();
                nameInput.select();
            }, 100);

            return { nameInput };
        };

        let inputs = {};

        createConfirmPopup({
            target: target,
            message: `修改分类名称`,
            icon: 'pi-pencil',
            position: 'bottom',
            confirmLabel: '保存',
            renderFormContent: (container) => {
                inputs = renderForm(container);
            },
            onConfirm: async () => {
                const newName = inputs.nameInput.value.trim();

                if (!newName) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "输入无效",
                        detail: "分类名称不能为空",
                        life: 3000
                    });
                    throw new Error("Validation failed");
                }

                if (newName === oldName) {
                    return; // 名称未改变，无需保存
                }

                await this._saveEditedCategory(oldName, newName, isTopLevel, parentCategory);
            }
        });
    }

    /**
     * 保存编辑后的分类名称
     */
    static async _saveEditedCategory(oldName, newName, isTopLevel, parentCategory) {
        try {
            const filename = this.currentCsvFile || await ResourceManager.getSelectedTagFile();
            if (!filename) {
                throw new Error("无法确定当前 CSV 文件");
            }

            const data = await ResourceManager.loadTagsCsv(filename);
            if (!data) {
                throw new Error("加载标签数据失败");
            }

            if (isTopLevel) {
                // 顶级分类重命名
                if (data.hasOwnProperty(newName)) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "名称已存在",
                        detail: `分类 "${newName}" 已存在`,
                        life: 3000
                    });
                    throw new Error("Category already exists");
                }

                // 复制数据到新名称，删除旧名称
                data[newName] = data[oldName];
                delete data[oldName];
            } else {
                // 子分类重命名
                const parentData = this._findCategoryRecursively(data, parentCategory);
                if (!parentData) {
                    throw new Error(`找不到父分类: ${parentCategory}`);
                }

                if (parentData.hasOwnProperty(newName)) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "名称已存在",
                        detail: `分类 "${newName}" 已存在于 "${parentCategory}" 下`,
                        life: 3000
                    });
                    throw new Error("Category already exists");
                }

                parentData[newName] = parentData[oldName];
                delete parentData[oldName];
            }

            await ResourceManager.saveTagsCsv(filename, data);
            const newData = await ResourceManager.loadTagsCsv(filename);
            TagManager.tagData = newData;

            // 刷新 UI
            if (isTopLevel) {
                // 更新 Tab 名称
                const tab = document.querySelector(`.popup_tab[data-category="${oldName}"]`);
                const tabContent = document.querySelector(`.popup_tab_content[data-category="${oldName}"]`);
                if (tab) {
                    tab.textContent = newName;
                    tab.setAttribute('data-category', newName);
                }
                if (tabContent) {
                    tabContent.setAttribute('data-category', newName);
                }
            } else {
                // 刷新当前 Tab 内容
                const activeTab = document.querySelector('.popup_tab.active');
                const content = document.querySelector('.popup_tab_content.active');
                if (activeTab && content) {
                    const cat = activeTab.getAttribute('data-category');
                    content.innerHTML = '';
                    content.removeAttribute('data-loaded');
                    this._loadCategoryContent(content, newData[cat], cat);
                }
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: "修改成功",
                detail: `分类已重命名为 "${newName}"`,
                life: 3000
            });

        } catch (error) {
            if (error.message !== "Validation failed" && error.message !== "Category already exists") {
                logger.error(`修改分类失败: ${error.message}`);
                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "修改失败",
                    detail: error.message,
                    life: 3000
                });
            }
        }
    }

    /**
     * 处理删除分类
     */
    static async _handleDeleteCategory(targetElement, categoryName, isTopLevel, parentCategory) {
        // 使用确认弹窗 - 定位到触发元素
        createConfirmPopup({
            target: targetElement,
            message: `确定要删除分类 "${categoryName}" 和该分类下的所有标签吗？`,
            icon: 'pi-exclamation-triangle',
            iconColor: 'var(--p-orange-500)',
            position: 'bottom',
            confirmLabel: '删除',
            cancelLabel: '取消',
            confirmDanger: true,
            onConfirm: async () => {
                try {
                    const filename = this.currentCsvFile || await ResourceManager.getSelectedTagFile();
                    if (!filename) {
                        throw new Error("无法确定当前 CSV 文件");
                    }

                    const data = await ResourceManager.loadTagsCsv(filename);
                    if (!data) {
                        throw new Error("加载标签数据失败");
                    }

                    if (isTopLevel) {
                        delete data[categoryName];
                    } else {
                        const parentData = this._findCategoryRecursively(data, parentCategory);
                        if (parentData) {
                            delete parentData[categoryName];
                        }
                    }

                    await ResourceManager.saveTagsCsv(filename, data);
                    const newData = await ResourceManager.loadTagsCsv(filename);
                    TagManager.tagData = newData;

                    // 刷新 UI
                    if (isTopLevel) {
                        // 删除 Tab 和内容
                        const tab = document.querySelector(`.popup_tab[data-category="${categoryName}"]`);
                        const tabContent = document.querySelector(`.popup_tab_content[data-category="${categoryName}"]`);

                        const wasActive = tab?.classList.contains('active');

                        tab?.remove();
                        tabContent?.remove();

                        // 如果删除的是当前激活的 Tab，激活第一个普通 Tab
                        if (wasActive) {
                            const firstTab = document.querySelector('.popup_tab:not(.add_category_tab)');
                            if (firstTab) {
                                firstTab.click();
                            }
                        }
                    } else {
                        // 刷新当前 Tab 内容
                        const activeTab = document.querySelector('.popup_tab.active');
                        const content = document.querySelector('.popup_tab_content.active');
                        if (activeTab && content) {
                            const cat = activeTab.getAttribute('data-category');
                            content.innerHTML = '';
                            content.removeAttribute('data-loaded');
                            this._loadCategoryContent(content, newData[cat], cat);
                        }
                    }

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: "删除成功",
                        detail: `分类 "${categoryName}" 已删除`,
                        life: 3000
                    });

                } catch (error) {
                    logger.error(`删除分类失败: ${error.message}`);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "删除失败",
                        detail: error.message,
                        life: 3000
                    });
                }
            }
        });
    }

    /**
     * 处理添加新标签
     * @param {string} categoryKey 分类键
     * @param {string} categoryName 分类名
     * @param {HTMLElement} triggerElement 触发元素（加号按钮）
     */
    static _handleAddTag(categoryKey, categoryName, triggerElement) {
        // 创建表单内容渲染函数
        const renderForm = (container) => {
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '16px';
            container.style.minWidth = '300px';

            // 标签名输入组 - 使用浮动标签样式
            const nameGroup = document.createElement('div');
            nameGroup.className = 'settings-form-group';

            const nameFloatContainer = document.createElement('div');
            nameFloatContainer.className = 'float-label-container';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = '';
            nameInput.className = 'p-inputtext p-component';
            nameInput.placeholder = ' '; // 使用空格触发 :not(:placeholder-shown)

            const nameLabel = document.createElement('label');
            nameLabel.textContent = '标签名称';

            nameFloatContainer.appendChild(nameInput);
            nameFloatContainer.appendChild(nameLabel);
            nameGroup.appendChild(nameFloatContainer);
            container.appendChild(nameGroup);

            // 标签内容输入组 - 使用浮动标签样式
            const valueGroup = document.createElement('div');
            valueGroup.className = 'settings-form-group';

            const valueFloatContainer = document.createElement('div');
            valueFloatContainer.className = 'float-label-container';

            const valueInput = document.createElement('textarea');
            valueInput.value = '';
            valueInput.className = 'p-inputtext p-component settings-form-textarea';
            valueInput.placeholder = ' ';
            valueInput.rows = 3;
            valueInput.style.resize = 'vertical';
            valueInput.style.minHeight = '80px';

            const valueLabel = document.createElement('label');
            valueLabel.textContent = '标签内容';

            valueFloatContainer.appendChild(valueInput);
            valueFloatContainer.appendChild(valueLabel);
            valueGroup.appendChild(valueFloatContainer);
            container.appendChild(valueGroup);

            // 返回引用以便获取值
            return { nameInput, valueInput };
        };

        // 使用传入的触发元素作为定位目标，如果没有则降级到手风琴头部
        const anchor = triggerElement ||
            document.querySelector(`.tag_accordion[data-category="${CSS.escape(categoryKey)}"] .tag_accordion_header`) ||
            document.body;

        let inputs = {};

        createConfirmPopup({
            target: anchor,
            message: `在 "${categoryKey}" 分类下创建新标签`,
            icon: 'pi-plus',
            position: 'left', // 创建按钮在右侧，气泡向左显示
            confirmLabel: '保存',
            renderFormContent: (container) => {
                inputs = renderForm(container);
            },
            onConfirm: async () => {
                const newName = inputs.nameInput.value.trim();
                const newValue = inputs.valueInput.value.trim();

                if (!newName || !newValue) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "输入无效",
                        detail: "标签名称和内容不能为空",
                        life: 3000
                    });
                    throw new Error("Validation failed");
                }

                // 执行保存逻辑
                await this._saveNewTag(categoryKey, categoryName, newName, newValue);
            }
        });
    }

    /**
     * 保存新标签
     */
    static async _saveNewTag(categoryKey, categoryName, tagName, tagValue) {
        try {
            // 使用 loadTagsCsv 加载当前 CSV 文件的最新数据
            const filename = this.currentCsvFile || await ResourceManager.getSelectedTagFile();
            if (!filename) {
                throw new Error("无法确定当前 CSV 文件");
            }

            const data = await ResourceManager.loadTagsCsv(filename);
            if (!data || Object.keys(data).length === 0) {
                throw new Error("加载标签数据失败");
            }

            // 查找目标分类
            let targetCategory = TagManager._findCategoryRecursively(data, categoryKey);

            if (!targetCategory) {
                // 如果分类不存在，创建新分类
                data[categoryKey] = {};
                targetCategory = data[categoryKey];
            }

            // 检查标签名是否已存在
            if (targetCategory.hasOwnProperty(tagName)) {
                app.extensionManager.toast.add({
                    severity: "warn",
                    summary: "标签已存在",
                    detail: `标签 "${tagName}" 已存在于该分类中`,
                    life: 3000
                });
                throw new Error("Tag already exists");
            }

            // 添加新标签
            targetCategory[tagName] = tagValue;

            // 保存到 CSV 文件
            await ResourceManager.saveTagsCsv(filename, data);

            // 重新加载 CSV 数据以刷新缓存
            const newData = await ResourceManager.loadTagsCsv(filename);

            // 更新静态数据引用，确保后续拖拽排序使用最新数据
            TagManager.tagData = newData;

            // 刷新当前视图
            const activeTab = document.querySelector('.popup_tab.active');
            const content = document.querySelector('.popup_tab_content.active');
            if (activeTab && content) {
                const cat = activeTab.getAttribute('data-category');
                content.innerHTML = '';
                content.removeAttribute('data-loaded');

                if (cat === 'favorites') {
                    this._loadCategoryContent(content, this.favorites, 'favorites');
                } else {
                    this._loadCategoryContent(content, newData[cat], cat);
                }
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: "创建成功",
                detail: `标签 "${tagName}" 已添加到 "${categoryKey}" 分类`,
                life: 3000
            });

        } catch (error) {
            // 如果是验证错误，不显示错误提示（已经在验证时显示）
            if (error.message !== "Validation failed" && error.message !== "Tag already exists") {
                logger.error(`创建标签失败: ${error.message}`);
                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "创建失败",
                    detail: error.message,
                    life: 3000
                });
            }
        }
    }

    /**
     * 处理编辑标签
     */
    static _handleEditTag(target, tagName, tagValue, category) {
        // 创建表单内容渲染函数
        const renderForm = (container) => {
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '16px';
            container.style.minWidth = '300px';

            // 标签名输入组 - 使用浮动标签样式
            const nameGroup = document.createElement('div');
            nameGroup.className = 'settings-form-group';

            const nameFloatContainer = document.createElement('div');
            nameFloatContainer.className = 'float-label-container';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = tagName;
            nameInput.className = 'p-inputtext p-component';
            nameInput.placeholder = ' '; // 使用空格触发 :not(:placeholder-shown)

            const nameLabel = document.createElement('label');
            nameLabel.textContent = '标签名称';

            nameFloatContainer.appendChild(nameInput);
            nameFloatContainer.appendChild(nameLabel);
            nameGroup.appendChild(nameFloatContainer);
            container.appendChild(nameGroup);

            // 标签内容输入组 - 使用浮动标签样式
            const valueGroup = document.createElement('div');
            valueGroup.className = 'settings-form-group';

            const valueFloatContainer = document.createElement('div');
            valueFloatContainer.className = 'float-label-container';

            const valueInput = document.createElement('textarea');
            valueInput.value = tagValue;
            valueInput.className = 'p-inputtext p-component settings-form-textarea';
            valueInput.placeholder = ' ';
            valueInput.rows = 3;
            valueInput.style.resize = 'vertical';
            valueInput.style.minHeight = '80px';

            const valueLabel = document.createElement('label');
            valueLabel.textContent = '标签内容';

            valueFloatContainer.appendChild(valueInput);
            valueFloatContainer.appendChild(valueLabel);
            valueGroup.appendChild(valueFloatContainer);
            container.appendChild(valueGroup);

            // 返回引用以便获取值
            return { nameInput, valueInput, categoryInput: null };
        };

        // 查找合适的定位目标 (tag_item)
        const tagItem = document.querySelector(`.tag_item[data-value="${CSS.escape(tagValue)}"]`);
        const anchor = tagItem || document.body; // 降级处理

        let inputs = {};

        createConfirmPopup({
            target: anchor,
            message: '编辑标签信息',
            icon: 'pi-pencil',
            confirmLabel: '保存',
            renderFormContent: (container) => {
                inputs = renderForm(container);
            },
            onConfirm: async () => {
                const newName = inputs.nameInput.value.trim();
                const newValue = inputs.valueInput.value.trim();
                const newCategory = inputs.categoryInput ? inputs.categoryInput.value.trim() : category;

                if (!newName || !newValue) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "输入无效",
                        detail: "标签名称和内容不能为空",
                        life: 3000
                    });
                    throw new Error("Validation failed");
                }

                // 执行保存逻辑
                await this._saveTagEdit(tagName, tagValue, category, newName, newValue, newCategory);
            }
        });
    }

    /**
     * 保存标签编辑
     */
    static async _saveTagEdit(oldName, oldValue, oldCategory, newName, newValue, newCategory) {
        try {
            // 使用 loadTagsCsv 加载当前 CSV 文件的最新数据
            const filename = this.currentCsvFile || await ResourceManager.getSelectedTagFile();
            if (!filename) {
                throw new Error("无法确定当前 CSV 文件");
            }

            const data = await ResourceManager.loadTagsCsv(filename);
            if (!data || Object.keys(data).length === 0) {
                throw new Error("加载标签数据失败");
            }

            // 查找原始标签
            const found = TagManager._findTagRecursively(data, oldName, oldValue);

            if (!found) {
                throw new Error("无法定位原始标签数据，请刷新后重试");
            }

            const { parent } = found;

            // 删除旧标签
            delete parent[oldName];

            // 确定目标分类对象
            let targetCategoryObj;
            if (oldCategory !== newCategory && newCategory) {
                // 如果分类改变，移动到新分类
                targetCategoryObj = TagManager._findCategoryRecursively(data, newCategory);
                if (!targetCategoryObj) {
                    // 如果目标分类不存在，创建它
                    data[newCategory] = {};
                    targetCategoryObj = data[newCategory];
                }
            } else {
                // 分类未变，仍在原父对象中
                targetCategoryObj = parent;
            }

            // 添加新标签（或更新后的标签）
            targetCategoryObj[newName] = newValue;

            // 保存到 CSV 文件
            const saveSuccess = await ResourceManager.saveTagsCsv(filename, data);
            if (!saveSuccess) {
                throw new Error("保存文件失败");
            }

            // 重新加载并更新状态
            const newData = await ResourceManager.loadTagsCsv(filename);
            TagManager.tagData = newData;

            // 刷新当前视图
            const activeTab = document.querySelector('.popup_tab.active');
            const content = document.querySelector('.popup_tab_content.active');
            if (activeTab && content) {
                const cat = activeTab.getAttribute('data-category');
                content.innerHTML = '';
                content.removeAttribute('data-loaded');

                if (cat === 'favorites') {
                    this._loadCategoryContent(content, this.favorites, 'favorites');
                } else {
                    // 常规分类，如果分类名变了可能需要动态加载新分类
                    const displayCategory = newData[cat] ? cat : newCategory;
                    this._loadCategoryContent(content, newData[displayCategory] || newData, displayCategory);
                }
            }

            app.extensionManager.toast.add({
                severity: "success",
                summary: "保存成功",
                detail: "标签已更新",
                life: 3000
            });

        } catch (error) {
            logger.error(`保存编辑失败: ${error.message}`);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "保存失败",
                detail: error.message,
                life: 3000
            });
        }
    }

    /**
     * 处理删除标签
     */
    static async _handleDeleteTag(targetElement, tagName, tagValue) {
        createConfirmPopup({
            target: targetElement || document.body,
            message: `确定要删除标签 "${tagName}" 吗？`,
            icon: 'pi-exclamation-triangle',
            iconColor: 'var(--p-orange-500)',
            confirmLabel: '删除',
            cancelLabel: '取消',
            confirmDanger: true,
            onConfirm: async () => {
                try {
                    // 1. 获取当前 CSV 文件名
                    const filename = this.currentCsvFile || await ResourceManager.getSelectedTagFile();
                    if (!filename) {
                        throw new Error("无法确定当前 CSV 文件");
                    }

                    // 2. 加载 CSV 数据
                    const data = await ResourceManager.loadTagsCsv(filename);
                    if (!data) {
                        throw new Error("加载标签数据失败");
                    }

                    // 3. 在数据中查找并删除标签
                    let deleted = false;

                    // 递归删除函数
                    const deleteRecursively = (obj) => {
                        for (const key in obj) {
                            if (key === tagName && obj[key] === tagValue) {
                                delete obj[key];
                                deleted = true;
                                return true;
                            }
                            if (typeof obj[key] === 'object' && obj[key] !== null) {
                                if (deleteRecursively(obj[key])) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    };

                    deleteRecursively(data);

                    if (!deleted) {
                        throw new Error("未找到指定的标签");
                    }

                    // 4. 保存更改
                    const saveSuccess = await ResourceManager.saveTagsCsv(filename, data);
                    if (!saveSuccess) {
                        throw new Error("保存文件失败");
                    }

                    // 5. 刷新 UI
                    TagManager.tagData = data;

                    // 重新加载当前视图
                    const activeTab = document.querySelector('.popup_tab.active');
                    if (activeTab) {
                        const category = activeTab.getAttribute('data-category');
                        const content = document.querySelector(`.popup_tab_content[data-category="${category}"]`);

                        if (content) {
                            if (category === 'favorites') {
                                this._loadCategoryContent(content, this.favorites, 'favorites');
                            } else if (category === 'inserted') {
                                this._loadInsertedTagsContent(content);
                            } else {
                                this._loadCategoryContent(content, data[category], category);
                            }
                        }
                    }

                    app.extensionManager.toast.add({
                        severity: "success",
                        summary: "删除成功",
                        detail: `标签 "${tagName}" 已删除`,
                        life: 3000
                    });

                } catch (error) {
                    logger.error(`删除标签失败: ${error.message}`);
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "删除失败",
                        detail: error.message,
                        life: 3000
                    });
                }
            }
        });
    }

    /**
     * 更新标签的收藏状态显示
     */
    static updateTagFavoriteState(tagValue, isFavorited) {
        // 查找所有具有该值的标签元素
        // 注意：需要转义引号以防止选择器错误
        const safeValue = tagValue.replace(/"/g, '\\"');
        const tagItems = document.querySelectorAll(`.tag_item[data-value="${safeValue}"]`);

        tagItems.forEach(item => {
            const textSpan = item.querySelector('.tag_item_text');
            if (textSpan) {
                const currentText = textSpan.textContent;
                // 移除现有的星星前缀（如果有）
                const cleanText = currentText.replace(/^⭐️\s*/, '');
                // 根据状态添加或不添加前缀
                textSpan.textContent = isFavorited ? `⭐️ ${cleanText}` : cleanText;
            }
        });
    }

    /**
     * 比对输入框内容与标签缓存，更新标签状态
     */
    static compareInputWithCache(nodeId, inputId, updateUI = true) {
        const startTime = performance.now();

        // 获取输入框值
        const mappingKey = `${nodeId}_${inputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];
        if (!mapping || !mapping.inputEl) return { cacheCount: 0, matchedCount: 0 };

        const inputValue = mapping.inputEl.value;

        // 获取缓存
        const cache = TagCacheService.getTagCache(nodeId, inputId);
        const cacheCount = cache ? cache.size : 0;
        let matchedCount = 0;

        if (updateUI) {
            // 清空已使用标签映射
            this.usedTags.clear();

            // 获取所有标签元素
            const tagItems = document.querySelectorAll('.tag_item');

            // 遍历所有标签元素，更新状态
            tagItems.forEach(tagItem => {
                const tagValue = tagItem.getAttribute('data-value');
                if (!tagValue) return;

                // 检查是否在输入框中
                const isUsed = TagCacheService.isTagInInput(nodeId, inputId, tagValue, inputValue);

                if (isUsed) {
                    matchedCount++;
                    this.usedTags.set(tagValue, tagItem);
                }

                // 更新标签显示状态
                this.updateTagState(tagItem, isUsed);
            });
        } else {
            // 只统计匹配数量，不更新UI
            cache?.forEach((_, rawTag) => {
                if (TagCacheService.isTagInInput(nodeId, inputId, rawTag, inputValue)) {
                    matchedCount++;
                }
            });
        }

        const endTime = performance.now();
        // logger.debug(`标签状态 | 动作:比对 | 节点:${nodeId} | 输入框:${inputId} | 缓存数量:${cacheCount} | 匹配数量:${matchedCount} | 耗时:${(endTime - startTime).toFixed(2)}ms`);

        return { cacheCount, matchedCount };
    }

    /**
     * 创建特殊标签页结构（包含正常标签、收藏标签和已插入标签）
     */
    static _createTabsWithSpecialCategories(tagData, favorites, container, nodeId, inputId) {
        // 创建标签页框架
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'popup_tabs_container';

        // 创建标签滚动区域
        const tabsScroll = document.createElement('div');
        tabsScroll.className = 'popup_tabs_scroll';

        // 创建标签栏
        const tabs = document.createElement('div');
        tabs.className = 'popup_tabs';

        // 创建内容区域
        const content = document.createElement('div');
        content.className = 'popup_content';

        // 准备所有分类
        const categories = [];

        // 1. 添加收藏夹分类
        categories.push({
            name: 'favorites',
            displayName: '⭐️ 收藏',
            data: favorites,
            type: 'favorites'
        });

        // 2. 添加CSV中的分类
        if (tagData) {
            // 构建查找表
            this.tagLookup.clear();
            const buildLookup = (obj) => {
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === 'object' && value !== null) {
                        buildLookup(value);
                    } else if (typeof value === 'string') {
                        // Value -> Name 映射
                        // 注意：如果不同标签有相同的值，后面的会覆盖前面的名称。这通常是可以接受的。
                        this.tagLookup.set(value, key);
                    }
                }
            };
            buildLookup(tagData);

            Object.keys(tagData).forEach(key => {
                categories.push({
                    name: key,
                    displayName: key,
                    data: tagData[key],
                    type: 'normal'
                });
            });
        }

        // 3. 添加已插入分类
        categories.push({
            name: '已插入',
            displayName: '📝 已插入',
            data: null,
            type: 'inserted'
        });

        // 获取上次激活的标签页
        let activeTabName = this.getLastActiveTab();
        // 如果上次激活的是普通分类，但当前CSV中没有这个分类，则重置为第一个分类
        if (activeTabName &&
            activeTabName !== 'favorites' &&
            activeTabName !== '已插入' &&
            tagData && !tagData[activeTabName]) {
            activeTabName = null;
        }

        if (!activeTabName && categories.length > 0) {
            activeTabName = categories[0].name;
        }

        // 创建标签页和内容
        categories.forEach((category, index) => {
            // 创建标签
            const tab = document.createElement('div');
            tab.className = 'popup_tab';
            tab.textContent = category.displayName;
            tab.setAttribute('data-category', category.name);

            // 创建内容容器
            const tabContent = document.createElement('div');
            tabContent.className = 'popup_tab_content';
            tabContent.setAttribute('data-category', category.name);

            // 激活状态处理
            if (category.name === activeTabName) {
                tab.classList.add('active');
                tabContent.classList.add('active');

                // 立即加载当前激活的标签页内容
                if (category.type === 'favorites') {
                    // 使用标准的 _loadCategoryContent 加载，因为数据结构已统一
                    this._loadCategoryContent(tabContent, category.data, 'favorites');
                } else if (category.type === 'inserted') {
                    this._loadInsertedTagsContent(tabContent);
                } else {
                    this._loadCategoryContent(tabContent, category.data, category.name);
                }
            }

            // 标签点击事件
            const tabClickCleanup = EventManager.addDOMListener(tab, 'click', () => {
                // 切换标签激活状态
                tabs.querySelectorAll('.popup_tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // 切换内容激活状态
                content.querySelectorAll('.popup_tab_content').forEach(c => c.classList.remove('active'));
                tabContent.classList.add('active');

                // 记录激活的标签页
                this.setLastActiveTab(category.name);

                // 懒加载内容或需要实时刷新的内容
                if (!tabContent.hasAttribute('data-loaded') || category.type === 'favorites') {
                    if (category.type === 'favorites') {
                        // 收藏页每次点击都重新获取最新数据
                        // 先清空现有内容
                        tabContent.innerHTML = '';
                        // 重新获取收藏数据
                        ResourceManager.getFavorites().then(favorites => {
                            this.favorites = favorites; // 更新本地缓存
                            this._loadCategoryContent(tabContent, favorites, 'favorites');
                            tabContent.setAttribute('data-loaded', 'true');
                        }).catch(err => {
                            console.error("刷新收藏失败", err);
                        });
                    } else if (category.type === 'inserted') {
                        this._loadInsertedTagsContent(tabContent);
                        tabContent.setAttribute('data-loaded', 'true');
                    } else {
                        // 常规分类只加载一次
                        if (!tabContent.hasAttribute('data-loaded')) {
                            this._loadCategoryContent(tabContent, category.data, category.name);
                            tabContent.setAttribute('data-loaded', 'true');
                        }
                    }
                } else if (category.type === 'inserted') {
                    // 已插入标签页每次点击都刷新
                    this._loadInsertedTagsContent(tabContent);
                }

                // 确保标签完全可见
                tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            });
            this.eventCleanups.push(tabClickCleanup);

            tabs.appendChild(tab);
            content.appendChild(tabContent);
        });

        // ---在 Tab 栏末尾添加"新建分类"按钮---
        const addTabButton = document.createElement('div');
        addTabButton.className = 'popup_tab add_category_tab';
        addTabButton.title = '新建分类';

        const addTabIcon = document.createElement('span');
        addTabIcon.className = 'pi pi-plus';
        addTabButton.appendChild(addTabIcon);

        const addTabClickCleanup = EventManager.addDOMListener(addTabButton, 'click', (e) => {
            e.stopPropagation();
            this._handleAddCategory(addTabButton, null, tabs, content, tagData);
        });
        this.eventCleanups.push(addTabClickCleanup);
        tabs.appendChild(addTabButton);

        // 添加滚动指示器
        const leftIndicator = document.createElement('div');
        leftIndicator.className = 'popup_tabs_indicator left';
        const leftIcon = document.createElement('i');
        leftIcon.className = 'pi pi-chevron-left';
        leftIndicator.appendChild(leftIcon);

        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'popup_tabs_indicator right';
        const rightIcon = document.createElement('i');
        rightIcon.className = 'pi pi-chevron-right';
        rightIndicator.appendChild(rightIcon);

        // 更新指示器状态
        const updateIndicators = () => {
            const { scrollLeft, scrollWidth, clientWidth } = tabsScroll;
            leftIndicator.style.display = scrollLeft > 0 ? 'flex' : 'none';
            rightIndicator.style.display = scrollLeft < scrollWidth - clientWidth - 1 ? 'flex' : 'none';
        };

        // 监听滚动事件
        const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', updateIndicators);
        this.eventCleanups.push(scrollCleanup);

        // 监听窗口大小变化
        const resizeObserver = new ResizeObserver(updateIndicators);
        resizeObserver.observe(tabsScroll);
        // 保存清理函数
        this.eventCleanups.push(() => resizeObserver.disconnect());

        // 添加指示器点击事件
        const leftClickCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
            tabsScroll.scrollBy({ left: -200, behavior: 'smooth' });
        });
        this.eventCleanups.push(leftClickCleanup);

        const rightClickCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
            tabsScroll.scrollBy({ left: 200, behavior: 'smooth' });
        });
        this.eventCleanups.push(rightClickCleanup);

        // 组装DOM
        tabsScroll.appendChild(tabs);
        tabsContainer.appendChild(leftIndicator);
        tabsContainer.appendChild(tabsScroll);
        tabsContainer.appendChild(rightIndicator);

        container.appendChild(tabsContainer);
        container.appendChild(content);

        // 初始化指示器
        setTimeout(updateIndicators, 0);
    }

    /**
     * 按照CSV文件的分类结构重新组织收藏标签
     * @param {Object} csvData CSV文件的分类结构
     * @param {Object} favorites 收藏标签数据
     * @param {string} csvFileName 当前CSV文件名
     * @returns {Object} 重新组织后的收藏标签数据
     */
    static _reorganizeFavoritesByCSVStructure(csvData, favorites, csvFileName) {
        // 标准化CSV文件名（去除扩展名）
        const normalizedFileName = csvFileName.replace(/\.(csv|json|yaml|yml)$/i, '');

        // 获取当前CSV文件的收藏标签
        const csvFavorites = favorites[normalizedFileName] || {};

        // 如果没有收藏标签，返回空对象
        if (Object.keys(csvFavorites).length === 0) {
            return {};
        }

        // 递归函数：按照CSV结构组织收藏标签
        const reorganize = (structure) => {
            const result = {};
            for (const [key, value] of Object.entries(structure)) {
                if (typeof value === 'string') {
                    // 这是一个标签，检查是否在收藏中
                    if (Object.values(csvFavorites).includes(value)) {
                        // 找到对应的标签名
                        const tagName = Object.keys(csvFavorites).find(k => csvFavorites[k] === value);
                        if (tagName) {
                            result[tagName] = value;
                        }
                    }
                } else if (typeof value === 'object' && value !== null) {
                    // 这是一个分类，递归处理
                    const subResult = reorganize(value);
                    if (Object.keys(subResult).length > 0) {
                        result[key] = subResult;
                    }
                }
            }
            return result;
        };

        return reorganize(csvData);
    }


    /**
     * 加载单个分类的内容
     */
    static _loadCategoryContent(contentElement, categoryData, categoryName) {
        if (!contentElement) return;

        // 加载前先清空容器，避免重复添加或残留Empty Tip
        contentElement.innerHTML = '';

        // 特殊处理收藏夹
        if (categoryName === 'favorites') {
            // 直接使用favorites的原始结构（CSV文件名作为顶层分类）
            // categoryData 的结构应该是 {CSV文件名: {分类: {标签名: 标签值}}}

            // 如果没有收藏标签，显示空提示
            if (!categoryData || Object.keys(categoryData).length === 0) {
                const emptyTip = document.createElement('div');
                emptyTip.className = 'empty_tip';
                emptyTip.textContent = '暂无收藏标签，在标签上右键点击可添加到收藏';
                emptyTip.style.padding = '20px';
                emptyTip.style.textAlign = 'center';
                emptyTip.style.color = 'var(--text-color-secondary)';
                contentElement.appendChild(emptyTip);
                contentElement.setAttribute('data-loaded', 'true');
                return;
            }
        }

        if (!categoryData) return;

        // 创建一个内容容器，用于应用动画效果
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'tag_content_wrapper';

        // 异步加载分类内容
        setTimeout(() => {
            try {
                // 创建分类内容
                if (typeof categoryData === 'object' && categoryData !== null) {
                    // 对于收藏标签页，不传递rootCategory，因为顶层就是CSV文件名
                    // 对于普通标签页，传递当前CSV文件名作为根分类
                    const rootCategory = categoryName === 'favorites' ? null : this.currentCsvFile;
                    const innerContent = this._createInnerAccordion(categoryData, '1', categoryName, rootCategory);
                    contentWrapper.appendChild(innerContent);

                    // 添加到父容器
                    contentElement.appendChild(contentWrapper);

                    // 标记为已加载
                    contentElement.setAttribute('data-loaded', 'true');

                    // 触发渐显动画
                    requestAnimationFrame(() => {
                        // 确保DOM已经渲染
                        setTimeout(() => {
                            contentWrapper.classList.add('visible');

                            // 对于收藏标签页，自动展开当前CSV文件对应的手风琴
                            if (categoryName === 'favorites' && this.currentCsvFile) {
                                // 标准化CSV文件名（去除扩展名）
                                const normalizedFileName = this.currentCsvFile.replace(/\.(csv|json|yaml|yml)$/i, '');

                                // 查找对应的手风琴
                                const targetAccordion = contentElement.querySelector(`.tag_accordion[data-category="${normalizedFileName}"]`);
                                if (targetAccordion) {
                                    const header = targetAccordion.querySelector('.tag_accordion_header');
                                    if (header && !header.classList.contains('active')) {
                                        // 自动展开
                                        header.click();
                                    }
                                }
                            }
                        }, 10);
                    });
                }
            } catch (error) {
                logger.error(`加载标签分类失败: ${categoryName} | ${error.message}`);

                // 创建错误提示
                const errorMessage = document.createElement('div');
                errorMessage.textContent = `加载${categoryName}分类失败`;
                errorMessage.style.textAlign = 'center';
                errorMessage.style.padding = '20px';
                errorMessage.style.color = '#ff6b6b';

                contentWrapper.appendChild(errorMessage);
                contentElement.appendChild(contentWrapper);

                // 显示错误信息
                requestAnimationFrame(() => {
                    contentWrapper.classList.add('visible');
                });
            }
        }, 0); // 使用0延迟，让UI线程有机会更新
    }

    /**
     * 显示标签弹窗
     */
    static showTagPopup(options) {
        const {
            anchorButton,
            nodeId,
            inputId,
            onClose,
            buttonInfo,
            onTagSelect,
            refresh = false
        } = options;

        // 保存当前节点和输入框ID
        this.currentNodeId = nodeId;
        this.currentInputId = inputId;
        this.onTagSelectCallback = onTagSelect;

        // 清理现有事件监听
        this._cleanupEvents();

        // 初始化 Sortable
        this._initSortable();

        try {
            // 创建弹窗容器
            const popup = document.createElement('div');
            popup.className = 'popup_container tag_popup'; // 添加tag_popup类用于特定样式
            popup.style.display = 'flex';
            popup.style.flexDirection = 'column';
            popup.style.minHeight = '400px'; // 设置最小高度，确保 PopupManager 可以正确计算位置
            popup.style.maxHeight = '80vh';  // 设置最大高度，防止弹窗过大
            popup.style.height = 'auto';     // 允许高度自适应内容

            // 使用事件委托处理右键菜单 - 解决某些情况下事件无法绑定的问题
            popup.addEventListener('contextmenu', (e) => {
                const tagItem = e.target.closest('.tag_item');
                if (tagItem) {
                    const tagName = tagItem.getAttribute('data-name');
                    const tagValue = tagItem.getAttribute('data-value');

                    const category = tagItem.getAttribute('data-category');

                    if (tagValue && tagName) {
                        e.preventDefault();
                        e.stopPropagation();
                        // 记录日志确保触发
                        logger.debug(`Delegated context menu triggered on tag: ${tagName} | category: ${category}`);

                        try {
                            this._showContextMenu(e, tagValue, tagName, category);
                        } catch (error) {
                            logger.error(`Error showing context menu: ${error.message}`);
                            console.error(error);
                        }
                    }
                }
            }, true); // 使用捕获阶段


            // 创建标题栏
            const titleBar = document.createElement('div');
            titleBar.className = 'popup_title_bar';

            const title = document.createElement('div');
            title.className = 'popup_title';

            // 加载SVG图标(getIcon返回已包含SVG的容器)
            const iconContainer = ResourceManager.getIcon('icon-tag.svg');
            if (iconContainer) {
                iconContainer.style.width = '18px';
                iconContainer.style.height = '18px';
                iconContainer.style.color = 'var(--p-dialog-color)'; // 设置颜色供SVG继承
                title.appendChild(iconContainer);
            }

            // 创建CSV选择器容器
            const csvSelectorContainer = document.createElement('div');
            csvSelectorContainer.className = 'popup_csv_selector_container';
            csvSelectorContainer.style.marginRight = '10px';
            csvSelectorContainer.style.position = 'relative';

            // 创建自定义下拉按钮
            const csvSelector = document.createElement('button');
            csvSelector.className = 'popup_csv_selector';
            csvSelector.style.padding = '4px 12px 4px 8px';
            csvSelector.style.borderRadius = '10px';
            csvSelector.style.border = '0px solid var(--p-dialog-border-color)';
            csvSelector.style.backgroundColor = 'color-mix(in srgb, var(--comfy-menu-secondary-bg), transparent 60%)';
            csvSelector.style.color = 'var(--p-text-color)';
            csvSelector.style.outline = 'none';
            csvSelector.style.cursor = 'pointer';
            csvSelector.style.display = 'flex';
            csvSelector.style.alignItems = 'center';
            csvSelector.style.gap = '8px';
            csvSelector.style.minWidth = '120px';
            csvSelector.style.transition = 'border-color 0.2s, background-color 0.2s';

            // 添加文本标签
            const csvSelectorLabel = document.createElement('span');
            csvSelectorLabel.style.flex = '1';
            csvSelectorLabel.style.textAlign = 'left';
            csvSelectorLabel.style.fontSize = '14px';
            csvSelector.appendChild(csvSelectorLabel);

            // 添加下拉箭头图标
            const csvSelectorIcon = document.createElement('i');
            csvSelectorIcon.className = 'pi pi-chevron-down';
            csvSelectorIcon.style.fontSize = '12px';
            csvSelectorIcon.style.transition = 'transform 0.2s';
            csvSelector.appendChild(csvSelectorIcon);

            // 创建下拉菜单
            const csvDropdownMenu = document.createElement('div');
            csvDropdownMenu.className = 'pa-context-menu pa-dropdown-menu'; // 添加pa-dropdown-menu类用于区分
            csvDropdownMenu.style.display = 'none';
            csvDropdownMenu.style.position = 'absolute';
            csvDropdownMenu.style.top = 'calc(100% + 4px)';
            csvDropdownMenu.style.left = '0';
            csvDropdownMenu.style.minWidth = '100%';
            // z-index 由 CSS 的 --settings-context-menu-z-index 变量管理

            const csvMenuList = document.createElement('ul');
            csvMenuList.className = 'pa-context-menu-list';
            csvDropdownMenu.appendChild(csvMenuList);

            csvSelectorContainer.appendChild(csvSelector);
            csvSelectorContainer.appendChild(csvDropdownMenu);

            // 切换下拉菜单显示/隐藏
            let csvMenuOpen = false;
            const toggleCsvMenu = (e) => {
                e.stopPropagation();
                csvMenuOpen = !csvMenuOpen;

                if (csvMenuOpen) {
                    csvDropdownMenu.style.display = 'block';
                    requestAnimationFrame(() => {
                        csvDropdownMenu.classList.add('pa-context-menu-show');
                        csvSelectorIcon.style.transform = 'rotate(180deg)';
                    });
                    csvSelector.style.borderColor = 'var(--p-primary-color)';
                } else {
                    csvDropdownMenu.classList.remove('pa-context-menu-show');
                    csvDropdownMenu.classList.add('pa-context-menu-hide');
                    csvSelectorIcon.style.transform = 'rotate(0deg)';
                    csvSelector.style.borderColor = 'var(--p-dialog-border-color)';
                    setTimeout(() => {
                        csvDropdownMenu.style.display = 'none';
                        csvDropdownMenu.classList.remove('pa-context-menu-hide');
                    }, 150);
                }
            };

            // 关闭下拉菜单
            const closeCsvMenu = () => {
                if (csvMenuOpen) {
                    csvMenuOpen = false;
                    csvDropdownMenu.classList.remove('pa-context-menu-show');
                    csvDropdownMenu.classList.add('pa-context-menu-hide');
                    csvSelectorIcon.style.transform = 'rotate(0deg)';
                    csvSelector.style.borderColor = 'var(--p-dialog-border-color)';
                    setTimeout(() => {
                        csvDropdownMenu.style.display = 'none';
                        csvDropdownMenu.classList.remove('pa-context-menu-hide');
                    }, 150);
                }
            };

            // 点击按钮切换菜单
            const csvSelectorClickCleanup = EventManager.addDOMListener(csvSelector, 'click', toggleCsvMenu);
            this.eventCleanups.push(csvSelectorClickCleanup);

            // 点击外部关闭菜单
            const handleCsvMenuOutsideClick = (e) => {
                if (csvMenuOpen && !csvSelectorContainer.contains(e.target)) {
                    closeCsvMenu();
                }
            };
            const csvOutsideClickCleanup = EventManager.addDOMListener(document, 'click', handleCsvMenuOutsideClick, true);
            this.eventCleanups.push(csvOutsideClickCleanup);

            // 监听右键菜单打开事件,自动关闭CSV下拉菜单
            const handleContextMenuOpen = (e) => {
                // 如果右键菜单不是在CSV选择器容器内打开的,则关闭CSV下拉菜单
                if (csvMenuOpen && !csvSelectorContainer.contains(e.target)) {
                    closeCsvMenu();
                }
            };
            const contextMenuCleanup = EventManager.addDOMListener(document, 'contextmenu', handleContextMenuOpen, true);
            this.eventCleanups.push(contextMenuCleanup);

            // CSV切换处理函数
            const handleCsvChange = async (filename) => {
                if (filename && filename !== this.currentCsvFile) {
                    this.currentCsvFile = filename;
                    await ResourceManager.setSelectedTagFile(filename);

                    // 重新加载数据
                    loadingIndicator.style.display = 'block';
                    contentContainer.innerHTML = '';
                    contentContainer.appendChild(loadingIndicator);

                    try {
                        const [tagData, favorites] = await Promise.all([
                            ResourceManager.loadTagsCsv(filename),
                            ResourceManager.getFavorites()
                        ]);

                        this.favorites = favorites;

                        // 移除加载指示器
                        if (loadingIndicator.parentNode) {
                            loadingIndicator.parentNode.removeChild(loadingIndicator);
                        }

                        // 重新创建标签页
                        this._createTabsWithSpecialCategories(tagData, favorites, contentContainer, nodeId, inputId);

                        // 如果当前在收藏标签页，重新加载收藏标签内容
                        // _loadCategoryContent会自动展开当前CSV对应的手风琴
                        setTimeout(() => {
                            const activeTab = contentContainer.querySelector('.popup_tab.active');
                            if (activeTab && activeTab.getAttribute('data-category') === '⭐️') {
                                const favoritesContent = contentContainer.querySelector('.popup_tab_content[data-category="⭐️"]');
                                if (favoritesContent) {
                                    // 重新加载收藏标签内容（会自动展开当前CSV）
                                    this._loadCategoryContent(favoritesContent, favorites, 'favorites');
                                }
                            }
                        }, 50);
                    } catch (error) {
                        logger.error(`切换CSV文件失败: ${error.message}`);
                        loadingIndicator.textContent = '加载失败，请重试';
                    }
                }
            };

            // 创建搜索框容器
            const searchContainer = document.createElement('div');
            searchContainer.className = 'popup_search_container';

            const searchInput = document.createElement('input');
            searchInput.className = 'popup_search_input';
            searchInput.type = 'text';
            searchInput.placeholder = '搜索标签...';

            // 创建清除按钮
            const clearBtn = document.createElement('button');
            clearBtn.className = 'popup_btn';
            clearBtn.title = '清除搜索';
            clearBtn.style.display = 'none';
            UIToolkit.addIconToButton(clearBtn, 'pi-times', '清除搜索');

            // 添加清除按钮点击事件
            const clearBtnCleanup = EventManager.addDOMListener(clearBtn, 'click', (e) => {
                e.stopPropagation();
                searchInput.value = '';
                clearBtn.style.display = 'none';
                searchInput.blur(); // 让搜索框失去焦点
                this._handleSearch('');
            });
            this.eventCleanups.push(clearBtnCleanup);

            searchContainer.appendChild(searchInput);
            searchContainer.appendChild(clearBtn);

            // 创建操作按钮容器
            const actions = document.createElement('div');
            actions.className = 'popup_actions';

            // 移除了管理标签按钮

            // 添加刷新按钮
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'popup_btn';
            refreshBtn.title = '刷新标签状态';
            const refreshIcon = document.createElement('span');
            refreshIcon.className = 'pi pi-refresh';
            refreshBtn.appendChild(refreshIcon);
            refreshBtn.title = '刷新标签状态';

            // 添加关闭按钮
            const closeBtn = document.createElement('button');
            closeBtn.className = 'popup_btn';
            UIToolkit.addIconToButton(closeBtn, 'pi-times', '关闭');

            // 添加刷新事件
            const refreshCleanup = EventManager.addDOMListener(refreshBtn, 'click', async () => {
                try {
                    refreshBtn.style.transform = 'rotate(360deg)';
                    refreshBtn.style.transition = 'transform 0.5s';

                    // 显示加载指示器
                    contentContainer.innerHTML = '';
                    const refreshLoadingIndicator = document.createElement('div');
                    refreshLoadingIndicator.className = 'loading_indicator';
                    refreshLoadingIndicator.textContent = '重新加载标签数据...';
                    refreshLoadingIndicator.style.textAlign = 'center';
                    refreshLoadingIndicator.style.padding = '20px';
                    refreshLoadingIndicator.style.color = 'var(--text-color-secondary)';
                    contentContainer.appendChild(refreshLoadingIndicator);

                    // 重新加载当前CSV和收藏
                    if (this.currentCsvFile) {
                        const [tagData, favorites] = await Promise.all([
                            ResourceManager.loadTagsCsv(this.currentCsvFile, true), // 强制重新加载
                            ResourceManager.getFavorites()
                        ]);
                        this.favorites = favorites;
                        TagManager.tagData = tagData;

                        // 移除加载指示器
                        if (refreshLoadingIndicator.parentNode) {
                            refreshLoadingIndicator.parentNode.removeChild(refreshLoadingIndicator);
                        }

                        // 完全重新创建标签页结构
                        contentContainer.innerHTML = '';
                        this._createTabsWithSpecialCategories(tagData, favorites, contentContainer, nodeId, inputId);

                        logger.debug(`[助手-标签] 刷新完成 | CSV文件:${this.currentCsvFile}`);
                    }

                } catch (error) {
                    logger.error(`标签刷新失败: ${error.message}`);
                    // 显示错误信息
                    contentContainer.innerHTML = '';
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'loading_indicator';
                    errorMsg.textContent = '刷新失败,请重试';
                    errorMsg.style.textAlign = 'center';
                    errorMsg.style.padding = '20px';
                    errorMsg.style.color = 'var(--error-color)';
                    contentContainer.appendChild(errorMsg);
                } finally {
                    setTimeout(() => {
                        refreshBtn.style.transform = '';
                        refreshBtn.style.transition = '';
                    }, 500);
                }
            });
            this.eventCleanups.push(refreshCleanup);

            // 添加关闭事件
            const closeCleanup = EventManager.addDOMListener(closeBtn, 'click', () => {
                PopupManager.closeAllPopups();
            });
            this.eventCleanups.push(closeCleanup);

            // 添加搜索事件
            const searchCleanup = EventManager.addDOMListener(searchInput, 'input', (e) => {
                const value = e.target.value;
                clearBtn.style.display = value.length > 0 ? 'flex' : 'none';

                if (this.searchTimeout) {
                    clearTimeout(this.searchTimeout);
                }
                this.searchTimeout = setTimeout(() => {
                    this._handleSearch(value.toLowerCase());
                }, 300);
            });
            this.eventCleanups.push(searchCleanup);

            // 添加搜索框聚焦和点击事件，防止弹窗关闭
            const searchFocusCleanup = EventManager.addDOMListener(searchInput, 'focus', (e) => {
                e.stopPropagation();
            });
            this.eventCleanups.push(searchFocusCleanup);

            const searchClickCleanup = EventManager.addDOMListener(searchInput, 'click', (e) => {
                e.stopPropagation();
            });
            this.eventCleanups.push(searchClickCleanup);

            // 组装标题栏 - 修改组装顺序
            titleBar.appendChild(title);
            titleBar.appendChild(csvSelectorContainer); // 添加CSV选择器
            titleBar.appendChild(searchContainer);
            titleBar.appendChild(actions);
            // 移除了旧的管理按钮
            actions.appendChild(refreshBtn);
            actions.appendChild(closeBtn);

            // 创建内容容器
            const contentContainer = document.createElement('div');
            contentContainer.style.display = 'flex';
            contentContainer.style.flexDirection = 'column';
            contentContainer.style.flex = '1';
            contentContainer.style.overflow = 'hidden';
            contentContainer.style.minHeight = '350px'; // 设置最小高度，确保有足够空间显示加载状态

            // 组装弹窗
            popup.appendChild(titleBar);
            popup.appendChild(contentContainer);

            // 添加标签弹窗特有的类名，用于识别
            popup.classList.add('tag_popup');

            // 恢复保存的窗口大小或使用默认尺寸
            const savedSize = this.getPopupSize();
            if (savedSize) {
                popup.style.width = `${savedSize.width}px`;
                popup.style.height = `${savedSize.height}px`;
                // logger.debug(`[助手-标签] 恢复窗口大小 | 宽:${savedSize.width}px | 高:${savedSize.height}px`);
            } else {
                popup.style.width = '600px';
                popup.style.height = '400px';
            }

            // 显示弹窗
            PopupManager.showPopup({
                popup: popup,
                anchorButton: anchorButton,
                buttonInfo: buttonInfo,
                preventCloseOnElementTypes: ['tag_item', 'tag_item_text', 'tag_search_input'], // 阻止标签和搜索框关闭弹窗
                enableResize: true, // 启用窗口大小调节功能
                onClose: () => {
                    try {
                        // 关闭时记住当前激活的标签页
                        const activeTab = popup.querySelector('.popup_tab.active');
                        if (activeTab) {
                            const category = activeTab.getAttribute('data-category');
                            TagManager.setLastActiveTab(category);

                            // 保存当前标签页中所有手风琴的展开状态
                            const activeTabContent = popup.querySelector('.popup_tab_content.active');
                            if (activeTabContent) {
                                const accordions = activeTabContent.querySelectorAll('.tag_accordion');
                                accordions.forEach(accordion => {
                                    const accordionCategory = accordion.getAttribute('data-category');
                                    const header = accordion.querySelector('.tag_accordion_header');
                                    if (accordionCategory && header) {
                                        const isExpanded = header.classList.contains('active');
                                        TagManager.setAccordionState(category, accordionCategory, isExpanded);
                                    }
                                });
                            }
                        }
                    } catch (e) {
                        logger.error(`保存弹窗状态失败: ${e.message}`);
                    }
                    this._cleanupEvents();
                    if (typeof onClose === 'function') {
                        onClose();
                    }
                }
            });

            // 显示加载指示器
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'loading_indicator';
            loadingIndicator.textContent = '加载标签数据...';
            loadingIndicator.style.textAlign = 'center';
            loadingIndicator.style.padding = '20px';
            loadingIndicator.style.color = 'var(--text-color-secondary)';
            contentContainer.appendChild(loadingIndicator);

            // 加载数据并创建标签页
            (async () => {
                try {
                    // 1. 获取CSV文件列表
                    const files = await ResourceManager.getTagFileList();

                    // 2. 获取上次选择的文件
                    let selectedFile = await ResourceManager.getSelectedTagFile();

                    // 确保选择的文件在列表中
                    if (!files.includes(selectedFile) && files.length > 0) {
                        selectedFile = files[0];
                    }
                    this.currentCsvFile = selectedFile;

                    // 3. 填充下拉菜单
                    csvMenuList.innerHTML = '';

                    // 设置当前选中文件的显示文本
                    csvSelectorLabel.textContent = selectedFile.replace('.csv', '');

                    files.forEach(file => {
                        const menuItem = document.createElement('li');
                        menuItem.className = 'pa-context-menu-item';
                        if (file === selectedFile) {
                            menuItem.classList.add('active');
                        }

                        const menuItemContent = document.createElement('div');
                        menuItemContent.className = 'pa-context-menu-item-content';

                        const label = document.createElement('span');
                        label.className = 'pa-context-menu-item-label';
                        label.textContent = file.replace('.csv', '');
                        menuItemContent.appendChild(label);

                        menuItem.appendChild(menuItemContent);

                        // 点击菜单项切换CSV文件
                        menuItem.addEventListener('click', async (e) => {
                            e.stopPropagation();

                            // 更新选中状态
                            csvMenuList.querySelectorAll('.pa-context-menu-item').forEach(item => {
                                item.classList.remove('active');
                            });
                            menuItem.classList.add('active');

                            // 更新显示文本
                            csvSelectorLabel.textContent = file.replace('.csv', '');

                            // 关闭菜单
                            closeCsvMenu();

                            // 切换CSV文件
                            await handleCsvChange(file);
                        });

                        csvMenuList.appendChild(menuItem);
                    });

                    // 4. 加载标签数据和收藏
                    const [tagData, favorites] = await Promise.all([
                        ResourceManager.loadTagsCsv(selectedFile),
                        ResourceManager.getFavorites()
                    ]);

                    this.favorites = favorites;

                    // 移除加载指示器
                    if (loadingIndicator.parentNode) {
                        loadingIndicator.parentNode.removeChild(loadingIndicator);
                    }

                    // 5. 创建标签页
                    // 更新静态数据引用
                    TagManager.tagData = tagData;
                    this._createTabsWithSpecialCategories(tagData, favorites, contentContainer, nodeId, inputId);

                } catch (error) {
                    logger.error(`初始化标签弹窗失败: ${error.message}`);
                    loadingIndicator.textContent = '加载失败，请重试';
                }
            })();

        } catch (error) {
            logger.error(`标签弹窗创建失败: ${error.message}`);
            this._cleanupAll();
        }
    }

    /**
     * 创建特殊标签页结构（包含正常标签、自定义标签和已插入标签）
     */
    static _createTabsWithSpecialCategories(tagData, userTagData, container, nodeId, inputId) {
        // 创建标签页框架
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'popup_tabs_container';

        // 创建标签滚动区域
        const tabsScroll = document.createElement('div');
        tabsScroll.className = 'popup_tabs_scroll';

        // 创建标签栏
        const tabs = document.createElement('div');
        tabs.className = 'popup_tabs';

        // 创建内容区域
        const tabContents = document.createElement('div');
        tabContents.className = 'tag_category_container';
        tabContents.style.overflow = 'hidden';
        tabContents.style.display = 'flex';
        tabContents.style.flexDirection = 'column';

        // 创建左右滚动指示器
        const leftIndicator = document.createElement('div');
        leftIndicator.className = 'tabs_scroll_indicator left';
        const leftIconSpan = document.createElement('span');
        leftIconSpan.className = 'pi pi-angle-left scroll_indicator_icon';
        leftIndicator.appendChild(leftIconSpan);
        leftIndicator.style.display = 'none';

        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'tabs_scroll_indicator right';
        const rightIconSpan = document.createElement('span');
        rightIconSpan.className = 'pi pi-angle-right scroll_indicator_icon';
        rightIndicator.appendChild(rightIconSpan);
        rightIndicator.style.display = 'none';

        // 更新指示器状态的函数
        const updateIndicators = () => {
            const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
            if (!canScroll) {
                leftIndicator.style.display = 'none';
                rightIndicator.style.display = 'none';
                return;
            }
            // 使用更大的阈值（8像素）确保边界情况下能正确隐藏
            const scrollLeft = tabsScroll.scrollLeft;
            const maxScroll = tabsScroll.scrollWidth - tabsScroll.clientWidth;

            leftIndicator.style.display = scrollLeft > 8 ? 'flex' : 'none';
            rightIndicator.style.display = scrollLeft < (maxScroll - 8) ? 'flex' : 'none';
        };

        // 添加滚动指示器点击事件 - 每次滚动一个标签
        const leftClickCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
            // 获取所有标签
            const allTabs = tabs.querySelectorAll('.popup_tab');
            if (allTabs.length === 0) return;

            // 找到当前第一个可见的标签
            const scrollRect = tabsScroll.getBoundingClientRect();
            let firstVisibleTab = null;

            for (const tab of allTabs) {
                const tabRect = tab.getBoundingClientRect();
                // 如果标签的右边缘在可视区域内，说明它至少部分可见
                if (tabRect.right > scrollRect.left + 10) {
                    firstVisibleTab = tab;
                    break;
                }
            }

            // 找到前一个标签
            if (firstVisibleTab) {
                const currentIndex = Array.from(allTabs).indexOf(firstVisibleTab);
                if (currentIndex > 0) {
                    const prevTab = allTabs[currentIndex - 1];
                    prevTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                    // 滚动完成后更新指示器状态（使用更长的延迟确保动画完成）
                    setTimeout(updateIndicators, 600);
                }
            }
        });

        const rightClickCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
            // 获取所有标签
            const allTabs = tabs.querySelectorAll('.popup_tab');
            if (allTabs.length === 0) return;

            // 找到当前最后一个可见的标签
            const scrollRect = tabsScroll.getBoundingClientRect();
            let lastVisibleTab = null;

            for (let i = allTabs.length - 1; i >= 0; i--) {
                const tab = allTabs[i];
                const tabRect = tab.getBoundingClientRect();
                // 如果标签的左边缘在可视区域内，说明它至少部分可见
                if (tabRect.left < scrollRect.right - 10) {
                    lastVisibleTab = tab;
                    break;
                }
            }

            // 找到下一个标签
            if (lastVisibleTab) {
                const currentIndex = Array.from(allTabs).indexOf(lastVisibleTab);
                if (currentIndex < allTabs.length - 1) {
                    const nextTab = allTabs[currentIndex + 1];
                    nextTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
                    // 滚动完成后更新指示器状态（使用更长的延迟确保动画完成）
                    setTimeout(updateIndicators, 600);
                }
            }
        });

        // 监听滚动事件，控制滚动指示器的显示/隐藏
        const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', updateIndicators);

        // 监听窗口大小调整事件
        const resizeObserver = new ResizeObserver(() => {
            updateIndicators();
        });
        resizeObserver.observe(container);

        // 添加清理函数
        const resizeCleanup = () => {
            resizeObserver.disconnect();
        };

        this.eventCleanups.push(leftClickCleanup, rightClickCleanup, scrollCleanup, resizeCleanup);

        // 添加滚动指示器
        tabsContainer.appendChild(leftIndicator);
        tabsContainer.appendChild(tabsScroll);
        tabsContainer.appendChild(rightIndicator);

        // 将标签栏添加到滚动区域
        tabsScroll.appendChild(tabs);

        // 将标签页容器和内容区域添加到主容器
        container.appendChild(tabsContainer);
        container.appendChild(tabContents);

        // 获取所有标签页，重新排序将"⭐️"放在最前面
        const normalTabs = Object.keys(tagData);
        const allTabs = ['⭐️', ...normalTabs, '已插入'];
        // 记忆上次激活的标签页
        let activeTabIndex = 1; // 默认第二个标签（即tags.json的第一个类别）
        const lastCategory = this.getLastActiveTab();
        if (lastCategory && allTabs.includes(lastCategory)) {
            activeTabIndex = allTabs.indexOf(lastCategory);
        }

        // 创建所有标签页但不立即加载内容
        allTabs.forEach((category, index) => {
            // 创建标签
            const tab = document.createElement('div');
            tab.className = 'popup_tab';
            tab.textContent = category;
            tab.setAttribute('data-category', category);

            // 第一个标签默认激活
            if (index === activeTabIndex) {
                tab.classList.add('active');
            }

            // 添加标签点击事件
            const tabClickCleanup = EventManager.addDOMListener(tab, 'click', () => {
                const currentActiveTab = tabs.querySelector('.popup_tab.active');
                if (currentActiveTab === tab) return;

                if (currentActiveTab) {
                    currentActiveTab.classList.add('exiting');
                    const animationEndHandler = () => {
                        currentActiveTab.classList.remove('active', 'exiting');
                        currentActiveTab.removeEventListener('transitionend', animationEndHandler);
                    };
                    currentActiveTab.addEventListener('transitionend', animationEndHandler);
                }

                tabContents.querySelectorAll('.popup_tab_content').forEach(c => {
                    c.classList.remove('active');
                    c.style.display = 'none';
                });

                tab.classList.add('active');

                const contentId = tab.getAttribute('data-category');
                const content = tabContents.querySelector(`.popup_tab_content[data-category="${contentId}"]`);
                if (content) {
                    content.classList.add('active');
                    content.style.display = 'block';

                    // 记忆当前选择的标签页
                    TagManager.setLastActiveTab(contentId);

                    // 对于特殊标签页，每次点击都重新加载
                    if (contentId === '⭐️') {
                        this._loadCategoryContent(content, userTagData, 'favorites');
                    } else if (contentId === '已插入') {
                        this._loadInsertedTagsContent(content);
                    }
                    // 对于普通标签页，仅在首次加载
                    else if (content.getAttribute('data-loaded') !== 'true') {
                        this._loadCategoryContent(content, tagData[contentId], contentId);
                    }
                }

                // 确保选中的标签完全可见
                const tabRect = tab.getBoundingClientRect();
                const scrollRect = tabsScroll.getBoundingClientRect();

                const isFullyVisible =
                    tabRect.left >= scrollRect.left &&
                    tabRect.right <= scrollRect.right;

                if (!isFullyVisible) {
                    if (tabRect.left < scrollRect.left) {
                        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                    } else if (tabRect.right > scrollRect.right) {
                        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
                    }
                }
            });

            this.eventCleanups.push(tabClickCleanup);

            // 添加右键菜单事件（特殊分类除外）
            const specialCategories = ['⭐️', 'favorites', '已插入'];
            if (!specialCategories.includes(category)) {
                const tabContextMenuCleanup = EventManager.addDOMListener(tab, 'contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._showCategoryContextMenu(e, category, true, null);
                });
                this.eventCleanups.push(tabContextMenuCleanup);
            }

            tabs.appendChild(tab);

            // 创建内容区域
            const content = document.createElement('div');
            content.className = 'popup_tab_content';
            content.setAttribute('data-category', category);
            content.setAttribute('data-loaded', 'false'); // 标记为未加载
            content.style.flex = '1';
            content.style.display = 'none';

            // 第一个内容默认显示
            if (index === activeTabIndex) {
                content.classList.add('active');
                content.style.display = 'block';
            }

            tabContents.appendChild(content);
        });

        // ---在 Tab 栏末尾添加"新建分类"按钮---
        const addTabButton = document.createElement('div');
        addTabButton.className = 'popup_tab add_category_tab';
        addTabButton.title = '新建分类';

        const addTabIcon = document.createElement('span');
        addTabIcon.className = 'pi pi-plus';
        addTabButton.appendChild(addTabIcon);

        const addTabBtnClickCleanup = EventManager.addDOMListener(addTabButton, 'click', (e) => {
            e.stopPropagation();
            this._handleAddCategory(addTabButton, null, tabs, tabContents, tagData);
        });
        this.eventCleanups.push(addTabBtnClickCleanup);
        tabs.appendChild(addTabButton);

        // ---初始化 Tab 栏拖拽排序---
        if (this.Sortable) {
            const tabsSortable = new this.Sortable(tabs, {
                animation: 150,
                ghostClass: 'tag-ghost',
                draggable: '.popup_tab:not(.add_category_tab)', // 排除添加按钮
                delay: 50,
                onEnd: async (evt) => {
                    const { oldIndex, newIndex } = evt;
                    if (oldIndex === newIndex) return;

                    // 获取当前所有 Tab 的新顺序
                    const newOrder = Array.from(tabs.querySelectorAll('.popup_tab:not(.add_category_tab)'))
                        .map(tab => tab.getAttribute('data-category'));

                    // 重新排列 tagData
                    const newTagData = {};

                    // 按照新顺序重建数据对象
                    newOrder.forEach(category => {
                        // 特殊分类 (⭐️, 已插入) 不在 tagData 中，跳过
                        if (category !== '⭐️' && category !== '已插入' && tagData[category]) {
                            newTagData[category] = tagData[category];
                        }
                    });

                    // 确保没有遗漏的数据（以防万一）
                    Object.keys(tagData).forEach(category => {
                        if (!newTagData[category]) {
                            newTagData[category] = tagData[category];
                        }
                    });

                    // 更新内存中的数据
                    TagManager.tagData = newTagData;

                    // 持久化到 CSV
                    const filename = this.currentCsvFile || await ResourceManager.getSelectedTagFile();
                    if (filename) {
                        const success = await ResourceManager.saveTagsCsv(filename, newTagData);
                        if (success) {
                            app.extensionManager.toast.add({
                                severity: "success",
                                summary: "排序已保存",
                                detail: "分类显示顺序已更新",
                                life: 2000
                            });
                        }
                    }
                }
            });
            this.sortables.push(tabsSortable);
        }

        // 初始化滚动指示器，并自动定位到激活的标签页
        setTimeout(() => {
            const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
            if (canScroll) {
                // 找到激活的标签页
                const activeTab = tabs.querySelector('.popup_tab.active');
                if (activeTab) {
                    // 将激活的标签页滚动到可见区域
                    activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
                }

                // 等待滚动完成后，更新滚动指示器显示状态
                setTimeout(updateIndicators, 50);
            }
        }, 50);

        // 加载第一个激活的标签页内容
        const firstContent = tabContents.querySelector('.popup_tab_content.active');
        if (firstContent) {
            const firstCategory = firstContent.getAttribute('data-category');
            // 初始激活的标签页也进行记忆
            TagManager.setLastActiveTab(firstCategory);
            if (firstCategory === '⭐️') {
                this._loadCategoryContent(firstContent, userTagData, 'favorites');
            } else if (firstCategory === '已插入') {
                this._loadInsertedTagsContent(firstContent);
            } else {
                this._loadCategoryContent(firstContent, tagData[firstCategory], firstCategory);
            }
        }

        // 更新标签状态
        setTimeout(() => {
            this.compareInputWithCache(nodeId, inputId, true);
        }, 100);
    }

    /**
     * 处理搜索
     */
    static _handleSearch(searchText) {
        const tagItems = document.querySelectorAll('.tag_item');
        const accordions = document.querySelectorAll('.tag_accordion');
        const tabs = document.querySelectorAll('.popup_tab');
        const tabContents = document.querySelectorAll('.popup_tab_content');
        const popup = document.querySelector('.popup_container');
        const tabsContainer = document.querySelector('.popup_tabs_container');
        const tagCategoryContainers = document.querySelectorAll('.tag_category_container');

        // 搜索结果容器class
        const SEARCH_RESULT_CLASS = 'tag_search_result_list';
        let searchResultList = document.querySelector('.' + SEARCH_RESULT_CLASS);

        if (!searchText) {
            // 恢复原有内容
            if (searchResultList) searchResultList.remove();

            // 恢复标签页容器
            if (tabsContainer) {
                tabsContainer.style.display = '';
                tabsContainer.style.visibility = '';
            }

            // 恢复所有相关容器
            tagCategoryContainers.forEach(container => {
                container.style.display = '';
                container.style.visibility = '';
            });

            // 恢复标签项
            tagItems.forEach(item => {
                item.style.display = '';
                item.style.pointerEvents = '';
            });

            // 恢复手风琴
            accordions.forEach(accordion => {
                accordion.style.display = '';
                accordion.style.pointerEvents = '';
            });

            // 恢复标签页
            tabs.forEach(tab => {
                tab.style.display = '';
                tab.style.pointerEvents = '';
            });

            // 恢复标签页内容
            tabContents.forEach(content => {
                if (content.classList.contains('active')) {
                    content.style.display = 'block';
                } else {
                    content.style.display = 'none';
                }
                content.style.pointerEvents = '';
            });

            // 重置滚动条
            const tabsScroll = document.querySelector('.popup_tabs_scroll');
            if (tabsScroll) {
                const activeTab = document.querySelector('.popup_tab.active');
                if (activeTab) {
                    activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                } else {
                    tabsScroll.scrollLeft = 0;
                }
                setTimeout(() => {
                    tabsScroll.dispatchEvent(new Event('scroll'));
                }, 100);
            }

            // 重新更新标签状态，确保点击功能正常
            setTimeout(() => {
                this.compareInputWithCache(this.currentNodeId, this.currentInputId, true);
            }, 50);

            return;
        }

        // 有搜索内容时，彻底隐藏原有内容和tabs栏
        if (tabsContainer) {
            tabsContainer.style.display = 'none';
            tabsContainer.style.visibility = 'hidden';
        }

        // 隐藏所有分类容器
        tagCategoryContainers.forEach(container => {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
        });

        // 隐藏标签页内容
        tabContents.forEach(content => {
            content.style.display = 'none';
            content.style.pointerEvents = 'none';
        });

        // 隐藏标签页
        tabs.forEach(tab => {
            tab.style.display = 'none';
            tab.style.pointerEvents = 'none';
        });

        // 隐藏手风琴
        accordions.forEach(accordion => {
            accordion.style.display = 'none';
            accordion.style.pointerEvents = 'none';
        });

        // 移除旧的搜索结果容器
        if (searchResultList) searchResultList.remove();

        // 创建新的搜索结果容器
        searchResultList = document.createElement('div');
        searchResultList.className = SEARCH_RESULT_CLASS;

        // 从原始数据中搜索标签，而不是从DOM中搜索
        this._searchFromData(searchText, searchResultList).then(() => {
            // 搜索完成后刷新标签状态
            setTimeout(() => {
                this.refreshSearchResultsState();
            }, 10);
        }).catch(error => {
            logger.error(`搜索处理失败: ${error.message}`);
        });

        // 插入到内容区（搜索框下方）
        // 先尝试找到弹窗的主内容容器（标题栏的下一个兄弟元素）
        const titleBar = popup.querySelector('.popup_title_bar');
        let contentContainer = null;

        if (titleBar && titleBar.nextElementSibling) {
            contentContainer = titleBar.nextElementSibling;
        } else {
            // 备用方案：查找包含标签页的容器
            contentContainer = popup.querySelector('.tag_category_container')?.parentElement ||
                popup.querySelector('[class*="tab_content"]')?.parentElement;
        }

        if (contentContainer) {
            contentContainer.appendChild(searchResultList);
        } else {
            logger.error('无法找到合适的容器来插入搜索结果');
        }
    }

    /**
     * 从原始数据中搜索标签
     * @param {string} searchText 搜索文本
     * @param {HTMLElement} searchResultList 搜索结果容器
     */
    static async _searchFromData(searchText, searchResultList) {
        try {
            // 获取原始标签数据
            const [tagData, userTagData] = await Promise.all([
                ResourceManager.getTagData(),
                ResourceManager.getUserTagData()
            ]);

            let matchCount = 0;

            // 搜索系统标签
            matchCount += this._searchInDataObject(tagData, searchText, searchResultList, []);

            // 搜索用户自定义标签（⭐️标签页）
            matchCount += this._searchInDataObject(userTagData, searchText, searchResultList, ['⭐️']);

            // 搜索已插入标签
            matchCount += this._searchInsertedTags(searchText, searchResultList);

            // 无结果提示
            if (matchCount === 0) {
                const empty = document.createElement('div');
                empty.textContent = '无匹配标签';
                empty.className = 'search_empty_message';
                searchResultList.appendChild(empty);
            }

        } catch (error) {
            logger.error(`搜索标签数据失败: ${error.message}`);
            const errorMessage = document.createElement('div');
            errorMessage.textContent = '搜索失败，请重试';
            errorMessage.className = 'search_empty_message';
            searchResultList.appendChild(errorMessage);
        }
    }

    /**
     * 在数据对象中递归搜索标签
     * @param {Object} dataObj 数据对象
     * @param {string} searchText 搜索文本
     * @param {HTMLElement} container 结果容器
     * @param {Array} categoryPath 分类路径
     * @returns {number} 匹配的标签数量
     */
    static _searchInDataObject(dataObj, searchText, container, categoryPath = [], onMatch) {
        let localMatchCount = 0;

        for (const [key, value] of Object.entries(dataObj)) {
            if (typeof value === 'string') {
                // 这是一个标签
                const tagName = key;
                const tagValue = value;
                const matches = tagName.toLowerCase().includes(searchText) ||
                    tagValue.toLowerCase().includes(searchText);

                if (matches) {
                    // 创建标签元素
                    const tagElement = this._createSearchResultTag(tagName, tagValue, [...categoryPath]);
                    container.appendChild(tagElement);
                    localMatchCount++;
                }
            } else if (typeof value === 'object' && value !== null) {
                // 这是一个分类，递归搜索
                const childMatchCount = this._searchInDataObject(value, searchText, container, [...categoryPath, key]);
                localMatchCount += childMatchCount;
            }
        }

        if (onMatch) {
            onMatch(localMatchCount);
        }

        return localMatchCount;
    }

    /**
     * 搜索已插入标签
     * @param {string} searchText 搜索文本
     * @param {HTMLElement} container 结果容器
     * @returns {number} 匹配的标签数量
     */
    static _searchInsertedTags(searchText, container) {
        let matchCount = 0;
        const cache = TagCacheService.getTagCache(this.currentNodeId, this.currentInputId);

        if (cache && cache.size > 0) {
            cache.forEach((formatInfo, tagValue) => {
                // 尝试从已加载的DOM中找到对应的标签名
                let tagName = tagValue; // 默认使用值作为名称

                // 查找已加载的标签元素来获取显示名称
                const existingTag = document.querySelector(`.tag_item[data-value="${tagValue}"]`);
                if (existingTag) {
                    tagName = existingTag.getAttribute('data-name') || tagValue;
                }

                const matches = tagName.toLowerCase().includes(searchText) ||
                    tagValue.toLowerCase().includes(searchText);

                if (matches) {
                    const tagElement = this._createSearchResultTag(tagName, tagValue, ['已插入']);
                    container.appendChild(tagElement);
                    matchCount++;
                }
            });
        }

        return matchCount;
    }

    /**
     * 创建搜索结果标签元素
     * @param {string} tagName 标签名称
     * @param {string} tagValue 标签值
     * @param {Array} categoryPath 分类路径
     * @returns {HTMLElement} 标签元素
     */
    static _createSearchResultTag(tagName, tagValue, categoryPath) {
        const tagItem = document.createElement('div');
        tagItem.className = 'tag_item search_result_tag_item';
        tagItem.setAttribute('data-name', tagName);
        tagItem.setAttribute('data-value', tagValue);
        // 确保搜索结果也包含当前的分类上下文（当前文件）
        if (this.currentCsvFile) {
            tagItem.setAttribute('data-category', this.currentCsvFile);
        }

        const tagText = document.createElement('span');
        tagText.className = 'tag_item_text';
        tagText.textContent = tagName;
        tagItem.appendChild(tagText);

        // 检查标签是否已使用
        if (this.isTagUsed(tagValue, this.currentNodeId, this.currentInputId)) {
            tagItem.classList.add('used');
        }

        // 添加鼠标事件监听
        const mouseEnterCleanup = EventManager.addDOMListener(tagItem, 'mouseenter', () => {
            const tooltipContent = `${tagValue}\n<span class="tooltip_path">类别: ${categoryPath.join(' > ')}</span>`;
            this._showTooltip(tagItem, tooltipContent);
        });

        const mouseLeaveCleanup = EventManager.addDOMListener(tagItem, 'mouseleave', () => {
            this._hideTooltip();
        });

        // 添加点击事件
        const tagClickCleanup = EventManager.addDOMListener(tagItem, 'click', (e) => {
            this.handleTagClick(tagItem, tagName, tagValue, e);
        });

        this.eventCleanups.push(mouseEnterCleanup, mouseLeaveCleanup, tagClickCleanup);

        return tagItem;
    }

    /**
     * 隐藏标签弹窗
     */
    static hideTagPopup() {
        // 清理事件监听
        this._cleanupEvents();

        // 使用PopupManager关闭所有弹窗
        PopupManager.closeAllPopups();
    }

    /**
     * 清理所有相关资源
     */
    static _cleanupAll() {
        // 清理事件监听
        this._cleanupEvents();

        // 使用PopupManager关闭所有弹窗
        PopupManager.closeAllPopups();
    }

    /**
     * 清理所有事件监听
     */
    static _cleanupEvents() {
        // 执行并清空所有事件清理函数
        if (this.eventCleanups.length > 0) {
            this.eventCleanups.forEach(cleanup => {
                if (typeof cleanup === 'function') {
                    cleanup();
                }
            });
            this.eventCleanups = [];
        }
    }

    /**
     * 更新所有标签的状态
     */
    static updateAllTagsState(nodeId, inputId) {
        const mappingKey = `${nodeId}_${inputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];
        if (!mapping || !mapping.inputEl) return;

        const inputValue = mapping.inputEl.value;
        const startTime = performance.now();

        // 清空已使用标签映射
        this.usedTags.clear();

        // 获取所有标签元素，包括所有标签页中的标签
        const tagItems = document.querySelectorAll('.tag_item');
        let checkedCount = 0;
        let matchedCount = 0;

        // 检查每个标签是否在输入框中
        tagItems.forEach(tagItem => {
            const tagValue = tagItem.getAttribute('data-value');
            if (!tagValue) return;

            checkedCount++;

            // 检查是否在输入框中
            const isUsed = TagCacheService.isTagInInput(nodeId, inputId, tagValue, inputValue);

            if (isUsed) {
                matchedCount++;
            }

            // 更新状态
            this.updateTagState(tagItem, isUsed);

            // 如果已使用，添加到映射
            if (isUsed) {
                this.usedTags.set(tagValue, tagItem);
            }
        });

        const endTime = performance.now();
        // logger.debug(`标签状态 | 动作:更新所有 | 节点:${nodeId} | 输入框:${inputId} | 检查数量:${checkedCount} | 匹配数量:${matchedCount} | 耗时:${(endTime - startTime).toFixed(2)}ms`);
    }

    /**
     * 添加辅助方法：统计标签总数
     */
    static _countTags(tagData) {
        let count = 0;
        const countTagsInObject = (obj) => {
            for (const key in obj) {
                if (typeof obj[key] === 'string') {
                    count++;
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    countTagsInObject(obj[key]);
                }
            }
        };
        countTagsInObject(tagData);
        return count;
    }

    /**
     * 刷新搜索结果中的标签状态
     * 注意：不在此处绑定点击事件，避免与创建时的事件重复导致触发两次（插入后又被移除）。
     */
    static refreshSearchResultsState() {
        // 获取搜索结果中的所有标签
        const searchResultTags = document.querySelectorAll('.search_result_tag_item');

        // 更新每个搜索结果标签的状态
        searchResultTags.forEach(tagItem => {
            const tagValue = tagItem.getAttribute('data-value');
            if (!tagValue) return;

            // 检查是否已使用
            const isUsed = this.isTagUsed(tagValue, this.currentNodeId, this.currentInputId);

            // 更新状态
            this.updateTagState(tagItem, isUsed);
        });
    }

    /**
     * 创建收藏夹内容
     */


    /**
     * 加载已插入标签内容
     */
    static _loadInsertedTagsContent(container) {
        container.innerHTML = ''; // 清空内容
        container.setAttribute('data-loaded', 'true');

        // 创建内容包装器
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'tag_content_wrapper visible';

        // 创建标签容器
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'inserted_tags_container';
        tagsContainer.style.padding = '10px';
        tagsContainer.style.display = 'flex';
        tagsContainer.style.flexWrap = 'wrap';
        tagsContainer.style.gap = '8px';

        // 获取已使用的标签
        const usedTags = new Map();

        // 从输入框中获取标签
        const mappingKey = `${this.currentNodeId}_${this.currentInputId}`;
        const mapping = window.PromptAssistantInputWidgetMap?.[mappingKey];

        if (mapping && mapping.inputEl) {
            // 从标签缓存中获取所有标签
            const tagCache = TagCacheService.getTagCache(this.currentNodeId, this.currentInputId);

            if (tagCache && tagCache.size > 0) {
                // 获取输入框内容
                const inputValue = mapping.inputEl.value;

                // 遍历缓存，检查哪些标签在输入框中
                tagCache.forEach((formats, rawTag) => {
                    // 检查标签是否在输入框中
                    if (TagCacheService.isTagInInput(this.currentNodeId, this.currentInputId, rawTag, inputValue)) {
                        // 标签在输入框中，添加到已使用标签列表
                        usedTags.set(rawTag, formats);
                    }
                });
            }
        }

        if (usedTags.size === 0) {
            // 如果没有已插入标签
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty_tags_message';
            emptyMessage.textContent = '没有已插入标签';
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.padding = '20px';
            emptyMessage.style.color = 'var(--text-color-secondary)';

            contentWrapper.appendChild(emptyMessage);
        } else {
            // 加载标签数据，用于查找中文名称
            Promise.all([
                ResourceManager.getTagData(),
                ResourceManager.getUserTagData()
            ]).then(([tagData, userTagData]) => {
                // 创建标签名称映射表 (英文值 -> 中文名)
                const tagNameMap = new Map();

                // 递归函数，用于从标签数据中提取标签名称映射
                const extractTagNames = (data) => {
                    for (const key in data) {
                        const value = data[key];
                        if (typeof value === 'string') {
                            // 找到一个标签，添加到映射表 (值 -> 名称)
                            tagNameMap.set(value, key);
                        } else if (typeof value === 'object' && value !== null) {
                            // 递归处理子分类
                            extractTagNames(value);
                        }
                    }
                };

                // 从标准标签和用户标签中提取名称映射
                extractTagNames(tagData);
                extractTagNames(userTagData);

                // 如果有已插入标签，创建标签元素
                usedTags.forEach((formats, rawTag) => {
                    const tagItem = document.createElement('div');
                    tagItem.className = 'tag_item used';
                    tagItem.setAttribute('data-value', rawTag);

                    // 查找标签的中文名称，如果找不到则使用原始值
                    const tagName = tagNameMap.get(rawTag) || rawTag;
                    tagItem.setAttribute('data-name', tagName);

                    const tagText = document.createElement('span');
                    tagText.className = 'tag_item_text';
                    tagText.textContent = tagName; // 使用中文名称

                    tagItem.appendChild(tagText);

                    // 添加鼠标事件监听
                    const mouseEnterCleanup = EventManager.addDOMListener(tagItem, 'mouseenter', () => {
                        this._showTooltip(tagItem, rawTag); // 显示原始值作为提示
                    });

                    const mouseLeaveCleanup = EventManager.addDOMListener(tagItem, 'mouseleave', () => {
                        this._hideTooltip();
                    });

                    // 添加点击事件 - 移除标签
                    const tagClickCleanup = EventManager.addDOMListener(tagItem, 'click', (e) => {
                        // 先隐藏tooltip
                        this._hideTooltip();
                        this.handleTagClick(tagItem, tagName, rawTag, e);
                        // 移除后，重新加载已插入标签
                        setTimeout(() => {
                            // 重新加载已插入标签页
                            this._loadInsertedTagsContent(container);
                            // 更新所有标签页中的标签状态
                            this.updateAllTagsState(this.currentNodeId, this.currentInputId);
                            // 如果当前在搜索状态，也要更新搜索结果中的标签状态
                            const searchResultList = document.querySelector('.tag_search_result_list');
                            if (searchResultList) {
                                this.refreshSearchResultsState();
                            }
                        }, 100);
                    });

                    this.eventCleanups.push(mouseEnterCleanup, mouseLeaveCleanup, tagClickCleanup);

                    tagsContainer.appendChild(tagItem);
                });

                contentWrapper.appendChild(tagsContainer);
                container.appendChild(contentWrapper);
            }).catch(error => {
                // 处理错误情况
                logger.error(`加载已插入标签失败: ${error.message}`);

                const errorMessage = document.createElement('div');
                errorMessage.className = 'error_message';
                errorMessage.textContent = '加载已插入标签失败';
                errorMessage.style.textAlign = 'center';
                errorMessage.style.padding = '20px';
                errorMessage.style.color = '#ff6b6b';

                contentWrapper.appendChild(errorMessage);
                container.appendChild(contentWrapper);
            });
        }

        if (usedTags.size === 0) {
            container.appendChild(contentWrapper);
        }
    }
}

export { TagManager };