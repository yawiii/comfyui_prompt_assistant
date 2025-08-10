/**
 * 工作流自动翻译拦截器
 * 在工作流执行时拦截CLIP节点的文本输入，实现自动翻译
 */

import { logger } from '../utils/logger.js';
import { PromptFormatter } from "../utils/promptFormatter.js";
import { TranslateCacheService } from "./cache.js";
import { APIService } from "./api.js";
import { FEATURES } from "./features.js";

// CLIP节点类型列表 - 导出以便其他模块使用
export const CLIP_NODE_TYPES = [
    'CLIPTextEncode',
    'CLIPTextEncodeSDXL',
    'CLIPTextEncodeSD3',
    'CLIPTextEncodeFlux',
    'CLIPTextEncodeControlnet',
    'CLIPTextEncodeHunyuanDiT',
    'CLIPTextEncodeLumina2',
    'CLIPTextEncodePixArtAlpha',
    'CLIPTextEncodeSDXLRefiner'
];

// 可能输出文本的节点类型
const TEXT_OUTPUT_NODE_TYPES = [
    'PrimitiveNode',  // 原始节点
    'Text',           // 文本节点
    'Note',           // 笔记节点
    'CLIPTextEncode', // CLIP文本编码（可能连接到其他CLIP节点）
    'Reroute',        // 路由节点，用于传递数据
    'PromptText',     // 提示词文本节点
    'TextCombine',    // 文本组合节点
    'TextMultiline',  // 多行文本节点
    'StringFunction', // 字符串函数节点
    'StringReplace',  // 字符串替换节点
    'StringVariable', // 字符串变量节点
    'TextNode',       // 通用文本节点类型
    'TextInput',      // 文本输入节点
    'easy positive',  // easy positive提示词节点
    'easy negative',  // easy negative提示词节点
    'positive',       // 普通提示词节点
    'negative',       // 普通负面提示词节点
    'prompt',         // 提示词节点
    'Template',       // 模板节点
    'PromptTemplate'  // 提示词模板节点
];

/**
 * 检查节点是否为指定的CLIP类型
 */
function isClipNode(classType) {
    return CLIP_NODE_TYPES.includes(classType);
}

/**
 * 检查节点是否可能输出文本
 * @param {string} classType - 节点类型
 * @returns {boolean} - 如果节点可能输出文本，则返回true
 */
function isTextOutputNode(classType) {
    // 精确匹配已知类型
    if (TEXT_OUTPUT_NODE_TYPES.includes(classType)) {
        return true;
    }
    
    // 使用名称匹配以扩展覆盖更多可能的文本节点
    // 包含这些关键词的节点类型很可能是处理文本的
    const textRelatedKeywords = [
        'text', 'prompt', 'string', 'chat', 'word', 'message', 'note',
        'positive', 'negative', 'template', 'gpt', 'llm', 'input'
    ];
    return textRelatedKeywords.some(keyword => 
        classType.toLowerCase().includes(keyword.toLowerCase()));
}

/**
 * 获取节点的文本输入字段名
 * 不同的CLIP节点可能有不同的文本输入字段
 */
function getTextInputFields(classType) {
    switch (classType) {
        case 'CLIPTextEncodeSDXL':
            return ['text_g', 'text_l'];
        case 'CLIPTextEncodeLumina2':
            return ['system_prompt', 'user_prompt'];
        case 'CLIPTextEncodePixArtAlpha':
        case 'CLIPTextEncodeSDXLRefiner':
            return ['text'];
        default:
            return ['text']; // 大多数CLIP节点使用'text'字段
    }
}

/**
 * 递归查找上游文本源
 * @param {Object} apiWorkflow - API工作流
 * @param {Array} link - 链接数组 [nodeId, outputSlot]
 * @param {number} [depth=0] - 递归深度，防止无限循环
 * @returns {Object|null} - 包含文本、源节点、源节点ID和源字段的对象，或null
 */
