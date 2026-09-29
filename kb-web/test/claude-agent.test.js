import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeAgentEngine } from '../src/ai/claude-agent.js';
import { kbRoot } from '../src/paths.js';

// —— 测试替身 ————————————————————————————————————————————————
// 引擎把 query() 作为可注入依赖，因此这里可以在不触碰真实 SDK、
// 不发真实 API 请求的前提下观察「引擎往 SDK 传了什么」与「引擎吐出什么事件」。

/** 按序放送给定消息帧的假 query。 */
function stubQuery(messages) {
  const calls = [];
  const fn = (params) => {
    calls.push(params);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  };
  return { fn, calls };
}

/** 迭代即抛错的假 query。 */
function throwingQuery(err) {
  return () => (async function* () { throw err; })();
}

/** 收取全部事件，便于整体断言。 */
async function collect(iterable) {
  const out = [];
  for await (const ev of iterable) out.push(ev);
  return out;
}

/** 只取第一个参数（query 的入参）的查询替身，省掉断言噪声。 */
function optionsOf(calls) {
  assert.equal(calls.length, 1, 'query 应恰好被调用一次');
  return calls[0].options;
}

const textMsg = (text) => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
});

// 通过 env 档位注入假凭据：第一命中即用，不会去读用户的 settings.json。
const FAKE_KEY = 'test-key-not-real';
function withFakeEnv(fn) {
  const saved = { ...process.env };
  process.env.AI_API_KEY = FAKE_KEY;
  process.env.AI_BASE_URL = 'https://example.test/anthropic';
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

// —— 事件契约 ————————————————————————————————————————————————

test('文本帧逐块投递，引用在文本之后抽取，最后以 done 收尾', async () => {
  const { fn, calls } = stubQuery([
    textMsg('宽字节注入用 %df%27 绕过转义（SQL.md:450）。'),
    // 非 assistant / 无文本帧应被忽略
    { type: 'system', subtype: 'init' },
    textMsg('详见 (SQL.md:450) 与 注入/宽字节.md:12'),
    textMsg(''),
  ]);
  const engine = createClaudeAgentEngine(fn);

  const events = await collect(engine.ask({ question: '宽字节注入怎么用' }));

  assert.deepEqual(events, [
    { type: 'text', text: '宽字节注入用 %df%27 绕过转义（SQL.md:450）。' },
    { type: 'text', text: '详见 (SQL.md:450) 与 注入/宽字节.md:12' },
    { type: 'citation', file: 'SQL.md', startLine: 450 },
    { type: 'citation', file: '注入/宽字节.md', startLine: 12 },
    { type: 'done' },
  ]);
  assert.equal(calls.length, 1);
});

test('无任何文本时只吐 done，不产生引用帧', async () => {
  const { fn } = stubQuery([{ type: 'result', subtype: 'success', is_error: false }]);
  const engine = createClaudeAgentEngine(fn);

  const events = await collect(engine.ask({ question: 'q' }));

  assert.deepEqual(events, [{ type: 'done' }]);
});

test('assistant 帧带鉴权错误时，报错并回显生效端点，且不再吐 done', async () => {
  await withFakeEnv(async () => {
    const { fn } = stubQuery([
      textMsg('半截回答'),
      { type: 'assistant', message: { content: [] }, error: 'authentication_failed' },
    ]);
    const engine = createClaudeAgentEngine(fn);

    const events = await collect(engine.ask({ question: 'q' }));

    assert.equal(events[0].type, 'text');
    assert.equal(events.at(-1).type, 'error');
    assert.match(events.at(-1).message, /鉴权失败/);
    assert.match(events.at(-1).message, /authentication_failed/);
    assert.match(events.at(-1).message, /https:\/\/example\.test\/anthropic/);
    assert.equal(events.some((e) => e.type === 'done'), false);
  });
});

test('非鉴权类 assistant 错误也如实报出，但不杜撰为鉴权失败', async () => {
  const { fn } = stubQuery([
    { type: 'assistant', message: { content: [] }, error: 'rate_limit' },
  ]);
  const engine = createClaudeAgentEngine(fn);

  const [ev] = await collect(engine.ask({ question: 'q' }));

  assert.equal(ev.type, 'error');
  assert.equal(ev.message.includes('鉴权失败'), false);
  assert.match(ev.message, /rate_limit|请求过于频繁/);
});

test('result 报错且全程无文本时，不静默降级为 done', async () => {
  const { fn } = stubQuery([
    { type: 'result', subtype: 'error_max_turns', is_error: true, errors: [] },
  ]);
  const engine = createClaudeAgentEngine(fn);

  const events = await collect(engine.ask({ question: 'q' }));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.match(events[0].message, /轮次/);
});

// —— 安全 ——————————————————————————————————————————————————

test('SDK 抛出的错误不得把子进程 stderr 原文泄漏进 error 帧', async () => {
  const secret = 'sk-live-DO-NOT-LEAK';
  const err = new Error(
    `Claude Code process exited with code 1. stderr: auth failed for key ${secret}`,
  );
  const engine = createClaudeAgentEngine(throwingQuery(err));

  const [ev] = await collect(engine.ask({ question: 'q' }));

  assert.equal(ev.type, 'error');
  assert.equal(ev.message.includes(secret), false);
  assert.equal(ev.message.includes('stderr'), false);
  // 仍要给出可定位的信息
  assert.match(ev.message, /exited with code 1|子进程异常退出/);
});

test('异常对象被原样抛出时（非 Error）也走同一条脱敏路径', async () => {
  const engine = createClaudeAgentEngine(throwingQuery({ message: 'boom sk-leak-2' }));

  const [ev] = await collect(engine.ask({ question: 'q' }));

  assert.equal(ev.type, 'error');
  assert.equal(ev.message.includes('sk-leak-2'), false);
});

test('未知异常只保留错误类型名，不透传原文', async () => {
  const err = new Error('unexpected internal detail');
  err.name = 'SomeSdkError';
  const engine = createClaudeAgentEngine(throwingQuery(err));

  const [ev] = await collect(engine.ask({ question: 'q' }));

  assert.equal(ev.type, 'error');
  assert.equal(ev.message.includes('unexpected internal detail'), false);
  assert.match(ev.message, /SomeSdkError/);
});

test('客户端中止时不吐任何帧（连接已断，无人在听）', async () => {
  const ac = new AbortController();
  const abortErr = new Error('aborted');
  abortErr.name = 'AbortError';
  const engine = createClaudeAgentEngine(() => (async function* () {
    yield textMsg('部分');
    ac.abort();
    throw abortErr;
  })());

  const events = await collect(engine.ask({ question: 'q' }, { signal: ac.signal }));

  assert.deepEqual(events, [{ type: 'text', text: '部分' }]);
});

// —— 传给 SDK 的参数 ———————————————————————————————————————

test('传 context 时，prompt 带上文件与行号前缀', async () => {
  const { fn, calls } = stubQuery([textMsg('答')]);
  const engine = createClaudeAgentEngine(fn);

  await collect(engine.ask({
    question: '这行什么意思',
    context: { file: 'SQL.md', startLine: 440, endLine: 460 },
  }));

  const prompt = calls[0].prompt;
  assert.match(prompt, /SQL\.md/);
  assert.match(prompt, /440-460/);
  assert.match(prompt, /这行什么意思/);
  // 用户问题必须在最后，前缀只做定位
  assert.ok(prompt.endsWith('这行什么意思'));
});

test('不传 context 时，prompt 就是问题原文（不带任何前缀）', async () => {
  const { fn, calls } = stubQuery([textMsg('答')]);
  const engine = createClaudeAgentEngine(fn);

  await collect(engine.ask({ question: '什么是 XSS' }));

  assert.equal(calls[0].prompt, '什么是 XSS');
});

test('cwd 锁定知识库根目录，避免 agent 看到库外文件', async () => {
  const { fn, calls } = stubQuery([textMsg('答')]);
  const engine = createClaudeAgentEngine(fn);

  await collect(engine.ask({ question: 'q' }));

  assert.equal(optionsOf(calls).cwd, kbRoot());
});

test('注入 env 档位凭据，且继承 PATH、删除更优先的 ANTHROPIC_AUTH_TOKEN', async () => {
  await withFakeEnv(async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'should-be-deleted';
    const { fn, calls } = stubQuery([textMsg('答')]);
    const engine = createClaudeAgentEngine(fn);

    await collect(engine.ask({ question: 'q' }));

    const env = optionsOf(calls).env;
    assert.equal(env.ANTHROPIC_API_KEY, FAKE_KEY);
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://example.test/anthropic');
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    // env 是整体替换而非合并：宿主必需变量必须仍在
    assert.ok(env.PATH, 'PATH 必须被继承，否则子进程无法启动');
  });
});

