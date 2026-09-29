import { query as defaultQuery } from '@anthropic-ai/claude-agent-sdk';
import { resolveAuth, buildChildEnv } from './auth.js';
import { extractCitations } from './citations.js';
import { kbRoot } from '../paths.js';

const SYSTEM = `你是 CTF 知识库助手。回答时必须用「文件路径:行号」标注依据。
路径必须是相对知识库根目录的完整路径，含所在目录，例如「（SQL.md:450）」
或「（CTF常用脚本及工具/SCRIPTS-INDEX.md:347）」——只写文件名会导致链接失效。
只依据知识库内容回答，找不到就说找不到。`;

const MAX_TURNS = 12;

/**
 * 鉴权类错误枚举（sdk.d.ts:3679 SDKAssistantMessageError）——比通用报错更能定位问题。
 * 未列出的值仍会如实报出，只是措辞不同。
 */
const AUTH_ERRORS = new Set([
  'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold',
  'verification_required', 'billing_error', 'cloud_credential_error',
]);

/** 常见非鉴权错误的可读说法；未命中的直接用枚举值本身。 */
const ERROR_HINTS = {
  rate_limit: '请求过于频繁（rate_limit）',
  overloaded: '服务过载（overloaded），请稍后重试',
  invalid_request: '请求不合法（invalid_request）',
  model_not_found: '模型不存在（model_not_found），请检查生效端点',
  server_error: '上游服务错误（server_error）',
  max_output_tokens: '回答超出长度上限（max_output_tokens）',
};

const RESULT_HINTS = {
  error_max_turns: '达到轮次上限，未能给出结论',
  error_max_budget_usd: '达到费用上限，未能给出结论',
  error_max_structured_output_retries: '结构化输出重试超限',
  error_during_execution: '执行过程中出错',
};

/**
 * 把外部 AbortSignal 桥接到 SDK 要求的 AbortController（sdk.d.ts:1519）。
 * 注意 options.abortController 收的是 AbortController，不是 AbortSignal。
 */
function bridgeAbort(signal) {
  const controller = new AbortController();
  if (!signal) return controller;
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', () => controller.abort(), { once: true });
  return controller;
}

/** 从 SDKAssistantMessage 抽取文本块（sdk.d.ts:3598）。 */
function extractText(msg) {
  if (msg.type !== 'assistant') return '';
  return (msg.message?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * 把 SDK 抛出的错误压成一句可展示的话。
 * 子进程错误会带 stderr 原文（含 key 片段），绝不透传给客户端。
 */
function describeSdkError(err) {
  if (err?.name === 'AbortError') return null; // 主动取消，不算错误
  const raw = String(err?.message ?? '');
  if (/exited with code (\d+)/.test(raw)) {
    const code = raw.match(/exited with code (\d+)/)[1];
    return `Claude 子进程异常退出（exit ${code}），请检查 /api/ai/status 显示的生效端点与凭据`;
  }
  // 不透传原文：子进程错误可能内嵌 stderr（含 key 片段）。只保留类型名以便定位。
  return `AI 引擎调用失败（${err?.name ?? 'Error'}），请稍后重试`;
}

/**
 * Claude Agent SDK 引擎。
 * @param {typeof defaultQuery} queryFn 注入点：测试可传入假 query，生产用真实 SDK。
 */
export function createClaudeAgentEngine(queryFn = defaultQuery) {
  // 启动自检（设计文档第 7 节）：SDK 未安装时上面的 import 会直接失败，
  // 版本不兼容则体现为 query 不再导出——这里给出可定位的报错而非运行到一半才炸。
  if (typeof queryFn !== 'function') {
    throw new Error('Claude Agent SDK 不可用：query 未导出，请检查 @anthropic-ai/claude-agent-sdk 版本');
  }
  return {
    async *ask({ question, context }, { signal } = {}) {
      const auth = resolveAuth();
      // 生效端点回显给用户，便于定位「key 与端点错配」——不是秘密。
      const endpoint = auth.baseUrl ?? '继承环境';

      let prompt = question;
      if (context) {
        prompt = `用户正在阅读 ${context.file} 第 ${context.startLine}-${context.endLine} 行。\n\n${question}`;
      }

      let buffer = '';
      try {
        for await (const msg of queryFn({
          prompt,
          options: {
            cwd: kbRoot(),                    // sdk.d.ts:1595 —— 只能看到知识库
            systemPrompt: SYSTEM,             // sdk.d.ts:2390
            env: buildChildEnv(auth),         // sdk.d.ts:1620 —— 整体替换，不合并
            abortController: bridgeAbort(signal), // sdk.d.ts:1519
            maxTurns: MAX_TURNS,              // sdk.d.ts:1920
            disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
          },
        })) {
          if (msg.type === 'assistant' && msg.error) {
            // sdk.d.ts:3598 assistant 帧可携带 SDKAssistantMessageError
            if (AUTH_ERRORS.has(msg.error)) {
              yield { type: 'error', message: `鉴权失败（${msg.error}），生效端点：${endpoint}` };
            } else {
              yield { type: 'error', message: `${ERROR_HINTS[msg.error] ?? `模型调用出错（${msg.error}）`}，生效端点：${endpoint}` };
            }
            return;
          }
          const text = extractText(msg);
          if (text) {
            buffer += text;
            yield { type: 'text', text };
          }
          // 走到 result 报错说明这轮没产出可用回答——如实报错，不静默 done
          if (msg.type === 'result' && msg.is_error) {
            yield {
              type: 'error',
              message: `${RESULT_HINTS[msg.subtype] ?? `调用失败（${msg.subtype}）`}，生效端点：${endpoint}`,
            };
            return;
          }
        }
      } catch (err) {
        const message = describeSdkError(err);
        if (message === null) return; // 客户端已断开，无人在听，不吐帧
        yield { type: 'error', message };
        return;
      }

      for (const c of extractCitations(buffer)) {
        yield { type: 'citation', file: c.file, startLine: c.startLine };
      }
      yield { type: 'done' };
    },
  };
}
