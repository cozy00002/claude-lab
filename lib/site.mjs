// 記事（posts/*.md）を読み込んで、静的サイトの HTML を組み立てる。
// 日本語の記事は posts/ に置いて / の下へ、英語版は posts/en/ に同じファイル名で置いて /en/ の下へ出す。
import { readdir, readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
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

// tags はカンマ区切り（[a, b] の形も可）。空と重複は除く
export function parseTags(v) {
  if (typeof v !== 'string') return [];
  const tags = v.replace(/^\[(.*)\]$/, '$1').split(',')
    .map((t) => t.trim().replace(/^["'](.*)["']$/, '$1').trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

export function renderTags(tags) {
  if (!tags.length) return '';
  return `<p class="tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</p>`;
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
    tags: parseTags(meta.tags),
    draft: meta.draft === true,
    html: renderMarkdown(body),
  };
}

// 画面の決まり文句。site.json の ja / en で上書きできる
export const TEXTS = {
  ja: { footer: 'Claude Code と一緒に作っています', back: '← 記事一覧', empty: 'まだ記事がありません', draft: '下書き', switchLabel: 'English' },
  en: { footer: 'Built together with Claude Code', back: '← All posts', empty: 'No posts yet', draft: 'Draft', switchLabel: '日本語' },
};

// 言語ごとの設定。日本語はサイトの直下、英語は en/ の下
export function langConfig(siteCfg, lang, base) {
  const own = siteCfg[lang] ?? {};
  return {
    ...TEXTS[lang],
    description: lang === 'ja' ? siteCfg.description : '',
    ...own,
    lang,
    siteTitle: siteCfg.siteTitle,
    base,
    home: lang === 'ja' ? base : `${base}${lang}/`,
  };
}

export function layout({ title, siteTitle, base, home, lang, footer, switchLabel, switchHref, content }) {
  const pageTitle = title ? `${escapeHtml(title)} | ${escapeHtml(siteTitle)}` : escapeHtml(siteTitle);
  const switcher = switchHref ? `\n<a class="lang" href="${switchHref}">${escapeHtml(switchLabel)}</a>` : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<link rel="stylesheet" href="${base}style.css">
</head>
<body>
<header class="site"><a href="${home}">${escapeHtml(siteTitle)}</a>${switcher}</header>
<main>
${content}
</main>
<footer class="site">${escapeHtml(footer)}</footer>
</body>
</html>
`;
}

export function renderPostPage(post, cfg, switchHref) {
  const content = `<article>
<p class="date">${post.date}${post.draft ? ` <span class="draft">${escapeHtml(cfg.draft)}</span>` : ''}</p>
<h1>${escapeHtml(post.title)}</h1>
${post.tags.length ? renderTags(post.tags) + '\n' : ''}${post.html}
</article>
<p class="back"><a href="${cfg.home}">${escapeHtml(cfg.back)}</a></p>`;
  return layout({ ...cfg, title: post.title, switchHref, content });
}

export function renderIndexPage(posts, cfg, switchHref) {
  const items = posts.map((p) => `<li>
<span class="date">${p.date}</span>
<a href="${cfg.home}posts/${p.slug}/">${escapeHtml(p.title)}</a>${p.draft ? ` <span class="draft">${escapeHtml(cfg.draft)}</span>` : ''}
${p.summary ? `<p class="summary">${escapeHtml(p.summary)}</p>` : ''}
${renderTags(p.tags)}
</li>`).join('\n');
  const description = cfg.description ? `<p>${escapeHtml(cfg.description)}</p>\n` : '';
  const content = `<h1>${escapeHtml(cfg.siteTitle)}</h1>
${description}<ul class="posts">
${items || `<li>${escapeHtml(cfg.empty)}</li>`}
</ul>`;
  return layout({ ...cfg, title: '', switchHref, content });
}

export async function loadPosts(postsDir, { includeDrafts = false } = {}) {
  const files = (await readdir(postsDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);
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

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function writePages(outDir, posts, cfg, other) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.html'), renderIndexPage(posts, cfg, other?.cfg.home));
  for (const p of posts) {
    // 翻訳があればその記事へ、なければもう一方の言語の一覧へ
    const switchHref = other && (other.slugs.has(p.slug) ? `${other.cfg.home}posts/${p.slug}/` : other.cfg.home);
    const dir = path.join(outDir, 'posts', p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), renderPostPage(p, cfg, switchHref));
  }
}

export async function buildSite({ root, outDir, base, includeDrafts }) {
  const siteCfg = JSON.parse(await readFile(path.join(root, 'site.json'), 'utf8'));
  base = base.endsWith('/') ? base : base + '/';
  const postsDir = path.join(root, 'posts');
  const enDir = path.join(postsDir, 'en');

  const ja = { cfg: langConfig(siteCfg, 'ja', base), posts: await loadPosts(postsDir, { includeDrafts }) };
  const en = (await exists(enDir))
    ? { cfg: langConfig(siteCfg, 'en', base), posts: await loadPosts(enDir, { includeDrafts }) }
    : null;
  for (const l of [ja, en]) if (l) l.slugs = new Set(l.posts.map((p) => p.slug));

  await mkdir(outDir, { recursive: true });
  await copyFile(path.join(root, 'assets', 'style.css'), path.join(outDir, 'style.css'));
  await writePages(outDir, ja.posts, ja.cfg, en);
  if (en) await writePages(path.join(outDir, 'en'), en.posts, en.cfg, ja);
  return { ja: ja.posts, en: en?.posts ?? [] };
}