function findUpstreamTextSource(apiWorkflow, link, depth = 0) {
    // 防止无限递归
    if (!link || !Array.isArray(link) || link.length < 2 || depth > 10) {
        logger.debug(`递归查找终止 | 链接无效或达到最大深度:${depth}`);
        return null;
    }

    const [nodeId, outputSlot] = link;
    const node = apiWorkflow[nodeId];

    // 如果找不到节点，则停止
    if (!node) {
        logger.debug(`未找到节点 | ID:${nodeId}`);
        return null;
    }
    
    logger.debug(`检查节点 | ID:${nodeId} | 类型:${node.class_type} | 输出槽:${outputSlot}`);
    
    // 记录节点结构以便调试
    const nodeInputsStr = JSON.stringify(node.inputs || {});
    const nodeOutputsStr = JSON.stringify(node.outputs || {});
    logger.debug(`节点详情 | 输入:${nodeInputsStr.substring(0, 200)} | 输出:${nodeOutputsStr.substring(0, 200)}`);

    // ===== 通用数据提取 =====
    // 1. 首先尝试从outputs数组中提取数据
    if (node.outputs && Array.isArray(node.outputs) && node.outputs.length > outputSlot) {
        const outputValue = node.outputs[outputSlot];
        if (typeof outputValue === 'string') {
            logger.debug(`从outputs数组中找到文本 | ID:${nodeId} | 槽:${outputSlot} | 文本:${outputValue.substring(0, 30)}`);
            return { 
                text: outputValue, 
                sourceNode: node, 
                sourceNodeId: nodeId, 
                sourceField: `outputs[${outputSlot}]` 
            };
        } else if (outputValue && typeof outputValue === 'object') {
            // 如果输出是对象，尝试提取其中的文本
            const extractedText = extractTextFromValue(outputValue);
            if (extractedText) {
                logger.debug(`从outputs数组对象中提取文本 | ID:${nodeId} | 槽:${outputSlot} | 文本:${extractedText.substring(0, 30)}`);
                return {
                    text: extractedText,
                    sourceNode: node,
                    sourceNodeId: nodeId,
                    sourceField: `outputs[${outputSlot}]`,
                    isExtracted: true
                };
            }
        }
    }
    
    // 2. 尝试从outputs对象中提取数据
    if (node.outputs && typeof node.outputs === 'object' && !Array.isArray(node.outputs)) {
        const possibleOutputKeys = ['text', 'value', 'string', 'output', 'result', `output_${outputSlot}`, 
            'positive', 'negative', 'prompt', 'content', 'message'];
            
        for (const key of possibleOutputKeys) {
            if (node.outputs[key] !== undefined) {
                if (typeof node.outputs[key] === 'string') {
                    logger.debug(`从outputs对象找到文本 | ID:${nodeId} | 键:${key} | 文本:${node.outputs[key].substring(0, 30)}`);
                    return {
                        text: node.outputs[key],
                        sourceNode: node,
                        sourceNodeId: nodeId,
                        sourceField: `outputs.${key}`
                    };
                } else if (node.outputs[key] && typeof node.outputs[key] === 'object') {
                    const extractedText = extractTextFromValue(node.outputs[key]);
                    if (extractedText) {
                        logger.debug(`从outputs对象属性中提取文本 | ID:${nodeId} | 键:${key} | 文本:${extractedText.substring(0, 30)}`);
                        return {
                            text: extractedText,
                            sourceNode: node,
                            sourceNodeId: nodeId,
                            sourceField: `outputs.${key}`,
                            isExtracted: true
                        };
                    }
                }
            }
        }
    }
    
    // 3. 尝试直接从节点属性提取数据
    const nodeTextProps = ['output_value', 'value', 'text', 'string', 'content', 'message', 'prompt'];
    for (const prop of nodeTextProps) {
        if (node[prop] !== undefined && typeof node[prop] === 'string') {
            logger.debug(`从节点属性中找到文本 | ID:${nodeId} | 属性:${prop} | 文本:${node[prop].substring(0, 30)}`);
            return { 
                text: node[prop], 
                sourceNode: node, 
                sourceNodeId: nodeId, 
                sourceField: prop 
            };
        } else if (node[prop] && typeof node[prop] === 'object') {
            const extractedText = extractTextFromValue(node[prop]);
            if (extractedText) {
                logger.debug(`从节点属性对象中提取文本 | ID:${nodeId} | 属性:${prop} | 文本:${extractedText.substring(0, 30)}`);
                return {
                    text: extractedText,
                    sourceNode: node,
                    sourceNodeId: nodeId,
                    sourceField: prop,
                    isExtracted: true
                };
            }
        }
    }

    // 4. 检查node.inputs中的所有字段，收集所有可能的文本字段
    // 不再仅仅关注特定字段，而是检查所有可能包含文本的字段
    if (node.inputs) {
        // 先检查常见的文本字段名称
        const commonTextFields = ['text', 'value', 'string', 'prompt', 'positive', 'negative', 
            'content', 'message', 'input', 'template'];
            
        for (const field of commonTextFields) {
            if (node.inputs[field] !== undefined) {
                if (typeof node.inputs[field] === 'string') {
                    logger.debug(`在inputs的常见字段中找到文本 | ID:${nodeId} | 字段:${field} | 文本:${node.inputs[field].substring(0, 30)}`);
                    return {
                        text: node.inputs[field],
                        sourceNode: node,
                        sourceNodeId: nodeId,
                        sourceField: field
                    };
                } else if (Array.isArray(node.inputs[field])) {
                    // 可能是链接到另一个节点
                    const upstreamLink = node.inputs[field];
                    logger.debug(`在字段${field}中找到上游链接 | ID:${nodeId} | 链接:${upstreamLink}`);
                    const result = findUpstreamTextSource(apiWorkflow, upstreamLink, depth + 1);
                    if (result) return result;
                }
            }
        }
        
        // 然后检查所有其他字段
        logger.debug(`检查所有输入字段 | ID:${nodeId} | 可用字段:${Object.keys(node.inputs)}`);
        
        // 收集可能的数组链接(递归来源)和字符串值
        const possibleArrays = [];
        const possibleStrings = [];
        
        for (const [field, value] of Object.entries(node.inputs)) {
            // 如果是字符串，收集起来稍后处理
            if (typeof value === 'string') {
                // 过滤掉太短或明显非文本内容的字段
                if (value.trim().length > 2 && !/^[,.:;\-_+*/\\|]+$/.test(value)) {
                    possibleStrings.push({field, value});
                }
            }
            // 如果是链接，收集起来稍后处理
            else if (Array.isArray(value)) {
                possibleArrays.push({field, value});
            }
            // 如果是对象，尝试提取文本
            else if (value && typeof value === 'object') {
                const extractedText = extractTextFromValue(value);
                if (extractedText) {
                    logger.debug(`从输入对象中提取文本 | ID:${nodeId} | 字段:${field} | 文本:${extractedText.substring(0, 30)}`);
                    return {
                        text: extractedText,
                        sourceNode: node,
                        sourceNodeId: nodeId,
                        sourceField: `inputs.${field}`,
                        isExtracted: true
                    };
                }
            }
        }
        
        // 首先处理可能的字符串，优先选择看起来像提示词的长字符串
        if (possibleStrings.length > 0) {
            // 按字符串长度排序，优先选择较长的字符串
            possibleStrings.sort((a, b) => b.value.length - a.value.length);
            
            for (const {field, value} of possibleStrings) {
                // 如果看起来像提示词(包含空格且长度适中)或长度足够有意义，就返回
                if (value.includes(' ') || value.length > 5) {
                    logger.debug(`选择可能的提示词文本 | ID:${nodeId} | 字段:${field} | 文本:${value.substring(0, 30)}`);
                    return {
                        text: value,
                        sourceNode: node,
                        sourceNodeId: nodeId,
                        sourceField: field
                    };
                }
            }
            
            // 如果没找到合适的，返回第一个
            const {field, value} = possibleStrings[0];
            logger.debug(`使用第一个可用文本 | ID:${nodeId} | 字段:${field} | 文本:${value}`);
            return {
                text: value,
                sourceNode: node,
                sourceNodeId: nodeId,
                sourceField: field
            };
        }
        
        // 如果没找到字符串，再处理可能的数组链接
        for (const {field, value} of possibleArrays) {
            logger.debug(`尝试处理链接数组 | ID:${nodeId} | 字段:${field} | 链接:${value}`);
            const result = findUpstreamTextSource(apiWorkflow, value, depth + 1);
            if (result) return result;
        }
    }
    
    // 5. 特殊处理：如果节点类型包含"concat"、"combine"、"join"等关键词
    // 这些节点可能将多个输入文本组合在一起
    if (node.class_type && 
        (node.class_type.toLowerCase().includes('concat') || 
         node.class_type.toLowerCase().includes('combine') ||
         node.class_type.toLowerCase().includes('join'))) {
        
        logger.debug(`检测到文本组合节点 | ID:${nodeId} | 类型:${node.class_type}`);
        
        // 尝试收集所有可能的文本输入
        const textParts = [];
        
        // 检查inputs中的所有字段，寻找可能的文本输入或链接
        if (node.inputs) {
            for (const [field, value] of Object.entries(node.inputs)) {
                // 跳过分隔符等非主要文本字段
                if (field.toLowerCase().includes('separator') || field.toLowerCase().includes('delimiter')) {
                    continue;
                }
                
                // 如果是字符串，直接添加
                if (typeof value === 'string' && value.trim().length > 0) {
                    textParts.push(value);
                }
                // 如果是链接，尝试获取上游文本
                else if (Array.isArray(value)) {
                    const result = findUpstreamTextSource(apiWorkflow, value, depth + 1);
                    if (result && result.text) {
                        textParts.push(result.text);
                    }
                }
            }
        }
        
        // 如果找到了文本部分，组合它们
        if (textParts.length > 0) {
            const combinedText = textParts.join(' ');
            logger.debug(`组合多个文本部分 | ID:${nodeId} | 部分数量:${textParts.length} | 组合结果:${combinedText.substring(0, 30)}...`);
            return {
                text: combinedText,
                sourceNode: node,
                sourceNodeId: nodeId,
                sourceField: 'combined_text',
                isCombined: true
            };
        }
    }
    
    // 6. 如果找不到其他文本，尝试从节点名称或描述中提取信息
    if (node.title && typeof node.title === 'string' && node.title.length > 3) {
        logger.debug(`从节点标题中提取信息 | ID:${nodeId} | 标题:${node.title}`);
        return {
            text: node.title,
            sourceNode: node,
            sourceNodeId: nodeId,
            sourceField: 'title'
        };
    }
    
    // 7. 特殊处理：节点是路由节点(Reroute)
    if (node.class_type === 'Reroute') {
        logger.debug(`处理路由节点 | ID:${nodeId}`);
        if (node.inputs && Object.values(node.inputs).length > 0) {
            const upstreamLink = Object.values(node.inputs)[0];
            // 确保上游连接是一个有效的链接数组
            if (Array.isArray(upstreamLink)) {
                logger.debug(`路由节点发现上游链接 | 链接:[${upstreamLink}]`);
                return findUpstreamTextSource(apiWorkflow, upstreamLink, depth + 1);
            }
        }
    }

    logger.debug(`未能找到文本源 | ID:${nodeId} | 类型:${node.class_type}`);
    return null;
}

