import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline } from '../lib/markdown.mjs';

test('見出しと段落', () => {
  assert.equal(renderMarkdown('## 見出し\n\n本文です。'), '<h2>見出し</h2>\n<p>本文です。</p>');
});

test('段落内の改行は <br> にする', () => {
  assert.equal(renderMarkdown('1 行目\n2 行目'), '<p>1 行目<br>\n2 行目</p>');
});

test('インライン：太字・斜体・コード・リンク', () => {
  assert.equal(
    renderInline('**太字** と *斜体* と `a < b` と [リンク](https://example.com/?a=1&b=2)'),
    '<strong>太字</strong> と <em>斜体</em> と <code>a &lt; b</code> と <a href="https://example.com/?a=1&amp;b=2">リンク</a>');
});

test('コードスパンの中は変換しない', () => {
  assert.equal(renderInline('`**x**` と `[a](b)`'), '<code>**x**</code> と <code>[a](b)</code>');
});

test('HTML の直書きはエスケープする', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('javascript: のリンクは無効にする', () => {
  assert.equal(renderInline('[x](javascript:alert(1))'), '<a href="#">x</a>');
});

test('URL 内の括弧（1 段）', () => {
  assert.equal(renderInline('[A](https://ja.wikipedia.org/wiki/A_(B)) です'),
    '<a href="https://ja.wikipedia.org/wiki/A_(B)">A</a> です');
});

test('相対リンクと画像', () => {
  assert.equal(renderInline('![図](img/a.png) [前の記事](../setup/)'),
    '<img src="img/a.png" alt="図"> <a href="../setup/">前の記事</a>');
});

test('箇条書き（続きの行を含む）と番号付き', () => {
  assert.equal(renderMarkdown('- a\n  続き\n- b'), '<ul>\n<li>a 続き</li>\n<li>b</li>\n</ul>');
  assert.equal(renderMarkdown('1. 一\n2. 二'), '<ol>\n<li>一</li>\n<li>二</li>\n</ol>');
});

test('コードブロックは中身をエスケープし、言語名をクラスにする', () => {
  assert.equal(renderMarkdown('```js\nif (a < b) { **x** }\n```'),
    '<pre><code class="language-js">if (a &lt; b) { **x** }</code></pre>');
});

test('コードブロック内の見出しや箇条書きは変換しない', () => {
  assert.equal(renderMarkdown('```\n# not heading\n- not list\n```'),
    '<pre><code># not heading\n- not list</code></pre>');
});

test('表（寄せ指定と、セル内の \\| ）', () => {
  const html = renderMarkdown('| 名前 | 数 |\n|---|---:|\n| a\\|b | 1 |');
  assert.equal(html, [
    '<table>',
    '<thead><tr><th>名前</th><th style="text-align:right">数</th></tr></thead>',
    '<tbody>',
    '<tr><td>a|b</td><td style="text-align:right">1</td></tr>',
    '</tbody>',
    '</table>',
  ].join('\n'));
});

test('表の行が足りないセルは空にする', () => {
  assert.match(renderMarkdown('| a | b |\n|---|---|\n| 1 |'), /<td>1<\/td><td><\/td>/);
});

test('引用と水平線', () => {
  assert.equal(renderMarkdown('> 引用\n\n---'), '<blockquote>\n<p>引用</p>\n</blockquote>\n<hr>');
});

test('段落の直後の箇条書き・見出し・表は別のブロックになる', () => {
  assert.equal(renderMarkdown('本文\n- 項目'), '<p>本文</p>\n<ul>\n<li>項目</li>\n</ul>');
  assert.equal(renderMarkdown('本文\n## 見出し'), '<p>本文</p>\n<h2>見出し</h2>');
  assert.match(renderMarkdown('本文\n| a |\n|---|\n| 1 |'), /^<p>本文<\/p>\n<table>/);
});

test('CRLF の改行でも同じ結果になる', () => {
  assert.equal(renderMarkdown('# a\r\n\r\nb'), renderMarkdown('# a\n\nb'));
});
