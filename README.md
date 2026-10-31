# claude-lab

Claude Code と一緒に、いろいろ試して育てていく実験の記録です。

`posts/` の Markdown を、自作の小さな変換スクリプト（外部依存なし）で HTML にして、GitHub Pages で公開しています。

```bash
npm test          # テスト
npm run build     # dist/ に出力（下書きは除く）
npm run preview   # 下書きを含めてビルドし、http://localhost:8080/ で表示
```

記事は `posts/YYYY-MM-DD-スラッグ.md` に置き、先頭に `title`（必須）、`summary`、`tags`（カンマ区切り。例：`tags: Claude Code, hooks`）、`draft: true`（下書き）を書きます。タグは記事ページと一覧に表示されます。

英語版は `posts/en/` に同じファイル名で置くと、`/en/` の下に出力され、日本語版と英語版の記事どうしがリンクされます。