/**
 * 处理可能包含对象或复杂结构的文本值
 * @param {any} value - 需要处理的值
 * @returns {string|null} - 提取的文本或null
 */
function extractTextFromValue(value) {
    // 如果是字符串，直接返回
    if (typeof value === 'string') {
        return value;
    }
    
    // 如果是对象，尝试提取text、value或其他常见文本字段
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        // 常见的文本字段名
        const textFields = ['text', 'value', 'content', 'string', 'prompt', 'message'];
        for (const field of textFields) {
            if (value[field] && typeof value[field] === 'string') {
                return value[field];
            }
        }
        
        // 如果有toString方法且不是默认的Object.toString
        if (typeof value.toString === 'function' && 
            value.toString !== Object.prototype.toString) {
            const strValue = value.toString();
            if (strValue !== '[object Object]') {
                return strValue;
            }
        }
    }
    
    return null;
}

/**
 * 检查文本是否需要翻译
 * @param {any} text - 要检查的文本内容
 * @returns {boolean} - 如果需要翻译返回true
 */
function shouldTranslateText(text) {
    // 处理无效文本情况
    if (text === undefined || text === null) {
        logger.debug(`跳过翻译检查 | 原因:文本为空`);
        return false;
    }
    
    // 如果不是字符串，尝试转换
    if (typeof text !== 'string') {
        // 尝试从复杂值中提取文本
        const extractedText = extractTextFromValue(text);
        if (!extractedText) {
            logger.debug(`跳过翻译检查 | 原因:非文本类型 | 类型:${typeof text}`);
            return false;
        }
        text = extractedText;
    }
    
    // 检查文本是否过短
    if (text.trim().length < 3) {
        logger.debug(`跳过翻译检查 | 原因:文本太短 | 文本:"${text}"`);
        return false;
    }
    
    // 检查是否是特殊标记或控制字符
    if (/^\s*\[(.*?)\]\s*$/.test(text) || /^<.*>$/.test(text)) {
        logger.debug(`跳过翻译检查 | 原因:可能是特殊标记 | 文本:"${text}"`);
        return false;
    }
    
    // 检查是否只包含非文本字符（如符号、数字等）
    if (!/[\p{L}]/u.test(text)) {
        logger.debug(`跳过翻译检查 | 原因:不含文字字符 | 文本:"${text}"`);
        return false;
    }

    // 检测文本是否包含中文字符
    // 使用正则表达式检查是否包含中文字符范围
    const containsChinese = /[\u4e00-\u9fa5]/.test(text);
    if (containsChinese) {
        // 计算中文字符所占比例，判断是否值得翻译
        const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
        const chineseRatio = chineseChars.length / text.length;
        
        // 如果中文字符比例大于1%，认为需要翻译
        if (chineseRatio > 0.01) {
            const textPreview = text.length > 50 ? `${text.substring(0, 50)}...` : text;
            logger.debug(`检测到中文文本 | 中文字符:${chineseChars.length} | 中文比例:${(chineseRatio * 100).toFixed(1)}% | 文本预览:"${textPreview}"`);
            return true;
        }
    }
    
    // 如果上述快速检查未确定，则使用PromptFormatter的更完整语言检测
    try {
        const { from, to } = PromptFormatter.detectLanguage(text);
        const needTranslate = from === 'zh';
        
        // 记录详细的语言检测日志
        const textPreview = text.length > 50 ? `${text.substring(0, 50)}...` : text;
        logger.debug(`语言检测结果 | 源语言:${from} | 目标语言:${to} | 需要翻译:${needTranslate} | 文本预览:"${textPreview}"`);
        
        return needTranslate;
    } catch (error) {
        logger.error(`语言检测异常 | 错误:${error.message} | 文本:"${text.substring(0, 30)}..."`);
        
        // 发生异常时，回退到简单的中文检测
        if (containsChinese) {
            logger.debug(`语言检测异常，回退到简单中文检测，检测到中文字符`);
            return true;
        }
        return false;
    }
}

