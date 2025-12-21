/**
 * Markdown Note 翻译辅助工具（零依赖）
 * - HTML -> 占位 -> 翻译回填 -> HTML
 * - 保护代码块/内联代码与链接/图片的 URL 属性，只翻译可见文本与可选的 img.alt
 */

// ---配置项---
const DEFAULT_OPTIONS = {
  translateImageAlt: true, // 是否翻译 <img alt>
  keepSurroundingPunctuation: false // 是否保持两端标点不翻译
};

// 占位符生成
const PH_PREFIX = "⟪T";
const PH_SUFFIX = "⟫";

// 判断是否在 code 上下文中
function isInCodeContext(node) {
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'code' || tag === 'pre') return true;
    }
    node = node.parentNode;
  }
  return false;
}

// 判断属性是否为 URL/不翻译属性
function isNonTranslatableAttr(name) {
  if (!name) return true;
  const n = name.toLowerCase();
  return n === 'href' || n === 'src' || n.startsWith('data-') || n === 'title';
}

// 拆分前后空白与标点
function splitLeadingTrailing(text, keepPunct) {
  if (!text) return { lead: '', core: '', trail: '' };
  let leadWS = text.match(/^\s+/)?.[0] || '';
  let trailWS = text.match(/\s+$/)?.[0] || '';
  let core = text.slice(leadWS.length, text.length - trailWS.length);

  if (keepPunct && core) {
    const punctSet = new Set([',', '，', '.', '。', '!', '！', '?', '？', ':', '：', ';', '；']);
    let left = 0;
    while (left < core.length && punctSet.has(core[left])) left++;
    let right = core.length - 1;
    while (right >= left && punctSet.has(core[right])) right--;
    const leftP = core.slice(0, left);
    const mid = core.slice(left, right + 1);
    const rightP = core.slice(right + 1);
    return { lead: leadWS + leftP, core: mid, trail: rightP + trailWS };
  }

  return { lead: leadWS, core, trail: trailWS };
}

// 遍历文本节点并占位
function protectAndExtract(html, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  const texts = [];
  const placeholders = [];
  let index = 0;

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      // 跳过纯空白
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      // 代码上下文跳过
      if (isInCodeContext(node)) return NodeFilter.FILTER_REJECT;
      // 属性文本不在 TreeWalker 中出现，这里只过滤可见文本节点
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodeRecords = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    // 如果在链接或图片等标签内，仅翻译可见文本
    const parentEl = node.parentElement;
    if (parentEl) {
      const tag = parentEl.tagName?.toLowerCase();
      if (tag === 'a') {
        // 仅翻译节点文本，属性跳过
      } else if (tag === 'img') {
        // 文本节点一般不出现在 <img> 下，这里忽略
      }
    }

    const { lead, core, trail } = splitLeadingTrailing(node.nodeValue, opts.keepSurroundingPunctuation);
    if (!core) continue; // 全是空白或标点且设置保持

    const ph = `${PH_PREFIX}${index}${PH_SUFFIX}`;
    texts.push(core);
    placeholders.push(ph);
    nodeRecords.push({ node, lead, trail, ph });
    index++;
  }

  // 将文本节点替换为 占位结构：lead + PH + trail
  for (const rec of nodeRecords) {
    rec.node.nodeValue = `${rec.lead}${rec.ph}${rec.trail}`;
  }

  // 可选：处理 <img alt>
  const imgList = Array.from(body.querySelectorAll('img[alt]'));
  const imgAltRecords = [];
  if (opts.translateImageAlt && imgList.length) {
    for (const img of imgList) {
      const alt = img.getAttribute('alt');
      if (alt && alt.trim() && !isInCodeContext(img)) {
        const { lead, core, trail } = splitLeadingTrailing(alt, opts.keepSurroundingPunctuation);
        if (!core) continue;
        const ph = `${PH_PREFIX}${index}${PH_SUFFIX}`;
        texts.push(core);
        placeholders.push(ph);
        imgAltRecords.push({ el: img, lead, trail, ph });
        index++;
      }
    }
  }

  for (const rec of imgAltRecords) {
    rec.el.setAttribute('alt', `${rec.lead}${rec.ph}${rec.trail}`);
  }

  // 返回占位后的 HTML 与文本数组
  return {
    placeholderHTML: body.innerHTML,
    texts,
    placeholders
  };
}

// 回填翻译
function restoreWithTranslations(placeholderHTML, placeholders, translations) {
  let html = placeholderHTML;
  for (let i = 0; i < placeholders.length; i++) {
    const ph = placeholders[i];
    const tr = translations[i] ?? '';
    // 只替换一次以保持顺序
    html = html.replace(ph, tr);
  }
  return html;
}

export const MarkdownNoteTranslate = {
  protectAndExtract,
  restoreWithTranslations,
  constants: { PH_PREFIX, PH_SUFFIX },
};
