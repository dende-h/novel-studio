# 仕様レビュー
review_mode: independent
host: Codex collaboration /root/spec_review
基準: /home/dende/.agents/skills/linear-spec/references/spec-adversary.md

## Round 1
verdict: PASS（blocker 0 / major 0 / minor 1）
- [minor] A-1 prototype.html#通常表示：集中終了後の通常ツールバーの配置が確認しにくい。
  対応：既存の話タイトル・記法・検索・用語集の並びを通常状態に追加。全画面と保存欄を通常のツールバーから除外し、集中/追従の2操作を残した。
- 追加点検：全画面の対象をdocument.documentElementに明記し、既存portalの通知とダイアログを保持する。
確認範囲：source/requirements/design/prototype、PC/スマホ画像の目視、CLAUDE、CODEMAP、App、AppShell、TopAppBar、EditorPane、caretCoordinates、useLocalFlag、useKeyboardInset、editorStore。
撮影失敗はセレクタとevalを修正して両画面を再撮影済み。失敗画像は除去。HTMLはChromiumでJSエラー0・参照画像読込を確認。
