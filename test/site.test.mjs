import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontMatter, parsePost, parseTags, buildSite, tagSlug, tagHref, groupByTag, comparePosts, loadPosts } from '../lib/site.mjs';

const blogRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('フロントマター', () => {
  const { meta, body } = parseFrontMatter('---\ntitle: "題名"\ndraft: true\n---\n本文');
  assert.deepEqual(meta, { title: '題名', draft: true });
  assert.equal(body, '本文');
});

test('フロントマターがなければ本文そのまま', () => {
  assert.deepEqual(parseFrontMatter('本文'), { meta: {}, body: '本文' });
});

test('記事：日付とスラッグはファイル名から取る', () => {
  const p = parsePost('2026-10-29-setup.md', '---\norder: 1\ntitle: 立ち上げ\n---\n# x');
  assert.equal(p.date, '2026-10-29');
  assert.equal(p.slug, 'setup');
  assert.equal(p.draft, false);
});

test('タグ：カンマ区切りと [a, b] の形。空と重複は除く', () => {
  assert.deepEqual(parseTags('Claude Code, hooks'), ['Claude Code', 'hooks']);
  assert.deepEqual(parseTags('[a, "b", a, ]'), ['a', 'b']);
  assert.deepEqual(parseTags(undefined), []);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parsePost('2026-10-29-a.md', '---\norder: 1\ntitle: a\n---\n').tags, []);
});

test('記事：ファイル名の形式と title は必須', () => {
  assert.throws(() => parsePost('setup.md', '---\norder: 1\ntitle: a\n---\n'), /YYYY-MM-DD/);
  assert.throws(() => parsePost('2026-10-29-a.md', '本文'), /title/);
});

test('order：同じ日付の中では、あとに出した方（大きい方）が上。order のない下書きはその下に abc 順', () => {
  const p = (name, order) => parsePost(name, `---\ntitle: t\n${order ? `order: ${order}` : 'draft: true'}\n---\n`);
  const posts = [
    p('2026-11-01-walk.md', 1), p('2026-11-01-notify.md', 3), p('2026-11-01-guard.md', 2),
    p('2026-11-01-b.md'), p('2026-11-01-a.md'), p('2026-11-02-new.md', 1), p('2026-10-31-old.md', 1),
  ];
  assert.deepEqual(posts.sort(comparePosts).map((x) => x.slug),
    ['new', 'notify', 'guard', 'walk', 'a', 'b', 'old']);
  assert.equal(p('2026-11-01-x.md').order, null);
});

test('order：公開する記事にないとき、数字でないとき、同じ日に重なったときはエラー', async () => {
  assert.throws(() => parsePost('2026-11-01-x.md', '---\ntitle: t\n---\n'), /order がありません/);
  for (const bad of ['0', '一', '1.5', '-1']) {
    assert.throws(() => parsePost('2026-11-01-x.md', `---\ntitle: t\norder: ${bad}\n---\n`), /order は/, bad);
  }
  const root = await makeSite({
    '2026-11-01-a.md': '---\ntitle: a\norder: 1\n---\n',
    '2026-11-01-b.md': '---\ntitle: b\norder: 1\n---\n',
  });
  await assert.rejects(loadPosts(path.join(root, 'posts')), /同じ日付に同じ order/);
  const ok = await makeSite({
    '2026-11-01-a.md': '---\ntitle: a\norder: 1\n---\n',
    '2026-11-01-b.md': '---\ntitle: b\ndraft: true\n---\n',
    '2026-11-02-c.md': '---\ntitle: c\norder: 1\n---\n',
  });
  assert.deepEqual((await loadPosts(path.join(ok, 'posts'), { includeDrafts: true })).map((x) => x.slug), ['c', 'a', 'b']);
});

const tempRoots = [];
after(() => Promise.all(tempRoots.map((r) => rm(r, { recursive: true, force: true }))));

async function makeSite(posts, enPosts) {
  const root = await mkdtemp(path.join(tmpdir(), 'blog-test-'));
  tempRoots.push(root);
  await mkdir(path.join(root, 'posts'));
  await mkdir(path.join(root, 'assets'));
  await copyFile(path.join(blogRoot, 'assets', 'style.css'), path.join(root, 'assets', 'style.css'));
  await writeFile(path.join(root, 'site.json'), JSON.stringify({ siteTitle: 'T', description: 'D' }));
  for (const [name, src] of Object.entries(posts)) await writeFile(path.join(root, 'posts', name), src);
  if (enPosts) {
    await mkdir(path.join(root, 'posts', 'en'));
    for (const [name, src] of Object.entries(enPosts)) await writeFile(path.join(root, 'posts', 'en', name), src);
  }
  return root;
}

