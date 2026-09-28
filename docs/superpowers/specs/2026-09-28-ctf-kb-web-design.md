# CTF 知识库 Web —— 设计文档

- **日期**：2026-09-28
- **状态**：已确认，待实现
- **作者**：与 Claude Code 协作

---

## 1. 背景与目标

`C:\Users\dcy10\Desktop\dph\Des-CTF-Knowledge-main\Des-CTF-Knowledge-main\` 是一份下载的 CTF 知识库（1279 个文件 / 42MB）：12 篇漏洞深度文章、1027 篇大赛 WP、50+ 解题脚本、10 大类 Payload 速查、6 篇工具速查。

该知识库自带 AI 友好的检索结构：

- `AI-SEARCH-INDEX.md`（约 250 行）——全局索引，按漏洞类型列出知识文章、WP、脚本、关键词
- 10 个 `*.idx.md` ——大文件的分段行号表，例如 `SQL.idx.md` 里的 `L450-L700: 宽字节注入`

**目标**：做一个本机 Web 工具，提供「导航式浏览检索」为主、「单题问 AI」为辅的体验，取代 grep 和翻文件。

### 使用场景（已确认）

| 维度 | 决定 |
|---|---|
| 核心用途 | 浏览检索为主 + 单题问 AI |
| 运行范围 | 仅本机 localhost，单人使用 |
| 检索方式 | 以导航为主（按漏洞类型/大赛名/脚本分类），搜索为辅 |
| AI 入口 | 两种都要：独立问答（粘题面）+ 页面内追问 |
| AI 引擎 | Claude Agent SDK（方案 A） |
| 鉴权 | 支持注入独立 API key（key + baseUrl **成对**），缺省继承当前环境（端点 + key） |

---

## 2. 范围

### 做

- 解析 `AI-SEARCH-INDEX.md` + 10 个 `.idx.md`，生成带行号的导航目录树
- 阅读器：按章节行号精准渲染文章片段
- 服务端子串搜索（辅助功能）
- AI 问答（两种模式），流式输出，带可点击引用
- API key 注入接口

### 明确不做

- **不为 1027 篇大赛 WP 生成章节索引**（已确认）。WP 只做扁平列表 + 全文搜索命中，不进章节层。
- **不引入 SQLite FTS5 或任何全文索引**（已确认）。42MB 静态文本服务端扫描足够快，索引构建与失效是过度设计。
- 不做公网部署、不做多用户、不做鉴权登录
- 不做知识库内容的编辑/写入——知识库是只读数据源
- 不做增量索引/热更新（内容静态，变更后重启即可）

---

## 3. 目录结构

```
C:\Users\dcy10\Desktop\dph\
├── docs\superpowers\specs\
│   └── 2026-09-28-ctf-kb-web-design.md      本文件
├── kb-web\                                  应用（待建）
│   ├── package.json
│   ├── src\
│   │   ├── server.js                        路由 + SSE
│   │   ├── kb-index.js                      索引解析 → 目录树
│   │   ├── search.js                        子串搜索
│   │   ├── config.js                        配置读写
│   │   └── ai\
│   │       ├── engine.js                    AiEngine 接口定义
│   │       ├── claude-agent.js              A 方案实现
│   │       └── auth.js                      鉴权解析
│   ├── web\                                 前端静态资源
│   └── test\
└── Des-CTF-Knowledge-main\Des-CTF-Knowledge-main\   知识库（只读数据源）

配置（在知识库目录之外，不进版本库）：
C:\Users\dcy10\.dph-kb\settings.json
```

**为什么配置放知识库外**：避免被 git 跟踪，也避免被 AI agent 自己在检索时读到而泄漏。

---

## 4. 架构

```
Edge (localhost)
  │
  ├─ 静态导航站 ── 目录树 / 阅读器 / 搜索框
  │
  └─ POST /api/ask   (SSE 流式响应)
         │
     Node 后端 (Fastify)
       ├─ kb-index   解析 AI-SEARCH-INDEX.md + *.idx.md → 目录树 JSON
       ├─ search     服务端子串扫描
       └─ ai/        AiEngine 接口
                     └─ ClaudeAgentEngine (Agent SDK, cwd = 知识库)
