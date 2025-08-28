/**
 * 标签管理器
 * 负责管理标签的显示和操作
 */

import { logger } from '../utils/logger.js';
import { TagCacheService } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { PopupManager } from "../utils/popupManager.js";
import { ResourceManager } from "../utils/resourceManager.js";
import { EventManager } from "../utils/eventManager.js";
import { PromptFormatter } from "../utils/promptFormatter.js";
import { TagConfigManager } from "./tagConfigManager.js";

/**
 * 标签管理器类
 * 管理标签弹窗和标签选择
 */
class TagManager {
    static popupInstance = null;
    static onCloseCallback = null;  // 添加关闭回调存储
    static eventCleanups = [];      // 事件清理函数数组
    static searchTimeout = null;    // 搜索延迟定时器
    static currentNodeId = null;
    static currentInputId = null;
    static activeTooltip = null;
    static usedTags = new Map();    // 存储已使用标签的Map: key为标签值，value为对应的DOM元素

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

                logger.debug(`标签操作 | 动作:移除 | 标签:"${tagName}" | 原始值:"${tagValue}"`);
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

                logger.debug(`标签操作 | 动作:插入 | 标签:"${tagName}" | 原始值:"${tagValue}" | 格式类型:${formatType} | 插入格式:"${insertFormat}"`);
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
     */
    static _createAccordionContent(data, level = '0') {
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

            // 获取所有一级分类
            const categories = Object.keys(data);

            // 如果没有分类，返回空容器
            if (categories.length === 0) {
                const emptyContainer = document.createElement('div');
                emptyContainer.className = 'tag_category_container';
                return emptyContainer;
            }

            // 创建左右滚动指示器
            const leftIndicator = document.createElement('div');
            leftIndicator.className = 'tabs_scroll_indicator left';

            // 添加图标
            const leftIconSpan = document.createElement('span');
            leftIconSpan.className = 'pi pi-chevron-down rotate_left scroll_indicator_icon';
            leftIndicator.appendChild(leftIconSpan);
            leftIndicator.style.display = 'none'; // 初始隐藏

            const rightIndicator = document.createElement('div');
            rightIndicator.className = 'tabs_scroll_indicator right';

            // 添加图标
            const rightIconSpan = document.createElement('span');
            rightIconSpan.className = 'pi pi-chevron-down rotate_right scroll_indicator_icon';
            rightIndicator.appendChild(rightIconSpan);
            rightIndicator.style.display = 'none'; // 初始隐藏

            // 添加指示器点击事件 - 改进滚动逻辑
            const leftClickCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
                // 获取可视区域宽度
                const visibleWidth = tabsScroll.clientWidth;

                // 计算滚动距离，PrimeVue风格是滚动一个较大的距离
                const scrollDistance = visibleWidth * 0.75;

                // 平滑滚动
                tabsScroll.scrollBy({
                    left: -scrollDistance,
                    behavior: 'smooth'
                });
            });

            const rightClickCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
                // 获取可视区域宽度
                const visibleWidth = tabsScroll.clientWidth;

                // 计算滚动距离，PrimeVue风格是滚动一个较大的距离
                const scrollDistance = visibleWidth * 0.75;

                // 平滑滚动
                tabsScroll.scrollBy({
                    left: scrollDistance,
                    behavior: 'smooth'
                });
            });

            // 监听滚动事件，显示/隐藏滚动指示器
            const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', () => {
                // 检查是否需要滚动
                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;

                if (!canScroll) {
                    // 如果不需要滚动，隐藏两个指示器
                    leftIndicator.style.display = 'none';
                    rightIndicator.style.display = 'none';
                    return;
                }

                // 显示/隐藏左右滚动指示器
                leftIndicator.style.display = tabsScroll.scrollLeft > 0 ? 'flex' : 'none';
                rightIndicator.style.display =
                    tabsScroll.scrollLeft < (tabsScroll.scrollWidth - tabsScroll.clientWidth - 2) ? 'flex' : 'none';
            });

            this.eventCleanups.push(leftClickCleanup, rightClickCleanup, scrollCleanup);

            // 初始检测是否需要滚动指示器
            setTimeout(() => {
                // 检查是否需要滚动
                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;

                if (canScroll) {
                    // 如果需要滚动，显示右侧指示器
                    rightIndicator.style.display = 'flex';
                }
            }, 100);

            // 为每个一级分类创建标签和内容
            categories.forEach((category, index) => {
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

                // 递归创建子内容（二级分类开始使用手风琴）
                if (typeof data[category] === 'object' && data[category] !== null) {
                    const innerContent = this._createInnerAccordion(data[category], '1');
                    content.appendChild(innerContent);
                }

                tabContents.appendChild(content);
            });

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
                    const tagItem = document.createElement('div');
                    tagItem.className = 'tag_item';
                    tagItem.setAttribute('data-name', key);
                    tagItem.setAttribute('data-value', value);

                    // 检查标签是否已使用
                    if (this.isTagUsed(value, this.currentNodeId, this.currentInputId)) {
                        tagItem.classList.add('used');
                        this.usedTags.set(value, tagItem);
                    }

                    const tagText = document.createElement('span');
                    tagText.className = 'tag_item_text';
                    tagText.textContent = key;

                    tagItem.appendChild(tagText);

                    // 添加鼠标事件监听
                    const mouseEnterCleanup = EventManager.addDOMListener(tagItem, 'mouseenter', () => {
                        this._showTooltip(tagItem, value);
                    });

                    const mouseLeaveCleanup = EventManager.addDOMListener(tagItem, 'mouseleave', () => {
                        this._hideTooltip();
                    });

                    // 添加点击事件
                    const tagClickCleanup = EventManager.addDOMListener(tagItem, 'click', (e) => {
                        this.handleTagClick(tagItem, key, value, e);
                    });

                    this.eventCleanups.push(mouseEnterCleanup, mouseLeaveCleanup, tagClickCleanup);

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

                    // 添加图标
                    const arrowIconSpan = document.createElement('span');
                    arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
                    headerIcon.appendChild(arrowIconSpan);

                    header.appendChild(headerTitle);
                    header.appendChild(headerIcon);

                    const content = document.createElement('div');
                    content.className = 'tag_accordion_content';

                    // 递归创建子内容
                    const childContent = this._createAccordionContent(value, (parseInt(level) + 1).toString());
                    content.appendChild(childContent);

                    // 如果是当前层级的第一个手风琴，默认展开
                    if (isFirstAccordionInLevel) {
                        header.classList.add('active');
                        content.classList.add('active');
                        const arrowIconSpan = headerIcon.querySelector('.accordion_arrow_icon');
                        if (arrowIconSpan) {
                            arrowIconSpan.classList.add('rotate-180');
                        }
                        isFirstAccordionInLevel = false;
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
                                            }
                                        }
                                    }
                                });
                            }
                        }

                        // 使用优化的切换方法切换当前手风琴
                        this._toggleAccordion(header, content, headerIcon);
                    });

                    this.eventCleanups.push(accordionCleanup);

                    accordion.appendChild(header);
                    accordion.appendChild(content);
                    container.appendChild(accordion);
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
        const childContent = this._createAccordionContent(value, (parseInt(level) + 1).toString());
        content.appendChild(childContent);

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
     */
    static _createInnerAccordion(data, level) {
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

                // 添加图标
                const arrowIconSpan = document.createElement('span');
                arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
                headerIcon.appendChild(arrowIconSpan);

                header.appendChild(headerTitle);
                header.appendChild(headerIcon);

                const content = document.createElement('div');
                content.className = 'tag_accordion_content';

                // 递归创建子内容
                const childContent = this._createAccordionContent(value, (parseInt(level) + 1).toString());
                childContent.style.flex = '1'; // 让子内容占满可用空间
                childContent.style.minHeight = '0'; // 允许flex收缩
                content.appendChild(childContent);

                // 如果是第一个手风琴，默认展开
                if (isFirstAccordion) {
                    header.classList.add('active');
                    content.classList.add('active');
                    const firstArrowIcon = headerIcon.querySelector('.pi.pi-chevron-down');
                    if (firstArrowIcon) {
                        firstArrowIcon.classList.add('rotate-180');
                    }
                    isFirstAccordion = false;
                }

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
                                    const otherContent = otherHeader.nextElementSibling;
                                    const otherHeaderIcon = otherHeader.querySelector('.tag_accordion_icon');
                                    // 使用优化的切换方法关闭其他手风琴
                                    if (otherHeader.classList.contains('active')) {
                                        this._toggleAccordion(otherHeader, otherContent, otherHeaderIcon);
                                    }
                                }
                            });
                        }
                    }
                    // 使用优化的切换方法切换当前手风琴
                    this._toggleAccordion(header, content, headerIcon);
                });

                this.eventCleanups.push(accordionCleanup);

                accordion.appendChild(header);
                accordion.appendChild(content);
                container.appendChild(accordion);
            } else if (typeof value === 'string') {
                // 如果值是字符串，创建标签项（保持原有的标签创建逻辑）
                const tagItem = document.createElement('div');
                tagItem.className = 'tag_item';
                tagItem.setAttribute('data-name', key);
                tagItem.setAttribute('data-value', value);

                // 检查标签是否已使用
                if (this.isTagUsed(value, this.currentNodeId, this.currentInputId)) {
                    tagItem.classList.add('used');
                    this.usedTags.set(value, tagItem);
                }

                const tagText = document.createElement('span');
                tagText.className = 'tag_item_text';
                tagText.textContent = key;

                tagItem.appendChild(tagText);

                // 添加鼠标事件监听
                const mouseEnterCleanup = EventManager.addDOMListener(tagItem, 'mouseenter', () => {
                    this._showTooltip(tagItem, value);
                });

                const mouseLeaveCleanup = EventManager.addDOMListener(tagItem, 'mouseleave', () => {
                    this._hideTooltip();
                });

                // 添加点击事件
                const tagClickCleanup = EventManager.addDOMListener(tagItem, 'click', (e) => {
                    // 先隐藏tooltip
                    this._hideTooltip();
                    this.handleTagClick(tagItem, key, value, e);
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

                container.appendChild(tagItem);
            }
        }

        return container;
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
        logger.debug(`标签状态 | 动作:比对 | 节点:${nodeId} | 输入框:${inputId} | 缓存数量:${cacheCount} | 匹配数量:${matchedCount} | 耗时:${(endTime - startTime).toFixed(2)}ms`);

        return { cacheCount, matchedCount };
    }

    /**
     * 分批加载标签内容
     * @param {Object} tagData 标签数据
     * @param {HTMLElement} container 容器元素
     * @param {Function} onComplete 完成回调
     */
    static _loadTagsInBatches(tagData, container, onComplete) {
        // 获取所有一级分类
        const categories = Object.keys(tagData);
        let currentCategoryIndex = 0;

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
        const leftIcon = ResourceManager.getIcon('icon-movedown.svg');
        if (leftIcon) {
            leftIcon.classList.add('rotate_left', 'scroll_indicator_icon');
            leftIndicator.appendChild(leftIcon);
        }
        leftIndicator.style.display = 'none';

        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'tabs_scroll_indicator right';
        const rightIcon = ResourceManager.getIcon('icon-movedown.svg');
        if (rightIcon) {
            rightIcon.classList.add('rotate_right', 'scroll_indicator_icon');
            rightIndicator.appendChild(rightIcon);
        }
        rightIndicator.style.display = 'none';

        // 添加滚动指示器点击事件
        const leftClickCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
            const visibleWidth = tabsScroll.clientWidth;
            const scrollDistance = visibleWidth * 0.75;
            tabsScroll.scrollBy({
                left: -scrollDistance,
                behavior: 'smooth'
            });
        });

        const rightClickCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
            const visibleWidth = tabsScroll.clientWidth;
            const scrollDistance = visibleWidth * 0.75;
            tabsScroll.scrollBy({
                left: scrollDistance,
                behavior: 'smooth'
            });
        });

        this.eventCleanups.push(leftClickCleanup, rightClickCleanup);

        // 监听滚动事件
        const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', () => {
            const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
            if (!canScroll) {
                leftIndicator.style.display = 'none';
                rightIndicator.style.display = 'none';
                return;
            }

            leftIndicator.style.display = tabsScroll.scrollLeft > 0 ? 'flex' : 'none';
            rightIndicator.style.display =
                tabsScroll.scrollLeft < (tabsScroll.scrollWidth - tabsScroll.clientWidth - 2) ? 'flex' : 'none';
        });

        this.eventCleanups.push(scrollCleanup);

        // 组装标签页结构
        tabsScroll.appendChild(tabs);
        tabsContainer.appendChild(leftIndicator);
        tabsContainer.appendChild(tabsScroll);
        tabsContainer.appendChild(rightIndicator);

        // 添加到容器
        container.appendChild(tabsContainer);
        container.appendChild(tabContents);

        // 创建所有标签页但不立即加载内容
        categories.forEach((category, index) => {
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
                    content.style.display = 'flex';
                    content.style.flexDirection = 'column';

                    // 如果内容还没有加载，加载它
                    if (content.getAttribute('data-loaded') !== 'true') {
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
            tabs.appendChild(tab);

            // 创建内容区域
            const content = document.createElement('div');
            content.className = 'popup_tab_content';
            content.setAttribute('data-category', category);
            content.setAttribute('data-loaded', 'false'); // 标记为未加载
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

            tabContents.appendChild(content);
        });

        // 初始化滚动指示器
        setTimeout(() => {
            const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
            if (canScroll) {
                rightIndicator.style.display = 'flex';
            }
        }, 50);

        // 只加载第一个分类的内容
        const firstContent = tabContents.querySelector('.popup_tab_content.active');
        if (firstContent) {
            const firstCategory = firstContent.getAttribute('data-category');
            this._loadCategoryContent(firstContent, tagData[firstCategory], firstCategory);
        }

        // 完成回调
        if (typeof onComplete === 'function') {
            onComplete();
        }
    }

    /**
     * 加载单个分类的内容
     */
    static _loadCategoryContent(contentElement, categoryData, categoryName) {
        if (!contentElement || !categoryData) return;

        // 创建一个内容容器，用于应用动画效果
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'tag_content_wrapper';

        // 异步加载分类内容
        setTimeout(() => {
            try {
                // 创建分类内容
                if (typeof categoryData === 'object' && categoryData !== null) {
                    const innerContent = this._createInnerAccordion(categoryData, '1');
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

        try {
            // 创建弹窗容器
            const popup = document.createElement('div');
            popup.className = 'popup_container tag_popup'; // 添加tag_popup类用于特定样式
            popup.style.display = 'flex';
            popup.style.flexDirection = 'column';
            popup.style.minHeight = '400px'; // 设置最小高度，确保 PopupManager 可以正确计算位置
            popup.style.maxHeight = '80vh';  // 设置最大高度，防止弹窗过大
            popup.style.height = 'auto';     // 允许高度自适应内容

            // 创建标题栏
            const titleBar = document.createElement('div');
            titleBar.className = 'popup_title_bar';

            const title = document.createElement('div');
            title.className = 'popup_title';
            title.textContent = '标签工具';

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

            // 添加管理标签按钮
            const manageBtn = document.createElement('button');
            manageBtn.className = 'popup_btn';
            manageBtn.title = '管理标签';
            UIToolkit.addIconToButton(manageBtn, 'pi-pen-to-square', '管理标签');
            const manageCleanup = EventManager.addDOMListener(manageBtn, 'click', () => {
                const tagConfigManager = new TagConfigManager();
                tagConfigManager.showTagsConfigModal();
                PopupManager.closeAllPopups();
            });
            this.eventCleanups.push(manageCleanup);

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
            const refreshCleanup = EventManager.addDOMListener(refreshBtn, 'click', () => {
                try {
                    refreshBtn.style.transform = 'rotate(360deg)';
                    refreshBtn.style.transition = 'transform 0.5s';

                    // 执行比对和更新
                    this.compareInputWithCache(nodeId, inputId, true);

                    // 如果当前在搜索状态，也要刷新搜索结果中的标签状态
                    const searchResultList = document.querySelector('.tag_search_result_list');
                    if (searchResultList) {
                        this.refreshSearchResultsState();
                    }

                    // 刷新已插入标签页
                    const insertedTabContent = document.querySelector('.popup_tab_content[data-category="已插入"]');
                    if (insertedTabContent && insertedTabContent.classList.contains('active')) {
                        this._loadInsertedTagsContent(insertedTabContent);
                    }

                } catch (error) {
                    logger.error(`标签状态刷新失败: ${error.message}`);
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
            titleBar.appendChild(searchContainer);
            titleBar.appendChild(actions);
            actions.appendChild(manageBtn);
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

            // 设置初始尺寸
            popup.style.width = '600px';
            popup.style.height = '400px';

            // 显示弹窗
            PopupManager.showPopup({
                popup: popup,
                anchorButton: anchorButton,
                buttonInfo: buttonInfo,
                preventCloseOnElementTypes: ['tag_item', 'tag_item_text', 'tag_search_input'], // 阻止标签和搜索框关闭弹窗
                enableResize: true, // 启用窗口大小调节功能
                onClose: () => {
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
            Promise.all([
                ResourceManager.getTagData(refresh),
                ResourceManager.getUserTagData(refresh)
            ]).then(([tagData, userTagData]) => {
                // 移除加载指示器
                if (loadingIndicator.parentNode) {
                    loadingIndicator.parentNode.removeChild(loadingIndicator);
                }

                // 创建一个扩展的数据对象，包含原始标签和两个特殊标签页
                const combinedData = { ...tagData };

                // 清空已插入标签的缓存，准备重新收集
                this._insertedTagsCache = {};

                // 创建标签页结构
                this._createTabsWithSpecialCategories(combinedData, userTagData, contentContainer, nodeId, inputId);

            }).catch(error => {
                // 移除加载指示器
                if (loadingIndicator.parentNode) {
                    loadingIndicator.parentNode.removeChild(loadingIndicator);
                }

                // 显示错误消息
                const errorMessage = document.createElement('div');
                errorMessage.className = 'error_message';
                errorMessage.textContent = `标签数据加载失败: ${error.message}`;
                errorMessage.style.textAlign = 'center';
                errorMessage.style.padding = '20px';
                errorMessage.style.color = '#ff6b6b';
                contentContainer.appendChild(errorMessage);

                logger.error(`标签数据加载失败: ${error.message}`);
                // 不要调用_cleanupAll，保留弹窗以便用户看到错误信息
            });
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
        const leftIcon = ResourceManager.getIcon('icon-movedown.svg');
        if (leftIcon) {
            leftIcon.classList.add('rotate_left', 'scroll_indicator_icon');
            leftIndicator.appendChild(leftIcon);
        }
        leftIndicator.style.display = 'none';

        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'tabs_scroll_indicator right';
        const rightIcon = ResourceManager.getIcon('icon-movedown.svg');
        if (rightIcon) {
            rightIcon.classList.add('rotate_right', 'scroll_indicator_icon');
            rightIndicator.appendChild(rightIcon);
        }
        rightIndicator.style.display = 'none';

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
        const activeTabIndex = 1; // 设置第二个标签（即tags.json的第一个类别）为激活状态

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

                    // 对于特殊标签页，每次点击都重新加载
                    if (contentId === '⭐️') {
                        this._loadUserTagsContent(content);
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

        // 初始化滚动指示器
        setTimeout(() => {
            const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
            if (canScroll) {
                rightIndicator.style.display = 'flex';
            }
        }, 50);

        // 加载第一个激活的标签页内容
        const firstContent = tabContents.querySelector('.popup_tab_content.active');
        if (firstContent) {
            const firstCategory = firstContent.getAttribute('data-category');
            if (firstCategory === '⭐️') {
                this._loadUserTagsContent(firstContent);
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
        logger.debug(`标签状态 | 动作:更新所有 | 节点:${nodeId} | 输入框:${inputId} | 检查数量:${checkedCount} | 匹配数量:${matchedCount} | 耗时:${(endTime - startTime).toFixed(2)}ms`);
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
     */
    static refreshSearchResultsState() {
        // 获取搜索结果中的所有标签
        const searchResultTags = document.querySelectorAll('.search_result_tag_item');

        // 更新每个搜索结果标签的状态
        searchResultTags.forEach(tagItem => {
            const tagValue = tagItem.getAttribute('data-value');
            const tagName = tagItem.getAttribute('data-name');

            if (!tagValue) return;

            // 检查是否已使用
            const isUsed = this.isTagUsed(tagValue, this.currentNodeId, this.currentInputId);

            // 更新状态
            this.updateTagState(tagItem, isUsed);

            // 确保点击事件正常工作
            if (!tagItem.onclick) {
                tagItem.onclick = (e) => {
                    this.handleTagClick(tagItem, tagName, tagValue, e);
                };
            }
        });
    }

    /**
     * 加载用户自定义标签内容
     */
    static _loadUserTagsContent(container) {
        container.innerHTML = ''; // 清空内容
        container.setAttribute('data-loaded', 'true');

        // 创建内容包装器
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'tag_content_wrapper visible';

        // 强制刷新获取最新的用户数据
        ResourceManager.getUserTagData(true).then(userTagData => {
            if (!userTagData || Object.keys(userTagData).length === 0) {
                // 如果没有自定义标签
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'empty_tags_message';
                emptyMessage.textContent = '没有自定义标签';
                emptyMessage.style.textAlign = 'center';
                emptyMessage.style.padding = '20px';
                emptyMessage.style.color = 'var(--text-color-secondary)';

                contentWrapper.appendChild(emptyMessage);
            } else {
                // 如果有自定义标签，使用标准的创建方法
                const tagsContent = this._createInnerAccordion(userTagData, '1');
                contentWrapper.appendChild(tagsContent);
            }

            container.appendChild(contentWrapper);

            // 内容加载后，同步一下标签使用状态
            this.compareInputWithCache(this.currentNodeId, this.currentInputId, true);
        }).catch(error => {
            logger.error('加载用户自定义标签失败', error);
            const errorMessage = document.createElement('div');
            errorMessage.textContent = `加载自定义标签失败: ${error.message}`;
            errorMessage.className = 'error_message';
            container.appendChild(errorMessage);
        });
    }

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