// CTF 知识库前端。无构建步骤：浏览器直接加载本 ES 模块。
// 职责：目录树导航、按行范围阅读、搜索、AI 面板（流式 SSE）。

// ---------- DOM ----------
const treeEl = document.getElementById('tree');
const readerEl = document.getElementById('reader'); // 阅读器的滚动容器
const locEl = document.getElementById('loc');
const contentEl = document.getElementById('content');
const qEl = document.getElementById('q');
const resultsEl = document.getElementById('results');
const searchStatusEl = document.getElementById('search-status');
const statusEl = document.getElementById('ai-status');
const scopeEl = document.getElementById('ai-scope');
const questionEl = document.getElementById('question');
const askEl = document.getElementById('ask');
const cancelEl = document.getElementById('cancel');
const answerEl = document.getElementById('answer');
const noticeEl = document.getElementById('notice');
const citationsEl = document.getElementById('citations');
const keyEl = document.getElementById('api-key');
const urlEl = document.getElementById('base-url');
const settingsMsgEl = document.getElementById('settings-msg');

// ---------- 状态 ----------
let tree = null;
let currentSection = null;   // {file,startLine,endLine,label} —— AI context 的唯一来源
let currentAbort = null;     // 进行中的提问
const sectionNodes = new Map(); // `${path}:${start}` → 目录树章节节点
const articleNodes = new Map(); // path → 目录树文章节点

// ---------- 小工具 ----------
const sectionKey = (path, start) => `${path}:${start}`;

/** 建元素；children 为字符串则作文本，为节点则挂载。 */
function el(tag, { text, cls, attrs } = {}, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  for (const c of children) node.append(c); // append 同时接受字符串与节点
  return node;
}

/** 不区分大小写的子串高亮：向 target 追加「含 <mark> 的片段」。 */
function appendHighlighted(target, text, needle) {
  if (!needle) { target.textContent = text; return; }
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(n, from);
    if (at === -1) { target.append(text.slice(from)); return; }
    target.append(text.slice(from, at));
    target.append(el('mark', { text: text.slice(at, at + needle.length) }));
    from = at + needle.length;
  }
}

// ---------- 目录树 ----------

async function initTree() {
  treeEl.replaceChildren(el('div', { cls: 'empty', text: '正在加载目录树…' }));
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tree = await res.json();
  } catch (err) {
    treeEl.replaceChildren(el('div', { cls: 'error-box', text: `目录树加载失败：${err.message}` }));
    return;
  }
  renderTree(tree);
}

function renderTree(data) {
  treeEl.replaceChildren();
  sectionNodes.clear();
  articleNodes.clear();

  const cats = data.categories ?? [];
  if (!cats.length) treeEl.append(el('div', { cls: 'empty', text: '索引中没有任何分类' }));

  for (const cat of cats) treeEl.append(renderCategory(cat));

  // WP 是扁平集合，没有章节层——按设计只做列表 + 搜索覆盖
  if (data.wpList?.length) treeEl.append(renderWpGroup(data.wpList));
}

function renderCategory(cat) {
  const children = el('ul', { cls: 'tree-list' });

  for (const a of cat.articles ?? []) children.append(renderArticle(a));
  if (cat.wp?.length) children.append(renderLinkGroup('WP', cat.wp));
  if (cat.scripts?.length) children.append(renderLinkGroup('脚本', cat.scripts));

  const head = el('div', { cls: 'node cat', attrs: { role: 'button', tabindex: '0' } });
  head.append(el('span', { cls: 'chev', text: '▾' }), cat.name);
  if (cat.keywords?.length) {
    head.append(el('span', { cls: 'kw', text: ' ' + cat.keywords.join(' / ') }));
  }

  const wrap = el('li', {}, head, children);
  makeCollapsible(head, children, false); // 分类默认展开
  return wrap;
}