```

**核心设计约束**：AI 必须藏在 `AiEngine` 接口之后。前端只认 `{ question, context? }`，不关心中间是 Agent SDK、Tool Runner 还是别的。方案 B（Anthropic API + Tool Runner）作为已验证的退路——切换成本必须保持在「只加一个实现文件」的量级。

---

## 5. 组件

### 5.1 `kb-index.js` —— 索引解析

**做什么**：读取 `AI-SEARCH-INDEX.md` 与全部 `*.idx.md`，产出目录树。

**输出结构**：

```js
{
  categories: [                    // 来自 AI-SEARCH-INDEX.md 的一级标签
    {
      name: "SQL注入",
      keywords: ["联合注入", "报错注入", ...],
      articles: [
        {
          title: "SQL.md",
          path: "SQL.md",
          totalLines: 2611,
          sections: [              // 来自 SQL.idx.md
            { label: "宽字节注入（GBK）", startLine: 450, endLine: 700 }
          ]
        }
      ],
      wp: [ { title: "...", path: "WP汇总/各大靶场WP汇总.md" } ],
      scripts: [ { title: "...", path: "CTF常用脚本及工具/..." } ]
    }
  ],
  flatArticles: [ ... ],           // 无 .idx.md 的顶层文章
  wpList: [ ... ]                  // 1027 篇 WP，扁平列表，无章节
}
```

**怎么用**：启动时调用一次，结果缓存在内存，通过 `GET /api/tree` 输出。

**依赖**：文件系统只读。

**已知缺口**：10 个 `.idx.md` 只覆盖核心文章。WP 与部分文章没有章节层，归入 `flatArticles` / `wpList`，前端以扁平列表 + 搜索呈现。

### 5.2 `search.js` —— 搜索

**做什么**：对知识库内 `.md` 做子串匹配（大小写不敏感），返回文件路径、命中行号、前后文片段。

**边界**：单次请求限制返回条数（默认 50），避免 42MB 全量吐给前端。

**不做**：分词、排名算法、索引。中文子串匹配不需要分词。

### 5.3 `ai/engine.js` —— 引擎接口

**定义契约并分发**到当前选定的实现。`server.js` 只 import 本文件，永远不直接 import 具体引擎。

```js
/**
 * 契约：所有引擎实现必须满足此签名。
 * @param {{ question: string, context?: { file: string, startLine: number, endLine: number } }} req
 * @param {{ signal?: AbortSignal }} opts
 * @returns { AsyncIterable<{ type: 'text'|'citation'|'done'|'error', ... }> }
 */
export function ask(req, opts) {
  return currentEngine.ask(req, opts);   // currentEngine 由配置决定
}
```

`currentEngine` 目前恒为 `claude-agent.js` 导出的实现；新增引擎 = 新增一个满足上述签名的文件 + 在配置里切换。

**这是全系统最重要的接缝**。前端契约固定为「一段上下文 + 一个问题 → 流式文本 + 引用列表」。

### 5.4 `ai/claude-agent.js` —— A 方案实现

**做什么**：调用 Claude Agent SDK，`cwd` 设为知识库根目录，让 agent 用自带工具（Read / Grep / Glob）自行检索。

**两种模式的差异仅在初始 prompt**：

| 模式 | 前端传参 | 注入的 prompt 前缀 |
|---|---|---|
| 页面内追问 | `context` 存在 | 「用户正在阅读 `<file>` 第 `<start>`-`<end>` 行。」 |
| 独立问答 | `context` 缺省 | 无前缀，agent 自主检索 |

**引用抽取**：要求 agent 在回答中标注 `文件路径:行号`，后端用正则抽取为结构化 `citation` 事件，与文本一起流给前端。

**环境注入**：调用 `query()` 时通过 `options.env` 传入凭据与端点，规则见 5.5。

### 5.5 `ai/auth.js` —— 鉴权解析（API key 接口）

**机制事实（已在本机取证）**：Claude Agent SDK 自身不读取凭据。它把 Claude Code CLI 作为**子进程**启动，子进程从**继承到的环境变量**中解析凭据。因此「继承」在实现上等同于**环境继承**，`options.env` 是唯一可确认的注入点（无证据表明存在 `apiKey` 选项字段）。

**核心约束**：`ANTHROPIC_API_KEY` 与 `ANTHROPIC_BASE_URL` **成对使用**。只换 key 不换端点会导致凭据与端点错配。本机实测当前环境：

| 变量 | 值 |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://api.deepseek.com/anthropic` |
| `ANTHROPIC_API_KEY` | 已设置 |

