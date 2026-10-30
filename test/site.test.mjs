import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontMatter, parsePost, buildSite } from '../lib/site.mjs';

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

test('記事：ファイル名の形式と title は必須', () => {
  assert.throws(() => parsePost('setup.md', '---\ntitle: a\n---\n'), /YYYY-MM-DD/);
  assert.throws(() => parsePost('2026-10-29-a.md', '本文'), /title/);
});

const tempRoots = [];
after(() => Promise.all(tempRoots.map((r) => rm(r, { recursive: true, force: true }))));

async function makeSite(posts) {
  const root = await mkdtemp(path.join(tmpdir(), 'blog-test-'));
  tempRoots.push(root);
  await mkdir(path.join(root, 'posts'));
  await mkdir(path.join(root, 'assets'));
  await copyFile(path.join(blogRoot, 'assets', 'style.css'), path.join(root, 'assets', 'style.css'));
  await writeFile(path.join(root, 'site.json'), JSON.stringify({ siteTitle: 'T', description: 'D' }));
  for (const [name, src] of Object.entries(posts)) await writeFile(path.join(root, 'posts', name), src);
  return root;
}

test('ビルド：下書きは既定で出さず、新しい順に並べる', async () => {
  const root = await makeSite({
    '2026-10-01-old.md': '---\ntitle: 古い\n---\nA',
    '2026-10-20-new.md': '---\ntitle: 新しい\n---\nB',
    '2026-10-25-wip.md': '---\ntitle: 書きかけ\ndraft: true\n---\nC',
  });
  const out = path.join(root, 'dist');
  const posts = await buildSite({ root, outDir: out, base: '/claude-lab', includeDrafts: false });
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