test('ビルド：下書きは既定で出さず、新しい順に並べる', async () => {
  const root = await makeSite({
    '2026-10-01-old.md': '---\norder: 1\ntitle: 古い\n---\nA',
    '2026-10-20-new.md': '---\norder: 1\ntitle: 新しい\n---\nB',
    '2026-10-25-wip.md': '---\ntitle: 書きかけ\ndraft: true\n---\nC',
  });
  const out = path.join(root, 'dist');
  const { ja: posts } = await buildSite({ root, outDir: out, base: '/claude-lab', includeDrafts: false });
  assert.deepEqual(posts.map((p) => p.slug), ['new', 'old']);

  const index = await readFile(path.join(out, 'index.html'), 'utf8');
  assert.ok(index.indexOf('新しい') < index.indexOf('古い'));
  assert.ok(!index.includes('書きかけ'));
  assert.ok(index.includes('href="/claude-lab/posts/new/"'), 'base の末尾に / を補う');
  assert.ok(index.includes('href="/claude-lab/style.css"'));
  await access(path.join(out, 'posts', 'old', 'index.html'));
  await assert.rejects(access(path.join(out, 'posts', 'wip', 'index.html')));
});

test('ビルド：--drafts なら下書きも出し、印を付ける', async () => {
  const root = await makeSite({ '2026-10-25-wip.md': '---\ntitle: 書きかけ\ndraft: true\n---\nC' });
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: true });
  const page = await readFile(path.join(out, 'posts', 'wip', 'index.html'), 'utf8');
  assert.match(page, /class="draft">下書き</);
});

test('ビルド：タグを記事ページと一覧に出し、タグ別の一覧へのリンクにする（エスケープも）', async () => {
  const root = await makeSite({
    '2026-10-01-a.md': '---\norder: 1\ntitle: タグあり\ntags: hooks, <b>\n---\nA',
    '2026-10-02-b.md': '---\norder: 1\ntitle: タグなし\n---\nB',
  });
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const tags = '<p class="tags"><a class="tag" href="/tags/hooks/">hooks</a> <a class="tag" href="/tags/b/">&lt;b&gt;</a></p>';
  assert.ok((await readFile(path.join(out, 'posts', 'a', 'index.html'), 'utf8')).includes(tags));
  assert.ok((await readFile(path.join(out, 'index.html'), 'utf8')).includes(tags));
  assert.ok(!(await readFile(path.join(out, 'posts', 'b', 'index.html'), 'utf8')).includes('class="tags"'));
  const tagPage = await readFile(path.join(out, 'tags', 'b', 'index.html'), 'utf8');
  assert.match(tagPage, /<h1>タグ：&lt;b&gt;<\/h1>/);
});

test('タグ：フォルダ名と、タグごとのまとめ', () => {
  assert.equal(tagSlug('Claude Code'), 'claude-code');
  assert.equal(tagSlug('散歩モード'), '散歩モード');
  assert.equal(tagSlug(' a/b?c '), 'a-b-c');
  assert.equal(tagSlug('<>'), 'tag');
  assert.equal(tagHref('散歩モード', '/x/'), `/x/tags/${encodeURIComponent('散歩モード')}/`);
  const a = { slug: 'a', tags: ['Hooks', 'x'] };
  const b = { slug: 'b', tags: ['hooks'] };
  const g = groupByTag([a, b]);
  assert.deepEqual(g.map((x) => [x.slug, x.name, x.posts.map((p) => p.slug)]), [['hooks', 'Hooks', ['a', 'b']], ['x', 'x', ['a']]]);
});

