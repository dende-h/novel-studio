# CODEMAP — novel-studio コード地図

**用途**: コード調査の入口。「何をどこで直すか」をここで当たりをつけてから、必要なファイルだけ開く。
全文検索より先にここを読む。ここに無い＝新しい領域、ということ。

**更新規約**: 実装・修正のあとは `/codemap-update` スキルで本ファイルを追従させる（→ `.claude/skills/codemap-update/`）。

---

## 0. 30秒でわかる全体像

ローカルファーストの小説執筆ツール。原稿は既定で端末内（IndexedDB）にのみ置き、
クラウド同期・バックアップは有料オプトイン（at-rest 暗号化）。書き出し先は EPUB / なろう / カクヨム / 自前公開サイト。

```
ブラウザ (Vite + React 19 + Tailwind4 + PWA)
  src/ui/   ← React・画面・ストア・同期クライアント
  src/core/ ← 純TS。React を import しない。TDD の主戦場
        │  (fetch)
Cloudflare Pages Functions
  functions/api/ ← 同期・バックアップ・課金・MCP・認証
        │
  D1 (メタ/課金/トークン) + R2 (暗号化ブロブ) + Clerk (認証) + Stripe (課金)
```

**最重要の境界**: `src/core/` は `src/ui/` と React を import してはいけない（03-architecture.md §2）。
状態管理ライブラリ（Redux/Zustand）は不使用 — 自前 `useSyncExternalStore` ストア。

---

## 1. 「◯◯を変えたい」→ 見るべき場所

| やりたいこと | まず開くファイル |
|---|---|
| 記法（ルビ・傍点・`[[参照]]`）の解釈を変える | `src/core/parser/parseNotation.ts` + `src/core/schema/index.ts` |
| 書き出し（EPUB/なろう/カクヨム/HTML）の出力を変える | `src/core/exporter/` 配下（形式ごとに1ファイル） |
| エディタの入力・ショートカット・サジェスト | `src/ui/components/EditorPane/` |
| 保存・自動保存・undo・開いている作品の状態 | `src/ui/store/editorStore.ts` |
| データの永続化・スキーマ移行 | `src/core/storage/*Repository.ts` |
| 図鑑（用語辞書）の挙動 | `src/core/glossary/index.ts` + `src/ui/components/GlossaryView/` |
| プロット（幕×ビート・伏線・秘密） | `src/core/plot/index.ts` + `src/ui/components/PlotView/plot-view.tsx` |
| マインドマップ／相関図／アウトライン | `src/core/structure/` + `src/ui/structure/` + 各 View |
| クラウド同期の競合・差分ロジック | `src/core/sync/plan.ts`（純ロジック）→ `src/ui/sync/sync-service.ts`（配線） |
| 同期 API の挙動 | `functions/api/sync/` |
| 課金・会員判定 | `src/core/billing/` + `functions/api/billing/` + `functions/api/_lib/membership.ts` |
| AI/MCP 連携（外部から原稿を編集） | `src/core/mcp-edit/index.ts` + `functions/api/_lib/mcp-server.ts` |
| 画面遷移・ルート追加 | `src/ui/Root.tsx` + `src/ui/hooks/use-hash-route.ts` |
| DB スキーマ | `migrations/*.sql` + `wrangler.toml` |

---

## 2. `src/core/` — 純TS ドメイン層（React 非依存・テストの主戦場）

各ディレクトリは `index.ts` を持ち、同階層に `*.test.ts` が並ぶ。

### データ定義
| モジュール | 責務 | 主な export |
|---|---|---|
| `schema/` | **正本 block スキーマ（Zod）**。全データの型の源 | `Block` `Inline` `Episode` `Work` `GlossaryEntry` `WorkPlatform` `PLATFORM_GENRES` |
| `plot/` | プロット（幕/ライン/ビート/伏線/秘密）のスキーマと操作 | `PlotSection` `PlotLine` `PlotBeat` `Foreshadow` `Secret` |
| `structure/` | 構造レイヤー（outline/chart/mindmap）のノード・辺 | `StructureNode` `StructureEdge` `StructureKind` `emptyStructure` `addNode` `pickPrimaryStructure` |
| `idea/` | ネタ帳のメモ | `IdeaNote` `normalizeIdeaText` |
| `profile/` | 作者プロフィール | `Profile` `ProfileRepository` |

