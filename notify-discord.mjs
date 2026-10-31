// 使い方: node notify-discord.mjs（GitHub Actions の deploy のあとに動かす）
//   直前のコミット（HEAD~1..HEAD）で追加された記事（posts/*.md、英語版と下書きは除く）を Discord に知らせる。
//   環境変数 DISCORD_WEBHOOK_URL（Secret）と PAGE_URL（公開先の URL、末尾 /）を使う。
//   Webhook の URL がない・新しい記事がないときは、何もしない。通知に失敗しても公開は済んでいるので、警告だけ出す。
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePost } from './lib/site.mjs';

// 追加されたファイルの一覧から、日本語の記事だけを選ぶ
export function pickNewPosts(files) {
  return files.filter((f) => /^posts\/[^/]+\.md$/.test(f));
}

// Discord に送る本文。メンションは無効にする（記事の題名に @everyone などがあっても通知しない）
export function buildMessage(posts, pageUrl, siteTitle) {
  const base = pageUrl.endsWith('/') ? pageUrl : pageUrl + '/';
  const lines = posts.map((p) => `新しい記事：${p.title}\n${base}posts/${p.slug}/`);
  return { content: `[${siteTitle}] ${lines.join('\n\n')}`, allowed_mentions: { parse: [] } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const webhook = process.env.DISCORD_WEBHOOK_URL ?? '';
  const pageUrl = process.env.PAGE_URL ?? '';
  const files = execSync('git diff --name-only --diff-filter=A HEAD~1 HEAD', { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const posts = [];
  for (const f of pickNewPosts(files)) {
    const p = parsePost(path.basename(f), await readFile(path.join(root, f), 'utf8'));
    if (!p.draft) posts.push(p);
  }
  if (!posts.length) {
    console.log('新しい記事はないので、通知しません');
  } else if (!webhook || !pageUrl) {
    console.log(`新しい記事 ${posts.length} 件。DISCORD_WEBHOOK_URL か PAGE_URL がないので、通知しません`);
  } else {
    const { siteTitle } = JSON.parse(await readFile(path.join(root, 'site.json'), 'utf8'));
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMessage(posts, pageUrl, siteTitle)),
    });
    if (res.ok) console.log(`Discord に通知しました（${posts.length} 件）`);
    else console.log(`::warning::Discord への通知に失敗しました（HTTP ${res.status}）`);
  }
}