test('ビルド：タグ別の一覧は言語ごと、下書きは除く', async () => {
  const root = await makeSite({
    '2026-10-01-a.md': '---\norder: 1\ntitle: 公開\ntags: Claude Code\n---\nA',
    '2026-10-02-b.md': '---\ntitle: 下書き\ntags: Claude Code, 下書きだけ\ndraft: true\n---\nB',
  });
  await mkdir(path.join(root, 'posts', 'en'), { recursive: true });
  await writeFile(path.join(root, 'posts', 'en', '2026-10-01-a.md'), '---\norder: 1\ntitle: Public\ntags: Claude Code\n---\nA');
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const ja = await readFile(path.join(out, 'tags', 'claude-code', 'index.html'), 'utf8');
  assert.match(ja, /公開/);
  assert.doesNotMatch(ja, /下書き<\/a>/);
  await assert.rejects(access(path.join(out, 'tags', encodeURIComponent('下書きだけ'))));
  await assert.rejects(access(path.join(out, 'tags', '下書きだけ')));
  const en = await readFile(path.join(out, 'en', 'tags', 'claude-code', 'index.html'), 'utf8');
  assert.match(en, /<h1>Tag: Claude Code<\/h1>/);
  assert.match(en, /href="\/en\/posts\/a\/"/);
});

test('ビルド：RSS フィードを言語ごとに出し、絶対 URL とエスケープを使う', async () => {
  const root = await makeSite(
    {
      '2026-10-01-old.md': '---\norder: 1\ntitle: 古い & <x>\nsummary: 要約\n---\nA',
      '2026-10-20-new.md': '---\norder: 1\ntitle: 新しい\n---\nB',
      '2026-10-25-wip.md': '---\ntitle: 書きかけ\ndraft: true\n---\nC',
    },
    { '2026-10-01-old.md': '---\norder: 1\ntitle: Old\n---\n' },
  );
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/claude-lab', includeDrafts: false, origin: 'https://example.github.io/' });

  const feed = await readFile(path.join(out, 'feed.xml'), 'utf8');
  assert.match(feed, /^<\?xml version="1.0" encoding="utf-8"\?>\n<rss version="2.0">/);
  assert.ok(feed.includes('<link>https://example.github.io/claude-lab/</link>'));
  assert.ok(feed.includes('<link>https://example.github.io/claude-lab/posts/new/</link>'));
  assert.ok(feed.indexOf('posts/new/') < feed.indexOf('posts/old/'), '新しい順');
  assert.ok(feed.includes('<title>古い &amp; &lt;x&gt;</title>'));
  assert.ok(feed.includes('<description>要約</description>'));
  assert.ok(feed.includes('<pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate>'));
  assert.ok(feed.includes('<language>ja</language>'));
  assert.ok(!feed.includes('書きかけ'));

  const enFeed = await readFile(path.join(out, 'en', 'feed.xml'), 'utf8');
  assert.ok(enFeed.includes('<link>https://example.github.io/claude-lab/en/posts/old/</link>'));
  assert.ok(enFeed.includes('<language>en</language>'));

  const index = await readFile(path.join(out, 'index.html'), 'utf8');
  assert.ok(index.includes('<link rel="alternate" type="application/rss+xml" title="T" href="/claude-lab/feed.xml">'));
  const enPage = await readFile(path.join(out, 'en', 'posts', 'old', 'index.html'), 'utf8');
  assert.ok(enPage.includes('href="/claude-lab/en/feed.xml"'));
});

test('ビルド：RSS フィードは新しい 20 件まで', async () => {
  const posts = {};
  for (let i = 1; i <= 25; i++) posts[`2026-10-${String(i).padStart(2, '0')}-p${i}.md`] = `---\norder: 1\ntitle: p${i}\n---\n`;
  const root = await makeSite(posts);
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const feed = await readFile(path.join(out, 'feed.xml'), 'utf8');
  assert.equal(feed.match(/<item>/g).length, 20);
  assert.ok(feed.includes('posts/p25/') && !feed.includes('posts/p5/'));
  assert.ok(feed.includes('<link>http://localhost:8080/</link>'), 'origin の既定');
});

test('ビルド：スラッグの重複はエラー', async () => {
  const root = await makeSite({
    '2026-10-01-a.md': '---\norder: 1\ntitle: 1\n---\n',
    '2026-10-02-a.md': '---\norder: 1\ntitle: 2\n---\n',
  });
  await assert.rejects(buildSite({ root, outDir: path.join(root, 'dist'), base: '/', includeDrafts: false }), /重複/);
});

