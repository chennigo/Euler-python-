import fs from 'node:fs';
import path from 'node:path';
import { kbRoot } from './paths.js';

const SKIP_DIRS = new Set(['node_modules', '.git']);

function* walkMd(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMd(abs);
    else if (entry.name.endsWith('.md')) yield abs;
  }
}

/** 全库子串搜索。中文无需分词，直接 indexOf。 */
export function search(query, { limit = 50 } = {}) {
  if (!query) return [];
  const root = kbRoot();
  const needle = query.toLowerCase();
  const hits = [];

  for (const abs of walkMd(root)) {
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({
          path: path.relative(root, abs).split(path.sep).join('/'),
          line: i + 1,
          text: lines[i].trim(),
          before: lines[i - 1] ?? '',
          after: lines[i + 1] ?? '',
        });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
