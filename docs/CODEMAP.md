# CODEMAP — novel-studio コード地図

**用途**: コード調査の入口。「何をどこで直すか」をここで当たりをつけてから、必要なファイルだけ開く。
全文検索より先にここを読む。ここに無い＝新しい領域、ということ。

**更新規約**: 実装・修正のあとは `/codemap-update` スキルで本ファイルを追従させる（→ `.claude/skills/codemap-update/`）。

---

## 0. 30秒でわかる全体像

ローカルファーストの小説執筆ツール。原稿は既定で端末内（IndexedDB）にのみ置き、
クラウド同期・バックアップは有料オプトイン（at-rest 暗号化）。書き出し先は EPUB / なろう / カクヨム / 自前 コトノハ-grove-。

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
| プレビューのマークダウン（見出し・リスト・表・引用）を変える | `src/core/markdown/index.ts`（本文は非対応。効くのはプロット・世界観・用語集の記法つき欄） |
| 書き出し（EPUB/なろう/カクヨム/HTML）の出力を変える | `src/core/exporter/` 配下（形式ごとに1ファイル） |
| サウンドノベル書き出し（ゲーム化・演出譜）を変える | `src/core/game/`（判別・演出譜・テンプレ背景・持ち込み背景・`continuity.ts`＝「この行で何が効いているか」の解決）+ `src/core/exporter/toNovelGame.ts`（プレイヤー本体は `novelGamePlayer.ts`）。演出エディタは `src/ui/components/StagingView/`（欄の説明は `field-helps.tsx`、アプリ内プレビューは `preview-dialog.tsx`＝`buildNovelGameHtml` を sandbox iframe に流し込む・`startAt` でその行から）、永続化は `src/core/storage/stagingRepository.ts`（演出譜）と `gameAssetRepository.ts`（持ち込み背景） |
| サウンドノベルの効果音（合成SE＋運営テンプレの音声ファイル）を変える | 合成レシピは `src/core/game/sePresets.ts`（`PRESET_SES` `presetSe`・鳴らし方は `Cue.seRepeat`＝1回/2回/ループ・止めるのは予約キー `SE_STOP`）。音声ファイル（目録 kind `se`・mp3/m4a）は `templates.ts` の `mergeSeCatalog` で合成に重なり、exporter がシナリオ `ses[key]` を `{steps}`（合成）か `{src}`（ファイル・zip は `assets/se/<slug>.mp3`・投稿は契約 v6 の `asset:<id>`）で載せる。解釈はプレイヤー（`novelGamePlayer.ts` の `playSe` `startLoopSe`＝`src` は fetch→decodeAudioData）とアプリ試聴 `src/ui/_utils/sePlayer.ts`（`playCatalogSe`）の2箇所——**両方を同時に直す** |
| サウンドノベルの grove 公開（契約 v4〜v6）を変える | leaf 側は `src/ui/_api/publish.ts`（`attachEpisodeGames`＝話ごとのプレイヤー同梱・対象は作者が選んだ話だけ＝`novelGameEpisodeOf`・`GAME_FONT_HREF`。**素材の実体は作品ぶん1回**＝`work.gameAssets` と `buildNovelGamePlayer` の `asset:<id>` 参照・契約 v5。音声（効果音ファイル）を載せるときだけ v6）と公開ページの切り替え（`PublishPage` の話一覧にある行スイッチだけ＝作品ぜんたいの切り替えは無い・`WorkPlatform.novelGameEpisodes`／`novelGame` は前回載せたかの控え）。インライン書き出しは `src/core/exporter/toNovelGame.ts` の `buildNovelGameHtml`。grove 側は novel-platform の `kotonoha-bundle.ts` / `import-work.ts`（契約文書は先方の `novel-platform:docs/architecture/kotonoha-import-contract.md`） |
| 立ち絵の登録・整理（誰に付けるか） | 演出エディタは `src/ui/components/StagingView/staging-view.tsx` の `renderSpriteEditor`（セリフの「話者」欄と地の文の「立ち絵の登場」欄で共用＝**喋らない人物にも付けられる**。出さない区間は cue の `hideSprite`＝一覧の「立ち絵なし」・解釈は `toNovelGame.ts` の `spritesHidden`）。図鑑からは `src/ui/components/GlossaryView/sprite-section.tsx`（人物ページの立ち絵欄）。正本はどちらも `gameAssetRepository.ts`（character/expression で紐づく） |
| 持ち込み素材のクラウド保管（有料・枚数上限）を変える | API は `functions/api/game-assets.ts`、上限と判定は `src/core/game/assets.ts`（`HOSTED_ASSET_LIMIT` `hostedAssetVerdict`）、配線は `src/ui/game/asset-hosting.ts`（下り取り込み）、管理 UI は `src/ui/components/StagingView/asset-manager.tsx` |
| **運営テンプレ（背景・立ち絵・効果音）の目録・管理ページ・配信**を変える（D-GAME-TEMPLATE-CMS） | 目録と合流は `src/core/game/templates.ts`（`TemplateManifest` `mergeBackgroundCatalog` `mergeSpriteCatalog` `mergeSeCatalog` `parseTemplateFilename`＝**ファイル名がキー**（画像は kind bg/sprite・音声の拡張子は se）・`applyTemplatePatch`・読み方は寛容＝読めない項目を落とす）。画面へ配るのは `src/ui/game/template-catalog.ts`（`useTemplateCatalog` `resolveTemplateBackgrounds`＝書き出し・投稿へ画像を持ち込み素材と同じ経路で渡す・`setTemplateCatalog`）。一覧の部品は `StagingView/template-picker.tsx`。管理ページは `src/ui/components/AdminTemplatesPage/`（`#/admin/templates`・staff だけ・`use-staff.ts`）。サーバは読み口 `functions/game-templates/[[path]].ts` と管理 API `functions/api/admin/templates.ts`、R2 のキーは `functions/api/_lib/templates-store.ts`（`_templates/`）。組み込み SVG（`presets.ts` `spritePresets.ts`）は画像が入るまでの控え |
| エディタの入力・ショートカット・サジェスト | `src/ui/components/EditorPane/` |
| 保存・自動保存・undo・開いている作品の状態 | `src/ui/store/editorStore.ts` |
| データの永続化・スキーマ移行 | `src/core/storage/*Repository.ts` |
| 用語集（`@`参照の解決先・**コトノハ-grove- へ送られる**）の挙動 | `src/core/glossary/index.ts` + `src/ui/components/GlossaryView/` |
| 世界観設定（作者専用・**公開されない**）の挙動 | `src/core/plot/index.ts`（`WORLD_SLOTS` ほか）+ `src/ui/components/PlotView/world-view.tsx` |
| `@`/`[[` サジェストの挙動 | 判定・候補は `src/core/glossary/index.ts`、見た目は `src/ui/components/EditorPane/ref-suggest.tsx`、本文以外の入力欄は `src/ui/components/NotationField/` |
| プロット（幕×ビート・伏線・秘密） | `src/core/plot/index.ts` + `src/ui/components/PlotView/plot-view.tsx` |
| 執筆中に見る「この話のプロット」パネル（一覧＋ビート詳細の二段ドロワー） | `src/ui/components/PlotPeek/`（`plot-peek.tsx` 一覧 ＋ `beat-detail.tsx` 詳細）+ 表示ヘルパは `src/ui/plot/beat-ui.ts` |
| マインドマップ／相関図／アウトライン | `src/core/structure/` + `src/ui/structure/` + 各 View |
| クラウド同期の競合・差分ロジック | `src/core/sync/plan.ts`（純ロジック）→ `src/ui/sync/sync-service.ts`（配線） |
| 同期 API の挙動 | `functions/api/sync/` |
| 課金・会員判定 | `src/core/billing/` + `functions/api/billing/` + `functions/api/_lib/membership.ts` |
| 無料／有料の線（どの機能をどの状態で出すか） | `src/ui/Root.tsx`（`canUseCreativeTools` ほか）+ `src/ui/auth/derive-status.ts` |
| AI/MCP 連携（外部から原稿を編集） | `src/core/mcp-edit/index.ts` + `functions/api/_lib/mcp-server.ts` |
| MCP コネクタの接続（OAuth ディスカバリ・認可の窓口） | `functions/_middleware.ts` + `functions/api/oauth/[[path]].ts` |
| **UI 部品・ヘルパを新規に作りたい** | まず §3「共通部品カタログ」で在庫を確認する（重複作成の防止） |
| **掲示板**（記名式スレッド・お知らせ・アンケート・通報）の挙動 | 画面は `src/ui/components/BoardPage/`、判断は `src/core/board/`、SQL は `functions/api/_lib/board-store.ts`、窓口は `functions/api/board/` |
| 掲示板に貼られた外部リンクの OGP（取得可否・画像の許可表） | `src/core/board/link.ts`（判定）+ `functions/api/_lib/board-link-fetch.ts`（取得とキャッシュ） |
| **ペンネーム（表示名）**の扱い — ヘッダ・サイドバー・新しい作品の著者・掲示板の表示名は同じ 1 つ | 判定は `src/core/profile/account.ts`、配線は `src/ui/hooks/use-pen-name.ts`、編集は `src/ui/components/ProfileDialog/`（Root が 1 つだけ持つ）、正本はサーバの `board_profiles.display_name` |
| **コトノハ-grove- （grove）の作者名** — コトノハ-leaf- のペンネームとは**別物**（D-PENNAME-GROVE）。語も分ける（ペンネーム／作者名） | `src/ui/components/PublishPage/publish-page.tsx` の `AuthorNameCard`（投稿前に名前を見せる）＋ `author-register-card.tsx`（登録）。取得は `src/ui/_api/author.ts`。変更の口は コトノハ-grove- の `/settings` |
| 未課金・解約アカウントの削除（reaper） | `src/core/billing/reap-policy.ts` + `functions/api/billing/reap.ts` + `functions/api/_lib/purge.ts` |
| 画面遷移・ルート追加 | `src/ui/Root.tsx` + `src/ui/hooks/use-hash-route.ts` |
| DB スキーマ | `migrations/*.sql` + `wrangler.toml` |
| ランディングページ（機能紹介・プラン表・スクリーンショット） | `public/lp/index.html` + `public/lp/shots/` |
| ユーザー向け文言（LP・案内・ボタン・エラー等）を書く/直す | `.claude/skills/toc-copy/`（トーン・用語表・マイクロコピーの型） |
| 小説本文の執筆・推敲（MCP/ローカル） | `.claude/skills/novel-writing/`（執筆制約・レビュー観点） |
| 小説原稿の機械検査（textlint）のルール・AI臭辞書 | `tools/novel-textlint/`（アプリ本体とは独立。README 参照） |
| note記事・設計文書・レポートなど仕事の文書を書く/直す | `.claude/skills/natural-japanese/`（coji/natural-japanese の同梱コピー。出自と更新手順は同 `UPSTREAM.md`） |

