/**
 * 一级注释：本地缓存服务模块
 * 统一管理历史记录和标签的本地缓存
 */

import { logger } from '../utils/logger.js';
import { PromptFormatter } from "../utils/promptFormatter.js";

// ---缓存配置---
const CACHE_CONFIG = {
    // 统一前缀
    GLOBAL_PREFIX: "PromptAssistant_",

    // 历史缓存配置
    HISTORY_KEY_PREFIX: "PromptAssistant_history_cache_",
    MAX_HISTORY_PER_NODE: 20,  // 每个节点最多保存的历史条数
    MAX_HISTORY_GLOBAL: 100,   // 全局最多保存的历史条数
    MAX_CONTENT_LENGTH: 5000,  // 单条历史最大长度限制

    // 标签缓存配置
    TAG_KEY_PREFIX: "PromptAssistant_tag_cache_",

    // 翻译缓存配置
    TRANSLATE_CACHE_KEY: "PromptAssistant_translate_cache",
    MAX_TRANSLATE_CACHE: 200,  // 最多保存的翻译缓存条数

    // 旧的缓存键名（用于迁移）
    OLD_HISTORY_KEY_PREFIX: "history_cache_",
    OLD_TAG_KEY_PREFIX: "tag_cache_",
    OLD_TRANSLATE_CACHE_KEY: "translate_cache",
};

/**
 * 通用缓存服务
 * 提供基础的缓存操作方法
 */
