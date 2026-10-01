Linear COT-6「脚本モード機能の追加」を実装してください。実装先の子 issue は COT-9。

## 読むもの（この順で）
1. `docs/specs/COT-6/spec.md` — 仕様（正本・これに従う）
2. `docs/specs/COT-6/design.md` — 変更ファイルの `path:line`・判別ロジックの擬似コード・テスト計画の詳細
3. `docs/specs/COT-6/prototype.html` と `screens/` — 画面の完成イメージ（https://claude.ai/artifact/VwhcDYmaEEiJ5KZsobEnCc）
4. `docs/CODEMAP.md` — §1 の該当行と §3「共通部品カタログ」
5. `CLAUDE.md` の「後方互換性」節

## 作業範囲
- 変更・新規するファイルは spec.md「実装の骨格」の表のとおり。表に無いファイルを触る必要が出たら、その理由を最後に報告する
- 変更しないもの：`src/core/parser/`・`src/core/game/`（演出譜）・`src/core/folder/`・`src/core/sync/`・`src/ui/components/ui/`（shadcn コピー）・`blocksToPlainText` の本文出力

## 進め方
1. `src/core/schema/index.ts` に `format` を足し、`WorkSchema.parse` のテスト（無し／`'script'`／不正値）を先に書く
2. `src/core/script/index.test.ts` を spec.md FR-2 の判別表と例で先に書き、`src/core/script/index.ts` を通す（`plainTextOfBlock` は `src/core/game/index.ts` から import）
3. `blocksToHtml` に `opts` を足す前に、「opts 無し＝`{script:false}` の文字列一致」と「脚本の例文を小説形式で通して `sc-` を含まない」のテストを `toHtml.test.ts` に足す。既存の入力（`'　それはまるで'` 等）を流用
4. EPUB・なろう・カクヨム・`workToPlainText` のメタ行 → `exporters.ts` の配線
5. UI：`WorkMetaDialog` → `editorStore.updateWorkMeta`（`'novel'` でキー削除）→ `workRepository` の summary → ライブラリのバッジ → `App.tsx` の記法ボタンと `previewHtml` → `EditorPane`（`scriptMode` prop・`applyNotation` の 2 分岐・`NotationBar` の items）→ `index.css` → ヘルプ
6. `publish.ts`：`SCHEMA_VERSION_WITH_FORMAT = 7`・`BundleWork` の `Omit` に `'format'`・`toBundleWork` で分割代入・`schemaVersion`・409 案内（`bundleWork.format && supported < 7` を先頭に）。`publish.test.ts:700` 付近の `supported` フィクスチャを流用
7. MCP：`setWorkMeta` の `format` → `mcp-server.ts` の inputSchema・`listWorksText`・`get_work`・`set_episode` の説明文
8. `docs/requirement/02-notation-and-format.md` に「脚本形式」節、`e2e/smoke.spec.ts` に回帰 1 本
9. 画面の文言（ⓘ本文・ヘルプ・409 案内・バッジ）は spec.md の文をそのまま使い、足りない文は `toc-copy` スキルで整える
10. 完了後 `/codemap-update` を実行（`src/core/script/` が増えるので §1・§2 に行が要る）

## 完了条件
- [ ] FR-1〜FR-9 の受け入れ条件（`requirements.md`）がテストで固定されている。特に「小説の作品の出力が不変」
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` が通る
- [ ] `pnpm test:e2e` の追加ケースが通る
- [ ] プロトタイプと見比べて ①〜⑧ に差分がない（PC・スマホ幅）
- [ ] `docs/CODEMAP.md` が更新されている

## 守る規約
- `src/core/` は React と `src/ui/` を import しない
- スキーマは optional で足す。既存欄を消さない・必須化しない
- `updateWorkMeta`・`setWorkMeta` は渡した項目だけ書き換える
- 新しい依存を足さない。`src/ui/components/ui/` を編集しない（ラジオは素の `<input type="radio">`）
- v7 送信は grove（novel-platform）の v7 対応が先。**この PR は stg まで**。main へのマージは grove 側のリリース後に判断する

## やらないこと
- 演出譜（`classifyBlock`）の話者判別の変更 → 後続 issue を COT-6 の子として切る
- 話ごとの形式切替・Block への種類保存・原稿用紙風レイアウト
- `＊` 行以外の既存記法の変更