---

## 2. `src/core/` — 純TS ドメイン層（React 非依存・テストの主戦場）

各ディレクトリは `index.ts` を持ち、同階層に `*.test.ts` が並ぶ。

### データ定義
| モジュール | 責務 | 主な export |
|---|---|---|
| `schema/` | **正本 block スキーマ（Zod）**。全データの型の源 | `Block` `Inline` `Episode` `Work` `GlossaryEntry`（`authorNote` は公開時に落とす） `WorkPlatform` `PLATFORM_GENRES` |
| `plot/` | プロット（幕/ライン/ビート/伏線/秘密）＋**世界観設定**（`Plot.world`・作者専用） | `PlotSection` `PlotLine` `PlotBeat` `Foreshadow` `Secret` / `beatsInStoryOrder` `sectionOfBeat` `linesOfBeat` `foreshadowsOfBeat` `secretsHiddenAt` / `WorldNote` `WORLD_SLOTS` `WORLD_CUSTOM_SLOT` `worldNoteLabel` `worldNotesInOrder` `setWorldNote` `removeWorldNote` |
| `structure/` | 構造レイヤー（outline/chart/mindmap）のノード・辺 | `StructureNode` `StructureEdge` `StructureKind` `emptyStructure` `addNode` `pickPrimaryStructure` |
| `idea/` | ネタ帳のメモ | `IdeaNote` `normalizeIdeaText` |
| `game/` | サウンドノベル化のドメイン（演出譜＝正本の外・blockId アンカー） | `Staging` `Cue` `AssetRef` / `classifyBlock` `toPages` `applyCues` `findOrphanCues` `suggestSceneBreaks` `suggestSpeaker` / テンプレ背景は `presets.ts`（`PRESET_BACKGROUNDS` `presetBgSvg` `buildGameCredits`・組み込み SVG＝画像が入るまでの控え）／テンプレ立ち絵（シルエット6種）は `spritePresets.ts`（`PRESET_SPRITES` `presetSpriteSvg`）／**運営テンプレの目録**は `templates.ts`（`TemplateManifest` `TemplateEntry` の Zod・`mergeBackgroundCatalog` `mergeSpriteCatalog`＝組み込みに目録を重ねる・`parseTemplateFilename` `parseTemplateTsv`・`templateAssetId`＝`tpl-<kind>-<slug>`・`templateUrl`・`applyTemplatePatch`・管理 API の入力 `TemplatePutInputSchema` `TemplatePatchInputSchema`）／持ち込み素材（背景・立ち絵）は `assets.ts`（`UserGameAsset`＝data URL＋tone 3色・キーは `userAssetKey`＝`user:<id>`、テンプレ由来の背景は `gameAssetKey` が `preset` のキーを返す。立ち絵の選定 `pickSprite` `spriteExpressionsOf`、無料枠 `FREE_IMPORT_LIMIT` `importVerdict`、クラウド保管の上限 `HOSTED_ASSET_LIMIT` と判定 `hostedAssetVerdict` もここ）／合成SEレシピは `sePresets.ts`（`PRESET_SES` `presetSe` `seDuration`・キーは `preset:se/<名>`） |
| `profile/` | 作者プロフィール（ペンネーム・アバター）と、**アカウントとの突き合わせ**（`account.ts`）。どのアカウントの名前かの印は `profile` とは**別キー**（同期・バックアップに乗せない） | `Profile`（`penName` `avatar` `updatedAt`） `ProfileRepository`（+ `getAccountId` `saveAccountId`） / `penNameForAccount` `PenNameSync` |
| `board/` | **掲示板の共有契約**（Zod）と純ロジック。詳細は下表 | `BOARD_KINDS` `BOARD_LIMITS` `BoardThread` `BoardPost` `PollResult` `LinkCard` `BoardThreadDetail` `ThreadListResponse` `BoardMeResponse` `ModerateInputSchema` ほか（`types.ts`） |

