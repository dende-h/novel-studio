Linear COT-43「小説の原稿用紙換算と、公募の書式での書き出し（Word・PDF）」を実装してください。

## 読むもの（この順で）
1. `docs/specs/COT-43/spec.md` — 仕様（正本）
2. `docs/specs/COT-43/design.md` — 変更ファイル・グリッドの式・テスト計画の詳細
3. `docs/specs/COT-43/prototype.html` と `screens/` — 画面の完成イメージ（https://claude.ai/artifact/QUz2s3CNFjszo6L7SM7Y9n）
4. `docs/specs/COT-43/requirements.md` — 受け入れ条件（迷ったらここ）
5. `docs/CODEMAP.md` — 該当節のみ

## 作業範囲
- 変更するファイル: design.md の「変更ファイル」の表のとおり
- 変更しないもの: 脚本の書き出し（`toDocx.ts` の出力のバイト列・`composeScriptSheet` の振る舞い）、`toPlainText.ts`、Zod スキーマ、`src/ui/components/ui/`

## 進め方
1. 最初に、脚本の .docx の全パートを文字列で固定するテストを足す（`toDocx.test.ts`）。それから `docxPackage.ts` へ共通部品を切り出し、テストが通ることを確かめる
2. `src/core/manuscript/` をテストから書く（FR-1 の受け入れ条件、字数 0 で 0 枚、ルビ、参照）
3. `toManuscriptDocx.ts`（グリッドの総当たりテスト・hps が整数）→ `toManuscriptHtml.ts`
4. iOS Safari の実機で、ページ内 iframe の印刷が iframe の中身を印刷するかを確かめる（FR-5）。だめなら iOS では PDF を押せなくして Word へ案内する
5. UI：`sheet-cache` と `WorkRepository`、カード・行・サイドバー・ステータスバー → 書き出しダイアログの「応募原稿」 → 作品情報の梗概 → ヘルプ・MCP の説明文
6. e2e：`e2e/helpers.ts` を作って smoke から移し、`manuscript-export.spec.ts` と mobile のテストを足す
7. 画面の文言は toc-copy スキルで整える
8. 完了後 `/codemap-update` を実行

## 完了条件
- [ ] FR-1〜FR-8 の受け入れ条件がテストで固定されている
- [ ] 脚本の .docx が切り出しの前後で同じ（固定したテストが通る）
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm test:e2e` が通る
- [ ] Word（Microsoft 365）と LibreOffice で警告なく開き、ページ設定の字数・行数が選んだ書式と一致する（手動）
- [ ] プロトタイプと見比べて差分がない（desktop / mobile）

## 守る規約
- `src/core/` は React と `src/ui/` を import しない
- スキーマは変えない（CLAUDE.md「後方互換性」）。`WorkSummary.sheetCount` は保存しない
- 新しい依存を足さない（PDF はブラウザの印刷で出す）
- 自動保存のたびに全作品を流し込まない（`sheet-cache` を通す）

## やらないこと
- 横書き、応募者情報の入力、.txt の応募原稿、判型 PDF（COT-55）、PDF のファイルとしての直接生成
