import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNewPosts, buildMessage } from '../notify-discord.mjs';

test('通知の対象は日本語の記事だけ（英語版・ほかのファイルは除く）', () => {
  assert.deepEqual(
    pickNewPosts(['posts/2026-11-01-a.md', 'posts/en/2026-11-01-a.md', 'lib/site.mjs', 'posts/README.txt', 'README.md']),
    ['posts/2026-11-01-a.md'],
  );
});

test('本文：サイト名・題名・記事の URL。メンションは無効', () => {
  const msg = buildMessage([{ slug: 'a', title: '題名 @everyone' }], 'https://example.github.io/claude-lab', 'claude-lab');
  assert.equal(msg.content, '[claude-lab] 新しい記事：題名 @everyone\nhttps://example.github.io/claude-lab/posts/a/');
  assert.deepEqual(msg.allowed_mentions, { parse: [] });
});

test('本文：複数の記事は空行で区切る', () => {
  const msg = buildMessage([{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }], 'https://example.github.io/x/', 'x');
  assert.equal(msg.content, '[x] 新しい記事：A\nhttps://example.github.io/x/posts/a/\n\n新しい記事：B\nhttps://example.github.io/x/posts/b/');
});
