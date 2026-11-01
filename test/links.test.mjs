import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrokenLinks, findImagesWithoutAlt } from '../lib/links.mjs';
import { buildSite } from '../lib/site.mjs';

const blogRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tempDirs = [];
after(() => Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true }))));

async function makeOut(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'links-test-'));
  tempDirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  return dir;
}

test('リンク切れ：あるもの・ないものを見分ける（base 付き）', async () => {
  const out = await makeOut({
    'index.html': [
      '<a href="/b/posts/a/">ある</a>',
      '<a href="/b/posts/none/">ない</a>',
      '<link href="/b/style.css">',
      '<a href="/b/posts/a">末尾の / なし</a>',
      '<a href="/other/">base の外</a>',
      '<a href="https://example.com/x">外部</a>',
      '<a href="mailto:a@example.com">メール</a>',
      '<a href="#top">ページ内</a>',
    ].join('\n'),
    'style.css': '',
    'posts/a/index.html': '<a href="../../">一覧へ（相対）</a> <img src="img.png"> <a href="/b/posts/a/#x">自分の中の見出し</a>',
  });
  const broken = await findBrokenLinks(out, '/b');
  assert.deepEqual(broken.map((b) => `${b.page} ${b.link}`).sort(), [
    'index.html /b/posts/none/',
    'index.html /other/',
    'posts/a/index.html img.png',
  ]);
});

test('画像の alt：空かないものを見つける', async () => {
  const out = await makeOut({
    'index.html': '<img src="a.png" alt="グラフ"> <img src="b.png"> <img alt="  " src="c.png">',
    'posts/a/index.html': "<IMG SRC='d.png' ALT='図'> <img src=\"e.png\" alt=\"\">",
  });
  const found = await findImagesWithoutAlt(out);
  assert.deepEqual(found.map((f) => `${f.page} ${f.img}`).sort(), [
    'index.html <img alt="  " src="c.png">',
    'index.html <img src="b.png">',
    'posts/a/index.html <img src="e.png" alt="">',
  ]);
});

test('本物の記事をビルドして、サイト内のリンク切れがない（下書きを除く・本番と同じ base）', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-site-'));
  tempDirs.push(out);
  await buildSite({ root: blogRoot, outDir: out, base: '/claude-lab/', includeDrafts: false });
  assert.deepEqual(await findBrokenLinks(out, '/claude-lab/'), []);
  assert.deepEqual(await findImagesWithoutAlt(out), []);
});