/** 无章节的链接组（分类内 WP / 脚本）——点开即整篇阅读。 */
function renderLinkGroup(label, links) {
  const children = el('ul', { cls: 'tree-list' });
  for (const link of links) {
    children.append(leafArticleRow({ title: link.title, path: link.path }));
  }
  const head = el('div', { cls: 'node group-title' });
  head.append(el('span', { cls: 'chev', text: '▾' }), `${label}（${links.length}）`);
  const wrap = el('li', {}, head, children);
  makeCollapsible(head, children, true); // 大列表默认折叠
  return wrap;
}

function renderWpGroup(wpList) {
  const children = el('ul', { cls: 'tree-list' });
  for (const w of wpList) children.append(leafArticleRow(w));
  const head = el('div', { cls: 'node cat' });
  head.append(el('span', { cls: 'chev', text: '▾' }), `大赛 WP（${wpList.length}）`);
  const wrap = el('li', {}, head, children);
  makeCollapsible(head, children, true);
  return wrap;
}

function renderArticle(article) {
  const sections = article.sections ?? [];

  // 无章节：叶子行，点击整篇阅读
  if (!sections.length) return leafArticleRow(article);

  const kids = el('ul', { cls: 'tree-list' });
  for (const s of sections) {
    const node = el('div', {
      cls: 'node section',
      text: s.label,
      attrs: { role: 'button', tabindex: '0', title: `${article.path} L${s.startLine}-L${s.endLine}` },
    });
    const open = () => openSection(article.path, s.startLine, s.endLine, s.label);
    node.addEventListener('click', open);
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    sectionNodes.set(sectionKey(article.path, s.startLine), node);
    kids.append(el('li', {}, node));
  }
  return collapsibleArticleRow(article, kids);
}

/** 文章行骨架：仅建节点并登记进 articleNodes，点击行为交给调用方。 */
function articleRow(article) {
  const node = el('div', {
    cls: 'node article',
    attrs: { role: 'button', tabindex: '0', title: article.path },
  });
  articleNodes.set(article.path, node);
  return node;
}

/** 有章节的文章行：点击标题只展开/折叠章节，不触发整篇阅读。 */
function collapsibleArticleRow(article, kids) {
  const node = articleRow(article);
  node.append(el('span', { cls: 'chev', text: '▾' }), article.title);
  const wrap = el('li', {}, node, kids);
  makeCollapsible(node, kids, true); // 有章节的文章默认折叠
  return wrap;
}

/** 叶子文章行（无章节，或 WP 集合内的文章）：点击整篇阅读。 */
function leafArticleRow(article) {
  const node = articleRow(article);
  node.append(el('span', { cls: 'chev', text: '·' }), article.title);
  node.addEventListener('click', () => openArticle(article.path));
  node.addEventListener('keydown', (e) => { if (e.key === 'Enter') openArticle(article.path); });
  return el('li', {}, node);
}

/** 折叠控制：head 点击时切换 body 的显示与箭头方向。 */
function makeCollapsible(head, body, collapsed) {
  const chev = head.querySelector('.chev');
  const apply = (isCollapsed) => {
    body.hidden = isCollapsed;
    chev.classList.toggle('collapsed', isCollapsed);
  };
  apply(collapsed);
  head.addEventListener('click', (e) => {
    e.stopPropagation(); // 分类标题里嵌了文章行，别让点击冒泡
    apply(!body.hidden);
  });
}

// ---------- 阅读器 ----------

/**
 * 点章节：定位并读该行范围。
 * opts.highlightLines/query 供命中跳转使用——目标行落在章节内时高亮它，
 * 再由调用方滚动到该行，这样「跳到引用所在行」在长章节里也可见。
 */
async function openSection(path, startLine, endLine, label, opts = {}) {
  currentSection = { file: path, startLine, endLine, label };
  setActiveNode(sectionNodes.get(sectionKey(path, startLine)));
  updateScope();
  await loadArticle({ file: path, startLine, endLine, ...opts });
}

