Linear COT-62「推敲画面に作品ごとの「例外」と「表記の好み」を足し、選んだ結果から決まりを提案する」を実装してください。

## 読むもの（この順で）

1. `docs/specs/COT-62/spec.md` — 仕様（正本）
2. `docs/specs/COT-62/design.md` — 変更ファイル・データモデル・決まりの当て方・提案の数え方・UI・テスト計画
3. `docs/specs/COT-62/requirements.md` — 受け入れ条件の全文
4. `docs/specs/COT-62/prototype.html` と `screens/` — 画面の完成イメージ（https://claude.ai/artifact/MESp3mnKQwgzkLbPZpuRjx ・非公開）
5. `docs/CODEMAP.md` — 推敲（COT-40）と用語集に無い名前（COT-59）の行、共通部品カタログ
6. `docs/specs/COT-59/design.md` 末尾の実装メモ — 外した語の配線の手本

## 作業範囲

- 変更するファイル：design.md の「変更ファイル」の表のとおり
- 変更しないもの：
  - 作品・話・用語集・推敲の判断（`ProofreadDecisionSchema`）・外した語のスキーマ
  - `src/ui/components/ui/`（shadcn のコピー。`DropdownMenu` はそのまま使う）
  - `variantFindingsForLine` の戻り値の形（配列のまま。位置は新しい `variantSpansForLine` が返す）
  - `samples.json`

## 進め方

1. stg から作業ブランチを切る。作業ツリーをほかのセッションと共有していたら、自分の変更だけをステージする。pnpm はシェルの 9.x ではなく `npx -y pnpm@10.29.3` を使う
2. core から、テストを先に書く
   - `work-rules.ts`（スキーマ・操作・`applyExceptions`・`suggestRule`）
   - `variants.ts`（好み・`variantSpansForLine`・`variantFormOf`）
   - `auto-variant.ts`（好み）
   - `ra-nuki.ts`・`rules.ts`（`rule.key`）
   - `index.ts`（`rules` の受け取りと、好みを当てる前の位置での重なり判定）
3. 保存と配線：`proofreadRulesRepository.ts` を足し、同期・バックアップ・取り込み・Root・store に配線する。COT-59 の `proofread-names:` の配線（design.md の表に行番号あり）を手本にする
4. 画面：
   - `proofread-view.tsx`：見出しのボタンと欄、提案の置き場所（チップと一覧のスクロールの間）、全話の判断の読み込み、FR-7 の言い換え
   - `finding-list.tsx`：カードのボタンと `DropdownMenu`
   - 新規の2部品（`work-rules-panel.tsx`・`rule-suggestion.tsx`）
   - `App.tsx`・`help-page.tsx`
5. 文言は、`.claude/skills/toc-copy/SKILL.md` を読んで整える。design.md の UI 節の文言を出発点にし、「辞書」は使わない
6. 推敲画面は会員の判定があるので、実物の画面の確認は、作業ツリーとは別の一時コピーで行う
   - `src/ui/Root.tsx` の `canUseCreativeTools` を true にし、vite を別ポートで起こす
   - 手順は `docs/specs/COT-59/design.md` の実装メモを参照
7. 終わったら、`.claude/skills/codemap-update/SKILL.md` を読んで `docs/CODEMAP.md` を更新する。実装メモ（NFR-1 の計測値など）を design.md の末尾に足す

## 完了条件

- [ ] FR-1〜FR-7 と NFR-4 の受け入れ条件が、design.md のテスト計画の置き場所でテストに固定されている
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` が通る（Biome は WSL ではネイティブバイナリを直に叩く）
- [ ] `pnpm build` が通る
- [ ] `pnpm test:e2e` が通る（WSL では `--workers=1` で直列に）
- [ ] 実物の画面でプロトタイプと見比べ、差分がない（PC のみ）
- [ ] NFR-1 を手動で測り、値を実装メモに残した

## 守る規約

- `src/core/` は React と `src/ui/` を import しない
- 新しい記録の接頭辞は `proofread-rules:` にする（`proofread:` で始めない）
- 新しい記録の核の欄は必須にし、中の配列は `.optional().default([])` にする
- バックアップの欄は省略できるようにし、壊れた要素は捨てて残りを復元する
- 決まりを消すのは、「戻す」と作品の完全削除のときだけ。推敲の判断の記録は消さない
- 本文は自動で書き換えない
- publish バンドルには出さない。MCP のツールは決まりを読み書きしない
- 新しい npm 依存を足さない

## やらないこと

- 作者の辞書
- 用語集の「作者だけ」の印、読みでルビを振る機能
- 全作品で共有する決まり
- 一括の書き換え
- MCP からの読み書き
- スマホ対応
- main への PR（stg への push は、緑になったら関連ファイルだけで可）
