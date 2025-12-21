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

    log(message) {
        if (this.level >= LOG_LEVELS.BASIC) {
            const msg = typeof message === 'function' ? message() : message;
            console.log(`[PromptAssistant-系统] ${msg}`);
        }
    }

    debug(message) {
        if (this.level >= LOG_LEVELS.DEBUG) {
            // 支持传入函数以实现惰性求值，避免在非调试模式下的性能开销
            const msg = typeof message === 'function' ? message() : message;
            console.debug(`[PromptAssistant-调试] ${msg}`);
        }
    }

    /**
     * 轻量调试（采样）
     * 仅当随机命中概率时才输出，用于高频路径
     * @param {string|Function} message
     * @param {number} rate 0~1，默认0.1表示10%采样
     */
    debugSample(message, rate = 0.1) {
        if (this.level >= LOG_LEVELS.DEBUG && Math.random() < rate) {
            const msg = typeof message === 'function' ? message() : message;
            console.debug(`[PromptAssistant-调试] ${msg}`);
        }
    }

    error(message) {
        const msg = typeof message === 'function' ? message() : message;
        console.error(`[PromptAssistant-错误] ${msg}`);
    }

    warn(message) {
        const msg = typeof message === 'function' ? message() : message;
        console.warn(`[PromptAssistant-警告] ${msg}`);
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