# リリース準備・本番稼働チェックリスト

novel-studio を **本番（production）で実際に動かす**ために必要な手配を、順序付きの実行リストに
まとめたもの。各手順の詳細・背景は `05-sync-setup.md`（セットアップ手順書）を参照。本書は
「何を・どの順で・どのスコープに」やるかの**運用チェックリスト**に徹する。

- **デプロイの仕組み**：GitHub Actions（`.github/workflows/deploy.yml`）が `push` を検知して
  Wrangler でデプロイする。**`main` への push＝本番 / `stg` への push＝ステージング**。
  コード自体のリリースはブランチ操作だけで自動的に回る（手動 deploy 不要）。
- **公開URL**：本番 `https://novel-studio-b2m.pages.dev/` ／ stg `https://stg.novel-studio-b2m.pages.dev/`
  （stg はベーシック認証。プロジェクト名は `novel-studio`）。
- **wrangler の呼び方**：素の `wrangler` は PATH に無い（devDependency）。本書の `wrangler ...` は
  すべて**プロジェクト直下で `pnpm exec wrangler ...`**（または `npx wrangler`）として実行する。
- **鍵の大原則**：`pk_*`（publishable）は mise（`VITE_` 接頭辞）でコミット可。
  `CLERK_SECRET_KEY`・`ENCRYPTION_KEY` 等の秘密は **git にも CI にも載せない**
  （`wrangler pages secret put` か Cloudflare ダッシュボード env、ローカルは `.dev.vars`）。

> ⚠️ このリポジトリには段階がある。**認証だけ（Phase 0＋1）でも、同期本体（Phase 2）でも、
> 外部リソース・鍵が未手配の間はゲスト＝完全ローカル動作**で、既存挙動を壊さない。
> 「殻だけ出す」→「同期を有効化する」を別タイミングで安全に切り替えられる。

---

## A. 一度きりの手配（初回のみ・以後は不要）

リソースと鍵は環境（dev / stg / production）ごとに用意する。スコープを取り違えると秘密漏洩・
別環境汚染につながるので、**どのスコープに入れるか**を必ず確認すること。

> **環境分離の原則（重要）**：本番(production)と stg(preview)は **D1・R2 を別リソースに分離**する。
> `wrangler.toml` のトップレベル binding が local＋本番、`[env.preview.*]` が stg を上書きする
> （Pages は `--branch` が本番ブランチ(main)以外なら自動で preview 環境を適用）。これで stg の
> テスト操作が本番ユーザーデータを汚さない。⚠️ D1・R2 は non-inheritable キーなので、`[env.preview]`
> を使うなら **preview に D1・R2 の両方**を必ず書く（片方だけだとデプロイ検証に落ちる）。

### A-1. Clerk（認証）
- [ ] Clerk で **dev / prod** の 2 アプリを作成し、メール＋パスワード（必要なら OAuth）を有効化。
- [ ] `pk_*`（publishable）を取得 → `mise.staging.toml` / `mise.production.toml` の
      `VITE_CLERK_PUBLISHABLE_KEY` に設定（**コミットする**。設定した瞬間に認証 UI が出る）。
- [ ] `sk_*`（secret）を取得 → `wrangler pages secret put CLERK_SECRET_KEY`（**stg / 本番の各スコープ**）。
- [ ] （推奨・多層防御）`CLERK_AUTHORIZED_PARTIES` に各環境のアプリ URL を設定
      （未設定だと azp 検証がスキップされる。詳細 05-sync-setup §5）。

### A-2. Cloudflare D1（メタデータ・本番／stg で別 DB）
- [ ] 本番 DB：`wrangler d1 create novel-studio` → `database_id` を `wrangler.toml` のトップレベル
      `[[d1_databases]]` に記入（コミット）。現状 id = `811bad99-8040-4c46-9192-26623aeabc99`。