### 変換
| モジュール | 責務 |
|---|---|
| `src/core/parser/parseNotation.ts` | 記法テキスト → 正本 Block。`parseEpisodeBody` `parseInlines` |
| `src/core/exporter/toEpub.ts` | 正本 → EPUB（`episodeToXhtml` + `zip/`） |
| `src/core/exporter/toHtml.ts` | 正本 → 安全な HTML（プレビュー兼用・全エスケープ済み） |
| `src/core/exporter/toNarou.ts` / `src/core/exporter/toKakuyomu.ts` | 各投稿サイト記法 |
| `src/core/exporter/toPlainText.ts` / `plotToPlainText.ts` / `structureToPlainText.ts` | AI 投げ込み用の平文（`glossaryToPlainText` 含む） |
| `src/core/exporter/blocksToNotation.ts` | 正本 → 記法（往復変換） |
| `src/core/zip/index.ts` | 依存ゼロの ZIP（store 法）・`crc32` |
| `bundle/` `folder/` | 全作品バンドル JSON / フォルダ形式の入出力 |
| `diff/` | 履歴表示用の行差分（`diffLines` `collapseUnchanged`） |
| `image/` | 画像のリサイズ・切り抜き計算（純関数） |

### 永続化（`storage/`）
`KeyValueStore`（`src/core/storage/types.ts`）を `IdbStore`（本番）と `MemoryStore`（テスト）が実装。
その上に薄いリポジトリ: `WorkRepository`（作品・ゴミ箱・`WorkSummary`）、`StructureRepository`、
`PlotRepository`、`IdeaRepository`、`ActivityRepository`。スナップショットは `snapshot/`。

### 同期・バックアップ・課金
| モジュール | 責務 |
|---|---|
| `src/core/sync/plan.ts` | **三方向差分の純ロジック** `planReconcile`（ローカル / リモート manifest / syncbase） |
| `src/core/sync/hash.ts` | 正規化 JSON と `sha256Hex`（CAS の基準） |
| `src/core/sync/types.ts` | `RemoteWorkMeta`（サーバとの共有契約。`functions/api/sync/manifest.ts` と同形） |
| `src/core/sync/syncBaseRepository.ts` | 最後に同期した版の記録 |
| `src/core/sync/syncLostRepository.ts` | 競合で退避した版の保管（`SyncLostEntry`・最大 20 件） |
| `src/core/sync/activityMerge.ts` | 執筆記録の端末間マージ |
| `backup/` | クラウド全体バックアップの直列化（`CloudBackup` v1） |
| `src/core/nudge/backup-nudge.ts` | バックアップ促しの判定（節目・クールダウン） |
| `src/core/billing/stripe-event.ts` | Stripe イベント → `StripeAction` 解釈 |
| `src/core/billing/reap-policy.ts` | 未課金アカウントの回収判定（`shouldReap`） |
| `src/core/mcp-edit/index.ts` | **MCP 経由の編集操作の純ロジック**（`createWork` `setEpisode` `upsertGlossaryEntry` `setPlotMeta` 等）。サーバの MCP ツールはこれを呼ぶ |
| `activity/` | 執筆記録（`localDateKey` `currentStreak` `buildHeatmap`） |
| `stats/` | 文字数カウント |
| `outline/` | アウトラインのメモ木操作（`indentNote` `moveNote` 等） |
| `glossary/` | 参照解決・出現検索・改名・サジェスト（`resolveRef` `renameEntry` `suggestRefs`） |

---

## 3. `src/ui/` — React 層

