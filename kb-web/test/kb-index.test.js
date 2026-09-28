import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIdx, parseSearchIndex, buildTree } from '../src/kb-index.js';
import { resolveInKb } from '../src/paths.js';

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

test('parseSearchIndex 不把 .idx.md 索引表当作文章', () => {
  const md = [
    '### SQL注入',
    '- **知识**: [SQL.md](SQL.md) → [SQL.idx.md](SQL.idx.md) (2611行)',
  ].join('\n');
  const cats = parseSearchIndex(md);
  const paths = cats[0].articles.map((a) => a.path);
  assert.ok(paths.includes('SQL.md'));
  assert.ok(!paths.some((p) => p.endsWith('.idx.md')));
});

test('buildTree 无需参数，且文章路径能解析到真实文件', () => {
  assert.equal(buildTree.length, 0); // root 形参已移除
  const tree = buildTree();
  assert.ok(tree.categories.length >= 5);
  const sql = tree.categories.find((c) => c.name === 'SQL注入');
  assert.ok(sql, '应存在 SQL注入 分类');
  const article = sql.articles.find((a) => a.path === 'SQL.md');
  assert.ok(article, 'SQL注入 分类下应有 SQL.md');
  assert.ok(fs.existsSync(resolveInKb(article.path)), 'SQL.md 应解析到真实文件');
});

test('buildTree 不再接受 root 参数：传入路径无法改变解析根目录', () => {
  const stray = buildTree(path.join(here, 'fixtures', 'nonexistent-root'));
  assert.equal(stray.categories.length, buildTree().categories.length);
});
