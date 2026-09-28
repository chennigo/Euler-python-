import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { resolveAuth, buildChildEnv } from '../src/ai/auth.js';

// 测试隔离：把配置路径指向一个不存在的临时文件。
// 否则 loadSettings() 会读用户真实的 ~/.dph-kb/settings.json，
// 一旦本地存过 key，'落到 inherited' 这类断言就会假失败。
process.env.DPH_KB_CONFIG = path.join(os.tmpdir(), 'dph-kb-test-nonexistent.json');

test('env 档优先于 settings', () => {
  const r = resolveAuth({
    AI_API_KEY: 'k-env', AI_BASE_URL: 'https://env.example',
    ANTHROPIC_API_KEY: 'inherited',
  });
  assert.equal(r.source, 'env');
  assert.equal(r.apiKey, 'k-env');
});

test('env 只设一半时不算命中，落到 inherited', () => {
  const r = resolveAuth({ AI_API_KEY: 'k-only', ANTHROPIC_API_KEY: 'inherited' });
  assert.equal(r.source, 'inherited');
});

test('什么都没有时是 inherited', () => {
  assert.equal(resolveAuth({}).source, 'inherited');
});

test('buildChildEnv 同时设置 key 与 baseUrl', () => {
  const env = buildChildEnv(
    { source: 'env', apiKey: 'K', baseUrl: 'https://b.example' },
    { ANTHROPIC_API_KEY: 'old', ANTHROPIC_AUTH_TOKEN: 'tok' },
  );
  assert.equal(env.ANTHROPIC_API_KEY, 'K');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://b.example');
});

test('buildChildEnv 必须删除 AUTH_TOKEN（它优先级更高）', () => {
  const env = buildChildEnv(
    { source: 'env', apiKey: 'K', baseUrl: 'https://b.example' },
    { ANTHROPIC_AUTH_TOKEN: 'tok' },
  );
  assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false);
});

test('inherited 档原样继承环境，不删 AUTH_TOKEN', () => {
  const env = buildChildEnv({ source: 'inherited' }, { ANTHROPIC_AUTH_TOKEN: 'tok' });
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'tok');
});