### 骨格
| ファイル | 責務 |
|---|---|
| `src/ui/main.tsx` | フォント読込・`createRoot`・Provider 積み上げ |
| `src/ui/Root.tsx` | **ハッシュルーティングの分岐点**（下表）。リポジトリ生成と会員判定の配線 |
| `src/ui/App.tsx` | 執筆画面本体（`#/write`）。エディタ・プレビュー・図鑑・履歴パネルの統括。**813行 / 最も密度が高い** |
| `src/ui/store/editorStore.ts` | 自前ストア。`getSnapshot`/`subscribe` + 作品・話・図鑑・ゴミ箱・プロフィールの全操作 |
| `src/ui/store/createDefaultStore.ts` | 本番のリポジトリ配線 |
| `src/ui/hooks/use-editor-store.ts` | `useSyncExternalStore` の薄いラッパ |

### ルート（`src/ui/hooks/use-hash-route.ts`・`location.hash` が唯一の真実）
`/` ライブラリ ・ `/write` 執筆 ・ `/publish` 公開 ・ `/activity` 執筆の記録 ・ `/ideas` ネタ帳
・ `/settings` ・ `/help` ・ `/plan` 同期の案内

### 画面（`components/` — PascalCase ディレクトリ + kebab ファイル・1ファイル1コンポーネント）
- **執筆**: `EditorPane/`（textarea + 記法バー + `@` サジェスト + 置換パネル）, `PreviewPane/`, `HistoryPanel/`
- **作品管理**: `Library/`（カード/リスト・作品メニュー）, `TrashDialog/`, `WorkMetaDialog/`, `TitlePromptDialog/`
- **図鑑**: `GlossaryView/`, `GlossaryEntryForm/`, `GlossaryPeek/`, `GlossaryEntryForm`
- **構造ツール（有料・遅延ロード）**: `MindmapView/`, `CorrelationChartView/`, `OutlineView/`, `PlotView/`, `PlotPeek/`, `StructureCanvas/`
- **入出力**: `ExportDialog/`, `ImportDialog/`, `BackupDialog/`, `CloudBackupDialog/`, `AiPullDialog/`
- **同期/課金**: `SyncOnboarding/`, `SyncLostDialog/`, `RestoreGrace/`, `McpConnectDialog/`, `SaveStateIndicator/`, `BackupNudgeDialog/`
- **その他**: `ActivityPage/`, `IdeaboxPage/`, `PublishPage/`, `SettingsPage/`, `HelpPage/`, `ProfileDialog/`, `FirstRunDialog/`
- **共通**: `AppShell/`, `PageLayout/`, `SideNav/`, `TopAppBar/`, `Toast/`, `ConfirmDialog/`, `ErrorBoundary/`
- `components/ui/` = shadcn/ui コピー品（**biome の lint 対象外**。手を入れない方針）

### 補助
| ディレクトリ | 責務 |
|---|---|
| `_api/` | サーバ呼び出しの薄いクライアント（`sync` `backup` `billing` `publish` `author` `mcp`） |
| `_utils/` | 純関数（`caretCoordinates` `imageResizer` `exporters` `download` `format` `clipboard` `cover-tone`） |
| `hooks/` | React ライフサイクル依存のみ（`use-autosave` `use-auto-sync` `use-auto-backup` `use-live-snapshot` `use-preferences` `use-narrow` `use-keyboard-inset` 等） |
| `sync/` | 同期クライアント。`src/ui/sync/sync-service.ts` が本体（808行）・`sync-gate` `sync-status` `sync-touch` |
| `src/ui/backup/backup-service.ts` | クラウド全体バックアップの実行 |
| `structure/` | React Flow アダプタ（`flow-adapter` `tree-layout` `use-structure-flow` `ensure-structure`） |
| `auth/` | Clerk 配線（`auth-provider` `clerk-gate` `derive-status` `cloud-pricing`） |

---

## 4. `functions/` — Cloudflare Pages Functions

`functions/_middleware.ts` が `/.well-known/*`（OAuth メタデータ）を Clerk へプロキシ。