/**
 * 生成请求ID
 * @param {string|null} prefix - 前缀
 * @param {string} type - 翻译类型
 * @returns {string} - 请求ID
 */
function generateRequestId(prefix, type) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const typePrefix = type === "baidu" ? "BD" : "LLM";
    return `${prefix || typePrefix}_${timestamp}_${random}`;
}

/**
 * 翻译文本并使用缓存
 */
async function translateWithCache(text) {
    try {
        const app = window.app;
        
        // 检查是否应该使用翻译缓存
        const useCache = FEATURES?.useTranslateCache !== false; // 默认为true
        
        // 如果启用了缓存，则查询翻译缓存
        if (useCache) {
            const cacheResult = TranslateCacheService.queryTranslateCache(text);
            
            if (cacheResult && cacheResult.type === 'source') {
                // 缓存命中，直接返回译文
                logger.debug(`翻译缓存命中 | 文本:"${text}" | 译文:"${cacheResult.translatedText}"`);
                return {
                    success: true,
                    translated: cacheResult.translatedText,
                    fromCache: true
                };
            }
        } else {
            logger.debug(`翻译缓存已禁用，将直接调用API | 文本:"${text}"`);
        }

        // 缓存未命中或未启用缓存，调用翻译API
        const translateType = app.settings?.["PromptAssistant.Settings.TranslateType"] || "baidu";

        // 生成唯一request_id，根据翻译类型生成对应的前缀
        const request_id = generateRequestId(null, translateType);

        // 检测语言
        const langResult = PromptFormatter.detectLanguage(text);

        let result;
        if (translateType === "baidu") {
            result = await APIService.baiduTranslate(text, langResult.from, langResult.to, null, true);
        } else {
            result = await APIService.llmTranslate(text, langResult.from, langResult.to, null, true);
        }

        if (result.success) {
            // 格式化翻译结果
            const formattedText = PromptFormatter.formatTranslatedText(result.data.translated);
            
            // 如果启用了缓存，则添加到翻译缓存
            if (useCache) {
                TranslateCacheService.addTranslateCache(text, formattedText);
                logger.debug(`添加翻译到缓存 | 文本:"${text}" | 译文:"${formattedText}"`);
            }

            return {
                success: true,
                translated: formattedText,
                fromCache: false
            };
        } else {
            throw new Error(result.error || '翻译失败');
        }
    } catch (error) {
        return {
            success: false,
            error: error.message,
            translated: text // 翻译失败时返回原文
        };
    }
}

/**
 * 工作流自动翻译拦截器
 */
