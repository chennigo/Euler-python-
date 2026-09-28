import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.js';

test('命中中文关键词并返回行号与上下文', () => {
  const hits = search('宽字节', { limit: 5 });
  assert.ok(hits.length > 0);
  assert.ok(hits[0].text.includes('宽字节'));
  assert.equal(typeof hits[0].line, 'number');
  assert.equal(typeof hits[0].before, 'string');
});

test('遵守 limit', () => {
  assert.ok(search('的', { limit: 3 }).length <= 3);
});

test('无命中返回空数组', () => {
  assert.deepEqual(search('zzz不存在的词zzz'), []);
});

test('正则特殊字符被当作字面量', () => {
  assert.doesNotThrow(() => search('a.*b['));
});
