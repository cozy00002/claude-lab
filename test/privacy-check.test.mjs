import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkText, checkFiles, parseWords, mask } from '../lib/privacy-check.mjs';

// このファイルも公開されるので、検出対象の文字列はそのまま書かず、実行時に組み立てる
const j = (...parts) => parts.join('');
const kinds = (text, opt) => checkText(text, opt).map((f) => f.kind);

test('ローカルのパスを見つける', () => {
  assert.deepEqual(kinds(j('C:', '\\Users\\', 'taro\\work')), ['ローカルのパス（Windows）']);
  assert.deepEqual(kinds(j('cd /c/', 'Users/', 'taro/dev')), ['ローカルのパス（Git Bash / WSL）']);
  assert.deepEqual(kinds(j('see /', 'home/', 'taro/.config')), ['ローカルのパス（macOS / Linux）']);
});

test('相対パスや一般的なパスは見逃す', () => {
  assert.deepEqual(kinds('.claude/settings.json と blog/lib/site.mjs と /usr/bin/node'), []);
});

test('メールアドレス：個人のものは見つけ、noreply と例示用は見逃す', () => {
  assert.deepEqual(kinds(j('taro', '@', 'mail.test.jp')), ['メールアドレス']);
  assert.deepEqual(kinds(j('1234+taro', '@', 'users.noreply.github.com')), []);
  assert.deepEqual(kinds(j('noreply', '@', 'anthropic.com')), []);
  assert.deepEqual(kinds(j('someone', '@', 'example.com')), []);
});

test('グローバル IP を見つけ、プライベート・説明用・バージョン番号は見逃す', () => {
  // 検出される例も、このファイルにそのまま書かない
  assert.deepEqual(kinds(j('接続元は ', '8.8', '.4.4', ' でした')), ['グローバル IP']);
  assert.deepEqual(kinds(j('(', '1.1', '.1.1)')), ['グローバル IP']);
  assert.deepEqual(kinds(j('http://', '93.184', '.216.34', ':8080/')), ['グローバル IP']);
  for (const safe of [
    '127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.1.1', '100.64.0.1',
    '192.0.2.1', '198.51.100.7', '203.0.113.5', '255.255.255.255', '224.0.0.1',
    'v1.2.3.4', 'node@20.11.1.0', 'Version 1.2.3.4.5', '999.1.1.1', 'build-1.2.3.4', '1.2.3.4-beta',
  ]) assert.deepEqual(kinds(safe), [], safe);
  assert.deepEqual(kinds(j('172.', '32.0.1')), ['グローバル IP'], 'プライベートの範囲の外');
});

test('機密情報らしきものを見つける', () => {
  const cases = [
    [j('gh', 'p_', 'a'.repeat(36)), 'GitHub のトークン'],
    [j('AK', 'IA', 'ABCDEFGHIJKLMNOP'), 'AWS のアクセスキー'],
    [j('Account', 'Key=', 'A'.repeat(40)), 'Azure の接続文字列・SAS'],
    [j('-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----'), '秘密鍵'],
    [j('https://discord.com/api/', 'webhooks/', '123456/abcDEF_-x'), 'Discord の Webhook の URL'],
    [j('xo', 'xb-', '1234567890-abc'), 'Slack のトークン・Webhook'],
    [j('ey', 'J', 'a'.repeat(12), '.ey', 'J', 'b'.repeat(12), '.', 'c'.repeat(12)), 'JWT'],
  ];
  for (const [text, kind] of cases) assert.deepEqual(kinds(text), [kind], kind);
});

test('固有の言葉は大文字小文字を区別せずに見つける', () => {
  const f = checkText('1 行目\nこれは SampleRepo の話', { words: ['samplerepo'] });
  assert.deepEqual(f, [{ line: 2, kind: '固有の言葉（単語の一覧）', match: 'samplerepo' }]);
});

test('単語の一覧：改行・カンマ区切り、コメント、短すぎる語', () => {
  assert.deepEqual(parseWords('alpha, beta\n# コメント\ngamma # 後ろのコメント\nab\n'), {
    words: ['alpha', 'beta', 'gamma'],
    skipped: ['ab'],
  });
  assert.deepEqual(parseWords(undefined), { words: [], skipped: [] });
});

test('報告では一部を伏せる', () => {
  assert.equal(mask('abcdefghij'), 'abcd****ij');
  assert.equal(mask('abc'), 'a**');
});

test('このブログのファイル一式（自分自身を含む）に、一般的なパターンの検出がない', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.deepEqual(await checkFiles(root), []);
});