### 変換
| モジュール | 責務 |
|---|---|
| `src/core/parser/parseNotation.ts` | 記法テキスト → 正本 Block。`parseEpisodeBody` `parseInlines` |
| `src/core/parser/reconcileBlockIds.ts` | 保存の再パースで振り直された block id を旧 blocks から引き継ぐ（演出譜 Staging のアンカー安定化。editorStore.save と mcp-edit の setEpisode が通す） |
| `src/core/exporter/toEpub.ts` | 正本 → EPUB（`episodeToXhtml` + `zip/`） |
| `src/core/exporter/toHtml.ts` | 正本 → 安全な HTML（プレビュー兼用・全エスケープ済み。`inlinesToHtml` も公開） |
| `src/core/markdown/index.ts` | 生テキスト → プレビュー HTML の軽量マークダウン（`markdownToHtml` `stripMarkdown` `InlineRenderer`。行内は既定で parseInlines へ委譲＝[[用語]]・ルビが生きるが、**第3引数で差し替えられる**＝掲示板はここを使う） |
| `src/core/exporter/toNarou.ts` / `src/core/exporter/toKakuyomu.ts` | 各投稿サイト記法 |
| `src/core/exporter/toNovelGame.ts` | 正本＋演出譜 → サウンドノベル zip の中身（`buildNovelGameFiles`）と grove 同梱用の自己完結HTML（`buildNovelGameHtml`＝素材 data URL 内包・契約 v4）。プレイヤー（index.html の CSS/JS 一式）は `novelGamePlayer.ts` |
| `src/core/exporter/toPlainText.ts` / `plotToPlainText.ts` / `structureToPlainText.ts` / `stagingToPlainText.ts` | AI 投げ込み用の平文（`glossaryToPlainText`、演出譜の `stagingToPlainText` 含む） |
| `src/core/exporter/blocksToNotation.ts` | 正本 → 記法（往復変換） |
| `src/core/zip/index.ts` | 依存ゼロの ZIP（store 法）・`crc32` |
| `bundle/` `folder/` | 全作品バンドル JSON / フォルダ形式の入出力 |
| `diff/` | 履歴表示用の行差分（`diffLines` `collapseUnchanged`） |
| `image/` | 画像のリサイズ・切り抜き計算（純関数） |

