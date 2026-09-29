# CTF 知识库 Web —— 已知缺口与后续项

- **日期**：2026-09-28
- **背景**：九任务实现计划（`docs/superpowers/plans/2026-09-28-ctf-kb-web.md`）已完成，终审通过。
  本文固化终审后仍未处理的事项，避免随过程产物一并丢失。

---

## 一、合并前必须处理

**无。** 终审提出的一项合并阻塞项（`server.js` 路由层 catch 原样透传 `err.message`）
已在终审修复波中解决并复评通过。

---

## 二、建议的后续加固（终审判定可合并后处理）

### 1. 读限制缺失（重要度最高）

`claude-agent.js` 只做了**写**保护 —— `disallowedTools: ['Bash','Edit','Write','NotebookEdit']`
阻止了写入与执行，但 `cwd: kbRoot()` **不能阻止 SDK 的 `Read` / `Grep` / `Glob` 工具
打开知识库之外的绝对路径**。

这使设计文档「配置放知识库外就不会被 agent 检索到」这条**假设**未被强制执行。

**现实严重度低**（单人本机工具：无执行通道、无外泄通道、env 里的 key 模型读不到），
但它是唯一一处「设计假设 vs 实际边界」的落差。

**修法**：用 `Options.canUseTool`（`sdk.d.ts:1582`）把 `Read`/`Grep`/`Glob` 的
`file_path`/`pattern` 对 `kbRoot()` 做归属校验，越界即拒。

### 2. `describeAuth` 已有测试，但可再收紧

终审后已补 `{source, configured, baseUrl}` 键集断言（两个档位各一条）。
无需再改。

### 3. 搜索阻塞事件循环

`search.js` 全同步扫描 42MB，会阻塞并发中的 SSE 流式与文章读取。
规范明确接受该取舍；仅在搜索延迟成为实际痛点时再改（异步读或 worker）。

---

## 三、已记录但判定「可发布」的次要项

按任务归并，均为已评审、已判定不影响合并的项。

| 来源 | 项 | 说明 |
|---|---|---|
| T2 | `paths.js` 的 `rel.startsWith('..')` 会误拒名为 `..foo` 的条目 | fail-closed，非安全漏洞 |
| T2 | `resolveInKb('.')` 抛错 | 后续若需枚举知识库根目录需另设入口 |
| T3 | `buildTree` 的裸 catch 吞掉所有异常（不止 ENOENT） | 计划强制如此，可观测性损失 |
| T3 | `countLines` 对以换行结尾的文件多算 1 行 | 与 `readArticle` 的口径一致，非 bug |
| T3 | `flatArticles: []` 恒为空 | 计划占位；前端未消费 |
| T4 | `article.js` 的 `endLine=0` 静默变成读全文 | UI 不可达 |
| T5 | `config.js` 未校验 settings 形状；字面量 `null` 会抛 TypeError | 仅 `saveSettings` 写入，极难触发 |
| T5 | `mode: 0o600` 在 NTFS 无效，且只在创建时生效 | 文件在仓库外且已 gitignore |
| T6 | 引用正则：贪婪截断、空格/全角标点文件名漏匹配、全角冒号丢行号 | 已文档化的限制；system prompt 已要求用完整相对路径 |
| T7 | `/api/article` 的 catch-all 把任何异常都转 400 并回显 `err.message` | 来源是路径校验与用户自填路径，非凭据类 |
| T7 | `/api/tree` 与 `/api/ai/status` 无错误处理 | 未捕获异常走 Fastify 默认 500 |
| T7 | `Number(limit) \|\| 50` 使 `limit=0` 变成 50 | 与 `search` 模块语义不一致，HTTP 层不可达 |
| T7 | 启动日志硬编码 5173 | `PORT` 被覆盖时打印错误 URL |
| T7 | `server.js` 的 `import fs` 未使用 | 计划原文如此 |
| T7 | 运行守卫用大小写敏感路径比较 | 盘符大小写差异会导致静默不启动 |
| T8 | `errored` 变量写入后从未读取（死代码） | |
| T8 | `.answer.error` 与 `.count` CSS 规则不可达 | |
| T8 | `#ai { overflow: visible }` 使 AI 栏不滚动 | 矮视口下设置区会被挤出视野 |
| T8 | SSE 解析对 CRLF 帧无容错、尾帧无换行会丢弃、decoder 未 flush | 当前服务端恒以 `\n\n` 结尾 |
| T8 | 键盘可达性不一致（部分折叠头无 role/tabindex/keydown） | |
| T8 | `res.json()` 先于 `res.ok` 检查 | 400 且响应非 JSON 时报解析错误 |
| T8 | `jumpTo` 未去竞态（两次快速点击可能交错） | 修复前已存在 |
| T9 | `resolveAuth()` / `extractCitations()` 在引擎 try 之外 | 二者均不含凭据 |
| T9 | 无 `includePartialMessages`，流式是块级不是逐字 | 计划明确的取舍 |

