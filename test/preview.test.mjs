import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer, injectReviewScript, saveReview, previewHost, REVIEW_SCRIPT } from '../lib/preview.mjs';
import { buildSite } from '../lib/site.mjs';

const blogRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs = [];
after(() => Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true }))));

async function tempDir() {
  const d = await mkdtemp(path.join(tmpdir(), 'preview-test-'));
  tempDirs.push(d);
  return d;
}

async function makeOut() {
  const out = await tempDir();
  await mkdir(path.join(out, 'en', 'posts', 'a'), { recursive: true });
  await writeFile(path.join(out, 'index.html'), '<html><body><p>top</p></body></html>');
  await writeFile(path.join(out, 'en', 'index.html'), '<html><body>en</body></html>');
  await writeFile(path.join(out, 'en', 'posts', 'a', 'index.html'), '<html><body>A</body></html>');
  await writeFile(path.join(out, 'style.css'), 'body{}');
  return out;
}

async function withServer(opts, fn) {
  const server = createPreviewServer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('末尾の / がないフォルダは / を付けて転送する（GitHub Pages と同じ）', async () => {
  const outDir = await makeOut();
  await withServer({ outDir }, async (base) => {
    const r = await fetch(`${base}/en?x=1`, { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/en/?x=1');
    assert.equal(await (await fetch(`${base}/en`)).text(), '<html><body>en</body></html>');
    assert.equal((await fetch(`${base}/style.css`)).status, 200);
    assert.equal((await fetch(`${base}/none`)).status, 404);
    // 外のファイルは読ませない（.. は根元で切り詰められて 404、すり抜けたときは 403）
    assert.ok([403, 404].includes((await fetch(`${base}/..%2f..%2fpackage.json`)).status));
  });
});

test('確認欄なし（reviewFile なし）：スクリプトを差し込まず、保存の受け口もない', async () => {
  const outDir = await makeOut();
  await withServer({ outDir }, async (base) => {
    assert.ok(!(await (await fetch(`${base}/`)).text()).includes('__review'));
    assert.equal((await fetch(`${base}/__review/data`)).status, 404);
  });
});

test('確認欄あり：HTML にだけ差し込み、保存して読み戻せる', async () => {
  const outDir = await makeOut();
  const reviewFile = path.join(await tempDir(), 'reviews.json');
  await withServer({ outDir, reviewFile }, async (base) => {
    assert.ok((await (await fetch(`${base}/en/posts/a/`)).text()).includes(REVIEW_SCRIPT));
    assert.ok(!(await (await fetch(`${base}/style.css`)).text()).includes('__review'));
    assert.match(await (await fetch(`${base}/__review/client.js`)).text(), /__review\/save/);
    assert.deepEqual(await (await fetch(`${base}/__review/data`)).json(), {});

    const post = (body, type = 'application/json') =>
      fetch(`${base}/__review/save`, { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body) });
    assert.equal((await post({ key: 'en/a', status: 'ng', comment: '直す', title: 'A' })).status, 200);
    assert.equal((await post({ key: 'ja/a', status: 'ok', comment: '', title: 'あ' })).status, 200);
    const all = await (await fetch(`${base}/__review/data`)).json();
    assert.deepEqual(Object.keys(all), ['en/a', 'ja/a']);
    assert.equal(all['en/a'].status, 'ng');
    assert.equal(all['en/a'].comment, '直す');

    // 受け付けないもの：JSON でない送り方（別のサイトからの送信を防ぐ）、正しくないキーや status
    assert.equal((await post({ key: 'ja/a', status: 'ok', comment: '' }, 'text/plain')).status, 415);
    assert.equal((await post({ key: '../x', status: 'ok', comment: '' })).status, 400);
    assert.equal((await post({ key: 'ja/a', status: 'maybe', comment: '' })).status, 400);
    assert.equal(JSON.parse(await readFile(reviewFile, 'utf8'))['ja/a'].status, 'ok');
  });
});

test('injectReviewScript：</body> の前に入れる', () => {
  assert.equal(injectReviewScript('<body>x</body>'), `<body>x${REVIEW_SCRIPT}\n</body>`);
});

test('saveReview：ファイルがなければ作る', async () => {
  const file = path.join(await tempDir(), 'r.json');
  await saveReview(file, { key: 'ja/x', status: '', comment: 'メモ' });
  assert.equal(JSON.parse(await readFile(file, 'utf8'))['ja/x'].comment, 'メモ');
});

test('本番のビルドの出力には、確認欄のスクリプトが入らない', async () => {
  const outDir = await tempDir();
  await buildSite({ root: blogRoot, outDir, base: '/claude-lab/', origin: 'https://example.github.io' });
  const walk = async (d) => (await Promise.all((await readdir(d, { withFileTypes: true }))
    .map((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])))).flat();
  const files = await walk(outDir);
  assert.ok(files.some((f) => f.endsWith('.html')));
  for (const f of files) assert.ok(!(await readFile(f, 'utf8')).includes('__review'), f);
});

test('previewHost：HOST がなければ PC の中だけ（127.0.0.1）', () => {
  assert.equal(previewHost({}), '127.0.0.1');
  assert.equal(previewHost({ HOST: '  ' }), '127.0.0.1');
  assert.equal(previewHost({ HOST: '192.0.2.10' }), '192.0.2.10');
});