/** 无章节文章（或 WP）：从第 1 行起读一个窗口。 */
async function openArticle(path) {
  currentSection = null; // 整篇阅读不构成「章节语境」，AI 不携带 context
  setActiveNode(articleNodes.get(path));
  updateScope();
  await loadArticle({ file: path, startLine: 1, endLine: 300 });
}

function setActiveNode(node) {
  for (const n of treeEl.querySelectorAll('.node.active')) n.classList.remove('active');
  node?.classList.add('active');
}

/** 拉取并渲染一段正文。highlightLines 中的行会按 lastQuery 高亮。 */
async function loadArticle({ file, startLine, endLine, highlightLines = [], query = '' }) {
  locEl.replaceChildren(el('span', { text: '加载中…' }));
  contentEl.replaceChildren();
  const params = new URLSearchParams({ path: file, start: String(startLine) });
  if (endLine != null) params.set('end', String(endLine));

  let data;
  try {
    const res = await fetch('/api/article?' + params);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    data = body;
  } catch (err) {
    locEl.replaceChildren(el('span', { text: file }));
    contentEl.replaceChildren(el('div', { cls: 'error-box', text: `读取失败：${err.message}` }));
    return;
  }

  // 顶部定位：文件 L起-止（区间已由服务端夹紧）
  locEl.replaceChildren(
    el('span', { text: data.path }),
    el('span', { text: ` L${data.startLine}-L${data.endLine}` }),
    el('span', { cls: 'jump', text: `　共 ${data.totalLines} 行` }),
  );

  renderContent(data, highlightLines, query);
  readerEl.scrollTop = 0; // 换文章后回到顶部（#reader 才是滚动容器）
}

function renderContent(data, highlightLines, query) {
  const marks = new Set(highlightLines);
  const frag = document.createDocumentFragment();
  const lines = data.content.split('\n');
  lines.forEach((line, i) => {
    const lineNo = data.startLine + i;
    const div = el('div', { cls: 'line' });
    div.id = 'L' + lineNo;
    if (marks.has(lineNo)) {
      // 落点行始终加视觉标记；有查询词时再把命中子串包成 <mark>
      div.classList.add('target');
      if (query) appendHighlighted(div, line, query);
      else div.textContent = line;
    } else {
      div.textContent = line;
    }
    frag.append(div);
  });
  contentEl.replaceChildren(frag);
}

/** 统一跳转逻辑：章节点击、搜索命中、AI 引用共用。 */
async function jumpTo(file, line) {
  const hit = line ? findSectionContaining(file, line) : null;
  const highlight = { highlightLines: line ? [line] : [], query: lastQuery };

  if (hit) {
    // 命中落在章节内：打开整段章节，并高亮目标行（章节可能长达数百行）
    await openSection(file, hit.section.startLine, hit.section.endLine, hit.section.label, highlight);
  } else {
    // 不在任何章节内：读目标行周围的一段
    currentSection = null;
    setActiveNode(articleNodes.get(file));
    updateScope();
    await loadArticle({
      file,
      startLine: line ? Math.max(1, line - 10) : 1,
      endLine: line ? line + 40 : 300,
      ...highlight,
    });
  }
  scrollToLine(line); // 两条分支共用同一个落点：把目标行滚进视野
}

function findSectionContaining(file, line) {
  for (const cat of tree?.categories ?? []) {
    for (const a of cat.articles ?? []) {
      if (a.path !== file) continue;
      for (const s of a.sections ?? []) {
        if (line >= s.startLine && line <= s.endLine) return { article: a, section: s };
      }
    }
  }
  return null;
}

/** 把目标行滚到阅读器视野中央。用相对偏移而非 scrollIntoView，避免连带滚动祖先。 */
function scrollToLine(line) {
  if (!line) return;
  const node = contentEl.querySelector('#L' + line);
  if (!node) return;
  const delta = node.getBoundingClientRect().top - readerEl.getBoundingClientRect().top;
  readerEl.scrollTop += delta - readerEl.clientHeight / 2;
}

// ---------- 搜索 ----------

let lastQuery = '';