test('abortController 是 AbortController 实例而非 signal，且外部 abort 会被桥接', async () => {
  const { fn, calls } = stubQuery([textMsg('答')]);
  const engine = createClaudeAgentEngine(fn);
  const ac = new AbortController();

  await collect(engine.ask({ question: 'q' }, { signal: ac.signal }));

  const ctrl = optionsOf(calls).abortController;
  assert.ok(ctrl instanceof AbortController);
  assert.equal(ctrl.signal.aborted, false);
  ac.abort();
  assert.equal(ctrl.signal.aborted, true, '外部 signal 中止后，SDK 的 controller 必须同步中止');
});

test('外部 signal 已中止时，启动前就同步为已中止', async () => {
  const { fn, calls } = stubQuery([textMsg('答')]);
  const engine = createClaudeAgentEngine(fn);
  const ac = new AbortController();
  ac.abort();

  await collect(engine.ask({ question: 'q' }, { signal: ac.signal }));

  assert.equal(optionsOf(calls).abortController.signal.aborted, true);
});

test('systemPrompt 与 maxTurns 被显式设定（约束回答必须标注出处）', async () => {
  const { fn, calls } = stubQuery([textMsg('答')]);
  const engine = createClaudeAgentEngine(fn);

  await collect(engine.ask({ question: 'q' }));

  const opts = optionsOf(calls);
  assert.match(opts.systemPrompt, /知识库/);
  assert.equal(opts.maxTurns, 12);
});