class CacheService {
    /**
     * 从localStorage获取数据
     */
    static get(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error(`缓存服务 | 读取失败 | 键:${key} | 错误:${error.message}`);
            return null;
        }
    }

    /**
     * 将数据存储到localStorage
     */
    static set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            logger.error(`缓存服务 | 写入失败 | 键:${key} | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 从localStorage删除数据
     */
    static remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            logger.error(`缓存服务 | 删除失败 | 键:${key} | 错误:${error.message}`);
        }
    }

    /**
     * 清除指定前缀的所有缓存
     */
    static clearByPrefix(prefix) {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => this.remove(key));
            logger.debug(`缓存服务 | 清除前缀缓存 | 前缀:${prefix} | 数量:${keysToRemove.length}`);
        } catch (error) {
            logger.error(`缓存服务 | 清除前缀缓存失败 | 前缀:${prefix} | 错误:${error.message}`);
        }
    }

    /**
     * 迁移旧的缓存键名到新的键名格式
     */
    static migrateCache() {
        try {
            const stats = {
                history: 0,
                tags: 0,
                translate: 0
            };

            // 1. 迁移历史缓存
            const oldHistoryKey = `${CACHE_CONFIG.OLD_HISTORY_KEY_PREFIX}all`;
            const newHistoryKey = `${CACHE_CONFIG.HISTORY_KEY_PREFIX}all`;
            const historyData = this.get(oldHistoryKey);
            if (historyData) {
                this.set(newHistoryKey, historyData);
                this.remove(oldHistoryKey);
                stats.history = 1;
            }

            // 2. 迁移标签缓存
            const tagKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(CACHE_CONFIG.OLD_TAG_KEY_PREFIX)) {
                    tagKeys.push(key);
                }
            }

            tagKeys.forEach(oldKey => {
                const newKey = oldKey.replace(
                    CACHE_CONFIG.OLD_TAG_KEY_PREFIX,
                    CACHE_CONFIG.TAG_KEY_PREFIX
                );
                const data = this.get(oldKey);
                if (data) {
                    this.set(newKey, data);
                    this.remove(oldKey);
                    stats.tags++;
                }
            });

            // 3. 迁移翻译缓存
            const translateData = this.get(CACHE_CONFIG.OLD_TRANSLATE_CACHE_KEY);
            if (translateData) {
                this.set(CACHE_CONFIG.TRANSLATE_CACHE_KEY, translateData);
                this.remove(CACHE_CONFIG.OLD_TRANSLATE_CACHE_KEY);
                stats.translate = 1;
            }

            logger.log(`缓存迁移完成 | 历史缓存: ${stats.history}个 | 标签缓存: ${stats.tags}个 | 翻译缓存: ${stats.translate}个`);
            return stats;
        } catch (error) {
            logger.error(`缓存迁移失败 | 错误: ${error.message}`);
            return { history: 0, tags: 0, translate: 0 };
        }
    }
}

/**
 * 历史缓存服务
 * 管理历史记录的缓存操作
 */
class HistoryCacheService {
    // 添加撤销/重做状态记录
    static undoStates = new Map(); // 格式: { "nodeId_inputId": { currentIndex: number, records: array } }

    /**
     * 获取所有历史记录
     */
    static getAllHistory() {
        const key = `${CACHE_CONFIG.HISTORY_KEY_PREFIX}all`;
        return CacheService.get(key) || [];
    }

    /**
     * 保存所有历史记录
     */
    static saveAllHistory(history) {
        const key = `${CACHE_CONFIG.HISTORY_KEY_PREFIX}all`;
        CacheService.set(key, history);
    }

    /**
     * 获取历史记录列表
     */
    static getHistoryList({ nodeId = null, limit = 50 } = {}) {
        try {
            const allHistory = this.getAllHistory();

            // 确保每条历史记录都有必要的字段
            const validHistory = allHistory.filter(item => {
                const isValid = item && item.node_id && item.input_id &&
                    item.content && item.timestamp && item.operation_type;
                if (!isValid) {
                    logger.debug(`历史缓存 | 跳过无效记录 | 节点:${item?.node_id}`);
                }
                return isValid;
            });

            if (!nodeId) {
                return validHistory
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, limit);
            }

            const currentNodeHistory = [];
            const otherNodesHistory = [];

            validHistory.forEach(item => {
                if (item.node_id === nodeId) {
                    currentNodeHistory.push(item);
                } else {
                    otherNodesHistory.push(item);
                }
            });

            currentNodeHistory.sort((a, b) => b.timestamp - a.timestamp);
            otherNodesHistory.sort((a, b) => b.timestamp - a.timestamp);

            return [...currentNodeHistory, ...otherNodesHistory].slice(0, limit);
        } catch (error) {
            logger.error(`历史缓存 | 获取历史失败 | 错误:${error.message}`);
            return [];
        }
    }

    /**
     * 获取指定节点和输入框的历史记录
     */
    static getInputHistory(nodeId, inputId, oldToNew = false) {
        try {
            const allHistory = this.getAllHistory();
            const filtered = allHistory.filter(item =>
                item.node_id === nodeId &&
                item.input_id === inputId
            );
            // 根据参数决定排序方向
            return filtered.sort((a, b) =>
                oldToNew ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
            );
        } catch (error) {
            logger.error(`历史缓存 | 获取输入框历史失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return [];
        }
    }

    /**
     * 检查是否为重复的翻译记录
     */
    static isRepeatedTranslation(nodeId, inputId, content, operationType) {
        try {
            if (operationType !== 'translate') {
                return false;
            }

            // 获取该节点和输入框的历史记录
            const history = this.getInputHistory(nodeId, inputId, false);
            if (!history || history.length === 0) {
                return false;
            }

            // 获取最近的一条记录
            const lastRecord = history[0];
            if (!lastRecord || lastRecord.operation_type !== 'translate') {
                return false;
            }

            // 检查内容是否匹配
            const currentContent = content.trim();
            const lastContent = lastRecord.content.trim();

            // 查询翻译缓存
            const cacheResult = TranslateCacheService.queryTranslateCache(currentContent);
            if (!cacheResult) {
                return false;
            }

            // 检查是否为原文-译文或译文-原文的切换
            if (cacheResult.type === 'source' && cacheResult.translatedText === lastContent) {
                return true;
            }
            if (cacheResult.type === 'translated' && cacheResult.sourceText === lastContent) {
                return true;
            }

            return false;
        } catch (error) {
            logger.error(`历史缓存 | 检查重复翻译失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 添加历史记录
     */
    static addHistory(historyItem) {
        try {
            // 验证必要字段
            if (!historyItem.node_id || !historyItem.input_id || historyItem.content === undefined) {
                logger.error("历史缓存 | 添加历史失败 | 缺少必要字段");
                return false;
            }

            // 如果内容为空或只包含空白字符，跳过记录
            if (!historyItem.content || historyItem.content.trim() === '') {
                logger.debug(`历史缓存 | 跳过添加 | 节点:${historyItem.node_id} | 原因:空内容`);
                return false;
            }

            // 内容长度限制
            let content = historyItem.content;
            if (content.length > CACHE_CONFIG.MAX_CONTENT_LENGTH) {
                content = content.substring(0, CACHE_CONFIG.MAX_CONTENT_LENGTH) + "...";
            }

            // 检查是否为重复的翻译记录
            if (this.isRepeatedTranslation(historyItem.node_id, historyItem.input_id, content, historyItem.operation_type)) {
                logger.debug(`历史缓存 | 跳过添加 | 节点:${historyItem.node_id} | 原因:重复的翻译记录`);
                return false;
            }

            const allHistory = this.getAllHistory();

            // 获取当前节点和输入框的历史记录
            const nodeHistory = allHistory.filter(item =>
                item.node_id === historyItem.node_id &&
                item.input_id === historyItem.input_id
            );

            // 检查是否与最近的一条历史记录内容相同
            if (nodeHistory.length > 0) {
                // 按时间戳降序排序，获取最新的记录
                const latestHistory = nodeHistory.sort((a, b) => b.timestamp - a.timestamp)[0];
                if (latestHistory.content === content) {
                    logger.debug(`历史缓存 | 跳过添加 | 节点:${historyItem.node_id} | 原因:与上一条记录相同`);
                    return false;
                }
            }

            // 创建新的历史记录
            const newItem = {
                node_id: historyItem.node_id,
                input_id: historyItem.input_id,
                content: content,
                operation_type: historyItem.operation_type || null,
                timestamp: Date.now() + 1, // 确保时间戳唯一
                request_id: historyItem.request_id || null
            };

            // 添加到历史记录末尾
            allHistory.push(newItem);

            // 限制每个节点的历史记录数量
            const currentNodeHistory = allHistory.filter(item => item.node_id === historyItem.node_id);
            if (currentNodeHistory.length > CACHE_CONFIG.MAX_HISTORY_PER_NODE) {
                // 按时间戳排序
                currentNodeHistory.sort((a, b) => b.timestamp - a.timestamp);
                // 获取要保留的记录的时间戳
                const cutoffTimestamp = currentNodeHistory[CACHE_CONFIG.MAX_HISTORY_PER_NODE - 1].timestamp;
                // 移除旧记录
                const filteredHistory = allHistory.filter(item =>
                    item.node_id !== historyItem.node_id ||
                    item.timestamp >= cutoffTimestamp
                );
                allHistory.length = 0;
                allHistory.push(...filteredHistory);
            }

            // 限制全局历史记录数量
            if (allHistory.length > CACHE_CONFIG.MAX_HISTORY_GLOBAL) {
                // 按时间戳排序
                allHistory.sort((a, b) => b.timestamp - a.timestamp);
                allHistory.length = CACHE_CONFIG.MAX_HISTORY_GLOBAL;
            }

            this.saveAllHistory(allHistory);
            logger.debug(`历史缓存 | 添加历史 | 节点:${historyItem.node_id} | 内容长度:${content.length}`);
            return true;
        } catch (error) {
            logger.error(`历史缓存 | 添加历史失败 | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 初始化撤销状态
     */
    static initUndoState(nodeId, inputId, currentContent) {
        try {
            const key = `${nodeId}_${inputId}`;

            // 获取该输入框的历史记录（从旧到新）
            const inputHistory = this.getInputHistory(nodeId, inputId, true);

            // 创建撤销状态，指向最新的记录
            const undoState = {
                currentIndex: inputHistory.length - 1, // 指向最后一条记录
                currentContent: currentContent,    // 保存当前内容
                lastHistoryTimestamp: inputHistory.length > 0 ? inputHistory[inputHistory.length - 1].timestamp : 0
            };

            // 更新撤销状态
            this.undoStates.set(key, undoState);

            logger.debug(`历史缓存 | 初始化撤销状态 | 节点:${nodeId} | 输入框:${inputId} | 历史数:${inputHistory.length} | 当前位置:${undoState.currentIndex}`);
        } catch (error) {
            logger.error(`历史缓存 | 初始化撤销状态失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
        }
    }

    /**
     * 执行撤销操作
     */
    static undo(nodeId, inputId) {
        try {
            const key = `${nodeId}_${inputId}`;
            const state = this.undoStates.get(key);

            if (!state) {
                return null;
            }

            // 获取历史记录（从旧到新）
            const history = this.getInputHistory(nodeId, inputId, true);

            // 如果没有历史记录，返回null
            if (history.length === 0) {
                return null;
            }

            // 如果已经是第一条记录，无法继续撤销
            if (state.currentIndex <= 0) {
                return null;
            }

            // 更新当前位置
            state.currentIndex--;

            // 从历史记录中获取内容
            const content = history[state.currentIndex]?.content || '';

            // 更新状态
            this.undoStates.set(key, state);

            logger.debug(`历史缓存 | 撤销操作 | 节点:${nodeId} | 输入框:${inputId} | 位置:${state.currentIndex}/${history.length - 1} | 内容:${content}`);
            return content;
        } catch (error) {
            logger.error(`历史缓存 | 撤销操作失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return null;
        }
    }

    /**
     * 执行重做操作
     */
    static redo(nodeId, inputId) {
        try {
            const key = `${nodeId}_${inputId}`;
            const state = this.undoStates.get(key);

            if (!state) {
                return null;
            }

            // 获取历史记录（从旧到新）
            const history = this.getInputHistory(nodeId, inputId, true);

            // 如果没有历史记录，返回null
            if (history.length === 0) {
                return null;
            }

            // 如果已经是最后一条记录，无法重做
            if (state.currentIndex >= history.length - 1) {
                return null;
            }

            // 更新当前位置
            state.currentIndex++;

            // 从历史记录中获取内容
            const content = history[state.currentIndex]?.content || '';

            // 更新状态
            this.undoStates.set(key, state);

            logger.debug(`历史缓存 | 重做操作 | 节点:${nodeId} | 输入框:${inputId} | 位置:${state.currentIndex}/${history.length - 1} | 内容:${content}`);
            return content;
        } catch (error) {
            logger.error(`历史缓存 | 重做操作失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return null;
        }
    }

    /**
     * 检查是否可以撤销
     */
    static canUndo(nodeId, inputId) {
        try {
            const key = `${nodeId}_${inputId}`;
            const state = this.undoStates.get(key);
            return state && state.currentIndex > 0;
        } catch (error) {
            logger.error(`历史缓存 | 检查撤销状态失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 检查是否可以重做
     */
    static canRedo(nodeId, inputId) {
        try {
            const key = `${nodeId}_${inputId}`;
            const state = this.undoStates.get(key);
            if (!state) return false;

            const history = this.getInputHistory(nodeId, inputId, true);
            return state.currentIndex < history.length - 1;
        } catch (error) {
            logger.error(`历史缓存 | 检查重做状态失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 清除所有历史记录
     */
    static clearAllHistory() {
        try {
            // 清除所有历史记录
            this.saveAllHistory([]);
            // 清除所有撤销状态
            this.undoStates.clear();
            logger.debug("历史缓存 | 清除所有历史");
        } catch (error) {
            logger.error(`历史缓存 | 清除所有历史失败 | 错误:${error.message}`);
        }
    }

    /**
     * 清除指定节点的历史记录
     */
    static clearNodeHistory(nodeId) {
        try {
            // 清除节点的历史记录
            const allHistory = this.getAllHistory();
            const filteredHistory = allHistory.filter(item => item.node_id !== nodeId);
            this.saveAllHistory(filteredHistory);

            // 清除该节点的撤销状态
            for (const [key] of this.undoStates) {
                if (key.startsWith(nodeId + "_")) {
                    this.undoStates.delete(key);
                }
            }

            logger.debug(`历史缓存 | 清除节点历史 | 节点:${nodeId}`);
        } catch (error) {
            logger.error(`历史缓存 | 清除节点历史失败 | 节点:${nodeId} | 错误:${error.message}`);
        }
    }

    /**
     * 添加历史记录并更新撤销状态
     */
    static addHistoryAndUpdateUndoState(nodeId, inputId, content, operationType = 'input') {
        // 首先尝试添加历史记录
        const success = this.addHistory({
            node_id: nodeId,
            input_id: inputId,
            content: content,
            operation_type: operationType,
            timestamp: Date.now()
        });

        if (success) {
            // 更新撤销状态
            const key = `${nodeId}_${inputId}`;
            const state = this.undoStates.get(key) || {
                currentIndex: 0,
                currentContent: content,
                lastHistoryTimestamp: 0
            };

            // 获取最新的历史记录
            const history = this.getInputHistory(nodeId, inputId, true);

            // 更新状态
            state.currentIndex = history.length - 1;
            state.currentContent = content;
            state.lastHistoryTimestamp = Date.now();

            // 保存状态
            this.undoStates.set(key, state);

            logger.debug(`历史缓存 | 更新撤销状态 | 节点:${nodeId} | 输入框:${inputId} | 位置:${state.currentIndex}`);
        }

        return success;
    }

    /**
     * 获取历史记录统计信息
     */
    static getHistoryStats() {
        try {
            const allHistory = this.getAllHistory();
            const stats = {
                total: allHistory.length,
                byNode: {}
            };

            // 按节点统计
            allHistory.forEach(item => {
                if (!stats.byNode[item.node_id]) {
                    stats.byNode[item.node_id] = 0;
                }
                stats.byNode[item.node_id]++;
            });

            logger.debug(`历史缓存 | 获取统计 | 总数:${stats.total} | 节点数:${Object.keys(stats.byNode).length}`);
            return stats;
        } catch (error) {
            logger.error(`历史缓存 | 获取统计失败 | 错误:${error.message}`);
            return { total: 0, byNode: {} };
        }
    }

    /**
     * 修改历史记录项的操作类型
     */
    static updateHistoryItemType(nodeId, inputId, timestamp, newType) {
        try {
            // 获取所有历史记录
            const allHistory = this.getAllHistory();

            // 查找匹配的历史记录
            const itemIndex = allHistory.findIndex(item =>
                item.node_id === nodeId &&
                item.input_id === inputId &&
                item.timestamp === timestamp
            );

            // 如果找到匹配的记录，修改其操作类型
            if (itemIndex !== -1) {
                allHistory[itemIndex].operation_type = newType;

                // 保存修改后的历史记录
                this.saveAllHistory(allHistory);

                logger.debug(`历史缓存 | 修改操作类型 | 节点:${nodeId} | 输入框:${inputId} | 类型:${newType}`);
                return true;
            } else {
                logger.debug(`历史缓存 | 修改操作类型失败 | 未找到匹配记录 | 节点:${nodeId} | 输入框:${inputId}`);
                return false;
            }
        } catch (error) {
            logger.error(`历史缓存 | 修改操作类型失败 | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 更新历史记录项
     */
    static updateHistoryItem(nodeId, inputId, timestamp, updates) {
        try {
            // 获取所有历史记录
            const allHistory = this.getAllHistory();

            // 查找匹配的历史记录
            const itemIndex = allHistory.findIndex(item =>
                item.node_id === nodeId &&
                item.input_id === inputId &&
                item.timestamp === timestamp
            );

            // 如果找到匹配的记录，更新指定字段
            if (itemIndex !== -1) {
                // 更新所有提供的字段
                Object.assign(allHistory[itemIndex], updates);

                // 保存修改后的历史记录
                this.saveAllHistory(allHistory);

                logger.debug(`历史缓存 | 更新记录 | 节点:${nodeId} | 输入框:${inputId} | 字段:${Object.keys(updates).join(',')}`);
                return true;
            } else {
                logger.debug(`历史缓存 | 更新失败 | 未找到匹配记录 | 节点:${nodeId} | 输入框:${inputId}`);
                return false;
            }
        } catch (error) {
            logger.error(`历史缓存 | 更新记录失败 | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 根据请求ID获取相关联的历史记录
     */
    static getHistoryByRequestId(requestId) {
        try {
            if (!requestId) return [];

            const allHistory = this.getAllHistory();
            return allHistory.filter(item =>
                item.request_id === requestId
            ).sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            logger.error(`历史缓存 | 获取请求关联历史失败 | 请求ID:${requestId} | 错误:${error.message}`);
            return [];
        }
    }
}

/**
 * 标签缓存服务
 * 管理标签的缓存操作
 */
class TagCacheService {
    /**
     * 获取或创建标签格式
     */
    static getOrCreateFormats(rawTag) {
        return PromptFormatter.formatTag(rawTag);
    }

    /**
     * 获取标签缓存
     */
    static getTagCache(nodeId, inputId) {
        try {
            const key = `${CACHE_CONFIG.TAG_KEY_PREFIX}${nodeId}_${inputId}`;
            const data = CacheService.get(key);
            if (data) {
                return new Map(Object.entries(data));
            }
            return new Map();
        } catch (error) {
            logger.error(`标签缓存 | 获取缓存失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return new Map();
        }
    }

    /**
     * 添加标签到缓存
     */
    static addTag(nodeId, inputId, rawTag, formats) {
        try {
            const cache = this.getTagCache(nodeId, inputId);

            // 确保formats包含所有必要的格式
            const format1 = formats.format1 || ` ${rawTag}`;
            const format2 = formats.format2 || ` ${rawTag},`;
            const format3 = formats.format3 || `, ${rawTag}`;
            const format4 = formats.format4 || `, ${rawTag},`;
            const insertedFormat = formats.insertedFormat || null;

            cache.set(rawTag, {
                format1,
                format2,
                format3,
                format4,
                insertedFormat
            });

            this._saveTagCache(nodeId, inputId, cache);
            logger.debug(`标签缓存 | 添加标签 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag}`);
            return true;
        } catch (error) {
            logger.error(`标签缓存 | 添加标签失败 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 从缓存中移除标签
     */
    static removeTag(nodeId, inputId, rawTag) {
        try {
            const cache = this.getTagCache(nodeId, inputId);
            const result = cache.delete(rawTag);
            if (result) {
                this._saveTagCache(nodeId, inputId, cache);
                logger.debug(`标签缓存 | 移除标签 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag}`);
            }
            return result;
        } catch (error) {
            logger.error(`标签缓存 | 移除标签失败 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 检查标签是否在输入框中
     */
    static isTagInInput(nodeId, inputId, rawTag, inputValue) {
        try {
            const formats = this.getTagFormats(nodeId, inputId, rawTag);
            if (!formats) {
                return false;
            }

            // 按优先级顺序检查各种格式
            const checkOrder = ['insertedFormat', 'format4', 'format3', 'format2', 'format1'];

            for (const formatKey of checkOrder) {
                const format = formats[formatKey];
                if (format && inputValue.includes(format)) {
                    logger.debug(`标签检查 | 结果:已存在 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 匹配格式:${formatKey}`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error(`标签检查 | 结果:异常 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 获取标签的所有格式
     */
    static getTagFormats(nodeId, inputId, rawTag) {
        try {
            const cache = this.getTagCache(nodeId, inputId);
            return cache.get(rawTag) || null;
        } catch (error) {
            logger.error(`标签缓存 | 获取标签格式失败 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 错误:${error.message}`);
            return null;
        }
    }

    /**
     * 获取标签的插入格式
     */
    static getInsertedFormat(nodeId, inputId, rawTag) {
        try {
            const formats = this.getTagFormats(nodeId, inputId, rawTag);
            return formats ? formats.insertedFormat : null;
        } catch (error) {
            logger.error(`标签缓存 | 获取插入格式失败 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 错误:${error.message}`);
            return null;
        }
    }

    /**
     * 获取所有原始标签
     */
    static getAllRawTags(nodeId, inputId) {
        try {
            const cache = this.getTagCache(nodeId, inputId);
            return Array.from(cache.keys());
        } catch (error) {
            logger.error(`标签缓存 | 获取所有标签失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
            return [];
        }
    }

    /**
     * 清除标签缓存
     */
    static clearCache(nodeId, inputId) {
        try {
            this._removeTagCache(nodeId, inputId);
            logger.debug(`标签缓存 | 清除缓存 | 节点:${nodeId} | 输入框:${inputId}`);
        } catch (error) {
            logger.error(`标签缓存 | 清除缓存失败 | 节点:${nodeId} | 输入框:${inputId} | 错误:${error.message}`);
        }
    }

    /**
     * 保存标签缓存
     */
    static _saveTagCache(nodeId, inputId, cache) {
        const key = `${CACHE_CONFIG.TAG_KEY_PREFIX}${nodeId}_${inputId}`;
        const data = Object.fromEntries(cache);
        CacheService.set(key, data);
    }

    /**
     * 移除标签缓存
     */
    static _removeTagCache(nodeId, inputId) {
        const key = `${CACHE_CONFIG.TAG_KEY_PREFIX}${nodeId}_${inputId}`;
        CacheService.remove(key);
    }

    /**
     * 获取标签统计信息
     */
    static getTagStats() {
        try {
            let total = 0;
            const byNode = {};

            // 遍历localStorage查找所有标签缓存
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(CACHE_CONFIG.TAG_KEY_PREFIX)) {
                    // 从key中提取节点ID和输入框ID
                    const [nodeId, inputId] = key.replace(CACHE_CONFIG.TAG_KEY_PREFIX, '').split('_');
                    const cache = this.getTagCache(nodeId, inputId);
                    const count = cache.size;

                    // 更新统计
                    total += count;
                    if (!byNode[nodeId]) {
                        byNode[nodeId] = {};
                    }
                    byNode[nodeId][inputId] = count;
                }
            }

            const stats = { total, byNode };
            logger.debug(`标签缓存 | 获取统计 | 总数:${total} | 节点数:${Object.keys(byNode).length}`);
            return stats;
        } catch (error) {
            logger.error(`标签缓存 | 获取统计失败 | 错误:${error.message}`);
            return { total: 0, byNode: {} };
        }
    }

    /**
     * 更新标签的插入格式
     */
    static updateInsertedFormat(nodeId, inputId, rawTag, insertedFormat) {
        try {
            const cache = this.getTagCache(nodeId, inputId);
            const formats = cache.get(rawTag);
            if (!formats) {
                logger.debug(`标签缓存 | 更新插入格式失败 | 原因:标签不存在 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag}`);
                return false;
            }

            // 更新插入格式
            formats.insertedFormat = insertedFormat;
            cache.set(rawTag, formats);

            // 保存到缓存
            this._saveTagCache(nodeId, inputId, cache);
            logger.debug(`标签缓存 | 更新插入格式 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 新格式:${insertedFormat}`);
            return true;
        } catch (error) {
            logger.error(`标签缓存 | 更新插入格式失败 | 节点:${nodeId} | 输入框:${inputId} | 标签:${rawTag} | 错误:${error.message}`);
            return false;
        }
    }
}

/**
 * 翻译缓存服务
 * 管理翻译结果的缓存操作
 */
class TranslateCacheService {
    /**
     * 获取所有翻译缓存
     */
    static getAllTranslateCache() {
        try {
            const data = CacheService.get(CACHE_CONFIG.TRANSLATE_CACHE_KEY);
            if (data) {
                return new Map(Object.entries(data));
            }
            return new Map();
        } catch (error) {
            logger.error(`翻译缓存 | 获取缓存失败 | 错误:${error.message}`);
            return new Map();
        }
    }

    /**
     * 保存所有翻译缓存
     */
    static saveAllTranslateCache(cache) {
        try {
            // 将Map转换为普通对象
            const data = Object.fromEntries(cache);
            CacheService.set(CACHE_CONFIG.TRANSLATE_CACHE_KEY, data);
        } catch (error) {
            logger.error(`翻译缓存 | 保存缓存失败 | 错误:${error.message}`);
        }
    }

    /**
     * 添加翻译缓存
     */
    static addTranslateCache(sourceText, translatedText) {
        try {
            // 验证参数
            if (!sourceText || !translatedText) {
                logger.error("翻译缓存 | 添加缓存失败 | 缺少必要参数");
                return false;
            }

            // 获取现有缓存
            const cache = this.getAllTranslateCache();

            // 添加或更新缓存
            cache.set(sourceText, translatedText);

            // 如果缓存过大，删除最旧的条目
            if (cache.size > CACHE_CONFIG.MAX_TRANSLATE_CACHE) {
                // 将Map转换为数组以便操作
                const entries = Array.from(cache.entries());
                // 删除最早的条目，保留最新的MAX_TRANSLATE_CACHE条
                const newEntries = entries.slice(-CACHE_CONFIG.MAX_TRANSLATE_CACHE);
                // 重建缓存
                cache.clear();
                newEntries.forEach(([key, value]) => cache.set(key, value));
            }

            // 保存缓存
            this.saveAllTranslateCache(cache);
            logger.debug(`翻译缓存 | 添加缓存 | 原文长度:${sourceText.length} | 译文长度:${translatedText.length}`);
            return true;
        } catch (error) {
            logger.error(`翻译缓存 | 添加缓存失败 | 错误:${error.message}`);
            return false;
        }
    }

    /**
     * 查询翻译缓存
     */
    static queryTranslateCache(text) {
        try {
            if (!text) return null;

            const cache = this.getAllTranslateCache();

            // 检查是否为原文(key)
            if (cache.has(text)) {
                const translatedText = cache.get(text);
                logger.debug(`翻译缓存 | 查询结果:命中原文 | 原文长度:${text.length} | 译文长度:${translatedText.length}`);
                return {
                    type: 'source',
                    text: text,
                    translatedText: translatedText
                };
            }

            // 检查是否为译文(value)
            for (const [source, translated] of cache.entries()) {
                if (translated === text) {
                    logger.debug(`翻译缓存 | 查询结果:命中译文 | 原文长度:${source.length} | 译文长度:${text.length}`);
                    return {
                        type: 'translated',
                        text: text,
                        sourceText: source
                    };
                }
            }

            // 未命中缓存
            logger.debug(`翻译缓存 | 查询结果:未命中 | 文本长度:${text.length}`);
            return null;
        } catch (error) {
            logger.error(`翻译缓存 | 查询缓存失败 | 错误:${error.message}`);
            return null;
        }
    }

    /**
     * 清除所有翻译缓存
     */
    static clearAllTranslateCache() {
        try {
            CacheService.remove(CACHE_CONFIG.TRANSLATE_CACHE_KEY);
            logger.debug("翻译缓存 | 清除所有缓存");
        } catch (error) {
            logger.error(`翻译缓存 | 清除缓存失败 | 错误:${error.message}`);
        }
    }

    /**
     * 获取翻译缓存统计信息
     */
    static getTranslateCacheStats() {
        try {
            const cache = this.getAllTranslateCache();
            const stats = {
                total: cache.size,
                sourceTextLengths: 0,
                translatedTextLengths: 0
            };

            // 计算原文和译文的总长度
            for (const [source, translated] of cache.entries()) {
                stats.sourceTextLengths += source.length;
                stats.translatedTextLengths += translated.length;
            }

            logger.debug(`翻译缓存 | 获取统计 | 总数:${stats.total} | 原文总长度:${stats.sourceTextLengths} | 译文总长度:${stats.translatedTextLengths}`);
            return stats;
        } catch (error) {
            logger.error(`翻译缓存 | 获取统计失败 | 错误:${error.message}`);
            return { total: 0, sourceTextLengths: 0, translatedTextLengths: 0 };
        }
    }
}

export { CacheService, HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG };