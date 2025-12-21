/**
 * 节点帮助文档翻译模块 (Node Help Translator)
 * 独立模块，用于检测 ComfyUI 侧边栏的节点文档翻译功能
 */

import { APIService } from "../services/api.js";
import { logger } from "../utils/logger.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { createSplitButton, createTooltip } from "./uiComponents.js";
import { PromptFormatter } from "../utils/promptFormatter.js";

class NodeHelpTranslator {
    constructor() {
        this.observer = null;
        this.isObserving = false;
        this.stateCache = new Map();

        this.currentHelpPanel = {
            nodeName: null,
            element: null,
            bilingualSwitch: null
        };
    }

    initialize() {
        // 检查功能开关
        if (typeof window !== 'undefined' && window.FEATURES && !window.FEATURES.nodeHelpTranslator) {
            logger.log("[NodeHelpTranslator] 功能已禁用,跳过初始化");
            return;
        }

        if (this.isObserving) return;

        logger.log("[NodeHelpTranslator] 初始化监听器");

        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    this._handleDomChange(mutation.addedNodes);
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        this.isObserving = true;
    }

    _handleDomChange(addedNodes) {
        // 检查功能开关
        if (typeof window !== 'undefined' && window.FEATURES && !window.FEATURES.nodeHelpTranslator) {
            return;
        }

        const helpContent = document.querySelector('.node-help-content');
        if (helpContent) {
            this._checkAndInject();
        }
    }

    _checkAndInject() {
        // 检查功能开关
        if (typeof window !== 'undefined' && window.FEATURES && !window.FEATURES.nodeHelpTranslator) {
            return;
        }

        if (this._injectTimer) clearTimeout(this._injectTimer);
        this._injectTimer = setTimeout(() => {
            const helpContent = document.querySelector('.node-help-content');
            if (!helpContent) return;

            const container = helpContent.closest('.flex.flex-col');
            if (container) {
                const header = container.querySelector('.border-b');
                if (header) {
                    const titleSpan = header.querySelector('span.font-semibold');
                    const currentNodeName = titleSpan ? titleSpan.textContent.trim() : 'Unknown';

                    const existingBtnContainer = header.querySelector('.pa-help-translate-btn-container');

                    if (!existingBtnContainer) {
                        const sampleText = helpContent.innerText.substring(0, 500);
                        const langDetect = PromptFormatter.detectLanguage(sampleText);

                        if (langDetect.from === 'en') {
                            this._injectTranslateButton(header, currentNodeName, helpContent);
                        } else {
                            logger.log(`[NodeHelpTranslator] 内容为中文或混合语言(${langDetect.from}→${langDetect.to})，不显示翻译按钮`);
                        }
                    } else {
                        const btn = existingBtnContainer.querySelector('button');
                        if (btn && btn.dataset.nodeName !== currentNodeName) {
                            logger.log(`[NodeHelpTranslator] 检测到节点切换: ${btn.dataset.nodeName} -> ${currentNodeName}，重置按钮状态`);
                            this._resetButtonState(btn, currentNodeName);
                        }
                    }
                }
            }
        }, 200);
    }

    _injectTranslateButton(header, nodeName, helpContent) {
        if (!header) return;
        if (header.querySelector('.pa-help-translate-btn-container')) return;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'pa-help-translate-btn-container';

        // 使用 SplitButton
        const splitBtn = createSplitButton({
            label: "翻译文档",
            icon: "pi pi-language",
            className: "p-splitbutton-compact p-splitbutton-primary",
            onClick: (e) => {
                const btn = splitBtn.container.querySelector('.p-button:first-child');
                this._handleTranslateClick(e, btn);
            },
            items: this._getMenuItems(nodeName, 'bilingual')
        });

        const mainBtn = splitBtn.container.querySelector('.p-button:first-child');
        mainBtn.classList.add('pa-translate-btn');
        mainBtn.dataset.nodeName = nodeName;
        mainBtn._paSplitBtn = splitBtn;
        this.currentHelpPanel.splitBtn = splitBtn;

        this._setButtonContent(mainBtn, 'translate');

        btnContainer.appendChild(splitBtn.container);
        header.appendChild(btnContainer);

        logger.log(`[NodeHelpTranslator] 已注入翻译按钮(SplitBtn)到节点: ${nodeName}`);

        if (helpContent) {
            this._restoreFromCache(mainBtn, helpContent, nodeName);
        }
    }

