import { loadSettings } from '../config.js';

/**
 * 解析鉴权档位。第一命中即用：
 *   1. env      —— AI_API_KEY + AI_BASE_URL（必须成对）
 *   2. settings —— settings.json 的 ai.apiKey + ai.baseUrl（必须成对）
 *   3. inherited —— 继承当前进程环境
 * 注意第 3 档继承的是「端点 + key」整体，不是「Claude Code 登录」。
 */
export function resolveAuth(env = process.env) {
  if (env.AI_API_KEY && env.AI_BASE_URL) {
    return { source: 'env', apiKey: env.AI_API_KEY, baseUrl: env.AI_BASE_URL };
  }
  const ai = loadSettings().ai;
  if (ai?.apiKey && ai?.baseUrl) {
    return { source: 'settings', apiKey: ai.apiKey, baseUrl: ai.baseUrl };
  }
  return { source: 'inherited' };
}

/**
 * 构建传给 Agent SDK options.env 的环境。
 * 1/2 档必须同时覆盖 key 与 baseUrl，并删除 ANTHROPIC_AUTH_TOKEN
 * —— 后者优先级高于 ANTHROPIC_API_KEY，不清会反压我们注入的凭据。
 */
export function buildChildEnv(auth, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (auth.source === 'inherited') return env;

  env.ANTHROPIC_API_KEY = auth.apiKey;
  env.ANTHROPIC_BASE_URL = auth.baseUrl;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/** 供 /api/ai/status 使用——绝不返回 key 本身。 */
export function describeAuth(auth) {
  return {
    source: auth.source,
    configured: auth.source !== 'inherited',
    baseUrl: auth.baseUrl ?? null,
  };
}