| エンドポイント | 責務 |
|---|---|
| `GET /api/sync/manifest` | 同期メタ一覧（本文なし・軽量）。`RemoteWorkMeta[]` |
| `GET /api/sync/version` | 同期世代番号（ポーリング用・超軽量） |
| `/api/sync/work` | Work 1件の同期本体。GET=pull / PUT=CAS push / PATCH=ゴミ箱伝播 / DELETE=purge |
| `POST /api/sync/activity` | 執筆記録の同期 |
| `/api/backup` | クラウド全体バックアップ（セッション非依存） |
| `POST /api/hit` | 訪問者集計（Cookie なし） |
| `/api/billing/{checkout,portal,status,reap}` | Stripe Checkout / Portal / 会員状態 / 未課金回収ジョブ |
| `POST /api/webhooks/stripe` | Stripe webhook → D1 `subscriptions` にミラー |
| `/api/mcp` | リモート MCP（Streamable HTTP・JSON-RPC 2.0） |
| `/api/mcp/token` | MCP アクセストークン発行（会員のみ） |
| `/api/mcp/oauth-protected-resource` | RFC 9728 メタデータ |

`api/_lib/`: `auth`（Clerk 検証・`verifyMember`）, `membership`（**会員判定の単一の真実 = D1 `subscriptions`**）,
`crypto`（at-rest 暗号化）, `mcp-server`（MCP プロトコル核・823行）, `mcp-auth`, `mcp-token`,
`oauth-metadata`, `stripe`, `rate-limit`, `purge`, `visitor`。

**バインディング**（`wrangler.toml`）: `DB` = D1 `novel-studio`、`MEDIA` = R2 `novel-studio-media`
（preview 環境は `-stg` サフィックス）。

**マイグレーション**（`migrations/`）: `0001_init` → `0002_sync_works` → `0003_trash_sync` →
`0004_mcp_tokens` → `0005_subscriptions` → `0006_activity_sync` → `0007_visitor_days`

---

## 5. 開発コマンド・規約

```bash
pnpm dev            # Vite 開発サーバ (localhost:5173)
pnpm test           # Vitest（ユニット・101ファイル）
pnpm typecheck      # tsc -b --noEmit
pnpm lint           # biome check .
pnpm format         # biome format --write .
pnpm build          # tsc -b && vite build
pnpm test:e2e       # Playwright（e2e/smoke.spec.ts, e2e/mobile.spec.ts）
pnpm d1:migrate:local / :remote
```

- CI（`.github/workflows/ci.yml`）は main / stg への push・PR で lint → typecheck → test → build → e2e。
- Node 22 / pnpm 10.29.3（`mise.toml` で固定）。環境別は `mise.staging.toml` / `mise.production.toml`。
- インポートエイリアス `@/` → `src/`。
- Biome: シングルクォート・セミコロンなし・幅100・スペース2。

---

## 6. 詳細ドキュメント（必要になったときだけ開く）

| ファイル | 中身 |
|---|---|
| `docs/requirement/00-overview.md` | プロダクトの狙い・設計哲学 |
| `docs/requirement/01-mvp-scope.md` | MVP の含む/含まない |
| `docs/requirement/02-notation-and-format.md` | **記法仕様と正本 block スキーマ**（parser/exporter を触るなら必読） |
| `docs/requirement/03-architecture.md` | **core/ui 境界・依存ポリシー・component 規約** |
| `docs/requirement/04-glossary.md` | 図鑑・`@` 参照の仕様 |
| `docs/requirement/05-sync.md` / `docs/requirement/05-sync-setup.md` | 同期の設計と構築手順 |
| `docs/requirement/06-release-prep.md` | リリース準備 |
| `docs/requirement/07-analytics.md` | アクセス解析 |
| `docs/requirement/99-open-questions.md` | 未決事項 |
| `design/stitch/*/index.html` | 画面のデザインカンプ（+ スクリーンショット） |
