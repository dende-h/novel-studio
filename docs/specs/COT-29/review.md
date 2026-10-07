# 敵対的レビュー — COT-29
review_mode: independent
host: Codex collaboration / spec_review
基準: /home/dende/.agents/skills/linear-spec/references/spec-adversary.md

## Round 1
verdict: FAIL（blocker 0 / major 2）
- [major] A-1 履歴append成功→本文保存失敗時に、次の自動保存で置換前履歴が集約される。
  対応: append成功直後にsnapshotsとappendNextSnapshotを反映。本文保存失敗でも維持。下書き編集→自動保存の回帰テストを設計へ追加。
- [major] A-2 プロトタイプの「この話」が結果一覧と履歴確認を追加し、従来操作を維持する設計と異なる。
  対応: この話は従来どおり件数表示→即時draft適用。結果一覧・確認ダイアログは作品全体だけに限定。
確認範囲: source/requirements/design/prototype、screens4枚（画像目視）、CODEMAP、CLAUDE、editorStore、snapshotRepository、snapshot/index、idbStore、workRepository、sync-service、use-auto-sync、replace-panel、editor-pane、parseNotation、index.css。

## Round 2
verdict: PASS（blocker 0 / major 0）
指摘なし。A-1/A-2は解消。独立レビュアーが保存手順・回帰テスト・FR-6・プロトタイプのタブ分岐/確認を再確認。

## ホスト側の検証
- 現状画面4枚を撮影・画像表示で目視。mobileはメニューから作品/話を作成して撮影。
- Playwrightでprototypeを操作: 3件→1件置換で2件→全件で0件。確認キャンセルで3件保持。mobileの別話結果クリックでパネルを閉じ本文選択。
- この話モードは結果一覧0行、確認なし。作品全体は確認あり。
- 初期/話なし/0件/検索中/置換中/保存失敗/本文変化/無料会員/オフラインを切替。desktop・mobile/darkを目視。JavaScriptエラー0件。
- アプリ本体は変更していないため、アプリのunit/e2e一式は実行していない。上記はモックの動作検証であり、保存や同期の実装検証ではない。

- natural-japaneseのlint: impl-promptは検出なし。specは文長の統計警告1件。要件IDごとの技術仕様の列挙として必要な粒度を保持し、最終通読で重複・禁止語がないことを確認。
