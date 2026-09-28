import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations } from '../src/ai/citations.js';

test('抽取「文件:行号」', () => {
  const c = extractCitations('见 SQL.md:450 的说明');
  assert.deepEqual(c, [{ file: 'SQL.md', startLine: 450 }]);
});

test('抽取带路径的文件:行号', () => {
  const c = extractCitations('参考 WP汇总/各大靶场WP汇总.md:12');
  assert.equal(c[0].file, 'WP汇总/各大靶场WP汇总.md');
  assert.equal(c[0].startLine, 12);
});

test('无行号时只取文件', () => {
  const c = extractCitations('详见 命令执行.md');
  assert.deepEqual(c, [{ file: '命令执行.md', startLine: null }]);
});

test('去重', () => {
  assert.equal(extractCitations('SQL.md:1 和 SQL.md:1').length, 1);
});

test('忽略非 .md 文本', () => {
  assert.deepEqual(extractCitations('版本 1.2:3 说明'), []);
});

// URL 里嵌着 .md 时必须整体忽略：否则会凭空造出一个知识库里不存在的引用，
// 下游按此解析得到死引用，UI 会显示错误来源。造一个假引用比漏一个更糟。
test('不把 URL 中的 .md 当作引用（路径式）', () => {
  assert.deepEqual(
    extractCitations('见 https://github.com/x/y/blob/main/README.md 说明'),
    [],
  );
});

test('不把 URL 中的 .md 当作引用（带端口/行号式）', () => {
  assert.deepEqual(extractCitations('http://a.com/x.md:5'), []);
});

// 与上面成对：负向后顾只能挡住「词中间起匹配」，不能误伤正常的路径引用。
// 该路径以空格开头、匹配起始于 W，后顾于此必须放行。
test('带路径的引用不被负向后顾误伤', () => {
  assert.deepEqual(
    extractCitations('参考 WP汇总/各大靶场WP汇总.md:12'),
    [{ file: 'WP汇总/各大靶场WP汇总.md', startLine: 12 }],
  );
});
