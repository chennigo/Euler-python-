import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setEngine, ask } from '../src/ai/engine.js';

// 顺序敏感：engine.js 的 current 是模块级单例，setEngine 不可撤销。
// 所以「未注册即抛」必须在本文件的首个测试中观察 —— node:test 同文件内按声明序串行执行。
test('未注册引擎时 ask 抛出（响亮失败，而非静默空回答）', () => {
  assert.throws(() => ask({ question: 'x' }), /not registered/);
});

test('注册后 ask 原样转发 req/opts，并返回实现返回的对象本身', async () => {
  const ac = new AbortController();
  const sentinel = (async function* () {
    yield { type: 'text', text: 'hi' };
    yield { type: 'done' };
  })();
  const seen = {};
  setEngine({
    ask(req, opts) {
      seen.req = req;
      seen.opts = opts;
      return sentinel;
    },
  });

  const req = {
    question: 'q',
    context: { file: 'SQL.md', startLine: 1, endLine: 2 },
  };
  const opts = { signal: ac.signal };
  const result = ask(req, opts);

  // 透传：返回的就是实现返回的那个对象，未包一层。
  assert.equal(result, sentinel);
  // 参数原样转发，未被克隆或改写。
  assert.equal(seen.req, req);
  assert.equal(seen.opts, opts);
  assert.equal(seen.opts.signal, ac.signal);

  const events = [];
  for await (const ev of result) events.push(ev);
  assert.deepEqual(events, [
    { type: 'text', text: 'hi' },
    { type: 'done' },
  ]);
});