async function runSearch() {
  const query = qEl.value.trim();
  lastQuery = query;
  if (!query) { resultsEl.hidden = true; resultsEl.replaceChildren(); searchStatusEl.textContent = ''; return; }

  searchStatusEl.textContent = '检索中…';
  let hits;
  try {
    const res = await fetch('/api/search?' + new URLSearchParams({ q: query }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    hits = body.hits ?? [];
  } catch (err) {
    searchStatusEl.textContent = '检索失败';
    resultsEl.hidden = false;
    resultsEl.replaceChildren(el('div', { cls: 'error-box', text: `搜索失败：${err.message}` }));
    return;
  }

  searchStatusEl.textContent = hits.length ? `${hits.length} 条命中` : '无命中';
  if (!hits.length) { resultsEl.hidden = true; resultsEl.replaceChildren(); return; }

  resultsEl.replaceChildren(...hits.map((h) => renderHit(h, query)));
  resultsEl.hidden = false;
}

function renderHit(hit, query) {
  const node = el('div', { cls: 'hit', attrs: { role: 'button', tabindex: '0' } });
  node.append(el('div', { cls: 'hit-path', text: `${hit.path}:${hit.line}` }));
  const snippet = el('div', { cls: 'hit-snippet' });
  appendHighlighted(snippet, hit.text, query);
  node.append(snippet);
  node.addEventListener('click', () => { lastQuery = query; resultsEl.hidden = true; jumpTo(hit.path, hit.line); });
  return node;
}

// ---------- AI 面板 ----------

async function refreshStatus() {
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderStatus(await res.json());
  } catch (err) {
    statusEl.replaceChildren(el('span', { cls: 'error-box', text: `引擎状态读取失败：${err.message}` }));
  }
}

/** 绝不渲染 key；只显示来源与生效端点（验收标准第 5 条要求回显 baseUrl）。 */
function renderStatus(s) {
  const dot = el('span', { cls: s.configured ? 'dot' : 'dot bad', text: '●' });
  const line1 = el('div', {}, dot, s.configured
    ? el('span', {}, ' 已配置独立凭据 · 来源 ', el('span', { cls: 'src', text: s.source }))
    : el('span', {}, ' 未配置独立凭据 · 继承当前环境'));
  const line2 = el('div', { cls: 'hint' }, '生效端点：', el('code', { text: s.baseUrl ?? '继承环境（重启后生效）' }));
  statusEl.replaceChildren(line1, line2);
}

/** 当前章节 → AI 的 context；无章节则独立问答。两种模式共用这一个面板。 */
function updateScope() {
  if (currentSection) {
    scopeEl.replaceChildren(
      '上下文：', el('code', { text: `${currentSection.file}` }),
      el('code', { text: ` L${currentSection.startLine}-L${currentSection.endLine}` }),
    );
  } else {
    scopeEl.replaceChildren('独立问答（不携带章节上下文）');
  }
}

async function submitQuestion() {
  const question = questionEl.value.trim();
  if (!question) return;

  if (currentAbort) currentAbort.abort();
  const controller = new AbortController();
  currentAbort = controller;
  // 每次提问一个身份。被新提问取代的旧请求（其 abort 的 catch/finally 稍后才跑）
  // 不得再碰共享 UI —— 否则会把新请求的「可取消」状态清掉、盖上陈旧的「已取消」提示。
  const id = ++requestSeq;

  beginAnswer();
  askEl.disabled = true;
  cancelEl.hidden = false;

  // 有章节才带 context —— 这是两种模式的唯一差别
  const payload = { question };
  if (currentSection) {
    payload.context = {
      file: currentSection.file,
      startLine: currentSection.startLine,
      endLine: currentSection.endLine,
    };
  }

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 非流式错误（如 400）也要显式呈现，不能静默
      const body = await res.json().catch(() => ({}));
      if (id !== requestSeq) return; // 已被取代，交给当前请求
      showError(body.error || `HTTP ${res.status}`);
      return;
    }
    // 事件同样按身份过滤：流未读完就被 abort 时，残余帧不能再写入新请求的答案区
    await readSSE(res.body, (ev) => { if (id === requestSeq) handleEvent(ev); });
  } catch (err) {
    if (id !== requestSeq) return; // 已被取代：不动 UI
    if (err.name === 'AbortError') showNotice('已取消');
    else showError(err.message);
  } finally {
    if (id === requestSeq) { // 只有当前请求负责收尾
      askEl.disabled = false;
      cancelEl.hidden = true;
      currentAbort = null;
    }
  }
}