### 永続化（`storage/`）
`KeyValueStore`（`src/core/storage/types.ts`）を `IdbStore`（本番）と `MemoryStore`（テスト）が実装。
その上に薄いリポジトリ: `WorkRepository`（作品・ゴミ箱・`WorkSummary`）、`StructureRepository`、
`PlotRepository`、`StagingRepository`（演出譜・`staging:<workId>:<episodeId>` の決定的 id）、
`GameAssetRepository`（持ち込み背景・`gameasset:` プレフィクス・同期には載せない）、
`IdeaRepository`、`ActivityRepository`。スナップショットは `snapshot/`。

> **罠**: IndexedDB からの直読みは Zod を通らないので、スキーマの `.default([])` が効かない
> （効くのはバックアップ・同期など Zod を通る経路だけ）。既存レコードに実体が無い項目を足したら、
> 読み出しの入口で既定値を埋める（先例: `normalizePlot`＝`src/core/plot/index.ts` で定義し、
> `src/core/storage/plotRepository.ts` の `get`/`list` が通す）。

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
| `src/core/billing/reap-policy.ts` | アカウント削除の判定（`shouldReap`）。**解約後の猶予切れだけ**が対象＝無料アカウントに期限は無い |
| `src/core/mcp-edit/index.ts` | **MCP 経由の編集操作の純ロジック**（`createWork` `setEpisode` `upsertGlossaryEntry` `setPlotMeta` `setPlotWorldNote` `deletePlotWorldNote` `setStagingCues`（演出譜） 等）。サーバの MCP ツールはこれを呼ぶ |
| `activity/` | 執筆記録（`localDateKey` `currentStreak` `buildHeatmap`） |
| `stats/` | 文字数カウント |
| `outline/` | アウトラインのメモ木操作（`indentNote` `moveNote` 等） |
| `glossary/` | 参照解決・出現検索・改名・サジェスト・公開情報の結合（`resolveRef` `renameEntry` `suggestRefs` `publicTextOf` `PERSON_CATEGORY`） |

### 掲示板（`board/`）— 判断はすべてここ。サーバは呼ぶだけ
| ファイル | 責務 | 主な export |
|---|---|---|
| `src/core/board/types.ts` | **サーバ・クライアント共通の契約**（Zod）と上限。種別は request/bug/chat/intro/promo/notice（旧 `suggestion` は request へ統合・enum には残す） | `BOARD_KINDS` `BOARD_STATUSES` `BOARD_LIMITS`（本文 1500 字） `KIND_ALIASES` `canonicalKind` `kindsForFilter` `CREATABLE_KINDS` `STAFF_ONLY_KINDS` `KINDS_WITH_STATUS` `boardKindLabel` `boardKindHint` `BoardThread` `BoardPost` `PollResult` `LinkCard` `BoardThreadDetail` `ThreadListResponse` `BoardMeResponse` `ModerateInputSchema` |
| `src/core/board/name.ts` | 表示名の正規化・予約語。**見た目が同じ文字を畳んでから**重複判定（なりすまし防止） | `normalizeDisplayName` `nameKeyOf` `RESERVED_NAME_KEYS` `validateDisplayName` |
| `src/core/board/link.ts` | **URL を取りに行ってよいかの判定（SSRF）**と OGP の抽出。og:image はホストの許可表を通す | `extractUrls` `normalizeUrl` `urlKeyOf` `canFetchUrl` `parseOgp` `OGP_IMAGE_HOSTS` `isAllowedImageHost` `resolveImageUrl` |
| `src/core/board/render.ts` | 掲示板本文の描画。**`markdownToHtml` は本文向けで使えない**（数字に縦中横、`[[用語]]` 素通し、URL がリンクにならない）ためブロック層だけ再利用 | `escapeHtml` `boardInlineHtml` `boardBodyToHtml` `boardBodyToPlain` |
| `src/core/board/poll.ts` | アンケートの検証・集計と**開示判定**（未投票かつ締切前は票数を返さない） | `validatePollInput` `tallyVotes` `pollResultFor` `canVote` `normalizeChoices` |
| `src/core/board/permission.ts` | 誰が何をできるか。理由を HTTP ステータスへ写す表つき。種別の表は `types.ts` から import | `canPost` `canCreateThread`（notice は staff のみ） `isStaffOnlyKind` `canDeletePost` `canDeleteThread` `threadDeleteMode` `canModerate` `canSetStatus` `canLike`（**投稿 1 件ごと**・種別は問わない） `visiblePost` `STATUS_OF_REASON` |

