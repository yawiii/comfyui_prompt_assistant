/**
 * 日志管理模块
 * 提供统一的日志记录和管理功能
 */

// ====================== 日志级别常量 ======================

/**
 * 日志级别常量
 * 用于控制日志输出的详细程度
 */
export const LOG_LEVELS = {
    ERROR: 0,   // 仅错误(生产环境)
    BASIC: 1,   // 基础日志(监控环境)
    DEBUG: 2    // 详细日志(开发环境)
};

// ====================== 日志管理器 ======================

/**
 * 统一日志管理器
 * 集中管理不同级别的日志记录
 */
class Logger {
    constructor() {
        this.level = LOG_LEVELS.DEBUG; // 默认使用详细日志级别
    }

    log(...args) {
        if (this.level >= LOG_LEVELS.BASIC) {
            console.log("[PromptAssistant-系统]", ...args);
        }
    }

    debug(...args) {
        if (this.level >= LOG_LEVELS.DEBUG) {
            console.log("[PromptAssistant-调试]", ...args);
        }
    }

    error(...args) {
        console.error("[PromptAssistant-错误]", ...args);
    }

    warn(...args) {
        console.warn("[PromptAssistant-警告]", ...args);
    }

    /**
     * 设置日志级别
     * @param {number} level - 日志级别 (0: ERROR, 1: BASIC, 2: DEBUG)
     */
    setLevel(level) {
        if (typeof level !== 'number' || level < 0 || level > 2) {
            console.error("[PromptAssistant-错误] 无效的日志级别:", level);
            return;
        }
        this.level = level;
    }
}

// 创建单例实例
const logger = new Logger();

// 导出日志管理器实例和日志级别常量
export { logger }; 