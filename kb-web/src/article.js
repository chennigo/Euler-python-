import fs from 'node:fs';
import { resolveInKb } from './paths.js';

/** 按行范围读取知识库中的文章。范围越界时夹紧，不报错。 */
export function readArticle(relPath, startLine, endLine) {
  const abs = resolveInKb(relPath);           // 越界在此抛错
  if (!fs.existsSync(abs)) throw new Error(`article not found: ${relPath}`);

  const all = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const totalLines = all.length;
  const start = Math.max(1, Math.min(Number(startLine) || 1, totalLines));
  const end = Math.max(start, Math.min(Number(endLine) || totalLines, totalLines));

  return {
    path: relPath,
    startLine: start,
    endLine: end,
    totalLines,
    content: all.slice(start - 1, end).join('\n'),
  };
}
