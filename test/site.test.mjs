import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontMatter, parsePost, parseTags, buildSite } from '../lib/site.mjs';

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
  const p = parsePost('2026-10-29-setup.md', '---\ntitle: 立ち上げ\n---\n# x');
  assert.equal(p.date, '2026-10-29');
  assert.equal(p.slug, 'setup');
  assert.equal(p.draft, false);
});

test('タグ：カンマ区切りと [a, b] の形。空と重複は除く', () => {
  assert.deepEqual(parseTags('Claude Code, hooks'), ['Claude Code', 'hooks']);
  assert.deepEqual(parseTags('[a, "b", a, ]'), ['a', 'b']);
  assert.deepEqual(parseTags(undefined), []);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parsePost('2026-10-29-a.md', '---\ntitle: a\n---\n').tags, []);
});

test('記事：ファイル名の形式と title は必須', () => {
  assert.throws(() => parsePost('setup.md', '---\ntitle: a\n---\n'), /YYYY-MM-DD/);
  assert.throws(() => parsePost('2026-10-29-a.md', '本文'), /title/);
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
    '2026-10-01-old.md': '---\ntitle: 古い\n---\nA',
    '2026-10-20-new.md': '---\ntitle: 新しい\n---\nB',
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

test('ビルド：タグを記事ページと一覧に出し、エスケープする', async () => {
  const root = await makeSite({
    '2026-10-01-a.md': '---\ntitle: タグあり\ntags: hooks, <b>\n---\nA',
    '2026-10-02-b.md': '---\ntitle: タグなし\n---\nB',
  });
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const tags = '<p class="tags"><span class="tag">hooks</span> <span class="tag">&lt;b&gt;</span></p>';
  assert.ok((await readFile(path.join(out, 'posts', 'a', 'index.html'), 'utf8')).includes(tags));
  assert.ok((await readFile(path.join(out, 'index.html'), 'utf8')).includes(tags));
  assert.ok(!(await readFile(path.join(out, 'posts', 'b', 'index.html'), 'utf8')).includes('class="tags"'));
});

test('ビルド：スラッグの重複はエラー', async () => {
  const root = await makeSite({
    '2026-10-01-a.md': '---\ntitle: 1\n---\n',
    '2026-10-02-a.md': '---\ntitle: 2\n---\n',
  });
  await assert.rejects(buildSite({ root, outDir: path.join(root, 'dist'), base: '/', includeDrafts: false }), /重複/);
});

test('ビルド：タイトルの HTML はエスケープする', async () => {
  const root = await makeSite({ '2026-10-01-x.md': '---\ntitle: <b>x</b>\n---\n' });
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const page = await readFile(path.join(out, 'posts', 'x', 'index.html'), 'utf8');
  assert.ok(page.includes('&lt;b&gt;x&lt;/b&gt;') && !page.includes('<b>x</b>'));
});

test('ビルド：posts/en がなければ英語版は出さず、切り替えのリンクも出さない', async () => {
  const root = await makeSite({ '2026-10-01-a.md': '---\ntitle: あ\n---\n' });
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
      '2026-10-01-both.md': '---\ntitle: 両方\n---\n',
      '2026-10-02-jaonly.md': '---\ntitle: 日本語だけ\n---\n',
    },
    { '2026-10-01-both.md': '---\ntitle: Both\n---\n' },
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
  const root = await makeSite({}, { '2026-10-01-a.md': '---\ntitle: A\n---\n' });
  await writeFile(path.join(root, 'site.json'), JSON.stringify({ siteTitle: 'T', description: 'D', en: { description: 'English D' } }));
  const out = path.join(root, 'dist');
  await buildSite({ root, outDir: out, base: '/', includeDrafts: false });
  const enIndex = await readFile(path.join(out, 'en', 'index.html'), 'utf8');
  assert.ok(enIndex.includes('<p>English D</p>'));
  assert.ok(!enIndex.includes('<p>D</p>'), '日本語の説明は英語版に出さない');
});