---

## 3. `src/ui/` — React 層

### 骨格
| ファイル | 責務 |
|---|---|
| `src/ui/main.tsx` | フォント読込・`createRoot`・Provider 積み上げ |
| `src/ui/Root.tsx` | **ハッシュルーティングの分岐点**（下表）。リポジトリ生成と会員判定の配線 |
| `src/ui/App.tsx` | 執筆画面本体（`#/write`）。エディタ・プレビュー・用語集・履歴パネルの統括。**約840行 / 最も密度が高い** |
| `src/ui/store/editorStore.ts` | 自前ストア。`getSnapshot`/`subscribe` + 作品・話・用語集・ゴミ箱・プロフィールの全操作 |
| `src/ui/store/createDefaultStore.ts` | 本番のリポジトリ配線 |
| `src/ui/hooks/use-editor-store.ts` | `useSyncExternalStore` の薄いラッパ |

### ルート（`src/ui/hooks/use-hash-route.ts`・`location.hash` が唯一の真実）
`/` ライブラリ ・ `/write` 執筆 ・ `/publish` 公開 ・ `/activity` 執筆の記録 ・ `/ideas` ネタ帳
・ `/settings` ・ `/help` ・ `/plan` 同期の案内 ・ `/board` 掲示板 ・ `/board/<threadId>` スレ詳細
・ `/admin/templates` 運営テンプレの管理（**staff だけ描く**・それ以外は通常の入口に倒す・`use-staff.ts`）

### 画面（`components/` — PascalCase ディレクトリ + kebab ファイル・1ファイル1コンポーネント）
- **執筆**: `EditorPane/`（textarea + 記法バー + `@` サジェスト + 置換パネル）, `PreviewPane/`, `HistoryPanel/`
- **作品管理**: `Library/`（カード/リスト・作品メニュー）, `TrashDialog/`, `WorkMetaDialog/`, `TitlePromptDialog/`
- **用語集**: `GlossaryView/`（左：一覧／右：その場編集の二枚看板）, `GlossaryEntryForm/`（本文からのクイック作成・パネル編集用モーダル）, `GlossaryPeek/`
- **構想の道具（無料アカウント登録で解禁・遅延ロード）**: `MindmapView/`, `CorrelationChartView/`, `OutlineView/`, `PlotView/`（`plot-view.tsx` ＋ 世界観設定タブ `world-view.tsx`）, `StructureCanvas/`, `StagingView/`（サウンドノベルの演出エディタ：行一覧＋話者/表情/背景/効果音/場面の切れ目・背景と立ち絵の持ち込み・素材の管理 `asset-manager.tsx`＝一覧/削除/クラウド保管・テンプレの一覧 `template-picker.tsx`＝分類タブ＋サムネイル・書き出しと図鑑でも共用）
- **執筆画面の右パネル（遅延ロードしない）**: `PlotPeek/`（この話のビート一覧 `plot-peek.tsx` ＋ 読み取り専用のビート詳細 `beat-detail.tsx`）
- **入出力**: `ExportDialog/`, `ImportDialog/`, `BackupDialog/`, `CloudBackupDialog/`, `AiPullDialog/`
- **同期/課金**: `SyncOnboarding/`, `SyncLostDialog/`, `RestoreGrace/`, `McpConnectDialog/`, `SaveStateIndicator/`, `BackupNudgeDialog/`
- **掲示板（遅延ロード・未ログインでも読める）**: `BoardPage/`（`board-page.tsx` 一覧 ／ `thread-view.tsx` スレ詳細 ／ `thread-list.tsx` `board-body.tsx` `link-card.tsx` `poll-card.tsx` `name-dialog.tsx` `new-thread-dialog.tsx` `report-dialog.tsx` `staff-controls.tsx`）
- **その他**: `ActivityPage/`, `IdeaboxPage/`, `PublishPage/`, `SettingsPage/`（staff には管理ページの入口）, `HelpPage/`, `ProfileDialog/`, `FirstRunDialog/`
- **運営だけ（遅延ロード）**: `AdminTemplatesPage/`（テンプレ素材の管理：背景・立ち絵・効果音のタブ。ドロップで一括投入＝ファイル名からキー・画像はブラウザで WebP/サムネ/tone・音声はそのまま長さだけ測る・表示名/分類/時間帯/非表示・TSV の一括取り込み・効果音は試聴）
- **共通**: `AppShell/`, `PageLayout/`, `SideNav/`, `TopAppBar/`, `Toast/`, `ConfirmDialog/`, `ErrorBoundary/`
- `components/ui/` = shadcn/ui コピー品（**biome の lint 対象外**・手を入れない）→ 中身は次節のカタログ参照

### 共通部品カタログ — **新しく作る前に必ずここを見る**

同じものを二度作らないための在庫表。ここに載っているものは import して使う。
足りない場合も、まず既存を拡張できないか検討してから新規作成する。

**プリミティブ `src/ui/components/ui/`**（shadcn/ui コピー品・biome 対象外・手を入れない）

