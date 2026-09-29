/**
 * 引擎错误的统一脱敏策略——server.js 与 claude-agent.js 共用同一份，
 * 避免策略漂移或被重新引入裸 err.message。
 *
 * 为什么必须脱敏：Claude Agent SDK 会把子进程 stderr 折进 Error.message，
 * 而 buildChildEnv 会把 ANTHROPIC_API_KEY 注入该子进程环境。任何一处把
 * 原文透传给客户端，就等于把 key 送到浏览器——违反「API key 永不回显」。
 */

/**
 * 把引擎抛出的任意异常压成一句可展示的话。
 * @returns {string|null} null 表示主动取消（AbortError），调用方不应吐帧。
 */
export function describeEngineError(err) {
  if (err?.name === 'AbortError') return null; // 主动取消，不算错误
  const raw = String(err?.message ?? '');
  if (/exited with code (\d+)/.test(raw)) {
    const code = raw.match(/exited with code (\d+)/)[1];
    return `Claude 子进程异常退出（exit ${code}），请检查 /api/ai/status 显示的生效端点与凭据`;
  }
  // 不透传原文：子进程错误可能内嵌 stderr（含 key 片段）。只保留类型名以便定位。
  return `AI 引擎调用失败（${err?.name ?? 'Error'}），请稍后重试`;
}
