/**
 * 事件管理器
 * 统一管理所有与事件相关的操作，包括DOM事件、鼠标事件等
 */

import { logger } from './logger.js';

class EventManager {
    // 事件存储 - 使用Map嵌套Map来存储事件和监听器
    static listeners = new Map();

    // 全局鼠标位置
    static mousePosition = { x: 0, y: 0 };

    // 初始化状态标记
    static initialized = false;
    static _mouseHandler = null;

    /**
     * 初始化事件管理器
     */
    static init() {
        // 严格检查避免重复初始化
        if (this.initialized) {
            return true;
        }

        try {
            // 设置全局鼠标跟踪
            this.setupGlobalMouseTracking();

            this.initialized = true;
            logger.log("事件管理器 | 初始化完成");
            return true;
        } catch (error) {
            logger.error(`事件管理器 | 初始化失败 | ${error.message}`);
            return false;
        }
    }

    /**
     * 设置全局鼠标位置跟踪
     */
    static setupGlobalMouseTracking() {
        // 移除可能存在的旧监听器
        if (this._mouseHandler) {
            document.removeEventListener('mousemove', this._mouseHandler);
        }

        // 创建新的鼠标处理函数
        this._mouseHandler = (e) => {
            // 更新鼠标位置
            this.mousePosition.x = e.clientX;
            this.mousePosition.y = e.clientY;

            // 触发自定义事件
            this.emit('global_mouse_move', e);
        };

        // 添加鼠标监听
        document.addEventListener('mousemove', this._mouseHandler);
    }

    /**
     * 获取当前鼠标位置
     */
    static getMousePosition() {
        return { ...this.mousePosition };
    }

    /**
     * 判断鼠标是否在元素上方
     */
    static isMouseOverElement(element) {
        if (!element) return false;

        try {
            const rect = element.getBoundingClientRect();
            return (
                this.mousePosition.x >= rect.left &&
                this.mousePosition.x <= rect.right &&
                this.mousePosition.y >= rect.top &&
                this.mousePosition.y <= rect.bottom
            );
        } catch {
            return false;
        }
    }

    /**
     * 添加事件监听器
     */
    static on(eventKey, id, callback) {
        // 参数验证
        if (!eventKey || !id || typeof callback !== 'function') {
            logger.error(`事件注册失败 | 无效参数 | 事件: ${eventKey}`);
            return false;
        }

        // 获取或创建事件监听器集合
        if (!this.listeners.has(eventKey)) {
            this.listeners.set(eventKey, new Map());
        }

        const listeners = this.listeners.get(eventKey);

        // 检查是否已存在相同ID的监听器
        if (listeners.has(id)) {
            return true; // 已存在，静默返回
        }

        // 添加新的监听器
        listeners.set(id, callback);
        return true;
    }

    /**
     * 移除事件监听器
     */
    static off(eventKey, id) {
        // 参数验证
        if (!eventKey || !id) return false;

        // 检查事件和监听器是否存在
        if (!this.listeners.has(eventKey)) return false;

        const listeners = this.listeners.get(eventKey);
        const removed = listeners.delete(id);

        // 如果该事件没有监听器了，则删除整个事件
        if (listeners.size === 0) {
            this.listeners.delete(eventKey);
        }

        return removed;
    }

    /**
     * 触发事件
     */
    static emit(eventKey, ...args) {
        if (!eventKey) return false;

        // 检查事件是否有监听器
        if (!this.listeners.has(eventKey)) return false;

        const listeners = this.listeners.get(eventKey);
        if (listeners.size === 0) return false;

        // 执行所有监听器
        for (const [id, callback] of listeners.entries()) {
            try {
                callback(...args);
            } catch (error) {
                logger.error(`事件处理错误 | 事件: ${eventKey}, ID: ${id} | 错误: ${error.message}`);
            }
        }

        return true;
    }

    /**
     * 添加DOM事件监听器
     * 简化的辅助方法，返回用于移除监听器的函数
     */
    static addDOMListener(element, event, handler, options = false) {
        if (!element || !event || typeof handler !== 'function') {
            return () => { };
        }

        element.addEventListener(event, handler, options);

        return () => {
            element.removeEventListener(event, handler, options);
        };
    }

    /**
     * 创建防抖函数
     * 限制函数调用频率
     */
    static debounce(func, wait = 100) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * 注册元素的悬停事件（简化版本）
     */
    static registerHoverEvents(element, id, onEnter, onLeave) {
        if (!element) return () => { };

        const enterHandler = () => onEnter && onEnter();
        const leaveHandler = () => onLeave && onLeave();

        element.addEventListener('mouseenter', enterHandler);
        element.addEventListener('mouseleave', leaveHandler);

        return () => {
            element.removeEventListener('mouseenter', enterHandler);
            element.removeEventListener('mouseleave', leaveHandler);
        };
    }

    /**
     * 清理事件管理器
     */
    static cleanup(keepGlobalEvents = true) {
        if (keepGlobalEvents) {
            // 保留全局事件，清理其他事件
            const globalEvents = ['global_mouse_move'];

            for (const [eventKey, listeners] of this.listeners.entries()) {
                if (!globalEvents.includes(eventKey)) {
                    this.listeners.delete(eventKey);
                }
            }
        } else {
            // 清理所有事件和监听器
            this.listeners.clear();

            // 移除全局鼠标监听
            if (this._mouseHandler) {
                document.removeEventListener('mousemove', this._mouseHandler);
                this._mouseHandler = null;
            }

            // 重置状态
            this.initialized = false;
        }
    }
}

export { EventManager };