    _resetButtonState(btn, newNodeName) {
        btn.dataset.nodeName = newNodeName;
        this._setButtonContent(btn, 'translate');
        btn.disabled = false;

        if (btn._paSplitBtn) {
            btn._paSplitBtn.updateMenu(this._getMenuItems(newNodeName, 'bilingual'));
        }

        const container = btn.closest('.flex.flex-col');
        const helpContent = container ? container.querySelector('.node-help-content') : null;
        if (helpContent) {
            this._restoreFromCache(btn, helpContent, newNodeName);
        }
    }

    _setButtonContent(btn, type) {
        let label = '翻译';
        let iconClass = 'pi pi-language pa-translate-btn-icon';
        let spinning = false;
        let tooltip = '';

        switch (type) {
            case 'translate':
                label = '翻译';
                iconClass = 'pi pi-language pa-translate-btn-icon';
                tooltip = '使用提示词小助手翻译文档';
                break;
            case 'translating':
                label = '翻译中...';
                iconClass = 'pi pi-spinner pa-translate-btn-icon';
                spinning = true;
                tooltip = '正在翻译文档...';
                break;
            case 'translated':
                label = '已翻译';
                iconClass = 'pi pi-check pa-translate-btn-icon';
                tooltip = '使用提示词小助手重新翻译';
                break;
        }

        if (btn._paSplitBtn) {
            btn._paSplitBtn.updateMainButton(label, iconClass, spinning);
        } else {
            btn.innerHTML = `
                <span class="p-button-icon p-button-icon-left ${iconClass} pa-translate-btn-icon ${spinning ? 'spinning' : ''}"></span>
                <span class="p-button-label">${label}</span>
            `;
        }

        // 更新自定义 Tooltip
        if (btn._paTooltip) {
            btn._paTooltip.destroy();
            btn._paTooltip = null;
        }

        if (tooltip) {
            btn._paTooltip = createTooltip({
                target: btn,
                content: tooltip,
                position: 'top'
            });
        }
    }

    async _handleTranslateClick(e, btn) {
        e.stopPropagation();

        const nodeName = btn.dataset.nodeName;
        const header = btn.closest('.border-b');
        if (!header) return;

        const container = header.parentElement;
        const contentEl = container.querySelector('.node-help-content');

        if (!contentEl) {
            UIToolkit.showStatusTip(btn, 'warn', '未找到帮助内容');
            return;
        }

        // 允许重新翻译：无论当前状态如何，点击按钮都触发翻译
        // 如果想要防抖或避免意外点击，可以检查 btn.disabled (已经在 _performTranslation 中处理)
        await this._performTranslation(btn, contentEl, nodeName);
    }

