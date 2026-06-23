# クラウド同期・認証 セットアップ手順（Phase 0＋1＋2）

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
R2 の `[[r2_buckets]]`（binding `MEDIA`）は Phase 2 でリポジトリに入っている。手順 2 でバケットを
作成済みなら追加設定は不要だが、**未作成のまま deploy すると Functions が起動時に失敗する**ので注意。

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
wrangler pages secret put ENCRYPTION_KEY     # Phase 2（同期本体）。詳細は §7。
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

## 7. Phase 2（同期本体）の手配

Phase 2 は Work をクラウドと双方向同期する本体。コードの足場はリポジトリに入っている
（`functions/api/sync/*`・`migrations/0002_sync_works.sql`・`src/core/sync/*`・`src/ui/sync/*`・
`wrangler.toml` の R2 binding）。**外部リソースと鍵が未手配の間は、ログインしても同期 API が
401/失敗してローカル動作のまま**（既存挙動を壊さない）。手配は次の 3 つ。

### 7-1. R2 バケット作成（手順 2 で未実施なら）
```bash
wrangler r2 bucket create novel-studio-media
```
binding 名 `MEDIA` は `functions/api/sync/work.ts` の `Env.MEDIA` に対応（`wrangler.toml` 設定済み）。

### 7-2. `ENCRYPTION_KEY`（at-rest 暗号化鍵・Workers Secret）
サーバは平文 part を gzip → AES-GCM で暗号化して R2 に置く（`functions/api/_lib/crypto.ts`）。
鍵は **base64 でデコードして 32byte ちょうど**（不正だと `importKey` が起動時に throw）。生成:
```bash
openssl rand -base64 32        # 例: 44 文字の base64（= 32byte）。これを鍵に使う。
```
投入先（git にも CI にも載せない）:
- ローカル：`.dev.vars`（gitignore 済み）に `ENCRYPTION_KEY="＜上で生成した base64＞"`
- stg / 本番：`wrangler pages secret put ENCRYPTION_KEY`（各スコープに投入）

> ⚠️ **鍵ローテーション不可（現状）**：この鍵は既存ブロブの復号にそのまま使う。差し替えると
> 既存 R2 オブジェクトが復号不能になる。再生成が必要なら全 work の再 push（実質サーバ側データ破棄）
> を伴う。本番投入後は鍵を確実に保管すること。鍵管理の高度化は将来フェーズ。

### 7-3. `0002_sync_works.sql` の適用
```bash
pnpm d1:migrate:local      # ローカル（wrangler pages dev 用）。works / rate_limits を作成。
pnpm d1:migrate:remote     # 本番 D1。← 手動運用（下記）。
```
> ⚠️ **リモート適用は手動**：このエージェント環境では auto-mode がリモート D1 への破壊的操作を
> 拒否するため、`d1:migrate:remote` は**人間が手元のターミナルで実行する**。セッション内で
> `! pnpm d1:migrate:remote` と打てば出力をこの会話に取り込める。適用後 `wrangler d1 execute
> novel-studio --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` で
> `works` / `rate_limits` の存在を確認する。

## 8. Phase 2 ローカル動作確認
```bash
pnpm build && pnpm dev:edge   # Functions＋D1(--local)＋R2(--local) 込みで起動
```
- 作品作成 → autosave（~30s coalesce） → `PUT /api/sync/work` が 200、R2 に `<userId>/<workId>/doc`
  が入り D1 `works` に upsert される。
- リロード → `GET /api/sync/manifest` ＋差分 pull で復元される。
- coverImage / 図鑑 thumbnail を変えたときだけ `media` part が送られる（本文だけの編集では doc のみ）。
- 別ブラウザで同アカウントにログイン → 旧端末の push が **409 → 同期停止バナー**、新端末で最新が pull。
- ゴミ箱へ移動は何も送らない／purge で D1 `deleted=1` ＋ R2 削除。
- 25MB 超の work → 413、容量逼迫 → 507 で**同期だけ止まり**、ローカルの執筆・書き出しは継続。

## 9. 手動 2 ブラウザ・チェックリスト（受け入れ）
Clerk ログインの自動化は不安定なため、双方向同期の受け入れは**実ブラウザ 2 つ（A・B、別プロファイル）**で
手動確認する。`05-sync.md` §8 と対応。各項目を stg で 1 回通す。

- [ ] **復元**：A で作品を作り少し書く → 30s 待つ（autosave push）→ B で同アカウントにログイン →
      A の作品が B に現れる（pull 復元）。
- [ ] **双方向**：B で本文を編集 → 30s → A をリロード（or「今すぐ同期」）→ A に B の変更が反映。
- [ ] **画像差分**：B で本文だけ編集 → push 後、R2 の media オブジェクトの更新日時が変わらない
      （doc のみ送信。DevTools の Network で PUT body の `parts` が `['doc']`）。
- [ ] **競合 LWW**：A・B を一旦オフラインにし両方で同じ作品を別々に編集 → 先に B をオンライン →
      後で A → 新しい方が採用され、**負けた版が端末の履歴（snapshot）に退避**されている。
- [ ] **削除伝播**：A で作品を purge（ゴミ箱→完全削除）→ B で pull → B から消え、消える前の版が
      B の snapshot に退避。
- [ ] **superseded**：A でログイン中に B で同アカウントにログイン → A が「別端末でログイン」バナー、
      A の push が 409 で停止。A で再ログインすると A 側がアクティブに戻る。
- [ ] **オフライン継続**：機内モードで執筆・書き出しが動き、「オフラインのため保留」バナー →
      復帰で自動 flush（or「今すぐ同期」）。
- [ ] **ゲスト回帰**：サインアウト → 同期 UI が消え、ローカルの全作品が無傷で編集・書き出しできる。

---

## 既知の確認事項（実装/運用時に裏取り）
- `@clerk/clerk-react@5.61.3` は deprecated（Core 3 `@clerk/react` へ改称）。実プロビジョニング前に
  `npx @clerk/upgrade` で `@clerk/react` へ移行することを推奨。Phase 1 のコードは安定版 v5 の API で書いてある。
- `wrangler.toml` 追加後の最初の `wrangler pages deploy` は CI ログを `gh run watch` で監視する
  （`pages_build_output_dir` / `--project-name` 併用時の挙動確認）。
- `compatibility_flags = ["nodejs_compat"]` が `@clerk/backend` に必要かは `dev:edge` で確認。
- `wrangler pages dev` と Vite HMR の共存形（`dist` 配信 or `--proxy`）は運用に合わせて調整。