即本机 Claude Code **并非登录 Anthropic 订阅**，而是指向 DeepSeek 的 Anthropic 兼容端点。

**鉴权档位，第一个命中即用**：

```
1. 环境变量 AI_API_KEY + AI_BASE_URL（两个都要，缺一不可）
2. C:\Users\dcy10\.dph-kb\settings.json 的 ai.apiKey + ai.baseUrl（成对）
3. 都不设 → 继承当前进程环境（端点 + key 一起继承）
```

第 3 档的准确含义是「**继承当前环境（端点 + key）**」，**不是**「继承 Claude Code 登录」——本机不存在可继承的 Anthropic 订阅登录。

**注入规则（1、2 档生效时）**，写入子进程环境必须同时做三件事：

```
ANTHROPIC_API_KEY    = <选中的 key>
ANTHROPIC_BASE_URL   = <与 key 配对的 baseUrl>
ANTHROPIC_AUTH_TOKEN = 删除            ← 其优先级高于 ANTHROPIC_API_KEY，不清会反压
```

**生效时机（必须写进 UI）**：

- 第 2 档的 settings.json **每次请求重新读取** → 改完立即生效，**无需重启**
- 第 1、3 档依赖**本服务进程启动时**的环境快照 → 改完**必须重启本服务**

**安全约束（必须实现）**：

- API key **只写不读**：设置页保存后，后端只返回 `{ configured: true, source: "settings" }`，任何接口都不回显 key 本身
- 配置文件权限收紧，仅当前用户可读
- 后端日志对 key 脱敏，任何时候不打印明文
- `GET /api/ai/status` 必须返回**三项**：当前档位（`env` / `settings` / `inherited`）、**生效的 baseUrl**、环境快照采集时间。只报档位不报 baseUrl 无法排查端点错配

### 5.6 `server.js` —— 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tree` | 目录树 JSON |
| GET | `/api/article?path=&start=&end=` | 读取指定行范围的文章内容 |
| GET | `/api/search?q=` | 搜索 |
| POST | `/api/ask` | AI 问答，SSE 流式 |
| GET | `/api/ai/status` | 当前鉴权来源 |
| POST | `/api/ai/settings` | 写入 API key + baseUrl（成对，只写不回显） |

### 5.7 `web/` —— 前端

三块：目录树侧栏、阅读器主区、AI 面板。AI 面板在两种模式间复用，`context` 由当前打开的章节自动填充。

---

## 6. 数据流

### 6.1 浏览（无 AI）

```
用户点「SQL注入」→ 前端已有 /api/tree 缓存 → 展开文章 → 点章节「宽字节注入」
→ GET /api/article?path=SQL.md&start=450&end=700
→ 阅读器渲染，顶部标注「SQL.md L450-L700」
```

### 6.2 页面内追问

```
用户在 L450-L700 页面提问
→ POST /api/ask { question, context: { file: "SQL.md", startLine: 450, endLine: 700 } }
→ 后端拼 prompt → Agent SDK query()（agent 自行读取该范围）
→ SSE 流式文本 + citation 事件
→ 前端渲染为可点击引用，点击跳回原文对应行
```

### 6.3 独立问答

```
用户粘贴题面
→ POST /api/ask { question }
→ agent 自主 grep / 读 .idx.md / 读正文
→ 同上返回
```

---

## 7. 错误处理

原则：**如实报错，不静默降级**。

| 情况 | 行为 |
|---|---|
| Agent SDK 未安装 / 版本不兼容 | 启动自检失败；`/api/ai/status` 标为不可用；AI 面板显示「引擎不可用」并给出原因，而非无限转圈 |
| 鉴权失败 | 明确区分来源失败（env 的 key 无效 / settings 的 key 无效 / 无任何凭据） |
| 凭据与端点错配 | key 与 baseUrl 不配对（如 Anthropic key 配 DeepSeek 端点）会返回 401/403。错误信息必须回显**生效的 baseUrl** 以便定位 |
| 单次提问超时 | 前端提供取消按钮；后端 abort 当前 query |
| SSE 流中断 | 前端保留已收到内容，明确标注「回答不完整」 |
| 索引解析失败 | 启动时报错退出——导航是地基，不允许带病运行 |
| 文章路径越界（`..` 等） | 拒绝请求，不读取知识库目录外的文件 |

