// 使い方: node build.mjs [--drafts] [--base /claude-lab/] [--out dist]
//   --drafts  下書き（draft: true）の記事も出力する（手元での確認用）
//   --base    サイトを置く URL のパス。既定は環境変数 BASE_PATH、なければ "/"
//   --origin  RSS フィードの絶対 URL に使う（例 https://example.github.io）。既定は http://localhost:8080
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './lib/site.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(root, opt('--out') ?? 'dist');
const base = opt('--base') ?? process.env.BASE_PATH ?? '/';
const origin = opt('--origin');
const includeDrafts = args.includes('--drafts');

const { ja, en } = await buildSite({ root, outDir, base, includeDrafts, origin });
console.log(`日本語 ${ja.length} 件、英語 ${en.length} 件の記事を出力しました（base: ${base}${includeDrafts ? '、下書きを含む' : ''}）`);