| ファイル | export |
|---|---|
| `button.tsx` | `Button` `buttonVariants` |
| `input.tsx` / `textarea.tsx` / `label.tsx` | `Input` / `Textarea` / `Label` |
| `dialog.tsx` | `Dialog` `DialogTrigger` `DialogContent` `DialogHeader` `DialogTitle` `DialogDescription` `DialogBody` `DialogFooter` `DialogClose` `DialogOverlay` `DialogPortal` |
| `dropdown-menu.tsx` | `DropdownMenu` `DropdownMenuTrigger` `DropdownMenuContent` `DropdownMenuItem` `DropdownMenuCheckboxItem` `DropdownMenuRadioGroup` `DropdownMenuRadioItem` `DropdownMenuLabel` `DropdownMenuSeparator` `DropdownMenuShortcut` `DropdownMenuSub` ほか |
| `card.tsx` | `Card` `CardHeader` `CardTitle` `CardDescription` `CardAction` `CardContent` `CardFooter` |
| `badge.tsx` | `Badge` `badgeVariants` |
| `switch.tsx` / `progress.tsx` / `separator.tsx` | `Switch` / `Progress` / `Separator` |
| `scroll-area.tsx` | `ScrollArea` `ScrollBar` |
| `tooltip.tsx` | `Tooltip` `TooltipProvider` `TooltipTrigger` `TooltipContent` |
| `zoomable-image.tsx` | `ZoomableImage`（自前・shadcn 由来ではない） |

**アプリ共通コンポーネント** — ブラウザ標準 API の代わりにこちらを使う

| 用途 | 使うもの | 素で書かない |
|---|---|---|
| 画面の骨格（トップバー＋サイドバー＋本文） | `AppShell`（`src/ui/components/AppShell/app-shell.tsx`） | — |
| 設定・ヘルプ等の一枚ものページ | `PageLayout`（`src/ui/components/PageLayout/page-layout.tsx`） | — |
| 一時通知 | `useToast()`（`src/ui/components/Toast/toast.tsx`） | `alert()` |
| 破壊操作の確認 | `ConfirmDialog`（`src/ui/components/ConfirmDialog/confirm-dialog.tsx`） | `window.confirm()` |
| 文字列の入力を求める | `TitlePromptDialog`（`src/ui/components/TitlePromptDialog/title-prompt-dialog.tsx`） | `window.prompt()` |
| 描画例外の受け止め | `ErrorBoundary`（`src/ui/components/ErrorBoundary/error-boundary.tsx`） | — |
| `@`/`[[` の用語集サジェスト付き入力欄（blur 確定） | `CommitTextarea`（`src/ui/components/NotationField/commit-textarea.tsx`） | 生の `<textarea>` ＋ 自前サジェスト |
| 記法つき入力（書く／プレビュー切替・マークダウン描画・`[[用語]]` クリック委譲） | `NotationField`（`src/ui/components/NotationField/notation-field.tsx`） | 画面ごとのプレビュー自作 |
| 記法つきテキストの読み取り専用表示（マークダウン描画・`[[用語]]` クリック委譲） | `NotationText`（`src/ui/components/NotationField/notation-text.tsx`） | 画面ごとに `markdownToHtml()` を直に描く自前配線 |
| **入力欄の説明（ラベル横のⓘ＋ダイアログ）** | `FieldHelp`（`src/ui/components/FieldHelp/field-help.tsx`） | 欄の下に説明文を並べる（画面が説明で埋まる） |
| 記法つき欄の「使える記法」説明 | `NotationHelpButton`（`src/ui/components/NotationField/notation-help.tsx`・器は `FieldHelp`） | 画面ごとの説明文自作 |
| 用語 1 項目のチラ見（読み取り専用の詳細表示） | `GlossaryEntryDetail`（`src/ui/components/GlossaryPeek/entry-detail.tsx`） | 画面ごとの項目詳細の自作 |
| 作品/話のナビゲーション | `SideNav` / `TopAppBar` | — |
| 軽量なケバブメニュー（Radix 不使用の作例） | `ProjectMenu`（`src/ui/components/Library/project-menu.tsx`） | — |

**フック `src/ui/hooks/`**（React ライフサイクル依存のものだけを置く）

`useEditorStore` / `useAutosave` / `useAutoSync` / `useAutoBackup` / `useLiveSnapshot` / `useSyncStatus`
/ `useHashRoute` / `useIsNarrow`（+ `NARROW_MAX_PX` `NARROW_QUERY`） / `useKeyboardInset`
/ `useLocalFlag`（localStorage 永続の真偽フラグ） / `usePreferences`（+ `setTheme` `setReadingSize`）
/ `usePenName` `useOpenProfile` `useAccountPenNameSync` `useSaveProfile`（+ `PenNameContext` `ProfileEditContext`・`use-pen-name.ts`）
/ `useBackupMarks`（+ `markLocalBackup` `markCloudBackup` `readBackupMarks`） / `readNudgeAck` `acknowledgeNudge`

**純関数 `src/ui/_utils/`**（React 非依存のヘルパ。ここに無いものだけ新規作成する）

| ファイル | export |
|---|---|
| `format.ts` | `formatRelative`（相対時刻） `formatCount` |
| `download.ts` | `triggerDownload` `readFileText` |
| `clipboard.ts` | `copyText` |
| `exporters.ts` | `episodeNarouExport` `episodeKakuyomuExport` `episodeNovelGameExport` `workEpubExport` `workFolderZipExport` `workAiTextExport` `worksBundleExport`（`ExportFile` を返す・core/exporter への配線） |
| `game-font.ts` | `loadGameFont`（サウンドノベル zip 同梱用の明朝 woff2＋OFL 全文を fetch） |
| `sePlayer.ts` | `playPresetSe`（合成SEのアプリ内試聴。レシピ解釈はプレイヤー側 `novelGamePlayer.ts` と揃える契約） |
| `imageResizer.ts` | `coverToDataUrl` `thumbnailToDataUrl` `gameBgToDataUrl`（持ち込み背景＝長辺1280 WebP＋tone 3色） `gameSpriteToDataUrl`（立ち絵＝長辺1080・透過保持） |
| `caretCoordinates.ts` | `getCaretCoordinates`（textarea のキャレット座標） |
| `cover-tone.ts` | `coverTone` `COVER_TONES` |

