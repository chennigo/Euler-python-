import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readArticle } from '../src/article.js';

test('按行范围读取', () => {
  const r = readArticle('SQL.md', 1, 5);
  assert.equal(r.startLine, 1);
  assert.equal(r.endLine, 5);
  assert.equal(r.content.split('\n').length, 5);
  assert.ok(r.totalLines > 5);
});

test('越界范围被夹紧而不是报错', () => {
  const r = readArticle('SQL.md', 1, 999999);
  assert.equal(r.endLine, r.totalLines);
});

test('路径越界被拒绝', () => {
  assert.throws(() => readArticle('../../x.md', 1, 1), /escapes knowledge base/);
});
