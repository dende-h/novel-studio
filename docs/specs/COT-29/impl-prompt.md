Linear COT-29「作品全体の検索・置換（全話をまたいで探して直す）」を実装してください。

## 読むもの（この順で）
1. `CLAUDE.md` と適用される `AGENTS.md` — 規約
2. `docs/specs/COT-29/spec.md` — 仕様の正本
3. `docs/specs/COT-29/requirements.md` — FR-1〜7の受け入れ条件
4. `docs/specs/COT-29/design.md` — 変更ファイル・保存手順・テスト計画
5. `docs/specs/COT-29/prototype.html` と `screens/` — PC/mobileのイメージ（ローカル）
6. `docs/specs/COT-29/review.md` — 解消済みの保存失敗/履歴集約の指摘
7. `docs/CODEMAP.md` — editorStore・共通部品・永続化・同期の節

## 作業範囲
- 新規: `src/core/search/workSearch.ts`, `src/core/storage/workMutationLock.ts`, `src/ui/components/WorkSearchPanel/work-search-panel.tsx` とそれぞれのテスト、`e2e/work-search.spec.ts`。
- 変更: `src/ui/store/editorStore.ts`, `src/core/storage/idbStore.ts`, `src/ui/sync/sync-service.ts`, `src/ui/Root.tsx`, `src/ui/App.tsx`, `src/ui/components/EditorPane/replace-panel.tsx`, `src/ui/components/EditorPane/editor-pane.tsx` と関連テスト、`docs/CODEMAP.md`。
- 保存スキーマ・外部API・publishバージョン・MCP・shadcnコピー部品は変更しない。
- 設計にある新規関数/型は提案であり、既存実装と誤認しない。まず実際のコードを再確認する。

## 進め方
1. coreの検索・1件/全件置換を受け入れ条件に沿ってテストから作る。
2. 保存競合と履歴保護を先に固定する。遅延Promise・失敗注入で、自動保存/用語集更新/同期と置換の順序を検証する。
3. 共通排他と作品操作キューを導入。キュー/ロックの再入でデッドロックしないよう内部処理と公開操作を分ける。同期の受信・ゴミ箱・復元・削除にも適用する。
4. 置換前履歴append成功直後に保護を設定。本文put成功と補助処理成功を区別し、transaction abortを成功としない。本文保存失敗後の自動保存でも置換前履歴が残るテストを必ず通す。
5. 検索パネルと結果移動を配線。現在話の下書きを使い、保存後の正規化に合わせ位置を再計算する。参照内の検索・移動を維持し、参照とその括弧に重なる一致は、この話/全話どちらも置換から除外する。実ブラウザで長文/折り返し/フォント設定の行スクロールを確認する。
6. `.claude/skills/toc-copy/SKILL.md` を読み、文言を揃える。この話モードも結果一覧と個別置換を提供し、個別置換後はパネル・検索語・置換語を保持する。全件置換は従来の即時draft適用と閉じる動作を維持する。
7. PC/393px・ゲスト/無料会員・オフライン・失敗状態を検証し、性能fixtureの計測環境/結果を記録する。
8. `.claude/skills/codemap-update/SKILL.md` を読み、CODEMAPを更新する。利用できなければ新規export・ストア操作・排他を直接追記する。

## 完了条件
- [ ] FR-1〜7の受け入れ条件が適切な層のテストで固定されている。
- [ ] 未保存編集・ルビ/参照・未変更フィールド/block idを保持する。
- [ ] 履歴失敗/本文失敗/abort/補助処理失敗/競合を区別し、本文を重複置換しない。
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` が通る。
- [ ] `pnpm test:e2e` が通り、PC/mobileの一致選択と行スクロールを確認した。
- [ ] 現状スクショ/プロトタイプと見比べ、既存画面のトーンを保っている。
- [ ] CODEMAPが実装を反映し、検証結果と残る制約が報告されている。

## 守る規約
- `src/core/` はReactと`src/ui/`をimportしない。自前ストアを維持する。
- スキーマの既存欄を削除/必須化しない。本件では保存型を変更しない。
- 部分更新で他の欄を落とさない。レコード削除を増やさない。
- ローカル検索のために原稿を外部へ送信しない。同期の既存オプトインを維持する。
- docs/specs/COT-29は仕様成果物として扱い、変更が必要なら要件・設計との整合を保つ。

## やらないこと
- 正規表現/曖昧検索、複数作品検索、本文以外の置換、用語集改名、新しい有料制限/外部API。
- 全話を一度に復元するUI、保存スキーマ変更、検索索引の永続化。
- ユーザーの明示指示なしにcommit/push/公開しない。