export class WorkflowAutoTranslateInterceptor {
    /**
     * 拦截并处理工作流数据
     * @param {Object} workflowData - 包含output和workflow的工作流数据
     * @returns {Promise<Object>} 处理后的工作流数据
     */
    static async interceptWorkflow(workflowData) {
        const { output: apiWorkflow, workflow } = workflowData;
        let translationCount = 0;
        let cacheHitCount = 0;
        let skippedCount = 0;
        let portTranslationCount = 0; // 输入端口翻译计数
        let processedInputLinks = new Set(); // 用于跟踪已处理的输入链接，避免重复处理

        // 存储所有翻译任务的Promise
        const translationTasks = [];
        
        // 存储CLIP节点信息，优先处理CLIP节点的输入
        const clipNodes = [];

        try {
            logger.debug(`开始拦截工作流 | 节点数量:${Object.keys(apiWorkflow).length}`);
            
            // 第一轮：先识别并收集所有CLIP节点
            for (const [nodeId, nodeData] of Object.entries(apiWorkflow)) {
                if (isClipNode(nodeData.class_type)) {
                    clipNodes.push({ nodeId, nodeData });
                    logger.debug(`发现CLIP节点 | ID:${nodeId} | 类型:${nodeData.class_type}`);
                }
            }
            
            logger.debug(`找到CLIP节点总数：${clipNodes.length}`);
            
            // 第二轮：处理所有CLIP节点
            for (const { nodeId, nodeData } of clipNodes) {
                logger.debug(`处理CLIP节点 | ID:${nodeId} | 类型:${nodeData.class_type}`);

                // 获取该节点类型的文本输入字段
                const textFields = getTextInputFields(nodeData.class_type);

                // 处理每个文本字段
                for (const fieldName of textFields) {
                    const input = nodeData.inputs[fieldName];

                    if (!input) {
                        continue;
                    }

                    // 处理直接输入的文本（字符串形式）
                    if (typeof input === 'string') {
                        if (shouldTranslateText(input)) {
                            logger.debug(`发现直接输入文本 | 节点:${nodeId} | 字段:${fieldName} | 文本:"${input.substring(0, 30)}..."`);
                            
                            // 创建翻译任务并添加到任务列表
                            const translationTask = (async () => {
                                try {
                                    const translateResult = await translateWithCache(input);

                                    if (translateResult.success) {
                                        // 替换API工作流中的文本（传给后端的数据）
                                        nodeData.inputs[fieldName] = translateResult.translated;
                                        translationCount++;

                                        if (translateResult.fromCache) {
                                            cacheHitCount++;
                                        }
                                        
                                        logger.debug(`直接输入文本已翻译 | 节点:${nodeId} | 字段:${fieldName} | 原文:"${input}" | 译文:"${translateResult.translated}"`);
                                    }
                                } catch (error) {
                                    logger.error(`直接输入文本翻译失败 | 节点:${nodeId} | 字段:${fieldName} | 错误:${error.message}`);
                                    // 翻译失败时保留原文
                                    nodeData.inputs[fieldName] = input;
                                }
                            })();

                            translationTasks.push(translationTask);
                        } else {
                            skippedCount++;
                        }
                    }
                    // 处理输入端口连接的情况（数组形式 [nodeId, outputSlot]）
                    else if (Array.isArray(input) && input.length >= 2) {
                        // 创建唯一的链接ID以避免重复处理
                        const linkId = `${input[0]}_${input[1]}_${nodeId}_${fieldName}`;
                        
                        // 如果这个链接已经处理过，则跳过
                        if (processedInputLinks.has(linkId)) {
                            logger.debug(`跳过重复链接 | 链接ID:${linkId}`);
                            continue;
                        }
                        
                        processedInputLinks.add(linkId);
                        
                        // 记录链接信息
                        logger.debug(`处理输入端口连接 | 节点:${nodeId} | 字段:${fieldName} | 输入链接:[${input[0]},${input[1]}]`);
                        
                        // ===== 直接从输入源提取整合后的完整文本，而不是从上游节点翻译 =====
                        const sourceNodeId = input[0];
                        const sourceOutputSlot = input[1];
                        const sourceNode = apiWorkflow[sourceNodeId];
                        
                        // 判断源节点是否是文本组合类型节点
                        const isTextCombineNode = sourceNode && sourceNode.class_type && (
                            sourceNode.class_type.toLowerCase().includes('concat') ||
                            sourceNode.class_type.toLowerCase().includes('combine') ||
                            sourceNode.class_type.toLowerCase().includes('join')
                        );
                        
                        // 如果是文本组合节点，尝试获取其完整输出
                        let combinedText = null;
                        if (isTextCombineNode) {
                            logger.debug(`检测到文本组合节点 | ID:${sourceNodeId} | 类型:${sourceNode.class_type}`);
                            
                            // 尝试从组合节点直接获取完整输出
                            if (sourceNode.outputs && Array.isArray(sourceNode.outputs) && sourceNode.outputs.length > sourceOutputSlot) {
                                if (typeof sourceNode.outputs[sourceOutputSlot] === 'string') {
                                    combinedText = sourceNode.outputs[sourceOutputSlot];
                                    logger.debug(`获取到组合节点输出 | 文本:"${combinedText.substring(0, 30)}..."`);
                                }
                            }
                            
                            // 如果没有找到直接输出，尝试组合所有输入
                            if (!combinedText) {
                                const textParts = [];
                                let separator = ' ';  // 默认分隔符
                                
                                // 尝试查找分隔符
                                if (sourceNode.inputs && sourceNode.inputs.separator) {
                                    if (typeof sourceNode.inputs.separator === 'string') {
                                        separator = sourceNode.inputs.separator;
                                        logger.debug(`使用自定义分隔符: "${separator}"`);
                                    }
                                }
                                
                                // 收集所有输入
                                if (sourceNode.inputs) {
                                    for (const [key, value] of Object.entries(sourceNode.inputs)) {
                                        // 跳过分隔符字段
                                        if (key.toLowerCase().includes('separator') || key.toLowerCase().includes('delimiter')) {
                                            continue;
                                        }
                                        
                                        // 直接字符串输入
                                        if (typeof value === 'string') {
                                            textParts.push(value);
                                            logger.debug(`添加文本部分: "${value.substring(0, 20)}..."`);
                                        }
                                        // 链接输入
                                        else if (Array.isArray(value)) {
                                            const upstreamText = findUpstreamTextSource(apiWorkflow, value);
                                            if (upstreamText && typeof upstreamText.text === 'string') {
                                                textParts.push(upstreamText.text);
                                                logger.debug(`添加上游文本: "${upstreamText.text.substring(0, 20)}..."`);
                                            }
                                        }
                                    }
                                }
                                
                                // 组合所有文本部分
                                if (textParts.length > 0) {
                                    combinedText = textParts.join(separator);
                                    logger.debug(`组合多个部分得到文本 | 部分数:${textParts.length} | 结果:"${combinedText.substring(0, 30)}..."`);
                                }
                            }
                        }
                        
                        // 如果找到了组合文本且需要翻译
                        if (combinedText && shouldTranslateText(combinedText)) {
                            logger.debug(`对组合节点的完整文本进行翻译 | 文本:"${combinedText.substring(0, 30)}..."`);
                            
                            const translationTask = (async () => {
                                try {
                                    const translateResult = await translateWithCache(combinedText);
                                    
                                    if (translateResult.success) {
                                        // 创建一个特殊字段保存完整的翻译结果，以便后续替换
                                        nodeData._translatedInput = {
                                            field: fieldName,
                                            originalLink: input.slice(), // 复制链接数组
                                            translatedText: translateResult.translated
                                        };
                                        
                                        // 修改输入为直接文本
                                        nodeData.inputs[fieldName] = translateResult.translated;
                                        
                                        translationCount++;
                                        portTranslationCount++;
                                        
                                        if (translateResult.fromCache) {
                                            cacheHitCount++;
                                        }
                                        
                                        logger.debug(`组合文本已翻译 | 节点:${nodeId} | 字段:${fieldName} | 原文:"${combinedText}" | 译文:"${translateResult.translated}"`);
                                        return; // 成功翻译组合文本，不再继续查找上游文本源
                                    }
                                } catch (error) {
                                    logger.error(`组合文本翻译失败 | 节点:${nodeId} | 字段:${fieldName} | 错误:${error.message}`);
                                }
                            })();
                            
                            translationTasks.push(translationTask);
                            continue; // 跳过后续处理
                        }
                        
                        // 如果没有找到组合文本或翻译失败，则继续使用常规方法递归查找上游文本源
                        const textSourceInfo = findUpstreamTextSource(apiWorkflow, input);

                        // 如果找到文本源
                        if (textSourceInfo) {
                            // 尝试从文本源中提取文本
                            let extractedText = textSourceInfo.text;
                            
                            // 如果text不是字符串，尝试提取
                            if (extractedText !== undefined && typeof extractedText !== 'string') {
                                const extractedValue = extractTextFromValue(extractedText);
                                if (extractedValue) {
                                    // 更新textSourceInfo中的文本
                                    extractedText = extractedValue;
                                    textSourceInfo.text = extractedValue;
                                    logger.debug(`成功从复杂数据结构中提取文本 | 节点:${nodeId} | 文本:"${extractedValue.substring(0, 30)}..."`);
                                }
                            }
                            
                            // 如果有文本并且需要翻译
                            if (extractedText && typeof extractedText === 'string' && shouldTranslateText(extractedText)) {
                                const { sourceNode, sourceNodeId, sourceField } = textSourceInfo;

                                logger.debug(`发现上游文本源 | 节点:${nodeId} | 字段:${fieldName} | 源节点:${sourceNodeId} | 源字段:${sourceField} | 文本:"${extractedText.substring(0, 30)}..."`);

                                // 创建翻译任务
                                const translationTask = (async () => {
                                    try {
                                        const translateResult = await translateWithCache(extractedText);

                                        if (translateResult.success) {
                                            // 直接更新源节点的文本值
                                            if (sourceField.startsWith('outputs[') && sourceField.endsWith(']')) {
                                                // 处理outputs数组情况
                                                const outputIndex = parseInt(sourceField.match(/\[(\d+)\]/)[1], 10);
                                                if (Array.isArray(sourceNode.outputs)) {
                                                    sourceNode.outputs[outputIndex] = translateResult.translated;
                                                }
                                            } else if (sourceField.includes('.')) {
                                                // 处理嵌套属性情况
                                                const parts = sourceField.split('.');
                                                let target = sourceNode;
                                                for (let i = 0; i < parts.length - 1; i++) {
                                                    target = target[parts[i]];
                                                }
                                                target[parts[parts.length - 1]] = translateResult.translated;
                                            } else {
                                                // 标准情况
                                                if (sourceNode.inputs && sourceField in sourceNode.inputs) {
                                                    sourceNode.inputs[sourceField] = translateResult.translated;
                                                } else {
                                                    sourceNode[sourceField] = translateResult.translated;
                                                }
                                            }

                                            portTranslationCount++;
                                            translationCount++;

                                            if (translateResult.fromCache) {
                                                cacheHitCount++;
                                            }

                                            logger.debug(`输入端口文本已翻译 | 节点:${nodeId} | 源节点:${sourceNodeId} | 源字段:${sourceField} | 原文:"${extractedText.substring(0, 30)}..." | 译文:"${translateResult.translated.substring(0, 30)}..."`);
                                        } else {
                                            logger.warn(`输入端口文本翻译失败 | 节点:${nodeId} | 源节点:${sourceNodeId} | 源字段:${sourceField} | 原因:${translateResult.error}`);
                                        }
                                    } catch (error) {
                                        logger.error(`输入端口文本翻译异常 | 节点:${nodeId} | 源节点:${sourceNodeId} | 错误:${error.message}`);
                                        // 翻译失败时保留原文
                                    }
                                })();

                                translationTasks.push(translationTask);
                            } else {
                                if (!extractedText) {
                                    logger.debug(`上游文本源无有效文本 | 节点:${nodeId} | 字段:${fieldName} | 源节点:${textSourceInfo.sourceNodeId} | 源字段:${textSourceInfo.sourceField} | 值类型:${typeof textSourceInfo.text}`);
                                } else if (typeof extractedText !== 'string') {
                                    logger.debug(`上游文本不是字符串 | 节点:${nodeId} | 字段:${fieldName} | 源节点:${textSourceInfo.sourceNodeId} | 值类型:${typeof extractedText}`);
                                } else {
                                    logger.debug(`跳过翻译 | 节点:${nodeId} | 字段:${fieldName} | 源节点:${textSourceInfo.sourceNodeId} | 原因:不需要翻译`);
                                }
                                skippedCount++;
                            }
                        } else {
                            logger.debug(`未找到上游文本源 | 节点:${nodeId} | 字段:${fieldName} | 输入链接:[${input[0]},${input[1]}]`);
                            
                            // 尝试直接访问源节点
                            try {
                                const sourceNodeId = input[0];
                                const sourceOutputSlot = input[1];
                                const sourceNode = apiWorkflow[sourceNodeId];
                                
                                if (sourceNode) {
                                    logger.debug(`尝试直接访问源节点 | 源节点ID:${sourceNodeId} | 类型:${sourceNode.class_type}`);
                                    
                                    // 创建一个新链接，使用通用的findUpstreamTextSource函数
                                    const textSourceInfo = findUpstreamTextSource(apiWorkflow, [sourceNodeId, sourceOutputSlot], 0);
                                    
                                    if (textSourceInfo && textSourceInfo.text) {
                                        logger.debug(`直接访问源节点成功找到文本 | 源节点:${sourceNodeId} | 文本:"${textSourceInfo.text.substring(0, 30)}..."`);
                                        
                                        // 如果找到了文本源且需要翻译，创建翻译任务
                                        if (shouldTranslateText(textSourceInfo.text)) {
                                            const translationTask = (async () => {
                                                try {
                                                    const translateResult = await translateWithCache(textSourceInfo.text);
                                                    
                                                    if (translateResult.success) {
                                                        // 更新源节点的文本
                                                        // 根据返回的sourceField确定如何更新
                                                        const { sourceNode, sourceField, isExtracted, isCombined } = textSourceInfo;
                                                        
                                                        // 根据sourceField类型和位置更新源节点
                                                        if (sourceField === 'combined_text' || isExtracted || isCombined) {
                                                            // 特殊情况：组合或提取的文本
                                                            logger.debug(`翻译组合/提取文本 | 源节点:${sourceNodeId} | 字段:${sourceField}`);
                                                        } 
                                                        else if (sourceField.startsWith('outputs[') && sourceField.endsWith(']')) {
                                                            // 处理outputs数组情况
                                                            const match = sourceField.match(/\[(\d+)\]/);
                                                            if (match) {
                                                                const outputIndex = parseInt(match[1], 10);
                                                                if (Array.isArray(sourceNode.outputs)) {
                                                                    sourceNode.outputs[outputIndex] = translateResult.translated;
                                                                    logger.debug(`更新源节点outputs数组 | 源节点:${sourceNodeId} | 索引:${outputIndex}`);
                                                                }
                                                            }
                                                        } 
                                                        else if (sourceField.startsWith('outputs.')) {
                                                            // 处理outputs对象属性
                                                            const key = sourceField.substring('outputs.'.length);
                                                            if (sourceNode.outputs && typeof sourceNode.outputs === 'object') {
                                                                sourceNode.outputs[key] = translateResult.translated;
                                                                logger.debug(`更新源节点outputs对象 | 源节点:${sourceNodeId} | 键:${key}`);
                                                            }
                                                        } 
                                                        else if (sourceField.startsWith('inputs.')) {
                                                            // 处理inputs对象属性
                                                            const key = sourceField.substring('inputs.'.length);
                                                            if (sourceNode.inputs && typeof sourceNode.inputs === 'object') {
                                                                sourceNode.inputs[key] = translateResult.translated;
                                                                logger.debug(`更新源节点inputs对象 | 源节点:${sourceNodeId} | 键:${key}`);
                                                            }
                                                        }
                                                        else {
                                                            // 直接字段或属性
                                                            if (sourceNode.inputs && sourceField in sourceNode.inputs) {
                                                                // 更新inputs中的字段
                                                                sourceNode.inputs[sourceField] = translateResult.translated;
                                                                logger.debug(`更新源节点inputs字段 | 源节点:${sourceNodeId} | 字段:${sourceField}`);
                                                            } else {
                                                                // 更新节点直接属性
                                                                sourceNode[sourceField] = translateResult.translated;
                                                                logger.debug(`更新源节点属性 | 源节点:${sourceNodeId} | 属性:${sourceField}`);
                                                            }
                                                        }
                                                        
                                                        // 通用回退：如果无法确定准确的位置，尝试在所有位置寻找
                                                        let needFallback = true;
                                                        
                                                        // 检查更新是否成功
                                                        if (sourceField === 'combined_text' || isExtracted || isCombined) {
                                                            // 对于组合文本或提取文本，需要逐个检查所有位置
                                                            needFallback = true;
                                                        } 
                                                        else if (sourceField.startsWith('outputs[')) {
                                                            const match = sourceField.match(/\[(\d+)\]/);
                                                            if (match) {
                                                                const outputIndex = parseInt(match[1], 10);
                                                                if (Array.isArray(sourceNode.outputs) && 
                                                                    sourceNode.outputs[outputIndex] === translateResult.translated) {
                                                                    needFallback = false;
                                                                }
                                                            }
                                                        } 
                                                        else if (sourceField.startsWith('outputs.')) {
                                                            const key = sourceField.substring('outputs.'.length);
                                                            if (sourceNode.outputs && sourceNode.outputs[key] === translateResult.translated) {
                                                                needFallback = false;
                                                            }
                                                        } 
                                                        else if (sourceField.startsWith('inputs.')) {
                                                            const key = sourceField.substring('inputs.'.length);
                                                            if (sourceNode.inputs && sourceNode.inputs[key] === translateResult.translated) {
                                                                needFallback = false;
                                                            }
                                                        }
                                                        else {
                                                            if (sourceNode.inputs && sourceField in sourceNode.inputs && 
                                                                sourceNode.inputs[sourceField] === translateResult.translated) {
                                                                needFallback = false;
                                                            } else if (sourceNode[sourceField] === translateResult.translated) {
                                                                needFallback = false;
                                                            }
                                                        }
                                                        
                                                        // 如果需要回退，则尝试所有位置
                                                        if (needFallback) {
                                                            logger.debug(`尝试回退方式更新源节点 | 源节点:${sourceNodeId}`);
                                                            
                                                            // 1. 检查inputs中的所有字段
                                                            if (sourceNode.inputs) {
                                                                for (const [key, value] of Object.entries(sourceNode.inputs)) {
                                                                    if (value === textSourceInfo.text) {
                                                                        sourceNode.inputs[key] = translateResult.translated;
                                                                        logger.debug(`回退更新: inputs.${key} | 源节点:${sourceNodeId}`);
                                                                        needFallback = false;
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                            
                                                            // 2. 检查outputs数组
                                                            if (needFallback && Array.isArray(sourceNode.outputs)) {
                                                                for (let i = 0; i < sourceNode.outputs.length; i++) {
                                                                    if (sourceNode.outputs[i] === textSourceInfo.text) {
                                                                        sourceNode.outputs[i] = translateResult.translated;
                                                                        logger.debug(`回退更新: outputs[${i}] | 源节点:${sourceNodeId}`);
                                                                        needFallback = false;
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                            
                                                            // 3. 检查outputs对象
                                                            if (needFallback && sourceNode.outputs && typeof sourceNode.outputs === 'object') {
                                                                for (const [key, value] of Object.entries(sourceNode.outputs)) {
                                                                    if (value === textSourceInfo.text) {
                                                                        sourceNode.outputs[key] = translateResult.translated;
                                                                        logger.debug(`回退更新: outputs.${key} | 源节点:${sourceNodeId}`);
                                                                        needFallback = false;
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                            
                                                            // 4. 检查节点属性
                                                            if (needFallback) {
                                                                for (const [key, value] of Object.entries(sourceNode)) {
                                                                    if (value === textSourceInfo.text && typeof value === 'string') {
                                                                        sourceNode[key] = translateResult.translated;
                                                                        logger.debug(`回退更新: ${key} | 源节点:${sourceNodeId}`);
                                                                        needFallback = false;
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        
                                                        portTranslationCount++;
                                                        translationCount++;
                                                        
                                                        if (translateResult.fromCache) {
                                                            cacheHitCount++;
                                                        }
                                                        
                                                        logger.debug(`输入端口文本已翻译 | 源节点:${sourceNodeId} | 原文:"${textSourceInfo.text.substring(0, 30)}..." | 译文:"${translateResult.translated.substring(0, 30)}..."`);
                                                    } else {
                                                        logger.warn(`输入端口文本翻译失败 | 源节点:${sourceNodeId} | 原因:${translateResult.error}`);
                                                    }
                                                } catch (error) {
                                                    logger.error(`输入端口文本翻译异常 | 源节点:${sourceNodeId} | 错误:${error.message}`);
                                                }
                                            })();
                                            
                                            translationTasks.push(translationTask);
                                        } else {
                                            logger.debug(`跳过翻译 | 源节点:${sourceNodeId} | 原因:不需要翻译`);
                                        }
                                    } else {
                                        logger.debug(`直接访问源节点未找到文本 | 源节点:${sourceNodeId}`);
                                    }
                                }
                            } catch (error) {
                                logger.error(`直接访问源节点异常 | 错误:${error.message} | 堆栈:${error.stack}`);
                            }
                            
                            skippedCount++;
                        }
                    }
                }
            }

            // 等待所有翻译任务完成
            if (translationTasks.length > 0) {
                logger.debug(`等待${translationTasks.length}个翻译任务完成...`);
                await Promise.all(translationTasks);
            }

            if (translationCount > 0) {
                logger.log(`工作流翻译完成 | 总计:${translationCount} | 缓存命中:${cacheHitCount} | 跳过:${skippedCount} | 输入端口:${portTranslationCount}`);
            } else {
                logger.debug(`工作流无需翻译 | 跳过:${skippedCount}`);
            }

        } catch (error) {
            logger.error(`工作流翻译拦截异常 | 错误:${error.message}`);
        }

        return workflowData;
    }
}

/**
 * 安装自动翻译拦截器（一次性）
 * 采用统一的功能开关逻辑，与其他功能保持一致
 * @param {number} [maxRetries=10] - 最大重试次数
 * @param {number} [retryDelay=500] - 重试延迟(毫秒)
 * @returns {Promise<boolean>} - 安装是否成功
 */
export function ensureAutoTranslateInterceptorInstalled(maxRetries = 10, retryDelay = 1000) {  // 重试间隔从500ms增加到1000ms
    let currentRetry = 0;
    
    const attemptInstall = () => {
        try {
            const app = window.app;
            
            // 检查是否已经安装过拦截器
            if (app && app.api && app.api._autoTranslateInstalled) {
                logger.debug('自动翻译拦截器已安装，无需重复安装');
                return true;
            }
            
            // 如果API还没准备好，稍后再试
            if (!app || !app.api || typeof app.api.queuePrompt !== 'function') {
                if (currentRetry < maxRetries) {
                    currentRetry++;
                    logger.debug(`API未准备好，${retryDelay}ms后重试(${currentRetry}/${maxRetries})...`);
                    setTimeout(() => attemptInstall(), retryDelay);
                    return false;
                } else {
                    logger.error(`安装自动翻译拦截器失败: 达到最大重试次数(${maxRetries})，API未准备好`);
                    return false;
                }
            }
            
            // 保存原始方法
            app.api._originalQueuePrompt = app.api.queuePrompt.bind(app.api);
            app.api._autoTranslateInstalled = true;
            
            // 重写queuePrompt方法
            app.api.queuePrompt = async function (number, data) {
                try {
                    // 检查自动翻译功能是否启用（使用统一的FEATURES对象）
                    let features = { autoTranslate: true }; // 默认启用
                    
                    try {
                        // 动态导入功能开关配置
                        const { FEATURES } = await import('./features.js');
                        features = FEATURES;
                    } catch (importError) {
                        logger.warn(`导入功能开关模块失败，使用默认设置 | 错误:${importError.message}`);
                    }
                    
                    // 如果自动翻译功能已启用，则拦截并处理工作流数据
                    if (features.autoTranslate) {
                        // 记录调试信息
                        logger.debug(`拦截工作流请求 | 编号:${number}`);
                        
                        // 在发送前拦截并处理工作流数据
                        const processedData = await WorkflowAutoTranslateInterceptor.interceptWorkflow(data);
                        
                        // 调用原始方法，传递处理后的数据
                        return await app.api._originalQueuePrompt(number, processedData);
                    } else {
                        logger.debug('自动翻译功能已禁用，跳过处理');
                        // 功能关闭时直接调用原始方法
                        return await app.api._originalQueuePrompt(number, data);
                    }
                } catch (error) {
                    // 出现异常时记录错误并继续使用原始数据
                    logger.error(`工作流拦截处理失败 | 错误:${error.message}`);
                    logger.error(`错误堆栈: ${error.stack}`);
                    // 发生错误时使用原始数据，确保即使翻译失败，原始功能仍然可用
                    return await app.api._originalQueuePrompt(number, data);
                }
            };
            
            // 添加卸载方法，便于日后调试或清理
            app.api._uninstallAutoTranslate = function() {
                if (app.api._originalQueuePrompt) {
                    app.api.queuePrompt = app.api._originalQueuePrompt;
                    delete app.api._originalQueuePrompt;
                    delete app.api._autoTranslateInstalled;
                    logger.log('自动翻译拦截器已卸载');
                    return true;
                }
                return false;
            };
            
            // 添加重新安装方法
            app.api._reinstallAutoTranslate = function() {
                if (app.api._uninstallAutoTranslate()) {
                    return ensureAutoTranslateInterceptorInstalled();
                }
                return false;
            };
            
            logger.log('自动翻译拦截器已成功安装（统一功能开关模式）');
            return true;
        } catch (error) {
            logger.error(`自动翻译拦截器安装异常 | 错误:${error.message}`);
            logger.error(`错误堆栈: ${error.stack}`);
            
            // 尝试错误恢复
            if (currentRetry < maxRetries) {
                currentRetry++;
                logger.debug(`安装失败，${retryDelay * 2}ms后重试(${currentRetry}/${maxRetries})...`);
                setTimeout(() => attemptInstall(), retryDelay * 2);
                return false;
            }
            
            return false;
        }
    };
    
    // 开始安装尝试
    return attemptInstall();
}

// 移除自动安装逻辑，改为由index.js直接控制初始化
// 这样可以避免与PromptAssistant.js的相互依赖，并使初始化流程更清晰 