    async _performTranslation(btn, contentEl, nodeName) {
        this._setButtonContent(btn, 'translating');
        btn.disabled = true;

        try {
            // 重置之前的翻译状态（如果有）
            // 如果已经翻译过，先还原DOM，以便重新提取文本
            const existingTranslatable = contentEl.querySelectorAll('.pa-translatable');
            if (existingTranslatable.length > 0) {
                existingTranslatable.forEach(el => {
                    if (el.dataset.paOriginal) {
                        el.innerHTML = el.dataset.paOriginal;
                    }
                    el.classList.remove('pa-translatable');
                    delete el.dataset.paTranslation;
                    // dataset.paOriginal 保留或删除皆可，保留着也没事，extractTextBlocks 不会利用它，而是读 innerText
                    // 但是为了干净，还是清理一下
                    delete el.dataset.paOriginal;
                });
            }

            contentEl.classList.remove('pa-mode-bilingual', 'pa-mode-translation-only', 'pa-mode-original-only');

            const textBlocks = this._extractTextBlocks(contentEl);
            if (textBlocks.length === 0) {
                UIToolkit.showStatusTip(btn, 'warn', '没有找到可翻译的内容');
                this._setButtonContent(btn, 'translate'); // 恢复为待翻译状态
                return;
            }
            // ... remainder is unchanged logic, but extractTextBlocks comes next


            const textsToTranslate = textBlocks.map(block => block.text);
            let translations = [];
            let isBaidu = false;

            // 1. 获取翻译配置，判断是否使用百度翻译
            try {
                const configResp = await fetch(APIService.getApiUrl('/config/translate'));
                if (configResp.ok) {
                    const config = await configResp.json();
                    if (config.provider === 'baidu') {
                        isBaidu = true;
                    }
                }
            } catch (e) {
                logger.warn(`[NodeHelpTranslator] 获取翻译配置失败: ${e.message}，将默认使用LLM`);
            }

            // 2. 根据服务类型执行翻译
            if (isBaidu) {
                logger.log('[NodeHelpTranslator] 使用百度翻译API进行翻译');
                // 百度批量翻译是串行请求，返回结果数组
                const results = await APIService.batchBaiduTranslate(textsToTranslate, 'en', 'zh');

                // 提取翻译结果，BaiduTranslateService 返回格式需与 LLM 保持一致 (data.translated)
                // 如果某个请求失败，result.success 为 false，这里暂时填 null 跳过
                translations = results.map(r => {
                    if (r && r.success && r.data && r.data.translated) {
                        return r.data.translated;
                    }
                    return null;
                });

                // 检查是否所有翻译都失败了
                const successCount = translations.filter(t => t !== null).length;
                if (successCount === 0 && textsToTranslate.length > 0) {
                    throw new Error('所有文本翻译失败 (Baidu)');
                }

            } else {
                logger.log('[NodeHelpTranslator] 使用LLM API进行批量翻译');
                const result = await APIService.llmBatchTranslate(textsToTranslate, 'en', 'zh');

                if (result.success && result.data && result.data.translations) {
                    translations = result.data.translations;
                } else {
                    throw new Error(result.error || '翻译接口返回错误');
                }
            }

            // 3. 渲染结果
            const cleanedTranslations = translations.map(t => t ? t.replace(/^\|\s*/, '') : t);
            this._renderTranslations(textBlocks, cleanedTranslations, nodeName);

            this.stateCache.set(nodeName, { translated: true, viewMode: 'bilingual' });

            if (this.currentHelpPanel.splitBtn) {
                this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, 'bilingual'));
            }

