Linear COT-40「推敲画面を執筆から切り離し、指摘ごとに「直す／このまま」を選べるようにする（形態素解析つき）」を実装してください。

## 読むもの（この順で）
1. `docs/specs/COT-40/spec.md` — 仕様（正本の要約）
2. `docs/specs/COT-40/requirements.md` — 受け入れ条件の正本（Given/When/Then）
3. `docs/specs/COT-40/design.md` — 変更ファイル・データモデル・判定の詳細・テスト計画
4. `docs/specs/COT-40/prototype.html` と `screens/` — 画面の完成イメージ（共有 URL https://claude.ai/artifact/NQ5GfUrxqSMq1tPTYZkG19 ・非公開）
5. `docs/CODEMAP.md` — 「小説の推敲チェック」「同期」「バックアップ」「画面遷移」の節だけ

## 作業範囲
- 変更するファイル: design.md の「変更ファイル」表のとおり（core の proofread・parser・storage、ui の proofread・hooks・ProofreadView・FixListButton・App・SideNav・Root・EditorPane・editorStore・sync-service・backup-service・ImportDialog・use-auto-backup・HelpPage、`public/llms-full.txt`、`vite.config.ts`、`scripts/` の3本、`public/_headers`、`package.json`・`.gitignore`、CI 2本、`docs/requirement/03-architecture.md`）
- 変更しないもの: `src/ui/components/ui/`（shadcn コピー）、`src/core/sync/plan.ts`・`types.ts`・`syncLostRepository.ts`、`functions/api/sync/*`、MCP（`functions/api/_lib/mcp-server.ts`）、publish バンドル、`Work`・`Episode`・`Block` のスキーマ、脚本の書式チェックの挙動

## 進め方
1. ブランチは stg から切る（COT-30 の推敲チェックが入っているのは stg だけ）
2. 最初に解析器の前提を確かめる：`lindera-wasm@6.2.0` を Worker で `__wbg_init` し、`scripts/fetch-dict.mjs` で取った `lindera-ipadic-6.2.0.zip` を `unzip.ts` で展開して `loadDictionaryFromBytes` → tokenize が通ること、Chrome でのメモリ。結果は design.md の末尾に「実装メモ」として残す。動かなければ実装を止めて報告する
3. core をテストから書く：`rules`・`variants` の出現ごと化（既存テストの「1行1件」を出現ごとへ書き換え、当たる段落の集合は変えない）→ `decisions.ts`（`occurrencesOf`・`openFixes`・`locateFix` の例を requirements.md FR-6 から全部）→ `plainOffsetMap` → `morph/*`（`scripts/gen-morph-fixtures.mjs` で実トークンのフィクスチャを作ってから）→ `proofreadRepository`
4. 同期・バックアップ・完全削除の配線（演出譜 staging の各箇所を写す。判断は `recordLost` を呼ばない）
5. UI：EditorPane から小説の推敲チェックを外す → FixListButton → App・SideNav の入口と「本文で直す」→ ProofreadView → Worker と `use-morph-analyzer`
6. ビルド：`vite.config.ts` の `globIgnores`・runtimeCaching・`navigateFallbackDenylist`・worker・optimizeDeps、`fetch-dict.mjs`（SHA-256 照合）、`check-precache.mjs`、`public/_headers`、CI のキャッシュ
7. `.claude/skills/toc-copy/SKILL.md` を読み、画面文言（「くわしい確認」・トースト・空状態・ヘルプ）を整える
8. 完了後 `.claude/skills/codemap-update/SKILL.md` を読んで CODEMAP を更新する。`docs/requirement/03-architecture.md` に依存の例外を記録する

## 完了条件
- [ ] requirements.md の FR-1〜FR-11 の受け入れ条件が、design.md のテスト計画の層でテストに固定されている
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` が通る（WSL で `pnpm lint` が OOM になる場合は、Biome のネイティブバイナリで変更ファイルを検査する）
- [ ] `pnpm test:e2e` が通る（ゲストで推敲チェックが出ない・脚本の書式チェックが残る・`.wasm` と `/dict/` を取りに行かない）
- [ ] build 後の `dist/sw.js` に `.wasm` と `/dict/` が無い（`check-precache.mjs`）
- [ ] プロトタイプと見比べて差分がない（執筆画面の PC・スマホ、推敲画面の PC）
- [ ] stg で Chrome・Safari・Firefox の初回読み込み、2回目のオフライン、失敗時の表示、メモリ（30万字の作品を含む）を確かめ、実装メモに残す

## 守る規約
- `src/core/` は React・`src/ui/`・`lindera-wasm` を import しない（解析器を import するのは Worker だけ）
- スキーマは optional で足し、既存欄を消さない。判断の未知の値（code・verdict・anchor）も捨てない（CLAUDE.md「後方互換性」）
- 判断が消えるのは「未判断に戻す」「外す」と作品の完全削除だけ。「直った」は都度計算し、記録を消さない
- 解析器と辞書を Service Worker のプリキャッシュに入れない。辞書は同じ配信元から取り、ハッシュを照合する
- 状態管理ライブラリを足さない（自前の `useSyncExternalStore` ストア）。足す依存は `lindera-wasm` だけ

## やらないこと
- スマホの推敲画面、ゲスト向けの案内
- 文末の単調さ・AI 常套句・同じ語の連続の形態素化、利用者定義の表記ゆれ、自動修正、推敲画面での編集
- 判断を MCP・grove に出すこと、UniDic、話の削除時の判断の後始末、競合で負けた判断の退避
