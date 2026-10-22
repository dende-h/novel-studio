Linear COT-59「本文の固有名詞を拾って用語集への登録を勧め、解析辞書に今の言葉を足す」を実装してください。

## 読むもの（この順で）

1. `docs/specs/COT-59/spec.md` — 仕様（正本）
2. `docs/specs/COT-59/design.md` — 変更ファイル・データモデル・フォーカスの仕組み・テスト計画・付録 A（架空の名前61個）
3. `docs/specs/COT-59/requirements.md` — 受け入れ条件の全文
4. `docs/specs/COT-59/prototype.html` と `screens/` — 画面の完成イメージ（https://claude.ai/artifact/P1qK7rsF1ADv6eL21sLh1d ・非公開）
5. `docs/CODEMAP.md` — 推敲（COT-40）の行と共通部品カタログだけ
6. `docs/specs/COT-40/design.md` 末尾の実装メモ — 解析器の作りと実測

## 作業範囲

- 変更するファイル：design.md の「変更ファイル」の表のとおり
- 変更しないもの：
  - `src/core/proofread/morph/__fixtures__/samples.json`（今の辞書の出力のまま基準に残す）
  - 用語集・作品・話のスキーマ
  - `src/ui/components/ui/`（shadcn のコピー）
  - 指摘タブの振る舞い

## 進め方

1. stg から作業ブランチを切る。作業ツリーをほかのセッションと共有していたら、自分の変更だけをステージする。pnpm はシェルの 9.x ではなく `npx -y pnpm@10.29.3` を使う
2. **辞書を先に作る**
   - `src/core/proofread/morph/dict-supplement.ts` とテストを書く
   - `scripts/build-dict.mjs` を書いて手元で回し、zip とハッシュを得る
   - 実装の最初に、今の辞書で `fictional-names.json` の61個を数えて基準の数を固定する（試作では55）
   - 次を node テストで確かめる：FR-1 の文が1語になる、`samples.json` と区切りが一致する、61個の数が基準以上、zip が 13MB 以下
3. **GitHub Release に zip を上げる前に、必ずユーザーの了承を得る**（公開リポジトリへの外向きの操作）
   - 了承を得たら、`fetch-dict.mjs` の URL とハッシュを替える
   - あわせて、ファイル名を4か所でそろえる（`protocol.ts`・`fetch-dict.mjs`・`gen-morph-fixtures.mjs`・`analyzer.node.test.ts`）
4. `gen-morph-fixtures.mjs --names` で `names.json` を作る。`name-candidates.ts` は、requirements.md の FR-2 の受け入れ条件をテストに先に書いてから作る
5. 外した語の core・リポジトリ・バックアップ・同期を、テストから書いて配線する。`ProofreadRepository` と `sync-service.ts` の `proofread` の扱いを手本にする
6. 画面を作る：欄・`proofread-view.tsx`・App の `quickCreate`・`GlossaryEntryForm` の `onCloseAutoFocus`。フォーカスの仕組みは design.md の UI 節「フォーカス」のとおりにする（handler は常に同じものを渡し、resolve の ref で働かせる）
7. 文言は、`.claude/skills/toc-copy/SKILL.md` を読んで整える。design.md の UI 節の文言を出発点にする
8. 終わったら、`.claude/skills/codemap-update/SKILL.md` を読んで `docs/CODEMAP.md` を更新する。`docs/requirement/03-architecture.md` の辞書の節も直す。実装メモ（実測の時間とメモリ）を design.md の末尾に足す

## 完了条件

- [ ] FR-1〜FR-5 と NFR-4 の受け入れ条件が、design.md のテスト計画の置き場所でテストに固定されている
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` が通る（Biome は WSL ではネイティブバイナリを直に叩く）
- [ ] `pnpm build` が通り、`scripts/check-precache.mjs` で辞書と wasm がプリキャッシュに無い
- [ ] `pnpm test:e2e` が通る（ヘルプのリンクを足したもの）
- [ ] プロトタイプと見比べて差分がない（PC のみ）
- [ ] 手動：30万字の作品で、候補づくりが足す時間（200ms 以内）とメモリを測った。古い辞書のキャッシュが `ns-dict-v1` から消えた

## 守る規約

- `src/core/` は React と `src/ui/` を import しない。`dict-supplement.ts` は import を持たない（`build-dict.mjs` が Node の型除去で読む）
- 新しいレコードの接頭辞は `proofread-names:` にする（`proofread:` で始めない）
- 新しいレコードの核の欄は必須、今後足す欄は optional にする
- バックアップの欄は省略可にし、壊れた要素は捨てて残りを復元する
- 外した語を消すのは、「戻す」と作品の完全削除のときだけ
- publish バンドル・MCP に新しい記録を出さない
- 新しい npm 依存を足さない（lindera の CLI は `build-dict.mjs` が手元で取るだけ）

## やらないこと

- AI での判定
- 別名として足す操作
- 本文を `[[ ]]` に書き換える操作
- 話者の推定
- スマホ対応
- 推敲画面の外への表示
- 指摘タブの作り直し中の表示を変えること
- main への PR（stg への push は、緑になったら関連ファイルだけで可）