---

## 8. 测试策略

| 层级 | 内容 |
|---|---|
| 单元 | **索引解析**：对着真实 `.idx.md` 断言章节数量与行号正确（全站导航的地基，最易悄悄出错） |
| 单元 | **搜索**：中文子串、大小写、正则特殊字符转义 |
| 单元 | **引用抽取**：覆盖 `文件:行号` 的各种书写变体 |
| 单元 | **路径越界防护**：构造 `../` 路径断言被拒 |
| 集成 | **鉴权优先级**：三种来源各自的命中与失败路径 |
| 冒烟 | 一个已知答案的问题（如「宽字节注入怎么用」），断言返回文本非空、含至少一条引用、且引用路径真实存在 |

---

## 9. 前置验证（实现前必须完成）

### 9.1 已在本机取证确认

| 事实 | 证据来源 |
|---|---|
| Agent SDK 不自行读取凭据，而是把 Claude Code CLI 作为**子进程**启动，读其继承的环境 | 多来源交叉印证 |
| `options.env` 是唯一可确认的环境注入点 | 无证据表明存在 `apiKey` 选项字段，不得假设其存在 |
| 本机 Claude Code **指向 DeepSeek 端点**，非 Anthropic 订阅登录 | 读取 `~/.claude/settings.json` 确认 `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` |
| 本机无 `~/.claude/.credentials.json` | 文件不存在 |
| `claude` CLI 在 PATH 上 | `C:\Users\dcy10\AppData\Roaming\npm\claude` |

### 9.2 尚未验证（实现前须对照官方文档确认）

官方文档站 `code.claude.com` 在本机网络环境下**被拦截**，以下无法查明，**不得凭记忆编写**：

1. **凭据优先级的确切顺序** —— 来源互相冲突：Claude Code 文档称 `ANTHROPIC_API_KEY` 优先于 `CLAUDE_CODE_OAUTH_TOKEN`，而某 Agent SDK 文档称相反。此项直接影响 5.5 的注入规则，必须实测
2. **子进程是否在运行中重读凭据** —— 本设计按「不重读、需重启」处理，属保守假设
3. **`query()` 的精确签名与流式事件结构**
4. **Agent SDK 独立计费额度**是否已生效 —— 该变更原定 2026-06-15 生效，当天被叫停，状态待确认

**验证方式**：浏览器打开 `code.claude.com/docs/en/agent-sdk` 与 `/docs/en/env-vars`；再用一个最小脚本跑通 `query()` 与一次显式 `options.env` 注入。

### 9.3 退路

**若 Agent SDK 的鉴权注入或流式接口不可用**：切到方案 B（Anthropic API + Tool Runner，`client.beta.messages.toolRunner()`，自定义 `grep_kb` / `read_section` 工具）。因 `AiEngine` 接口已固定，切换只影响 `ai/` 目录下一个实现文件，前端与路由不变。

---

## 10. 验收标准

1. `npm start` 后浏览器打开 localhost，能按漏洞类型展开目录树并读到正确行范围的正文
2. 搜索框输入中文关键词，能返回带高亮的命中片段
3. 在任一章节页面提问，能收到流式回答，且引用可点击跳回原文
4. 粘贴一道题的题面独立提问，agent 能自主检索知识库并给出带引用的回答
5. 设置页写入 API key + baseUrl 后，`/api/ai/status` 显示来源为 `settings`，并回显**生效的 baseUrl**；任何接口都不回显 key 本身
6. 删掉设置后，行为回落到继承当前环境（端点 + key）
7. `settings` 档改动后**无需重启**即生效；`env` / `inherited` 档改动时 UI 明确提示需重启
8. 填入与 baseUrl 不匹配的 key 时，错误信息包含生效的 baseUrl，可据此定位
9. 单元测试与冒烟测试全部通过

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| Agent SDK API 与预期不符 | 第 9 节的前置验证；方案 B 作为已验证退路 |
| 每次提问延迟数秒 | 本机自用可接受；页面内追问因上下文已明确，通常比独立问答快 |
| 1027 篇 WP 无章节导航 | 已确认接受；以扁平列表 + 搜索覆盖 |
| 知识库内容涉及攻击技术 | 仅本机自用；**不做公网部署**。若将来要对外提供 AI 问答，等于对外分发攻击技术，需重新评估 |
