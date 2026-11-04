// 手元での確認用: 下書きを含めてビルドし、http://localhost:8080/ で表示する
// 環境変数 HOST で受け付けるアドレスを変えられる（既定は 127.0.0.1。スマホから Tailscale で見るときに使う）
// --review <ファイル> を付けると、記事のページに OK / NG とコメントの欄を出し、そのファイル（JSON）に保存する（lib/preview.mjs）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './lib/site.mjs';
import { createPreviewServer, previewHost } from './lib/preview.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, 'dist');
const port = Number(process.env.PORT ?? 8080);
const i = process.argv.indexOf('--review');
const reviewFile = i >= 0 && process.argv[i + 1] ? path.resolve(root, process.argv[i + 1]) : null;

await buildSite({ root, outDir, base: '/', includeDrafts: true, origin: `http://localhost:${port}` });

const host = previewHost();
createPreviewServer({ outDir, reviewFile }).listen(port, host, () => {
  console.log(`http://${host === '127.0.0.1' ? 'localhost' : host}:${port}/ で表示中（Ctrl+C で終了）`);
  if (reviewFile) console.log(`記事の確認欄の保存先：${reviewFile}`);
});
