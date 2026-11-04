// 手元のプレビュー用のサーバー（serve.mjs から使う）。本番のビルド（build.mjs / buildSite）は、このファイルを使わない。
// - 末尾の / がないフォルダの URL は、/ を付けて転送する（GitHub Pages と同じ動き）
// - reviewFile を渡したときだけ、記事のページに OK / NG とコメントの欄を出し、その JSON ファイルに保存する。
//   欄を出すスクリプトは、ページを返すときに差し込む。ビルドで作るファイル（dist/）には何も足さない
import http from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/rss+xml; charset=utf-8',
};
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'review-client.js');
export const REVIEW_SCRIPT = '<script src="/__review/client.js" defer></script>';
// 記事のキー：言語/スラッグ（例 ja/walk-mode、en/walk-mode）
const KEY = /^(ja|en)\/[^/\s]{1,100}$/;
const MAX_BODY = 100_000;

// 受け付けるアドレス。既定は PC の中だけ。スマホから Tailscale で見るときは HOST にその PC の Tailscale のアドレスを入れる
export function previewHost(env = process.env) {
  return env.HOST?.trim() || '127.0.0.1';
}

export function injectReviewScript(html) {
  return html.includes('</body>') ? html.replace('</body>', `${REVIEW_SCRIPT}\n</body>`) : html + REVIEW_SCRIPT;
}

export async function readReviews(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

// 1 記事分を保存する。status は ok / ng / ''（未判断）
export async function saveReview(file, { key, status, comment, title }) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('記事のキーが正しくありません');
  if (!['ok', 'ng', ''].includes(status)) throw new Error('status は ok / ng / 空 のどれか');
  if (typeof comment !== 'string') throw new Error('comment は文字列');
  const all = await readReviews(file);
  all[key] = { status, comment, title: String(title ?? ''), updated: new Date().toISOString() };
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(file, JSON.stringify(sorted, null, 2) + '\n');
  return all[key];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('大きすぎます')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleReview(req, res, p, reviewFile) {
  if (p === '/__review/client.js' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] }).end(await readFile(CLIENT));
    return;
  }
  if (p === '/__review/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(await readReviews(reviewFile)));
    return;
  }
  if (p === '/__review/save' && req.method === 'POST') {
    // 別のサイトのページから送らせないため、JSON の Content-Type だけ受け付ける（ブラウザは事前の確認を送り、それには答えない）
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      res.writeHead(415).end('application/json で送ってください');
      return;
    }
    try {
      const saved = await saveReview(reviewFile, JSON.parse(await readBody(req)));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(saved));
    } catch (e) {
      res.writeHead(400).end(String(e.message));
    }
    return;
  }
  res.writeHead(404).end('not found');
}

export function createPreviewServer({ outDir, reviewFile = null }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let p;
    try {
      p = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (p.startsWith('/__review/')) {
      if (!reviewFile) { res.writeHead(404).end('not found'); return; }
      await handleReview(req, res, p, reviewFile);
      return;
    }
    const file = path.join(outDir, path.normalize(p));
    if (file !== outDir && !file.startsWith(outDir + path.sep)) { res.writeHead(403).end(); return; }
    let target = file;
    try {
      if ((await stat(file)).isDirectory()) {
        if (!p.endsWith('/')) {
          res.writeHead(301, { Location: url.pathname + '/' + url.search }).end();
          return;
        }
        target = path.join(file, 'index.html');
      }
      let body = await readFile(target);
      const ext = path.extname(target);
      if (ext === '.html' && reviewFile) body = injectReviewScript(body.toString('utf8'));
      res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
}