test('ビルド：タイトルの HTML はエスケープする', async () => {
  const root = await makeSite({ '2026-10-01-x.md': '---\norder: 1\ntitle: <b>x</b>\n---\n' });
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const page = await readFile(path.join(out, 'posts', 'x', 'index.html'), 'utf8');
  assert.ok(page.includes('&lt;b&gt;x&lt;/b&gt;') && !page.includes('<b>x</b>'));
});

test('ビルド：posts/en がなければ英語版は出さず、切り替えのリンクも出さない', async () => {
  const root = await makeSite({ '2026-10-01-a.md': '---\norder: 1\ntitle: あ\n---\n' });
  const out = path.join(root, 'dist');
  const { en } = await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  assert.equal(en.length, 0);
  await assert.rejects(access(path.join(out, 'en', 'index.html')));
  const index = await readFile(path.join(out, 'index.html'), 'utf8');
  assert.ok(!index.includes('class="lang"'));
  assert.match(index, /<html lang="ja">/);
});

test('ビルド：英語版は /en/ の下に出し、翻訳どうしをリンクする', async () => {
  const root = await makeSite(
    {
      '2026-10-01-both.md': '---\norder: 1\ntitle: 両方\n---\n',
      '2026-10-02-jaonly.md': '---\norder: 1\ntitle: 日本語だけ\n---\n',
    },
    { '2026-10-01-both.md': '---\norder: 1\ntitle: Both\n---\n' },
  );
  const out = path.join(root, 'dist');
  const { ja, en } = await buildSite({ root, outDir: out, base: '/claude-lab/', includeDrafts: false });
  assert.deepEqual([ja.length, en.length], [2, 1]);

  const enIndex = await readFile(path.join(out, 'en', 'index.html'), 'utf8');
  assert.match(enIndex, /<html lang="en">/);
  assert.ok(enIndex.includes('href="/claude-lab/en/posts/both/"'));
  assert.ok(enIndex.includes('href="/claude-lab/style.css"'), 'CSS は共通');
  assert.ok(enIndex.includes('class="lang" href="/claude-lab/">日本語<'));

  const enPost = await readFile(path.join(out, 'en', 'posts', 'both', 'index.html'), 'utf8');
  assert.ok(enPost.includes('class="lang" href="/claude-lab/posts/both/"'), '翻訳元の記事へ');
  assert.ok(enPost.includes('← All posts'));

  const jaPost = await readFile(path.join(out, 'posts', 'both', 'index.html'), 'utf8');
  assert.ok(jaPost.includes('class="lang" href="/claude-lab/en/posts/both/"'), '英語版の記事へ');
  const jaOnly = await readFile(path.join(out, 'posts', 'jaonly', 'index.html'), 'utf8');
  assert.ok(jaOnly.includes('class="lang" href="/claude-lab/en/"'), '翻訳がなければ英語の一覧へ');
});

test('ビルド：site.json の en で英語の文言を上書きできる', async () => {
  const root = await makeSite({}, { '2026-10-01-a.md': '---\norder: 1\ntitle: A\n---\n' });
  await writeFile(path.join(root, 'site.json'), JSON.stringify({ siteTitle: 'T', description: 'D', en: { description: 'English D' } }));
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const enIndex = await readFile(path.join(out, 'en', 'index.html'), 'utf8');
  assert.ok(enIndex.includes('<p>English D</p>'));
  assert.ok(!enIndex.includes('<p>D</p>'), '日本語の説明は英語版に出さない');
});

test('ビルド：assets/img/ の画像を img/ にコピーし、記事から相対パスで指せる', async () => {
  const root = await makeSite({ '2026-10-01-pic.md': '---\norder: 1\ntitle: 画像\n---\n![図の説明](../../img/a.png)' });
  await mkdir(path.join(root, 'assets', 'img'));
  await writeFile(path.join(root, 'assets', 'img', 'a.png'), 'PNG');
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/claude-lab', includeDrafts: false });
  assert.equal(await readFile(path.join(out, 'img', 'a.png'), 'utf8'), 'PNG');
  const page = await readFile(path.join(out, 'posts', 'pic', 'index.html'), 'utf8');
  assert.ok(page.includes('src="../../img/a.png"'));
});

test('ビルド：assets/img/ がなくても止まらない', async () => {
  const root = await makeSite({ '2026-10-01-a.md': '---\norder: 1\ntitle: A\n---\nA' });
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/claude-lab', includeDrafts: false });
  await assert.rejects(readFile(path.join(out, 'img', 'a.png')));
});
