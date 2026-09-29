import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

test('GET /api/tree 返回目录树', async () => {
  const app = createServer();
  const res = await app.inject({ method: 'GET', url: '/api/tree' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.categories));
  await app.close();
});

test('GET /api/article 越界返回 400', async () => {
  const app = createServer();
  const res = await app.inject({ method: 'GET', url: '/api/article?path=../../x.md&start=1&end=1' });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('GET /api/ai/status 不回显 key', async () => {
  const app = createServer();
  const res = await app.inject({ method: 'GET', url: '/api/ai/status' });
  const body = res.json();
  assert.equal(JSON.stringify(body).includes('apiKey'), false);
  assert.ok('source' in body && 'baseUrl' in body);
  await app.close();
});
