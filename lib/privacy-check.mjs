// 公開前チェック：公開するファイルに、個人情報・ローカルの情報・機密情報らしきものがないかを調べる。
// 一般的なパターンはここに書く。本人の名前など「その人固有の言葉」は、このファイル（公開される）には書かず、
// 環境変数 PRIVACY_WORDS か、公開用に含めない単語ファイルから渡す。
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const RULES = [
  { kind: 'ローカルのパス（Windows）', re: /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"`]+/gi },
  { kind: 'ローカルのパス（Git Bash / WSL）', re: /\/(?:[a-z]|mnt\/[a-z])\/Users\/[^/\s'"`]+/gi },
  { kind: 'ローカルのパス（macOS / Linux）', re: /(?:^|[\s'"`(])\/(?:Users|home)\/[A-Za-z0-9._-]+\//gm },
  { kind: 'GitHub のトークン', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: 'AWS のアクセスキー', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'Azure の接続文字列・SAS', re: /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/=]{20,}|[?&]sig=[A-Za-z0-9%+/=]{20,}/g },
  { kind: '秘密鍵', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g },
  { kind: 'Discord の Webhook の URL', re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/gi },
  { kind: 'Slack のトークン・Webhook', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}|https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 公開してよいメールアドレス（noreply や例示用のドメイン）
const SAFE_EMAIL = /@(?:users\.noreply\.github\.com|noreply\.github\.com|anthropic\.com|example\.(?:com|org|net)|[\w-]+\.example)$/i;

const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.ts', '.json', '.css', '.html', '.yml', '.yaml', '.txt', '.svg', '.xml', '']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** 単語の一覧（改行かカンマ区切り。# 以降はコメント）を読む。短すぎる語は誤検出が多いので除く。 */
export function parseWords(text) {
  const words = [];
  const skipped = [];
  for (const raw of (text ?? '').split(/[\n,]/)) {
    const w = raw.replace(/#.*$/, '').trim();
    if (!w) continue;
    (w.length >= 3 ? words : skipped).push(w);
  }
  return { words, skipped };
}

/** 見つかった文字列を、報告用に一部だけ伏せる（ログに全部を出さないため）。 */
export function mask(s) {
  if (s.length <= 6) return s[0] + '*'.repeat(s.length - 1);
  return s.slice(0, 4) + '*'.repeat(Math.min(s.length - 6, 12)) + s.slice(-2);
}

export function checkText(text, { words = [] } = {}) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const lowerWords = words.map((w) => w.toLowerCase());

  lines.forEach((line, i) => {
    const add = (kind, match) => findings.push({ line: i + 1, kind, match });
    for (const { kind, re } of RULES) {
      for (const m of line.matchAll(re)) add(kind, m[0].trim());
    }
    for (const m of line.matchAll(EMAIL)) {
      if (!SAFE_EMAIL.test(m[0])) add('メールアドレス', m[0]);
    }
    const lower = line.toLowerCase();
    lowerWords.forEach((w, k) => {
      if (lower.includes(w)) add('固有の言葉（単語の一覧）', words[k]);
    });
  });
  return findings;
}

export async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name));
      } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
        out.push(path.join(dir, e.name));
      }
    }
  }
  await walk(root);
  return out.sort();
}

export async function checkFiles(root, options) {
  const results = [];
  for (const file of await listFiles(root)) {
    const findings = checkText(await readFile(file, 'utf8'), options);
    for (const f of findings) results.push({ file: path.relative(root, file).replaceAll('\\', '/'), ...f });
  }
  return results;
}
