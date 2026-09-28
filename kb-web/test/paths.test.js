import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { kbRoot, resolveInKb } from '../src/paths.js';

test('kbRoot 返回绝对路径', () => {
  assert.ok(path.isAbsolute(kbRoot()));
});

test('正常相对路径可解析', () => {
  const p = resolveInKb('SQL.md');
  assert.ok(p.startsWith(kbRoot()));
  assert.ok(p.endsWith('SQL.md'));
});

test('拒绝 ../ 越界', () => {
  assert.throws(() => resolveInKb('../../secret.txt'), /escapes knowledge base/);
});

test('拒绝嵌套越界', () => {
  assert.throws(() => resolveInKb('a/b/../../../x'), /escapes knowledge base/);
});

test('拒绝绝对路径', () => {
  assert.throws(() => resolveInKb('C:\\Windows\\win.ini'), /escapes knowledge base/);
});
