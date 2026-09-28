import fs from 'node:fs';
import { resolveInKb } from './paths.js';

const SECTION_RE = /^-\s*L(\d+)-L(\d+):\s*(.+?)\s*$/;
const CATEGORY_RE = /^###\s+(.+?)\s*$/;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const KEYWORD_RE = /`([^`]+)`/g;

/** 解析 .idx.md，抽出「行号范围 → 章节名」表。 */
export function parseIdx(mdText) {
  const sections = [];
  for (const line of mdText.split(/\r?\n/)) {
    const m = SECTION_RE.exec(line);
    if (m) {
      sections.push({ label: m[3], startLine: Number(m[1]), endLine: Number(m[2]) });
    }
  }
  return sections;
}

/** 解析 AI-SEARCH-INDEX.md，抽出分类及其下的文章/WP/脚本/关键词。 */
export function parseSearchIndex(mdText) {
  const lines = mdText.split(/\r?\n/);
  const categories = [];
  let current = null;

  const pushLinks = (target, text) => {
    for (const m of text.matchAll(MD_LINK_RE)) {
      const [, title, href] = m;
      // .idx.md 是行号索引表，不是可读内容，不作为文章暴露给 UI
      if (href.endsWith('.md') && !href.endsWith('.idx.md')) target.push({ title, path: href });
    }
  };

  for (const line of lines) {
    const cat = CATEGORY_RE.exec(line);
    if (cat) {
      current = { name: cat[1], keywords: [], articles: [], wp: [], scripts: [] };
      categories.push(current);
      continue;
    }
    if (!current) continue;

    if (line.includes('**关键词**')) {
      for (const m of line.matchAll(KEYWORD_RE)) current.keywords.push(m[1]);
      continue;
    }
    if (line.includes('**知识**')) { pushLinks(current.articles, line); continue; }
    if (line.includes('**WP**')) { pushLinks(current.wp, line); continue; }
    if (line.includes('**脚本**')) { pushLinks(current.scripts, line); continue; }
  }
  return categories;
}

/** 扫描知识库构建完整目录树。启动时调用一次。 */
export function buildTree() {
  const indexPath = resolveInKb('AI-SEARCH-INDEX.md');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`索引文件不存在，无法构建目录树: ${indexPath}`);
  }
  const categories = parseSearchIndex(fs.readFileSync(indexPath, 'utf8'));

  // 为每篇文章挂上章节表（若存在同名 .idx.md）
  for (const c of categories) {
    for (const a of c.articles) {
      const idxRel = a.path.replace(/\.md$/, '.idx.md');
      try {
        const idxAbs = resolveInKb(idxRel);
        if (fs.existsSync(idxAbs)) {
          a.sections = parseIdx(fs.readFileSync(idxAbs, 'utf8'));
          a.totalLines = countLines(resolveInKb(a.path));
        }
      } catch { /* 索引缺失或路径异常：该文章留作无章节文章，不阻断整体构建 */ }
    }
  }

  const wpDir = resolveInKb('CTF大赛WP集合/articles');
  const wpList = fs.existsSync(wpDir)
    ? fs.readdirSync(wpDir).filter((f) => f.endsWith('.md'))
        .map((f) => ({ title: f.replace(/\.md$/, ''), path: `CTF大赛WP集合/articles/${f}` }))
    : [];

  return { categories, flatArticles: [], wpList };
}

function countLines(abs) {
  if (!fs.existsSync(abs)) return 0;
  return fs.readFileSync(abs, 'utf8').split(/\r?\n/).length;
}
