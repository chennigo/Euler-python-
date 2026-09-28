import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIdx, parseSearchIndex } from '../src/kb-index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => fs.readFileSync(path.join(here, 'fixtures', n), 'utf8');

test('parseIdx 抽取章节与行号', () => {
  const sections = parseIdx(fixture('sample.idx.md'));
  assert.equal(sections.length, 3);
  assert.deepEqual(sections[2], { label: '宽字节注入（GBK）', startLine: 450, endLine: 700 });
});

test('parseIdx 忽略不含行号的行', () => {
  const sections = parseIdx(fixture('sample.idx.md'));
  assert.ok(!sections.some((s) => s.label.includes('总行数')));
});

test('parseIdx 对空输入返回空数组', () => {
  assert.deepEqual(parseIdx(''), []);
});

test('parseSearchIndex 抽取分类与关键词', () => {
  const md = [
    '### SQL注入',
    '- **知识**: [SQL.md](SQL.md) → [SQL.idx.md](SQL.idx.md) (2611行)',
    '- **关键词**: `联合注入` `盲注` `WAF绕过`',
    '',
    '### SSRF',
    '- **知识**: [SSRF漏洞.md](SSRF漏洞.md)',
  ].join('\n');
  const cats = parseSearchIndex(md);
  assert.equal(cats.length, 2);
  assert.equal(cats[0].name, 'SQL注入');
  assert.deepEqual(cats[0].keywords, ['联合注入', '盲注', 'WAF绕过']);
  assert.equal(cats[0].articles[0].path, 'SQL.md');
});
