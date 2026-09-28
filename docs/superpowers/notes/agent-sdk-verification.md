# Claude Agent SDK 能力验证结论

- **日期**：2026-09-28
- **验证对象**：`@anthropic-ai/claude-agent-sdk@0.3.283`（registry 上的 `latest`）
- **对应**：设计文档 9.2 节、实现计划 Task 1

---

## 验证方法（与计划不同，且更好）

计划原定「在浏览器中阅读官方文档」。实际执行时发现两条路都不通：

- 本机网络策略拦截 `code.claude.com`、`platform.claude.com`、`github.com`（WebFetch 报 "Unable to verify if domain is safe to fetch"）
- 用户侧也无法人工查阅

**改用更好的方法**：从 npm registry 直接下载包本体，读其 **TypeScript 类型定义**（`sdk.d.ts`，9833 行）。

类型定义是**编译期契约**，比文档更权威——文档可能滞后，`.d.ts` 不会。

```bash
curl -sL https://registry.npmmirror.com/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.283.tgz -o sdk.tgz
tar -xzf sdk.tgz
# 证据文件：package/sdk.d.ts
```

**所有下述结论均标注 `sdk.d.ts` 行号，可复查。**

---

## 1. `query()` 精确签名 ✅ 已验证

`sdk.d.ts:3237`

```ts
export declare function query(_params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
}): Query;
```

`sdk.d.ts:2843`

```ts
export declare interface Query extends AsyncGenerator<SDKMessage, void> { ... }
```

**结论**：`Query` 是 `AsyncGenerator`，因此 `for await (const msg of query({...}))` 是正确用法。计划 Task 9 的调用形式成立。

`Query` 另有 `close(): void`（`sdk.d.ts:3234`，注释明确写「Use this when you need to abort a query that is still running」）与 `interrupt()` 等方法。

---

## 2. `options.env` 注入 ✅ 已验证，且有一条**必须遵守的约束**

`sdk.d.ts:1641-1659`，注释原文：

> Environment variables for the Claude Code process.
>
> **When set, this value REPLACES the subprocess environment entirely — it is not merged with `process.env`.** Spread `process.env` yourself if the subprocess still needs inherited variables like `PATH`, `HOME`, or `ANTHROPIC_API_KEY`. When omitted, the subprocess inherits `process.env`.

```ts
env?: {
    [envVar: string]: string | undefined;
};
```

**三条结论**：

1. `env` **存在**，是凭据注入的唯一入口
2. **它整体替换子进程环境，不与 `process.env` 合并** —— 因此 `buildChildEnv` 必须 `{ ...baseEnv }` 打底，否则子进程会丢掉 `PATH` 等必需变量而启动失败
3. 不传 `env` 时，「继承」＝ 继承 `process.env` —— **证实了设计文档 5.5 对「继承」机制的理解**

---

## 3. 不存在 `apiKey` 选项 ✅ 已验证

全文件检索 `apiKey?:` 无结果。凭据只能通过 `env` 注入。

**结论**：设计文档 5.5「`options.env` 是唯一可确认的注入点」成立；计划中**不得**出现 `options.apiKey`。

---

## 4. 其余相关选项 ✅ 已验证

| 选项 | 行号 | 类型 | 备注 |
|---|---|---|---|
| `cwd` | 1595 | `string` | 设为知识库根目录 |
| `systemPrompt` | 2400 | `string \| string[] \| {...}` | 直接用 `string` |
| `abortController` | 1523 | `AbortController` | **收 `AbortController`，不是 `AbortSignal`** |
| `includePartialMessages` | 1859 | `boolean` | 开启后出 token 级增量帧 |
| `maxTurns` | 1930 | `number` | |
| `model` | 1965 | `string` | |

**对计划的影响**：Task 9 骨架里关于取消的 TODO 现在有答案——外部 `AbortSignal` 需在引擎内桥接到一个自建 `AbortController`，再传给 `abortController`。

关于 `includePartialMessages`：默认关闭时，`assistant` 帧是**整块**投递（注释：「When streamed, content typically holds the single block this message delivers」）。若要打字机效果，需显式开启。**本项目的取舍**：先按整块投递实现（Task 8 前端已能逐帧渲染），打字机效果列为后续可选优化——避免为次要体验多一层复杂度。

---

## 5. 流式消息结构 ✅ 已验证

`sdk.d.ts:5273` —— `SDKMessage` 是 **39 个成员的联合类型**。与本项目相关的：

```ts
// sdk.d.ts:3602
export declare type SDKAssistantMessage = {
    type: 'assistant';
    message: BetaMessage;              // 形状同 Messages API，含 content blocks
    parent_tool_use_id: string | null;
    error?: SDKAssistantMessageError;
    uuid: UUID;
    session_id: string;
    ...
};

// sdk.d.ts:3685
export declare type SDKAuthStatusMessage = {
    type: 'auth_status';
    isAuthenticating: boolean;
    output: string[];
    error?: string;
    ...
};

// sdk.d.ts:5669
export declare type SDKResultMessage = SDKResultSuccess | SDKResultError;
```

**文本抽取逻辑**：遍历 `msg.type === 'assistant'` 的帧，从其 `message.content` 中取 `type === 'text'` 的块，累加 `.text`。

**鉴权失败判定**：`sdk.d.ts:3683` 给出 `SDKAssistantMessageError` 枚举，含 `'authentication_failed'`、`'billing_error'`、`'rate_limit'`、`'oauth_org_not_allowed'`、`'cloud_credential_error'` 等 13 个值。**这些比通用报错更有价值**——设计文档第 7 节要求「明确区分鉴权失败来源」，可直接映射到这些枚举值给出精准提示。

---

## 6. 本机环境事实（独立取证）

读取 `~/.claude/settings.json` 确认：

| 变量 | 值 |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://api.deepseek.com/anthropic` |
| `ANTHROPIC_API_KEY` | 已设置（DeepSeek key） |

`~/.claude/.credentials.json` **不存在**。`claude` CLI 位于 `C:\Users\dcy10\AppData\Roaming\npm\claude`。

**结论**：本机 Claude Code 非 Anthropic 订阅登录，指向 DeepSeek 兼容端点。设计文档 5.5 已据此修正为「继承当前环境（端点 + key）」。

---

## 7. 仍未验证（诚实标注）

1. **凭据优先级的确切顺序** —— 类型定义不表达运行时优先级。设计文档 5.5 的处理方式是「我们自己注入的那两个变量必定生效」，这**不依赖**继承顺序，因此该未知项不影响实现。仅当第 3 档「继承」出现意外时才会被触及
2. **官方文档对计费/条款的当前措辞** —— `support.claude.com` 同样被拦截。搜索结果显示 Agent SDK 独立计费额度原定 2026-06-15 生效、当天被叫停，状态待确认。**本机实际走 DeepSeek 端点，不受此影响**
3. **`options.env` 的注入在真实调用中是否生效** —— 类型与注释已充分说明，但未实跑。计划 Task 9 Step 3 的冒烟测试会覆盖到

---

## 8. 结论

**方案 A 可行，无需切换到方案 B。** 设计文档 5.5 的两项核心假设（`env` 是唯一注入点、继承等价于环境继承）都得到类型定义证实，且发现一条必须遵守的额外约束（`env` 整体替换而非合并）。

**对实现计划的影响**（已同步进计划）：

- Task 1 的 Step 2–3（下载包 + 跑探测脚本）**证明路径改为读 `.d.ts`**，探测脚本降级为可选
- Task 9 骨架的 `abortController` 待定项已有答案
- Task 9 的错误处理应映射 `SDKAssistantMessageError` 枚举，而非笼统报错
