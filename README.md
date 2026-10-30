# claude-lab

Claude Code と一緒に、いろいろ試して育てていく実験の記録です。

`posts/` の Markdown を、自作の小さな変換スクリプト（外部依存なし）で HTML にして、GitHub Pages で公開しています。

```bash
npm test          # テスト
npm run build     # dist/ に出力（下書きは除く）
npm run preview   # 下書きを含めてビルドし、http://localhost:8080/ で表示
```

記事は `posts/YYYY-MM-DD-スラッグ.md` に置き、先頭に `title`（必須）、`summary`、`draft: true`（下書き）を書きます。
