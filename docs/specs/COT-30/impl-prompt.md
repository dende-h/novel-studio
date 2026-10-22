Linear COT-30「小説の推敲チェック（表記ゆれと原稿の作法）」を実装してください。

## 読むもの（この順で）
1. `docs/specs/COT-30/spec.md` — 仕様（正本）
2. `docs/specs/COT-30/design.md` — 変更ファイル・辞書の正規表現・テスト計画の詳細（「表記ゆれ辞書（初版）」の表はそのまま実装する）
3. `docs/specs/COT-30/prototype.html` と `screens/` — 画面の完成イメージ（https://claude.ai/artifact/5J3y2BLPxT8YjTskosUxm3）
4. `docs/CODEMAP.md` — §1「脚本形式…書式チェック」の行と §2 `script/`、§3 共通部品カタログ
5. 既存の流用元：`src/core/script/proofread.ts`・`src/core/script/proofread.test.ts`・`src/ui/components/EditorPane/editor-pane.tsx` の `notices` と `<details>` 部分

## 作業範囲
変更するファイル:
- 新規 `src/core/proofread/{types,rules,variants,index}.ts` と各 `*.test.ts`
- 新規 `src/ui/hooks/use-proofread-prefs.ts`（＋テスト）
- 新規 `src/ui/components/EditorPane/proofread-panel.tsx`
- 変更 `src/ui/components/EditorPane/editor-pane.tsx`・`editor-pane.test.tsx`・`src/ui/App.tsx`・`src/ui/components/HelpPage/help-page.tsx`・`docs/CODEMAP.md`

変更しないもの:
- `src/core/schema/`（データモデルは変えない）、`src/core/script/proofread.ts`、`src/ui/components/ui/`（shadcn コピー）、同期・バックアップ・publish・MCP・`functions/`
- 脚本モードの書式チェックの文言・挙動（部品に切り出すだけ。既存テストが通ること）
- `tools/novel-textlint/`（参照するだけ。フィクスチャをテストから `readFileSync` で読む）

## 進め方
1. `src/core/proofread/rules.test.ts` から書く。spec.md FR-2 の当たり／外れ例と `tools/novel-textlint/fixtures/novel-{good,bad}.txt` を固定してから `rules.ts` を実装する。
2. `variants.test.ts`：design.md の辞書表の各組について「当たる例」「当たらない例」「取りこぼし（許容）」を置き、数の書き方は助数詞ごとの組と共通 exclude を固定してから `variants.ts` を実装する。
3. `index.ts`：`proofreadNovel`・`countVariantsInBlocks`・`createVariantCountCache`。「同じ `Episode` 参照には再計算しない」をスパイで固定する。
4. `use-proofread-prefs.ts`：`use-preferences.ts` と同型。snapshot の `Set` は toggle 時だけ差し替える（毎回 new Set にしない）。壊れた localStorage 値で落ちないテストを置く。
5. `proofread-panel.tsx` に既存の `<details>` を移し、脚本側が今までどおり描けることを既存テストで確認してから、小説側（`toggles` 付き）を足す。`App.tsx` で `variantBase` を渡す。
6. ヘルプに「推敲する」を追加。文言は design.md「UI」節のとおり。`.claude/skills/toc-copy/SKILL.md` を読んでトーンを確認する。
7. 完了後 `.claude/skills/codemap-update/SKILL.md` を読んで CODEMAP を更新する（§1 に「小説の推敲チェック」、§2 に `proofread/`）。

## 完了条件
- [ ] FR-1〜FR-6 の受け入れ条件（`requirements.md`）がテストで固定されている
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` が通る
- [ ] 脚本作品で「脚本の書式チェック」が従来どおり出る（既存テスト緑）
- [ ] プロトタイプと見比べて差分がない（desktop / mobile）。候補あり・0 件・項目オフの 3 状態
- [ ] `docs/CODEMAP.md` が更新されている

## 守る規約
- `src/core/` は React と `src/ui/` を import しない
- 新しい npm 依存を足さない（textlint 本体は載せない）
- スキーマは変えない。設定は localStorage `ns-proofread-off` のみ（CLAUDE.md「後方互換性」）
- 本文を書き換えない。候補は保存・書き出し・公開を止めない
- 画面文言は spec.md／design.md のものを使う。変えるときは `toc-copy` スキルの作法に合わせる
- 正規表現を design.md から変えるときは、変えた理由と当たり／外れ例をテストに残す
