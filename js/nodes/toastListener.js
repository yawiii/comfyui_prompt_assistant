/**
 * Toast通知监听器
 * 用于接收后端发送的toast通知并显示
 */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

class ToastListener {
    /**
     * 初始化Toast监听器
     */
    constructor() {
        this.setupEventListener();
        // 用于存储最近的通知，避免重复显示
        this.recentNotifications = new Map();
        // 通知去重的时间窗口（毫秒）
        this.deduplicationWindow = 3000;
    }

    /**
     * 设置WebSocket事件监听
     */
    setupEventListener() {
        // 监听后端发送的toast通知事件
        api.addEventListener("prompt_assistant/toast", this.handleToastEvent.bind(this));
        console.log("[提示词小助手] Toast通知监听器已初始化");
    }

    /**
     * 生成通知的唯一标识
     * @param {Object} data - 通知数据
     * @returns {string} 通知的唯一标识
     */
    generateNotificationKey(data) {
        const { severity, summary, detail } = data;
        return `${severity}:${summary}:${detail || ''}`;
    }

    /**
     * 检查是否为重复通知
     * @param {string} key - 通知的唯一标识
     * @returns {boolean} 是否为重复通知
     */
    isDuplicateNotification(key) {
        const now = Date.now();
        if (this.recentNotifications.has(key)) {
            const lastTime = this.recentNotifications.get(key);
            if (now - lastTime < this.deduplicationWindow) {
                // 更新时间戳
                this.recentNotifications.set(key, now);
                return true;
            }
        }
        // 记录这个通知
        this.recentNotifications.set(key, now);
        
        // 清理过期的通知记录
        this.cleanupOldNotifications();
        
        return false;
    }

    /**
     * 清理过期的通知记录
     */
    cleanupOldNotifications() {
        const now = Date.now();
        for (const [key, time] of this.recentNotifications.entries()) {
            if (now - time > this.deduplicationWindow) {
                this.recentNotifications.delete(key);
            }
        }
    }

    /**
     * 处理toast事件
     * @param {CustomEvent} event - 事件对象
     */
    handleToastEvent(event) {
        const data = event.detail;
        if (!data) return;

        // 解构事件数据
        const { severity = "info", summary = "", detail = null, life = 3000 } = data;
        
        // 生成通知的唯一标识
        const notificationKey = this.generateNotificationKey(data);
        
        // 检查是否为重复通知
        if (this.isDuplicateNotification(notificationKey)) {
            console.log(`[提示词小助手] 跳过重复通知: ${summary}`);
            return;
        }

        // 调用ComfyUI的toast系统显示通知
        app.extensionManager.toast.add({
            severity: severity,
            summary: summary,
            detail: detail,
            life: life
        });

        // 记录日志
        const logLevel = severity === "error" ? "error" : 
                        severity === "warn" ? "warn" : "log";
        console[logLevel](`[提示词小助手] ${summary}${detail ? ': ' + detail : ''}`);
    }
}

// 创建单例实例
const toastListener = new ToastListener();

export default toastListener; 