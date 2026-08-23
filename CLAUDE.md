# novel-studio

ローカルファーストの小説執筆ツール（Vite + React 19 + Cloudflare Pages Functions）。

## コード調査

**コードを調べる前に `docs/CODEMAP.md` を読む。** リポジトリ全体の地図で、
「何をどこで直すか」がそこに索引化してある。全文検索やディレクトリ探索より先に使う。
**UI 部品・フック・ヘルパを新規に作る前も**、同ファイルの「共通部品カタログ」で在庫を確認する。

## 実装・修正のあと

**`/codemap-update` スキルを実行して `docs/CODEMAP.md` を追従させる。**
ファイル構成・export・API・ルート・マイグレーション・コマンドのいずれかが変わったら必須。
中身だけの変更（バグ修正・スタイル）なら、スキルが「更新不要」と判断して終わる。

## 破ってはいけない規約

- `src/core/` は `src/ui/` と React を import しない（純TS・テストの主戦場）
- 状態管理ライブラリ（Redux/Zustand）は使わない — 自前 `useSyncExternalStore` ストア
- `src/ui/components/ui/` は shadcn/ui のコピー品。lint 対象外で、手を入れない
- 新しい依存を足す前に「コピーして所有できないか」を検討する

## コマンド

`pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test:e2e`
（CI はこの順に全部通す。push 前に最低限 typecheck と test）
