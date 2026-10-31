// ビルドしたサイト（outDir）の中のリンク切れを探す。
// 対象はサイト内のリンク（href / src のうち、相対か / で始まるもの）。外部のサイト・mailto・ページ内の # は調べない。
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

async function listHtml(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await listHtml(p)));
    else if (e.name.endsWith('.html')) files.push(p);
  }
  return files;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// 戻り値：[{ page: 'posts/a/index.html', link: '...' }]
export async function findBrokenLinks(outDir, base = '/') {
  base = base.endsWith('/') ? base : base + '/';
  const origin = 'http://site.invalid';
  const broken = [];
  for (const file of await listHtml(outDir)) {
    const rel = path.relative(outDir, file).split(path.sep).join('/');
    const pageUrl = new URL(base + rel.replace(/index\.html$/, ''), origin);
    const html = await readFile(file, 'utf8');
    for (const [, link] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      if (!link || link.startsWith('#')) continue;
      const url = new URL(link.replace(/&amp;/g, '&'), pageUrl);
      if (url.origin !== origin) continue;
      let target = decodeURIComponent(url.pathname);
      if (!target.startsWith(base)) { broken.push({ page: rel, link }); continue; }
      target = target.slice(base.length);
      const candidates = target === '' || target.endsWith('/')
        ? [path.join(outDir, target, 'index.html')]
        : [path.join(outDir, target), path.join(outDir, target, 'index.html')];
      let ok = false;
      for (const c of candidates) if (await exists(c)) { ok = true; break; }
      if (!ok) broken.push({ page: rel, link });
    }
  }
  return broken;
}

// 画像の説明文（alt）が空か、ないものを探す。読み上げや、画像が出ないときに内容が伝わるように
// 戻り値：[{ page: 'posts/a/index.html', img: '<img ...>' }]
export async function findImagesWithoutAlt(outDir) {
  const missing = [];
  for (const file of await listHtml(outDir)) {
    const rel = path.relative(outDir, file).split(path.sep).join('/');
    for (const [img] of (await readFile(file, 'utf8')).matchAll(/<img\b[^>]*>/gi)) {
      const alt = img.match(/\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (!alt || !(alt[1] ?? alt[2]).trim()) missing.push({ page: rel, img });
    }
  }
  return missing;
}