/** 逐行解析 `data: ` 前缀的 SSE；不缓冲，事件到达即渲染。 */
async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let at;
    while ((at = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, at);
      buf = buf.slice(at + 2);
      const data = frame.split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!data) continue;
      try { onEvent(JSON.parse(data)); } catch { /* 忽略无法解析的帧 */ }
    }
  }
}

let answerText = '';
let errored = false;
let requestSeq = 0; // 提问序号：用于识别被取代的旧请求

function beginAnswer() {
  answerText = '';
  errored = false;
  answerEl.hidden = true;
  answerEl.className = 'answer';
  answerEl.textContent = '';
  noticeEl.hidden = true;
  noticeEl.textContent = '';
  noticeEl.className = '';
  citationsEl.replaceChildren();
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'text':
      // 逐帧追加：到达即显示，不等待 done
      answerText += ev.text;
      answerEl.hidden = false;
      answerEl.textContent = answerText;
      answerEl.scrollTop = answerEl.scrollHeight;
      break;
    case 'citation':
      addCitation(ev);
      break;
    case 'error':
      showError(ev.message);
      break;
    case 'done':
      break;
  }
}

function addCitation(ev) {
  const line = ev.startLine ?? null;
  const label = line ? `${ev.file}:${line}` : ev.file;
  const chip = el('span', { cls: 'citation', text: label, attrs: { role: 'button', tabindex: '0', title: label } });
  const go = () => { lastQuery = ''; jumpTo(ev.file, line); };
  chip.addEventListener('click', go);
  chip.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  citationsEl.append(chip);
}

/** 出错：保留已收到的文本，并明确标注「回答不完整」。 */
function showError(message) {
  errored = true;
  noticeEl.hidden = false;
  noticeEl.className = 'error-box';
  noticeEl.textContent = answerText ? `⚠ 回答不完整：${message}` : `提问失败：${message}`;
}

function showNotice(message) {
  noticeEl.hidden = false;
  noticeEl.className = 'warn-box';
  noticeEl.textContent = answerText ? `⚠ ${message}，回答不完整` : message;
}

// ---------- 凭据设置（只写不读） ----------

async function saveSettings() {
  const apiKey = keyEl.value.trim();
  const baseUrl = urlEl.value.trim();
  if (!apiKey || !baseUrl) {
    setSettingsMsg('apiKey 与 baseUrl 必须成对提供', 'bad');
    return;
  }
  try {
    const res = await fetch('/api/ai/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, baseUrl }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    keyEl.value = ''; // 立刻清空：key 永不回显
    setSettingsMsg('已保存，来源：settings', 'ok');
    await refreshStatus();
  } catch (err) {
    setSettingsMsg(`保存失败：${err.message}`, 'bad');
  }
}

function setSettingsMsg(text, cls) {
  settingsMsgEl.textContent = text;
  settingsMsgEl.className = `settings-msg ${cls ?? ''}`;
}

// ---------- 事件绑定与启动 ----------

askEl.addEventListener('click', submitQuestion);
cancelEl.addEventListener('click', () => currentAbort?.abort());
questionEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitQuestion(); }
});
qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
document.getElementById('save-settings').addEventListener('click', saveSettings);

// 点击面板外关闭搜索结果浮层
document.addEventListener('click', (e) => {
  if (!e.target.closest('#searchbar')) resultsEl.hidden = true;
});

updateScope();
initTree();
refreshStatus();
