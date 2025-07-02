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
                this.removeTag(tagValue, this.currentNodeId, this.currentInputId, true);
                this.updateTagState(tagElement, false);
                this.usedTags.delete(tagValue);
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

            // 创建图标元素
            const leftIconSpan = this._createIconElement('icon-movedown');
            leftIconSpan.classList.add('rotate_left', 'scroll_indicator_icon');
            leftIndicator.appendChild(leftIconSpan);
            leftIndicator.style.display = 'none'; // 初始隐藏

            const rightIndicator = document.createElement('div');
            rightIndicator.className = 'tabs_scroll_indicator right';

            // 创建图标元素
            const rightIconSpan = this._createIconElement('icon-movedown');
            rightIconSpan.classList.add('rotate_right', 'scroll_indicator_icon');
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
                        content.style.display = 'block';
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

                // 第一个内容默认显示
                if (index === 0) {
                    content.classList.add('active');
                    content.style.display = 'block';
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

                    // 创建图标元素
                    const iconSpan = this._createIconElement('icon-movedown');
                    iconSpan.classList.add('accordion_arrow_icon');
                    headerIcon.appendChild(iconSpan);

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
                        iconSpan.classList.add('rotate-180');
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
                                            otherHeader.classList.remove('active');
                                            const otherContent = otherHeader.nextElementSibling;
                                            if (otherContent && otherContent.classList.contains('active')) {
                                                otherContent.classList.remove('active');
                                            }
                                            const otherIcon = otherHeader.querySelector('.accordion_arrow_icon');
                                            if (otherIcon) {
                                                otherIcon.classList.remove('rotate-180');
                                            }
                                        }
                                    }
                                });
                            }
                        }

                        // 切换当前手风琴状态
                        header.classList.toggle('active');
                        content.classList.toggle('active');
                        // 图标旋转
                        const arrowIcon = headerIcon.querySelector('.accordion_arrow_icon');
                        if (arrowIcon) {
                            arrowIcon.classList.toggle('rotate-180');
                        }
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
        const iconSpan = this._createIconElement('icon-movedown');
        iconSpan.classList.add('accordion_arrow_icon');
        headerIcon.appendChild(iconSpan);

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
            const arrowIcon = headerIcon.querySelector('.accordion_arrow_icon');
            if (arrowIcon) {
                if (header.classList.contains('active')) {
                    arrowIcon.classList.add('rotate-180');
                } else {
                    arrowIcon.classList.remove('rotate-180');
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
        container.style.overflow = 'auto';
        container.style.maxHeight = 'none';

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

                // 使用icon.css中定义的类创建图标
                const iconSpan = document.createElement('span');
                iconSpan.className = 'icon-movedown';
                iconSpan.classList.add('accordion_arrow_icon');
                headerIcon.appendChild(iconSpan);

                header.appendChild(headerTitle);
                header.appendChild(headerIcon);

                const content = document.createElement('div');
                content.className = 'tag_accordion_content';

                // 递归创建子内容
                const childContent = this._createAccordionContent(value, (parseInt(level) + 1).toString());
                childContent.style.maxHeight = '160px'; // 限制嵌套内容高度
                content.appendChild(childContent);

                // 如果是第一个手风琴，默认展开
                if (isFirstAccordion) {
                    header.classList.add('active');
                    content.classList.add('active');
                    const iconSpan = headerIcon.querySelector('.accordion_arrow_icon');
                    if (iconSpan) {
                        iconSpan.classList.add('rotate-180');
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
                                    otherHeader.classList.remove('active');
                                    const otherContent = otherHeader.nextElementSibling;
                                    if (otherContent && otherContent.classList.contains('active')) {
                                        otherContent.classList.remove('active');
                                    }
                                    const otherIcon = otherHeader.querySelector('.accordion_arrow_icon');
                                    if (otherIcon) {
                                        otherIcon.classList.remove('rotate-180');
                                    }
                                }
                            });
                        }
                    }
                    // 切换当前手风琴状态
                    header.classList.toggle('active');
                    content.classList.toggle('active');
                    // 图标旋转
                    const arrowIcon = headerIcon.querySelector('.accordion_arrow_icon');
                    if (arrowIcon) {
                        arrowIcon.classList.toggle('rotate-180');
                    }
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
                    this.handleTagClick(tagItem, key, value, e);
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
        const leftIconSpan = this._createIconElement('icon-movedown');
        leftIconSpan.classList.add('rotate_left', 'scroll_indicator_icon');
        leftIndicator.appendChild(leftIconSpan);
        leftIndicator.style.display = 'none';

        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'tabs_scroll_indicator right';
        const rightIconSpan = this._createIconElement('icon-movedown');
        rightIconSpan.classList.add('rotate_right', 'scroll_indicator_icon');
        rightIndicator.appendChild(rightIconSpan);
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
                    content.style.display = 'block';

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

            // 第一个内容默认显示
            if (index === 0) {
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
            popup.className = 'popup_container';
            popup.style.display = 'flex';
            popup.style.flexDirection = 'column';
            popup.style.minHeight = '400px'; // 设置最小高度，确保 PopupManager 可以正确计算位置
            popup.style.maxHeight = '80vh';  // 设置最大高度，防止弹窗过大

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
            const clearIconSpan = this._createIconElement('icon-close');
            clearIconSpan.classList.add('popup_btn_icon');
            clearBtn.appendChild(clearIconSpan);
            clearBtn.title = '清除搜索';
            clearBtn.style.display = 'none';

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

            // 添加刷新按钮
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'popup_btn';
            const refreshIconSpan = this._createIconElement('icon-refresh');
            refreshIconSpan.classList.add('popup_btn_icon');
            refreshBtn.appendChild(refreshIconSpan);
            refreshBtn.title = '刷新标签状态';

            // 添加关闭按钮
            const closeBtn = document.createElement('button');
            closeBtn.className = 'popup_btn';
            const closeIconSpan = this._createIconElement('icon-close');
            closeIconSpan.classList.add('popup_btn_icon');
            closeBtn.appendChild(closeIconSpan);

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

            // 获取标签数据
            ResourceManager.getTagData(refresh).then(tagData => {
                // 使用分批加载方法
                this._loadTagsInBatches(tagData, contentContainer, () => {
                    // 标签加载完成后，更新标签状态
                    this.compareInputWithCache(nodeId, inputId, true);
                });
            }).catch(error => {
                logger.error(`标签数据加载失败: ${error.message}`);
                this._cleanupAll();
            });



        } catch (error) {
            logger.error(`标签弹窗创建失败: ${error.message}`);
            this._cleanupAll();
        }
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
        
        // 设置搜索结果容器的样式，确保正确显示并占满整个高度
        searchResultList.style.flex = '1';
        searchResultList.style.overflow = 'auto';
        searchResultList.style.height = '100%';
        searchResultList.style.boxSizing = 'border-box';
        searchResultList.style.position = 'relative'; // 为绝对定位的空消息提供参考

        // 收集所有匹配标签及其分类
        let matchCount = 0;
        tagItems.forEach(item => {
            const name = item.getAttribute('data-name') || '';
            const value = item.getAttribute('data-value') || '';
            const matches = name.toLowerCase().includes(searchText) || value.toLowerCase().includes(searchText);
            if (!matches) return;

            // 获取完整的分类路径
            const categoryPath = [];

            // 获取一级分类（标签页）
            const tabContent = item.closest('.popup_tab_content');
            if (tabContent) {
                const category = tabContent.getAttribute('data-category');
                if (category) categoryPath.push(category);
            }

            // 获取所有父级手风琴的标题
            let parent = item.closest('.tag_accordion');
            while (parent) {
                const title = parent.querySelector('.tag_accordion_title');
                if (title) {
                    categoryPath.unshift(title.textContent);
                }
                parent = parent.parentElement.closest('.tag_accordion');
            }

            // 克隆标签节点，保留交互
            const tagClone = item.cloneNode(true);
            tagClone.style.display = '';
            tagClone.style.cursor = 'pointer';
            tagClone.classList.add('search_result_tag_item');

            // 添加鼠标事件监听
            const mouseEnterCleanup = EventManager.addDOMListener(tagClone, 'mouseenter', () => {
                // 显示包含值和完整分类路径的tooltip
                const tooltipContent = `${value}\n<span class="tooltip_path">类别: ${categoryPath.join(' > ')}</span>`;
                this._showTooltip(tagClone, tooltipContent);
            });

            const mouseLeaveCleanup = EventManager.addDOMListener(tagClone, 'mouseleave', () => {
                this._hideTooltip();
            });

            // 重新绑定点击事件
            tagClone.onclick = (e) => {
                this.handleTagClick(tagClone, name, value, e);
            };

            // 检查标签是否已使用
            if (this.isTagUsed(value, this.currentNodeId, this.currentInputId)) {
                tagClone.classList.add('used');
            }

            searchResultList.appendChild(tagClone);
            matchCount++;

            this.eventCleanups.push(mouseEnterCleanup, mouseLeaveCleanup);
        });

        // 无结果提示
        if (matchCount === 0) {
            const empty = document.createElement('div');
            empty.textContent = '无匹配标签';
            empty.className = 'search_empty_message';
            searchResultList.appendChild(empty);
        }

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
            
            // 搜索结果创建完成后，刷新标签状态
            setTimeout(() => {
                this.refreshSearchResultsState();
            }, 10);
        } else {
            logger.error('无法找到合适的容器来插入搜索结果');
        }
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
     * 创建图标元素
     * @param {string} iconClass 图标CSS类名
     * @returns {HTMLElement} 图标元素
     */
    static _createIconElement(iconClass) {
        const iconElement = document.createElement('span');
        iconElement.className = iconClass;
        iconElement.setAttribute('aria-hidden', 'true');
        return iconElement;
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
}

export { TagManager };