**クラス名の結合**: `cn()`（`src/lib/utils.ts` = clsx + tailwind-merge）。自前で文字列連結しない。


### 補助
| ディレクトリ | 責務 |
|---|---|
| `_api/` | サーバ呼び出しの薄いクライアント（`sync` `backup` `billing` `publish` `author` `mcp` `board` `game-assets` `game-templates`＝目録/実体の取得と staff の管理 API） |
| `_utils/` | 純関数（`caretCoordinates` `imageResizer` `exporters` `download` `format` `clipboard` `cover-tone` `audioMeta`＝効果音ファイルの data URL 化と長さ計測・`sePlayer`＝効果音の試聴） |
| `hooks/` | React ライフサイクル依存のみ（`use-autosave` `use-auto-sync` `use-auto-backup` `use-live-snapshot` `use-preferences` `use-narrow` `use-keyboard-inset` `use-pen-name` `use-staff`＝運営か・`enabled` のときだけ `/api/board/me` を見る 等） |
| `sync/` | 同期クライアント。`src/ui/sync/sync-service.ts` が本体（約800行）・`sync-gate` `sync-status` `sync-touch` |
| `src/ui/backup/backup-service.ts` | クラウド全体バックアップの実行 |
| `game/` | 持ち込み素材のクラウド保管の配線（`asset-hosting.ts`＝API 結線と下り取り込み `pullHostedAssets`。ローカルが正・上りは追加時と明示操作のみ）／運営テンプレの目録を画面へ配る `template-catalog.ts`（`useTemplateCatalog`＝アプリで1つの `useSyncExternalStore`・localStorage に控え、`templateBgSrc` `templateSpriteSrc`、`resolveTemplateBackgrounds`＝演出譜が指す目録の画像を実体ごと素材の形にして書き出し・投稿へ、`templateSpriteDataUrl`） |
| `plot/` | プロットの表示ヘルパ（React 非依存・`beat-ui.ts` に `STATUS_UI` `LINE_PALETTE` `lineColorOf` `beatStripeColor` `plainOf` `fmtCount`）。プロット画面と執筆画面のパネルで色・表記を揃える |
| `board/` | 掲示板の表示ヘルパ（React 非依存・`board-ui.ts` に `KIND_UI`／`STATUS_UI` の色・`kindOrder`・`creatableKindOrder(role)`・未読件数・抜粋） |
| `structure/` | React Flow アダプタ（`flow-adapter` `tree-layout` `use-structure-flow` `ensure-structure`） |
| `auth/` | Clerk 配線（`auth-provider` `clerk-gate` `derive-status` `cloud-pricing`） |

---

## 4. `functions/` — Cloudflare Pages Functions

`functions/_middleware.ts` が `/.well-known/*`（OAuth ディスカバリ）を、**自オリジンを名乗る形へ
書き換えて**配る（ChatGPT は MCP ホストの well-known を直接読み、issuer がそのホストと一致することを
求めるため）。実体の窓口は `/api/oauth/*` が Clerk へ中継する。
窓口が `/oauth/*` でなく **`/api/oauth/*`** なのは、Service Worker のナビゲーションフォールバックが
`/api/` だけを除外しているから（`vite.config.ts`）。移すと認可画面がアプリの画面に差し替わる。

