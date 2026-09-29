import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { setEngine, ask } from '../src/ai/engine.js';

test('createServer 注册真实引擎（无需外部 setEngine）', async () => {
  // engine.js 的 current 是模块级单例；本用例置于文件首位，观察 createServer 自身的注册效果。
  const app = createServer();
  // 引擎未注册时 ask 会同步抛错；ask 是生成器，不会真的发起调用。
  assert.doesNotThrow(() => ask({ question: 'q' }));
  await app.close();
});

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

// 回归：曾经把 req.raw.signal 当客户端断开信号透传给 ask()。req.raw 是
// Readable，请求体读完后它自行结束、signal 随之 abort——与客户端是否断开无关，
// 于是引擎在每次提问时都会看到 signal.aborted === true 并自我中止。
// 现在改为从响应流的 close 事件派生（正常结束时 writableEnded 已为 true，不中止）。
// engine.js 的 current 是模块级单例，故整个用例自包含，不与其他用例交叉。
test('POST /api/ask 正常路径不中止信号，且不产生 error 帧', async () => {
  let signalAtCall;
  let noticeAborted;

  const app = createServer();
  // createServer() 会注册真实引擎，故 mock 必须在它之后注册；
  // 路由在请求时才解析引擎，此时序无碍。
  setEngine({
    async *ask(req, opts) {
      signalAtCall = { hasSignal: !!opts.signal, aborted: opts.signal?.aborted };
      noticeAborted = opts.signal;
      yield { type: 'text', text: '测试回答' };
      yield { type: 'done' };
    },
  });

  const res = await app.inject({
    method: 'POST', url: '/api/ask',
    payload: { question: '什么是 SQL 注入?' },
  });

  // 调用那一刻必须是未中止的（旧实现记录到 undefined → 断言失败）
  assert.deepEqual(signalAtCall, { hasSignal: true, aborted: false });
  // 正常流式结束后也不得被中止
  assert.equal(noticeAborted.aborted, false);
  // 文本与 done 帧都要送到，且不得出现 error 帧
  assert.match(res.body, /"type":"text","text":"测试回答"/);
  assert.match(res.body, /"type":"done"/);
  assert.equal(res.body.includes('"type":"error"'), false);

  await app.close();
});
