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

// タグ別の一覧ページのフォルダ名。大文字小文字をそろえ、空白や URL・ファイル名に使えない文字は - にする
export function tagSlug(tag) {
  return tag.toLowerCase().replace(/[\s<>:"|*?#%&\\/]+/g, '-').replace(/^-+|-+$/g, '') || 'tag';
}

export function tagHref(tag, home) {
  return `${home}tags/${encodeURIComponent(tagSlug(tag))}/`;
}

// home を渡すと、各タグをタグ別の一覧ページへのリンクにする
export function renderTags(tags, home) {
  if (!tags.length) return '';
  const one = (t) => (home
    ? `<a class="tag" href="${tagHref(t, home)}">${escapeHtml(t)}</a>`
    : `<span class="tag">${escapeHtml(t)}</span>`);
  return `<p class="tags">${tags.map(one).join(' ')}</p>`;
}

// タグのフォルダ名ごとに記事をまとめる。表示名は最初に出てきた書き方
export function groupByTag(posts) {
  const groups = new Map();
  for (const p of posts) {
    for (const t of p.tags) {
      const slug = tagSlug(t);
      if (!groups.has(slug)) groups.set(slug, { slug, name: t, posts: [] });
      const g = groups.get(slug);
      if (!g.posts.includes(p)) g.posts.push(p);
    }
  }
  return [...groups.values()];
}

// ファイル名は YYYY-MM-DD-スラッグ.md
export function parsePost(fileName, src) {
  const name = fileName.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (!name) throw new Error(`記事のファイル名は YYYY-MM-DD-スラッグ.md にしてください: ${fileName}`);
  const { meta, body } = parseFrontMatter(src);
  if (!meta.title) throw new Error(`title がありません: ${fileName}`);
  // order：その日に出した順番（1 から）。公開する記事には必須。下書きは公開するときに決めるので、なくてよい
  const draft = meta.draft === true;
  let order = null;
  if (meta.order !== undefined) {
    if (!/^[1-9]\d*$/.test(String(meta.order))) throw new Error(`order は 1 以上の整数にしてください: ${fileName}`);
    order = Number(meta.order);
  } else if (!draft) {
    throw new Error(`order がありません（その日に出した順番を 1 から付ける）: ${fileName}`);
  }
  return {
    slug: name[2],
    date: String(meta.date ?? name[1]),
    title: String(meta.title),
    summary: meta.summary ? String(meta.summary) : '',
    tags: parseTags(meta.tags),
    draft,
    order,
    html: renderMarkdown(body),
  };
}

// 画面の決まり文句。site.json の ja / en で上書きできる
export const TEXTS = {
  ja: { footer: 'Claude Code と一緒に作っています', back: '← 記事一覧', empty: 'まだ記事がありません', draft: '下書き', switchLabel: 'English', tagHeading: 'タグ：' },
  en: { footer: 'Built together with Claude Code', back: '← All posts', empty: 'No posts yet', draft: 'Draft', switchLabel: '日本語', tagHeading: 'Tag: ' },
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
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteTitle)}" href="${home}feed.xml">
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
${post.tags.length ? renderTags(post.tags, cfg.home) + '\n' : ''}${post.html}
</article>
<p class="back"><a href="${cfg.home}">${escapeHtml(cfg.back)}</a></p>`;
  return layout({ ...cfg, title: post.title, switchHref, content });
}

function renderPostList(posts, cfg) {
  const items = posts.map((p) => `<li>
<span class="date">${p.date}</span>
<a href="${cfg.home}posts/${p.slug}/">${escapeHtml(p.title)}</a>${p.draft ? ` <span class="draft">${escapeHtml(cfg.draft)}</span>` : ''}
${p.summary ? `<p class="summary">${escapeHtml(p.summary)}</p>` : ''}
${renderTags(p.tags, cfg.home)}
</li>`).join('\n');
  return `<ul class="posts">
${items || `<li>${escapeHtml(cfg.empty)}</li>`}
</ul>`;
}

export function renderIndexPage(posts, cfg, switchHref) {
  const description = cfg.description ? `<p>${escapeHtml(cfg.description)}</p>\n` : '';
  const content = `<h1>${escapeHtml(cfg.siteTitle)}</h1>
${description}${renderPostList(posts, cfg)}`;
  return layout({ ...cfg, title: '', switchHref, content });
}

export function renderTagPage(group, cfg, switchHref) {
  const heading = `${cfg.tagHeading}${group.name}`;
  const content = `<h1>${escapeHtml(heading)}</h1>
${renderPostList(group.posts, cfg)}
<p class="back"><a href="${cfg.home}">${escapeHtml(cfg.back)}</a></p>`;
  return layout({ ...cfg, title: heading, switchHref, content });
}

// RSS 2.0。リンクは絶対 URL が要るので origin（例 https://example.github.io）を付ける
export const FEED_LIMIT = 20;

export function renderFeed(posts, cfg, origin) {
  const home = `${origin}${cfg.home}`;
  const items = posts.slice(0, FEED_LIMIT).map((p) => {
    const link = `${home}posts/${p.slug}/`;
    return `<item>
<title>${escapeHtml(p.title)}</title>
<link>${link}</link>
<guid>${link}</guid>
<pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>
${p.summary ? `<description>${escapeHtml(p.summary)}</description>\n` : ''}</item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
<channel>
<title>${escapeHtml(cfg.siteTitle)}</title>
<link>${home}</link>
<description>${escapeHtml(cfg.description ?? '')}</description>
<language>${cfg.lang}</language>
${items}
</channel>
</rss>
`;
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
  const orders = new Set();
  for (const p of posts.filter((x) => !x.draft)) {
    const key = `${p.date} ${p.order}`;
    if (orders.has(key)) throw new Error(`同じ日付に同じ order があります: ${p.date} の order ${p.order}（${p.slug}）`);
    orders.add(key);
  }
  return posts
    .filter((p) => includeDrafts || !p.draft)
    .sort(comparePosts);
}

// 並び順：日付の新しい順。同じ日付の中では、出した順番（order）の大きい方（あとに出した方）が上。
// order のない下書き（プレビューのときだけ並ぶ）は、その日の記事の下に、スラッグの abc 順で並ぶ
export function comparePosts(a, b) {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  if (a.order !== b.order) return (b.order ?? 0) - (a.order ?? 0);
  return a.slug.localeCompare(b.slug);
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function writePages(outDir, posts, cfg, other, origin) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.html'), renderIndexPage(posts, cfg, other?.cfg.home));
  await writeFile(path.join(outDir, 'feed.xml'), renderFeed(posts, cfg, origin));
  for (const p of posts) {
    // 翻訳があればその記事へ、なければもう一方の言語の一覧へ
    const switchHref = other && (other.slugs.has(p.slug) ? `${other.cfg.home}posts/${p.slug}/` : other.cfg.home);
    const dir = path.join(outDir, 'posts', p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), renderPostPage(p, cfg, switchHref));
  }
  // タグ別の一覧。もう一方の言語へは、その言語の一覧へ切り替える（タグは言語ごとに違うため）
  for (const g of groupByTag(posts)) {
    const dir = path.join(outDir, 'tags', g.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), renderTagPage(g, cfg, other?.cfg.home));
  }
}

// 記事の画像：assets/img/ のファイルを、出力先の img/ にそのままコピーする（フォルダの中のフォルダは扱わない）。
// 記事からは相対パスで指す（日本語の記事は ../../img/名前）。リンク切れのテストが、指した先の有無を確かめる
async function copyImages(srcDir, destDir) {
  if (!(await exists(srcDir))) return;
  const files = (await readdir(srcDir, { withFileTypes: true })).filter((e) => e.isFile());
  if (!files.length) return;
  await mkdir(destDir, { recursive: true });
  for (const e of files) await copyFile(path.join(srcDir, e.name), path.join(destDir, e.name));
}

export async function buildSite({ root, outDir, base, includeDrafts, origin = 'http://localhost:8080' }) {
  const siteCfg = JSON.parse(await readFile(path.join(root, 'site.json'), 'utf8'));
  base = base.endsWith('/') ? base : base + '/';
  origin = origin.replace(/\/+$/, '');
  const postsDir = path.join(root, 'posts');
  const enDir = path.join(postsDir, 'en');

  const ja = { cfg: langConfig(siteCfg, 'ja', base), posts: await loadPosts(postsDir, { includeDrafts }) };
  const en = (await exists(enDir))
    ? { cfg: langConfig(siteCfg, 'en', base), posts: await loadPosts(enDir, { includeDrafts }) }
    : null;
  for (const l of [ja, en]) if (l) l.slugs = new Set(l.posts.map((p) => p.slug));

  await mkdir(outDir, { recursive: true });
  await copyFile(path.join(root, 'assets', 'style.css'), path.join(outDir, 'style.css'));
  await copyImages(path.join(root, 'assets', 'img'), path.join(outDir, 'img'));
  await writePages(outDir, ja.posts, ja.cfg, en, origin);
  if (en) await writePages(path.join(outDir, 'en'), en.posts, en.cfg, ja, origin);
  return { ja: ja.posts, en: en?.posts ?? [] };
}
