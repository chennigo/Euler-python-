// 匹配 路径/文件.md 或 文件.md，后接可选的 :行号
const CITATION_RE = /([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5/\\.-]*\.md)(?::(\d+))?/g;

/** 从回答文本中抽取引用，按 (file, startLine) 去重。 */
export function extractCitations(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text).matchAll(CITATION_RE)) {
    const file = m[1].replace(/\\/g, '/');
    const startLine = m[2] ? Number(m[2]) : null;
    const key = `${file}:${startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, startLine });
  }
  return out;
}
