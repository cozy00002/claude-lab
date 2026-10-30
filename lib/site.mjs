// 記事（posts/*.md）を読み込んで、静的サイトの HTML を組み立てる。
import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { renderMarkdown, escapeHtml } from './markdown.mjs';

// 先頭の --- で囲まれた部分を「キー: 値」として読む
export function parseFrontMatter(src) {
  const m = src.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

// ファイル名は YYYY-MM-DD-スラッグ.md
export function parsePost(fileName, src) {
  const name = fileName.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (!name) throw new Error(`記事のファイル名は YYYY-MM-DD-スラッグ.md にしてください: ${fileName}`);
  const { meta, body } = parseFrontMatter(src);
  if (!meta.title) throw new Error(`title がありません: ${fileName}`);
  return {
    slug: name[2],
    date: String(meta.date ?? name[1]),
    title: String(meta.title),
    summary: meta.summary ? String(meta.summary) : '',
    draft: meta.draft === true,
    html: renderMarkdown(body),
  };
}

export function layout({ title, siteTitle, base, content }) {
  const pageTitle = title ? `${escapeHtml(title)} | ${escapeHtml(siteTitle)}` : escapeHtml(siteTitle);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<link rel="stylesheet" href="${base}style.css">
</head>
<body>
<header class="site"><a href="${base}">${escapeHtml(siteTitle)}</a></header>
<main>
${content}
</main>
<footer class="site">Claude Code と一緒に作っています</footer>
</body>
</html>
`;
}

export function renderPostPage(post, cfg) {
  const content = `<article>
<p class="date">${post.date}${post.draft ? ' <span class="draft">下書き</span>' : ''}</p>
<h1>${escapeHtml(post.title)}</h1>
${post.html}
</article>
<p class="back"><a href="${cfg.base}">← 記事一覧</a></p>`;
  return layout({ ...cfg, title: post.title, content });
}

export function renderIndexPage(posts, cfg) {
  const items = posts.map((p) => `<li>
<span class="date">${p.date}</span>
<a href="${cfg.base}posts/${p.slug}/">${escapeHtml(p.title)}</a>${p.draft ? ' <span class="draft">下書き</span>' : ''}
${p.summary ? `<p class="summary">${escapeHtml(p.summary)}</p>` : ''}
</li>`).join('\n');
  const content = `<h1>${escapeHtml(cfg.siteTitle)}</h1>
<p>${escapeHtml(cfg.description)}</p>
<ul class="posts">
${items || '<li>まだ記事がありません</li>'}
</ul>`;
  return layout({ ...cfg, title: '', content });
}

export async function loadPosts(postsDir, { includeDrafts = false } = {}) {
  const files = (await readdir(postsDir)).filter((f) => f.endsWith('.md'));
  const posts = [];
  for (const f of files) posts.push(parsePost(f, await readFile(path.join(postsDir, f), 'utf8')));
  const slugs = new Set();
  for (const p of posts) {
    if (slugs.has(p.slug)) throw new Error(`スラッグが重複しています: ${p.slug}`);
    slugs.add(p.slug);
  }
  return posts
    .filter((p) => includeDrafts || !p.draft)
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
}

export async function buildSite({ root, outDir, base, includeDrafts }) {
  const cfg = JSON.parse(await readFile(path.join(root, 'site.json'), 'utf8'));
  cfg.base = base.endsWith('/') ? base : base + '/';
  const posts = await loadPosts(path.join(root, 'posts'), { includeDrafts });

  await mkdir(outDir, { recursive: true });
  await copyFile(path.join(root, 'assets', 'style.css'), path.join(outDir, 'style.css'));
  await writeFile(path.join(outDir, 'index.html'), renderIndexPage(posts, cfg));
  for (const p of posts) {
    const dir = path.join(outDir, 'posts', p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), renderPostPage(p, cfg));
  }
  return posts;
}