            this._setButtonContent(btn, 'translated');

        } catch (error) {
            logger.error(`[NodeHelpTranslator] 翻译失败: ${error.message}`);
            UIToolkit.showStatusTip(btn, 'error', '翻译失败: ' + error.message);
            this._setButtonContent(btn, 'translate');
            btn.disabled = false;
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * 提取文本块
     */
    _extractTextBlocks(rootEl) {
        const blocks = [];
        // 优化1：不提取 th (表头)，因为无需翻译
        const candidates = rootEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td');

        for (const el of candidates) {
            const text = el.innerText.trim();
            if (!text) continue;

            // 过滤纯数字和标点
            if (/^[0-9\s\p{P}]+$/u.test(text)) continue;

            // 优化2：过滤看似“类型”定义的纯大写单词 (如 IMAGE, FLOAT, BOOLEAN, COMBO等)
            // 允许特定符号如下划线，但不包含空格（通常类型是一个单词）
            // 限制长度<30，防止误伤全大写的长句子
            // 注意：参数名通常是 snake_case (小写)，所以不会被过滤
            if (/^[A-Z0-9_]+$/.test(text) && text.length < 30) continue;

            if (el.closest('pre') || el.closest('code')) continue;
            if (el.classList.contains('pa-translatable')) continue;
            if (el.closest('.pa-translatable')) continue;

            const hasBlockChildren = Array.from(el.children).some(child =>
                ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'UL', 'OL'].includes(child.tagName)
            );
            if (hasBlockChildren) continue;

            blocks.push({ element: el, text: text });
        }

        return blocks;
    }

    _renderTranslations(blocks, translations, nodeName) {
        // 保存用于缓存的数据
        const cacheData = [];

        blocks.forEach((block, index) => {
            const translation = translations[index];
            if (!translation) return;

            const el = block.element;
            el.classList.add('pa-translatable');

            if (!el.dataset.paOriginal) {
                el.dataset.paOriginal = el.innerHTML;
            }
            el.dataset.paTranslation = translation;

            this._updateBlockContent(el, 'bilingual');

            // 收集缓存数据（存储原始HTML的哈希或简单选择器作为标识可能不可靠，因为DOM结构变化）
            // 这里我们使用一种简单策略：按顺序存储。
            // 只要帮助文档内容没变，顺序提取的文本块也应该没变。
            cacheData.push({
                index: index, // 保存索引，以便恢复时匹配
                translation: translation
            });
        });

        // 保存到缓存
        if (nodeName) {
            this._saveToCache(nodeName, {
                translations: cacheData,
                timestamp: Date.now(),
                bilingual: true
            });
        }
    }

    _updateBlockContent(el, mode) {
        const original = el.dataset.paOriginal || '';
        const translation = el.dataset.paTranslation || '';

        // Wrap original content to allow toggling visibility
        const wrappedOriginal = `<span class="pa-original-content">${original}</span>`;
        const separator = `<span class="pa-trans-separator"></span>`;
        const styledTranslation = `<span class="pa-trans-text">${translation.replace(/\n/g, '<br>')}</span>`;

        el.innerHTML = `${wrappedOriginal}${separator}${styledTranslation}`;
    }

    // --- 缓存管理 ---

    _getCacheKey() {
        return 'pa_node_help_translations';
    }

    _loadFromCache(nodeName) {
        try {
            const raw = sessionStorage.getItem(this._getCacheKey());
            if (!raw) return null;
            const cache = JSON.parse(raw);
            return cache[nodeName] || null;
        } catch (e) {
            console.error('[NodeHelpTranslator] 读取缓存失败', e);
            return null;
        }
    }

    _saveToCache(nodeName, data) {
        try {
            const key = this._getCacheKey();
            const raw = sessionStorage.getItem(key);
            let cache = raw ? JSON.parse(raw) : {};

            cache[nodeName] = data;

            // 简单的清理策略：如果太大了，清空旧的（虽然sessionStorage限制是按域名，但也要防止无限增长）
            // 这里暂不实现复杂LRU，假设用户单次会话查看的节点有限

            sessionStorage.setItem(key, JSON.stringify(cache));
        } catch (e) {
            console.error('[NodeHelpTranslator] 写入缓存失败', e);
        }
    }

    _restoreFromCache(btn, contentEl, nodeName) {
        const cached = this._loadFromCache(nodeName);
        if (!cached) return false;

        // 检查是否过期（例如超过24小时？其实sessionStorage已经限制了会话生命周期，这里可以不检查时间）
        // 但检查是否匹配当前内容结构很重要。
        // 我们尝试按索引恢复。

        const textBlocks = this._extractTextBlocks(contentEl);
        if (textBlocks.length === 0) return false;

        // 简单的完整性检查：如果缓存的索引超出了当前文本块数量，可能内容变了
        const maxIndex = Math.max(...cached.translations.map(t => t.index));
        if (maxIndex >= textBlocks.length) {
            logger.warn(`[NodeHelpTranslator] 缓存与当前内容不匹配(索引溢出)，跳过恢复: ${nodeName}`);
            return false;
        }

        // 恢复翻译
        // 构建全量的 translations 数组
        // cached.translations 是稀疏的，只包含有翻译的块
        const appliedTranslations = new Array(textBlocks.length).fill(null);
        let matchCount = 0;

        cached.translations.forEach(item => {
            if (item.index < textBlocks.length) {
                // 可选：对比一下原文内容是否大致匹配？（防止内容微调导致错位）
                // 这里为了性能暂不对比原文，严格依赖提取顺序
                appliedTranslations[item.index] = item.translation;
                matchCount++;
            }
        });

        if (matchCount === 0) return false;

        // 渲染
        this._renderTranslations(textBlocks, appliedTranslations, null); // passing null as nodeName to avoid recursive save

        // 恢复状态
        const viewMode = cached.viewMode || (cached.bilingual !== false ? 'bilingual' : 'translation-only');
        this.stateCache.set(nodeName, { translated: true, viewMode: viewMode });

        // 更新按钮状态
        this._setButtonContent(btn, 'translated');

        // 更新 SplitButton 菜单
        if (btn._paSplitBtn) {
            btn._paSplitBtn.updateMenu(this._getMenuItems(nodeName, viewMode));
        }

        // 应用显示模式
        this._applyViewMode(contentEl, viewMode);

        logger.log(`[NodeHelpTranslator] 已从缓存恢复翻译: ${nodeName}`);
        return true;
    }

    cleanup() {
        // 清理定时器
        if (this._injectTimer) {
            clearTimeout(this._injectTimer);
            this._injectTimer = null;
        }

        // 停止并清理 MutationObserver
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.isObserving = false;

        // 移除所有已注入的翻译按钮
        const translationButtons = document.querySelectorAll('.pa-help-translate-btn-container');
        translationButtons.forEach(btn => {
            // 清理 tooltip
            const mainBtn = btn.querySelector('.pa-translate-btn');
            if (mainBtn && mainBtn._paTooltip) {
                mainBtn._paTooltip.destroy();
                mainBtn._paTooltip = null;
            }
            // 移除按钮容器
            btn.remove();
        });

        // 清理状态缓存
        this.stateCache.clear();

        // 重置当前帮助面板引用
        this.currentHelpPanel = {
            nodeName: null,
            element: null,
            bilingualSwitch: null
        };

        logger.log("[NodeHelpTranslator] 已清理所有资源");
    }

    /**
     * 应用视图模式
     * @param {HTMLElement} contentEl 内容元素
     * @param {string} mode 'bilingual' | 'translation-only' | 'original-only'
     */
    _applyViewMode(contentEl, mode) {
        if (!contentEl) return;
        contentEl.classList.remove('pa-mode-bilingual', 'pa-mode-translation-only', 'pa-mode-original-only');

        switch (mode) {
            case 'bilingual':
                contentEl.classList.add('pa-mode-bilingual');
                break;
            case 'translation-only':
                contentEl.classList.add('pa-mode-translation-only');
                break;
            case 'original-only':
                contentEl.classList.add('pa-mode-original-only');
                break;
        }
    }

    /**
     * 获取下拉菜单配置
     * @param {string} nodeName 
     * @param {string} currentMode 
     * @returns {Array}
     */
    _getMenuItems(nodeName, currentMode) {
        return [
            {
                label: '中英对照',
                checked: currentMode === 'bilingual',
                command: () => this._handleModeChange(nodeName, 'bilingual')
            },
            {
                label: '显示译文',
                checked: currentMode === 'translation-only',
                command: () => this._handleModeChange(nodeName, 'translation-only')
            },
            {
                label: '显示原文',
                checked: currentMode === 'original-only',
                command: () => this._handleModeChange(nodeName, 'original-only')
            },
            { separator: true },
            {
                label: '重新翻译',
                icon: 'pi pi-refresh',
                command: () => {
                    const btn = document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`);
                    if (btn) btn.click();
                }
            }
        ];
    }

    async _handleModeChange(nodeName, mode) {
        const state = this.stateCache.get(nodeName);
        if (!state) return;

        state.viewMode = mode;
        this.stateCache.set(nodeName, state);

        const btn = document.querySelector(`.pa-translate-btn[data-node-name="${nodeName}"]`);
        if (!btn) return;

        // Find header then panel then content
        const header = btn.closest('.border-b') || btn.closest('.pa-help-translate-btn-container').parentElement;
        if (!header) return;

        // If header is inside a container which has sibling content
        const container = header.parentElement;
        const contentEl = container.querySelector('.node-help-content');

        if (contentEl) {
            this._applyViewMode(contentEl, mode);
        }

        const cachedData = this._loadFromCache(nodeName);
        if (cachedData) {
            this._saveToCache(nodeName, { ...cachedData, viewMode: mode });
        }

        if (this.currentHelpPanel.splitBtn) {
            this.currentHelpPanel.splitBtn.updateMenu(this._getMenuItems(nodeName, mode));
        }
    }
}

export const nodeHelpTranslator = new NodeHelpTranslator();
