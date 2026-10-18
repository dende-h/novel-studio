Linear COT-31「テキストの取り込み（.txt を読み込んで話に分ける）」を実装してください。

## 読むもの（この順で）
1. `docs/specs/COT-31/spec.md` — 仕様（正本）
2. `docs/specs/COT-31/design.md` — 変更ファイル・関数シグネチャ・テスト計画の詳細
3. `docs/specs/COT-31/requirements.md` — 受け入れ条件の全文（Given/When/Then）
4. `docs/specs/COT-31/prototype.html` と `docs/specs/COT-31/screens/` — 画面の完成イメージ（公開版: https://claude.ai/artifact/BodvdMcJTZYYTCYM54uLKT ）
5. `docs/CODEMAP.md` — §1 の「取り込み」「作品一覧」周辺と §3 共通部品カタログだけ
6. `CLAUDE.md` — 「破ってはいけない規約」「後方互換性」

## 作業範囲
変更するファイル:
- 新規 `src/core/importer/{text,split,build,index}.ts` と `*.test.ts`
- 新規 `src/ui/components/TextImportDialog/{text-import-dialog,source-pane,preview-pane}.tsx`、`use-text-import.ts`、`text-import-dialog.test.tsx`
- 変更 `src/ui/components/Library/library.tsx`（データ管理メニューに「テキストから作品を作る」・state・`<TextImportDialog>` の配線）
- 新規 `e2e/text-import.spec.ts`
- 変更 `docs/requirement/99-open-questions.md`（「外部からのインポート」を解決済みに）、`docs/CODEMAP.md`、必要なら `src/ui/components/HelpPage/` に1行

変更しないもの:
- `src/core/schema/`（スキーマ差分なし）、`src/ui/components/ImportDialog/`（JSON 取り込みは据え置き）、`src/ui/components/ui/`（shadcn コピー品）、`functions/`、同期・バックアップ・publish・MCP のコード
- 新しい依存は足さない（`TextDecoder`／`TextEncoder` は標準 API）

## 進め方
1. `src/core/importer/` をテストから書く。design.md「ロジック・API」のシグネチャどおりに `text.ts`（復号・正規化・JSON サイズ）→ `split.ts`（見出し／区切り判定・分割・`applyEdits`）→ `build.ts`（`Work` 組み立て）の順。requirements FR-1／FR-3／FR-5／FR-7 の受け入れ条件を1件ずつテストケースにする。Shift_JIS は固定バイト列（例 `[0x82,0xa0,...]`）、失敗ケースは PNG ヘッダ 16 バイトと NUL 入り UTF-8。
2. `TextImportDialog` を組む。状態は `use-text-import.ts` に集め、プレビューは `useMemo` で導出。`useIsNarrow()` で desktop 2ペイン／モバイル 2ステップを切り替える。使う部品は design.md の「使う共通部品」どおり（ラジオは `TitlePromptDialog` と同じ素の `<input type="radio">`、タブは作らず `aria-pressed` トグル）。
3. `library.tsx` の「データ管理」メニューに項目を足し（「バックアップを取り込み」の直後・`DataMenuItem` のラベルのみ）、`onCreate={(w) => store.importWorks([w])}`・`onWrite={handleWrite}` を配線する。
4. integration テストと e2e を書く（design.md「テスト計画」）。
5. `.claude/skills/toc-copy/SKILL.md` を読んで画面文言を整える。spec.md に書いた文言を既定とし、変える場合は理由をコミットメッセージに書く。
6. 完了後 `.claude/skills/codemap-update/SKILL.md` を読んで `docs/CODEMAP.md` を更新する（§1 索引・§2 `importer/`・§3 `TextImportDialog/`）。

## 完了条件
- [ ] FR-1〜FR-7 の受け入れ条件が unit／integration／e2e のいずれかで固定されている（対応表を PR 説明に書く）
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` が通る
- [ ] `pnpm test:e2e` で `e2e/text-import.spec.ts` が通る
- [ ] ゲスト（`VITE_CLERK_PUBLISHABLE_KEY=` で起動）で、Shift_JIS・CRLF・BOM 付きの .txt を実際に取り込み、執筆画面で本文が崩れていないことを手で確認した
- [ ] プロトタイプと見比べて desktop／mobile の配置・文言に差分がない（差分があれば理由を PR に書く）
- [ ] `docs/CODEMAP.md` と `docs/requirement/99-open-questions.md` が追従している

## 守る規約
- `src/core/` は React と `src/ui/` を import しない
- スキーマは触らない。作る Work は既存 `WorkSchema` の範囲で、`repo.saveWork` の `WorkSchema.parse` を通す
- 既存作品を書き換えない・消さない。取り込みが失敗しても既存データに影響させない（CLAUDE.md「後方互換性」）
- 利用者の文章を暗黙に捨てない（先頭の見出しより前の本文も1話として残す）
- 作成時に `workJsonBytes(work) > MAX_WORK_JSON_BYTES` なら保存しない（同期の 25MB 上限はここで守る。クライアントに 413 の個別処理は無い）
- 状態管理ライブラリは使わない。トーストは使わず結果はダイアログ内に出す（既存 ImportDialog と同じ）
- 文言は spec.md の一覧を既定にし、toc-copy の型（ボタンは動詞で言い切る・エラーは事実＋次の一歩）に従う

## やらないこと
既存作品への追加取り込み／脚本形式／ファイルの並べ替え UI／`.md` など `.txt` 以外の受け付け／EUC-JP・UTF-16／なろう式傍点 `｜字《・》` の傍点化／前書き・後書きの分離／`ImportDialog` の改修
