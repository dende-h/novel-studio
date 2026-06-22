# クラウド同期・認証 セットアップ手順（Phase 0＋1）

`docs/requirement/05-sync.md` の設計に基づく、外部リソースの手配と鍵の置き場所の手順書。
コードの足場（`wrangler.toml`・`migrations/`・認証シェル）はリポジトリに入っているが、
**外部リソースが未手配の間はゲスト＝完全ローカル動作**（認証 UI は出ず、既存挙動と同一）。

## 用語と方針
- **公開可の鍵**（`pk_*` publishable key）＝クライアントに露出してよい。mise（`VITE_` 接頭辞）で管理。
- **秘密の鍵**（`CLERK_SECRET_KEY`・`ENCRYPTION_KEY` 等）＝git にも CI にも載せない。
  `wrangler pages secret put`（本番）／`.dev.vars`（ローカル・gitignore 済み）でのみ投入する。

---

## 1. Clerk アプリ作成
1. [Clerk ダッシュボード](https://dashboard.clerk.com) で **dev** と **prod** の 2 アプリを作成。
2. メール＋パスワード（必要なら OAuth）を有効化。
3. 各アプリの API キーから取得:
   - `pk_test_*` / `pk_live_*`（publishable・公開可）
   - `sk_test_*` / `sk_live_*`（secret・非公開）
   - （任意）JWT public key（PEM）＝ネットワークレス検証用 `CLERK_JWT_KEY`

## 2. Cloudflare リソース作成
```bash
wrangler login
wrangler d1 create novel-studio          # 出力の database_id を控える
wrangler r2 bucket create novel-studio-media   # Phase 2 で使用
```

## 3. `wrangler.toml` のバインディング有効化
`wrangler.toml` の `[[d1_databases]]` ブロックのコメントを外し、`database_id` に手順 2 の値を入れる。
（R2 は Phase 2 で有効化。未作成 id のまま deploy すると失敗するので注意。）

## 4. D1 マイグレーション適用
```bash
pnpm d1:migrate:local     # ローカル（wrangler pages dev 用）
pnpm d1:migrate:remote    # 本番 D1
```
`migrations/0001_init.sql`（`sessions` テーブル）が適用される。

## 5. 鍵の配置
### 公開可（mise・コミットする）
`mise.staging.toml` / `mise.production.toml` の以下のコメントを外して設定:
```toml
VITE_CLERK_PUBLISHABLE_KEY = "pk_test_xxx"   # staging
VITE_CLERK_PUBLISHABLE_KEY = "pk_live_xxx"   # production
```
設定された瞬間に認証 UI（ヘッダー右上の「同期するにはサインイン」）が出るようになる。

### 秘密（CLI・コミットしない）
- ローカル：`.dev.vars`（gitignore 済み）に `CLERK_SECRET_KEY` 等を記載。
- 本番：
```bash
wrangler pages secret put CLERK_SECRET_KEY
# 将来 Phase 2 で：wrangler pages secret put ENCRYPTION_KEY
```
> 既存 stg のベーシック認証の秘密はダッシュボード（Preview スコープ）管理で、これとは別系統。

### `CLERK_AUTHORIZED_PARTIES`（推奨・多層防御）
セッション API（`/api/session/*`）は Clerk JWT の署名・期限を検証するが、**発行元オリジン（azp）の
拘束は `CLERK_AUTHORIZED_PARTIES` を設定したときだけ**効く（未設定だと azp 検証はスキップされる）。
別オリジンの正規トークン再利用を防ぐため、各環境のアプリ URL を設定することを推奨:
- ローカル：`.dev.vars` に `CLERK_AUTHORIZED_PARTIES="http://localhost:8788"`
- stg / 本番：ダッシュボード（各スコープ）の env か `wrangler pages secret put CLERK_AUTHORIZED_PARTIES` で
  `https://stg.novel-studio-b2m.pages.dev`（stg）／本番ドメインを設定（カンマ区切りで複数可）。

> 値は秘密ではない（公開オリジン）が、Functions の env として上記の経路で投入する。単一フロントエンド
> 構成では実害は小さいが、本番では設定しておくこと。

## 6. ローカル動作確認
```bash
pnpm build && pnpm dev:edge   # wrangler pages dev で Functions＋D1（--local）込みで起動
```
- サインアップ／サインイン／リロードでセッション維持。
- ログイン直後に `/api/session/claim` が成功。
- 別ブラウザで同じアカウントにログイン → 旧ブラウザで `/api/session/status` が 409 → 同期停止バナー表示。
- サインアウト → ゲストに戻り、ローカルの作品は無傷。

---

## 既知の確認事項（実装/運用時に裏取り）
- `@clerk/clerk-react@5.61.3` は deprecated（Core 3 `@clerk/react` へ改称）。実プロビジョニング前に
  `npx @clerk/upgrade` で `@clerk/react` へ移行することを推奨。Phase 1 のコードは安定版 v5 の API で書いてある。
- `wrangler.toml` 追加後の最初の `wrangler pages deploy` は CI ログを `gh run watch` で監視する
  （`pages_build_output_dir` / `--project-name` 併用時の挙動確認）。
- `compatibility_flags = ["nodejs_compat"]` が `@clerk/backend` に必要かは `dev:edge` で確認。
- `wrangler pages dev` と Vite HMR の共存形（`dist` 配信 or `--proxy`）は運用に合わせて調整。
