Linear COT-65「投稿サイトのバックアップ ZIP を取り込み、全話をまとめて書き出す（なろう・カクヨム・ノベルアップ+）」を実装してください。

## 読むもの（この順で）
1. `docs/specs/COT-65/spec.md` — 仕様（正本）
2. `docs/specs/COT-65/samples.md` — 実物の ZIP で確かめた形（フィクスチャはこれを写す）
3. `docs/specs/COT-65/design.md` — 変更ファイル・型・ロジック・テスト計画の詳細
4. `docs/specs/COT-65/prototype.html` と `screens/` — 画面の完成イメージ（https://claude.ai/artifact/24J7DSAagnLAhcLY4Zyp5Q）
5. `docs/specs/COT-65/requirements.md` — 受け入れ条件（迷ったらここ）
6. `docs/CODEMAP.md` — 取り込み・書き出しの節のみ

## 作業範囲
- 変更するファイル: design.md の「変更ファイル」の表のとおり
- 変更しないもの: Zod スキーマ、.txt と貼り付けの分け方と題名（COT-31）、既存の書き出し（EPUB・docx・サウンドノベル・フォルダ）の出力、`src/ui/components/ui/`
- ノベルアップ+ の見分けは作らない（実物が届いてから）

## 進め方
1. `src/core/zip/unzip.ts` を移してテストから（`src/ui/proofread/unzip.ts` は再 export。辞書の展開が動くことを確かめる）
2. 文字コードの判定（JIS・EUC-JP）をテストから。既存の UTF-8・Shift_JIS の判定が変わらないことを先に固定する
3. `samples.md` の構造で架空の文のフィクスチャを作り、`sites/kakuyomu.ts` `sites/narou.ts` をテストから。なろうは許可リストの見出しだけを読む
4. `archive.ts` `meta.ts` `build.ts` `split.ts`
5. `toPostingSite.ts` と往復のテスト
6. UI：取り込みダイアログ（`addFiles` は `Promise.all` でまとめて判定）→ 書き出しの範囲 → ネタ帳の配線 → ヘルプ
7. 画面の文言は toc-copy スキルで整える
8. 完了後 `/codemap-update` を実行

## 完了条件
- [ ] FR-1〜FR-10 の受け入れ条件がテストで固定されている（FR-4 を除く）
- [ ] なろうのユーザID・評価・収益・リアクションの文字列が、作品にもネタ帳にも入らないテストがある
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm test:e2e` が通る
- [ ] 作者の手元の実物の ZIP（カクヨム章あり・なし、なろう章2・1・0）で取り込めることを手動で確かめる（実物はリポジトリに入れない）
- [ ] プロトタイプと見比べて差分がない（desktop / mobile）

## 守る規約
- `src/core/` は React と `src/ui/` を import しない
- スキーマは変えない（CLAUDE.md「後方互換性」）
- 新しい依存を足さない（ZIP・文字コードは自前と `TextDecoder`）
- 利用者の文章を黙って捨てない（入りきらないものはネタ帳、前書き・後書きを外すのは利用者が選んだときだけ）

## やらないこと
- 記法の変換（COT-48）、ほかのサイトの記法での書き出し（COT-47）、既存の作品への追記、感想・画像の取り込み、Shift_JIS の書き出し