| エンドポイント | 責務 |
|---|---|
| `GET /api/sync/manifest` | 同期メタ一覧（本文なし・軽量）。`RemoteWorkMeta[]` |
| `GET /api/sync/version` | 同期世代番号（ポーリング用・超軽量） |
| `/api/sync/work` | Work 1件の同期本体。GET=pull / PUT=CAS push / PATCH=ゴミ箱伝播 / DELETE=purge |
| `POST /api/sync/activity` | 執筆記録の同期 |
| `/api/backup` | クラウド全体バックアップ（セッション非依存） |
| `/api/game-assets` | 持ち込みゲーム素材のクラウド保管（会員のみ・枚数/サイズ上限・暗号化）。GET=一覧/1件 / PUT / DELETE |
| `/game-templates/*` | **運営テンプレの公開読み口**（認証なし・`/api/` の外＝SW がキャッシュする）。`manifest.json`（目録・max-age=300）／`<kind>/<slug>[.thumb].<ext>`（ext は MIME から＝webp/png/jpg/mp3/m4a・`?v=<hash>`・immutable）。実装は `functions/game-templates/[[path]].ts` |
| `/api/admin/templates` | 運営テンプレの管理（**staff だけ・それ以外は 404**）。GET=目録 / PUT=`?kind=&slug=` 投入・置き換え（kind bg/sprite は画像 1.5MB＋サムネ、se は mp3/m4a 2MB＋長さ） / PATCH=表示名・分類・時間帯・並び・非表示・分類の表示名 / DELETE=非表示 |
| `POST /api/hit` | 訪問者集計（Cookie なし） |
| `/api/billing/{checkout,portal,status,reap}` | Stripe Checkout / Portal / 会員状態 / 未課金回収ジョブ |
| `POST /api/webhooks/stripe` | Stripe webhook → D1 `subscriptions` にミラー |
| `GET /api/board/threads` | 掲示板の一覧（`?kind=` `?cursor=`）。**未ログインでも読める** |
| `POST /api/board/threads` | スレ立て（本文＋任意でアンケート）。リンクカードの取得もここ |
| `/api/board/thread` | スレ1本（`?id=`）。GET=詳細 / PATCH=ステータス・ピン・ロック（staff）/ DELETE=自分のスレ |
| `/api/board/posts` | POST=返信（`?thread=`）/ DELETE=自分の投稿（`?id=`） |
| `POST /api/board/like` | 👍 のトグル（`?post=`・**投稿 1 件ごと**。古い `?thread=` はスレ本文への 👍 に写す） |
| `POST /api/board/vote` | アンケートの投票（`?thread=`・1アカウント1票） |
| `POST /api/board/reports` | 通報（作業キューに積むだけ・自動非表示はしない） |
| `/api/board/me` | GET=自分の表示名と投稿 / PUT=表示名の設定・変更（**アカウントのペンネームの正本**） |
| `POST /api/board/moderate` | 運営の措置（非表示・投稿禁止・カードの停止）。**staff のみ** |
| `/api/mcp` | リモート MCP（Streamable HTTP・JSON-RPC 2.0） |
| `/api/mcp/token` | MCP アクセストークン発行（会員のみ） |
| `/api/mcp/oauth-protected-resource` | RFC 9728 メタデータ |
| `/api/oauth/*` | 認可サーバー窓口。`authorize` は Clerk へ 302、`token`/`register` ほかはサーバー側中継 |

`api/_lib/`: `auth`（Clerk 検証・`verifyMember`）, `membership`（**会員判定の単一の真実 = D1 `subscriptions`**）,
`crypto`（at-rest 暗号化）, `mcp-server`（MCP プロトコル核・約1,100行）, `mcp-auth`, `mcp-token`,
`oauth-metadata`, `oauth-upstream`（中継先 Clerk の取得）, `stripe`, `rate-limit`, `purge`, `visitor`,
`board-store`（**掲示板の SQL はすべてここ**・行 ⇄ camelCase の変換も）, `board-link-fetch`（OGP の取得とキャッシュ）,
`staff`（`verifyStaff`＝運営の判定・`board_profiles.role`）, `templates-store`（運営テンプレの R2 キー `_templates/` と目録の読み書き）。

掲示板の共通部品は `functions/api/board/board-endpoint.ts`（`boardJson`＝`private, no-store` 付きの応答、
`rateLimitedResponse`＝分あたりの安全弁、`postQuotaExceeded`＝10件/時、`createPostRetrying`、`conflictResponse`）。
**新しいエンドポイントを足すときはここから使う**（片方だけ緩むと誰も気づけない）。
テスト用の D1 フェイクは `functions/api/board/board-test-util.ts`（`makeBoardDb` `makeBoardEnv` `clerkAuthMock`）。
**SQL そのものを確かめるのは `functions/api/board/real-d1.ts`**（`migrations/` の掲示板 DDL（0008・0009）を順に流した実 SQLite＝`node:sqlite`。フェイクは SQL を解釈しないので構文エラー・曖昧な列名を拾えない。**マイグレーションを足したらここにも足す**）。

**バインディング**（`wrangler.toml`）: `DB` = D1 `novel-studio`、`MEDIA` = R2 `novel-studio-media`
（preview 環境は `-stg` サフィックス）。

**マイグレーション**（`migrations/`）: `0001_init` → `0002_sync_works` → `0003_trash_sync` →
`0004_mcp_tokens` → `0005_subscriptions` → `0006_activity_sync` → `0007_visitor_days` → `0008_board`（掲示板9テーブル）
→ `0009_board_post_likes`（👍 を投稿単位へ。`board_post_likes` ＋ `board_posts.like_count`・旧 `board_likes` は残す）

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
pnpm --dir tools/novel-textlint lint:novel <file>   # 小説原稿の textlint（CI 対象外）
uv run .claude/skills/natural-japanese/scripts/lint.py <file>   # 仕事の文書の AI 臭 lint（要 uv・CI 対象外）
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
| `docs/requirement/04-glossary.md` | 用語集・`@` 参照の仕様 |
| `docs/requirement/08-worldbuilding.md` | 世界観設定（作者専用スロット）の仕様 |
| `docs/requirement/05-sync.md` / `docs/requirement/05-sync-setup.md` | 同期の設計と構築手順 |
| `docs/requirement/06-release-prep.md` | リリース準備 |
| `docs/requirement/07-analytics.md` | アクセス解析 |
| `docs/requirement/07-novel-game.md` | **サウンドノベル書き出し（ゲーム化）の設計**（演出譜・素材・課金の線・G0〜G3） |
| `docs/requirement/09-board.md` | 掲示板（記名式スレッド・お知らせ・アンケート・外部リンクの OGP）の設計と決定表 |
| `public/board-guidelines.html` | 掲示板ガイドライン（`/board-guidelines` で公開・通報や上限の文言はここと揃える） |
| `docs/requirement/99-open-questions.md` | 未決事項 |
| `design/stitch/*/index.html` | 画面のデザインカンプ（+ スクリーンショット） |