---

## 四、实现过程中发现的计划缺陷（供后续写计划时参考）

> **处置状态（2026-09-28 收尾核对）**：第 1、2、4 项在实现过程中已修复并回写计划。
> 第 3 项是唯一「代码修好但约束本身未改」的——已在事后重写计划的 Global Constraints
> （`docs/superpowers/plans/2026-09-28-ctf-kb-web.md` 的「路径访问边界」条目），
> 使约束按威胁分类，并把这次踩的坑作为反例写在约束旁边。**四项均已处置。**

1. **测试命令在目标 Node 版本上不可执行** ✅ —— 计划的 `node --test test/` 在 Node v24.16.0 上
   报 `MODULE_NOT_FOUND`，应为 `node --test "test/**/*.test.js"`。计划与实际均已改。

2. **计划自相矛盾** ✅ —— 要求 `buildTree(kbRoot: string)` 带 root 形参，同时要求
   「所有文件读取必须走 `resolveInKb`」；而 `resolveInKb` 从环境变量解析根目录、不接受参数。
   传不同 root 时索引与文章会读到不同知识库。已裁定去掉形参，计划与代码均已改。

3. **全局约束定义不当** ✅（约束措辞已重写）—— 原句「所有读取走 `resolveInKb`」在**遍历场景**下
   是装饰性的：路径本就从同一 root 走出，`resolveInKb(rel)` 恒等还原，逃逸检查永不触发（循环论证）；
   且它是纯词法的，本就拦不住符号链接。遍历场景真正需要的是 `isSymbolicLink()` 跳过。
   **教训**：约束要写清「防的是什么威胁」，否则会产出看起来满足、实际无保护、且白占代码的守卫。

4. **凭据可能经 `err.message` 外泄** ✅ —— SDK 把子进程 stderr 折进 `Error.message`，
   而计划把 key 放进了该子进程环境，骨架里的 `catch (err) → {message: err.message}`
   是一条真实可达的泄漏路径。已抽出共用脱敏策略（`src/ai/errors.js`）并在两处接入。
   **教训**：只要错误路径能把异常消息送到客户端，就必须假定消息里可能夹带凭据。

---

## 五、实测发现（非计划可预见）

- **符号链接外泄**：修复前 `search.js` 会读取知识库外经符号链接指向的文件并把内容返回给客户端。
  测试中的哨兵串确实到达了客户端。已通过跳过符号链接修复。
- **引用伪造**：引用正则会从 URL 抽出假引用（`https://github.com/x/y/blob/main/README.md`
  → `{file:"github.com/x/y/blob/main/README.md"}`），下游会渲染成死链。已通过负向后顾修复。
- **`req.raw.signal` 不是断开信号**：`req.raw` 是 Readable，请求体读完流自身 end/destroy
  即触发 abort（实测 60ms 后 `aborted` 由 false 变 true）。拿它当断开信号会让每次提问自我中止。
  已改为从 `reply.raw` 的 `close` 事件派生（仅在 `!writableEnded` 时 abort）。
