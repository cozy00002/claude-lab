// 使い方: node check.mjs
//   公開するファイル（このフォルダ配下。dist/ と node_modules/ は除く）を調べ、見つかったら終了コード 1 で終わる。
//   固有の言葉（名前・アカウント名など）は、次のどちらかで渡す。どちらも公開用のリポジトリには入れない。
//     - 環境変数 PRIVACY_WORDS（GitHub Actions では Secret から渡す）
//     - 環境変数 PRIVACY_WORDS_FILE が指すファイル。未指定なら、このフォルダの 1 つ上の .privacy-words.txt
//   CI（環境変数 CI=true）で単語の一覧がないときは、確認漏れを防ぐためにエラーにする。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFiles, parseWords, mask } from './lib/privacy-check.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const wordsFile = process.env.PRIVACY_WORDS_FILE ?? path.join(root, '..', '.privacy-words.txt');

let text = process.env.PRIVACY_WORDS ?? '';
let source = text ? '環境変数 PRIVACY_WORDS' : '';
if (!text) {
  try {
    text = await readFile(wordsFile, 'utf8');
    source = '単語ファイル';
  } catch {
    // ファイルがなければ、一般的なパターンだけで調べる
  }
}
const { words, skipped } = parseWords(text);

if (skipped.length) console.warn(`短すぎる語（3 文字未満）は使いません: ${skipped.length} 件`);
if (!words.length) {
  const msg = '固有の言葉の一覧がありません（一般的なパターンだけで調べます）';
  if (process.env.CI === 'true') {
    console.error(`${msg}。CI では PRIVACY_WORDS の設定が必要です。`);
    process.exit(1);
  }
  console.warn(msg);
}

const results = await checkFiles(root, { words });
if (results.length) {
  console.error(`公開前チェック：${results.length} 件見つかりました`);
  for (const r of results) console.error(`  ${r.file}:${r.line}  ${r.kind}  ${mask(r.match)}`);
  process.exit(1);
}
console.log(`公開前チェック：問題なし（固有の言葉 ${words.length} 語${source ? `、${source}から` : ''}）`);