- [ ] stg DB：`wrangler d1 create novel-studio-stg` → `database_id` を `[[env.preview.d1_databases]]`
      に記入（コミット）。現状 id = `b41dafd3-26fb-4e2e-823a-031a3398d4f5`。
- [ ] マイグレーション適用（`0001_init` セッション ＋ `0002_sync_works`）を**両 DB に**:
      - 本番：`pnpm d1:migrate:remote`（= `wrangler d1 migrations apply novel-studio --remote`）
      - stg：`pnpm exec wrangler d1 migrations apply novel-studio-stg --remote --env preview`
        （`--env preview` が無いと `[env.preview]` 配下の DB を見つけられず
        `Couldn't find a D1 DB ... in your wrangler.toml` になる）
      ⚠️ **auto-mode がリモート D1 操作を拒否する**ため、リモート適用は人間が `!` で実行する。
- [ ] 適用確認：`pnpm exec wrangler d1 execute <DB名> --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
      で各 DB に `sessions` / `works` / `rate_limits` が存在すること。

### A-3. Cloudflare R2（同期の本文・画像ブロブ・本番／stg で別バケット）
- [ ] **先にアカウントで R2 を有効化**：Cloudflare ダッシュボード → R2 → 「Enable R2」（規約同意・
      必要なら支払い方法登録）。未有効だと `bucket create` が
      `Please enable R2 through the Cloudflare Dashboard [code: 10042]` で失敗する。
- [ ] 本番バケット：`pnpm exec wrangler r2 bucket create novel-studio-media`
      （トップレベル `[[r2_buckets]]`）。
- [ ] stg バケット：`pnpm exec wrangler r2 bucket create novel-studio-media-stg`
      （`[[env.preview.r2_buckets]]`）。
      ⚠️ **バケット未作成のまま deploy すると Functions が起動時に失敗する**
      （`R2 bucket '...' not found`）。各環境のデプロイは対応するバケットを検証する。
      ※ wrangler はプロジェクトの devDependency。素の `wrangler` は PATH に無いので
      **必ずプロジェクト直下で `pnpm exec wrangler ...`**（または `npx wrangler`）で呼ぶ。

### A-4. `ENCRYPTION_KEY`（at-rest 暗号化鍵・環境ごとに独立）
- [ ] `openssl rand -base64 32` で **base64 32byte ちょうど**の鍵を生成（不正長だと起動時 throw）。
      本番と stg は R2・D1 を分離しているので、**環境ごとに別々の鍵**でよい（推奨：別鍵）。
- [ ] 投入先（**いずれもダッシュボード**で設定）：
      - 本番：Pages → Settings → Variables and Secrets → **Production** に `ENCRYPTION_KEY`（Secret）。
      - stg：同 → **Preview** に `ENCRYPTION_KEY`（Secret）。
      - ローカル：`.dev.vars`（gitignore 済み）。
      ⚠️ **`wrangler pages secret put` は production スコープ固定**（`--environment` 非対応）。
      preview スコープの secret は**ダッシュボードからのみ**設定できる。
- [ ] 生成した鍵を**安全に保管**（チャット等に貼らない）。
      ⚠️ **鍵ローテーション不可（現状）**：差し替えると**その環境の**既存 R2 ブロブが復号不能になり、
      全 work の再 push（＝実質サーバ側データ破棄）が必要。本番投入後の紛失は致命的。

### A-5. stg ベーシック認証（既存・参考）
- [ ] `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` を Cloudflare ダッシュボードの **Preview スコープにのみ**設定
      （本番には設定しない）。CLI 経由の Direct Upload シークレットは `context.env` に届かない既知不具合の
      ため、必ずダッシュボードで設定する。

---

## B. 毎リリースのチェックリスト

コードを stg / 本番に出すたびに通す。

### B-1. リリース前（ローカル / CI で緑）
- [ ] `pnpm typecheck` がクリーン。
- [ ] `pnpm test` が緑（ユニット＋結合）。
- [ ] `"$(pnpm bin)/biome" ci .` が error ゼロ（CI と同一）。
- [ ] `pnpm build` が成功。
- [ ] （同期に触れた変更なら）`pnpm dev:edge` で Functions＋D1(--local)＋R2(--local) のスモーク。

### B-2. ステージング検証
- [ ] `stg` ブランチに push → Actions のデプロイ成功を確認（`gh run watch`）。
- [ ] stg URL（ベーシック認証）で対象機能をスモーク。
- [ ] 同期に変更があるリリースは **`05-sync-setup.md §9` の手動 2 ブラウザ・チェックリスト**を stg で通す。
- [ ] **ゲスト回帰**：サインアウト状態で執筆・書き出し・ローカル保存が無傷（同期 UI が出ない）。

### B-3. 本番反映
- [ ] `main` への PR をマージ → Actions のデプロイ成功を確認。
- [ ] 本番 URL で読み込み・ログイン・同期の最小スモーク。
- [ ] （任意）新しい鍵・マイグレーションを伴うリリースは、A 章の対応スコープが**本番側にも**入って
      いることを再確認（stg だけに入れて本番で 401/500 になる事故を防ぐ）。

---

## C. ロールバック / トラブル時

- **デプロイのロールバック**：Cloudflare Pages ダッシュボードで前のデプロイメントへ即時切替が可能
  （または `main` を直前コミットへ戻して再 push）。
- **マイグレーションは前方のみ**：`0002` 以降にダウン用 SQL は用意していない。スキーマ変更を伴う
  ロールバックは手動 SQL が要る。リリース前に stg で必ず確認すること。
- **同期だけ止めたい**：`VITE_CLERK_PUBLISHABLE_KEY` を外せば全ユーザーがゲスト＝ローカル動作に戻る
  （ローカルデータは無傷）。サーバ側の障害切り分けに使える。

---

## D. スコープ外（将来フェーズ）

- **Phase 4（課金）**：Clerk Billing で member ゲート。設計確定（`05-sync.md` D-SYNC-PRICE）：会員/プラン
  判定＝Clerk JWT クレーム（client `has({plan})`＝UX／server `toAuth().has({plan})`＝強制力）。
  **解約＝期末まで継続予約**（`cancel_at_period_end`、グレース期間は同期継続）。**失効＝Clerk 失効 webhook を
  トリガにクラウドのアカウント＋データ削除＋全端末強制ログアウト**。削除はクラウドのみ・**ローカル原稿は保持**
  （D-PLAN-LOCALDATA）。新規シークレット `CLERK_WEBHOOK_SECRET` が要る（`.dev.vars`／ダッシュボードのみ・
  git/CI 非搭載）。
  - **実装状況**：Slice A（セッションUX）・B（サーバ 402 ゲート `verifyMember`）・C（クライアント
    `deriveStatus`）・D（失効 webhook → R2/D1 purge＋`deleteUser`）・E（アップグレード課金導線＝
    `<PricingTable />` ダイアログ）まで**コード実装済み**（ユニット/結合テスト緑）。
  - **残るは Slice F＝ダッシュボード設定（手作業）**：Clerk Billing 有効化＋プラン作成（slug `cloud`＝
    `src/core/billing/plan.ts` の `PLAN_KEY`）＋webhook 登録＋`CLERK_WEBHOOK_SECRET` 配置。手順は
    **`05-sync-setup.md §10`**。F 完了まで `has({plan})` が常に偽＝全員 402 になるため、**B〜E は stg/本番へ
    push せずローカルコミットで温存**する（F と同時に揃えて push）。
- **セッション UX（Slice A・実装済み）**：別端末ログインで押し出された旧端末は**強制サインアウト（→ゲスト）＋
  トースト1回**で通知（旧「同期停止中」常駐バナーは撤去）。ゲストはヘッダー一律「同期オフ（ログインで同期）」。
- **鍵ローテーション運用**：A-4 の通り現状は単一鍵固定。鍵 ID 付きエンベロープ暗号化等は将来。
