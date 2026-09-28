import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('limit 为 0 返回空数组', () => {
  assert.deepEqual(search('的', { limit: 0 }), []);
});

test('limit 为 1 恰好返回 1 条', () => {
  assert.equal(search('的', { limit: 1 }).length, 1);
});

test('跳过符号链接，不读取库外内容', (t) => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sym-kb-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sym-out-'));
  fs.writeFileSync(path.join(kb, 'real.md'), '库内正常内容\n');
  const secret = path.join(outside, 'SECRET.md');
  fs.writeFileSync(secret, 'SECRET-库外不该泄漏-token\n');
  try {
    fs.symlinkSync(secret, path.join(kb, 'link.md'), 'file');
  } catch (e) {
    fs.rmSync(kb, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    t.skip(`环境不允许创建符号链接: ${e.code}`);
    return;
  }

  const prev = process.env.KB_ROOT;
  process.env.KB_ROOT = kb;
  try {
    // 先行断言：切换 KB_ROOT 生效，遍历确实跑过这个临时知识库
    assert.equal(search('库内正常内容', { limit: 10 }).length, 1);
    // 符号链接指向库外文件，其内容不得被返回
    assert.deepEqual(search('SECRET-库外不该泄漏-token', { limit: 10 }), []);
  } finally {
    process.env.KB_ROOT = prev;
    fs.rmSync(kb, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
