import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations } from '../src/ai/citations.js';

test('抽取「文件:行号」', () => {
  const c = extractCitations('见 SQL.md:450 的说明');
  assert.deepEqual(c, [{ file: 'SQL.md', startLine: 450 }]);
});

test('抽取带路径的文件:行号', () => {
  const c = extractCitations('参考 WP汇总/各大靶场WP汇总.md:12');
  assert.equal(c[0].file, 'WP汇总/各大靶场WP汇总.md');
  assert.equal(c[0].startLine, 12);
});

test('无行号时只取文件', () => {
  const c = extractCitations('详见 命令执行.md');
  assert.deepEqual(c, [{ file: '命令执行.md', startLine: null }]);
});

test('去重', () => {
  assert.equal(extractCitations('SQL.md:1 和 SQL.md:1').length, 1);
});

test('忽略非 .md 文本', () => {
  assert.deepEqual(extractCitations('版本 1.2:3 说明'), []);
});
