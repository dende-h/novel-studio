# 10 — MCP の認可は「窓口だけ自分」の折衷をやめる（ChatGPT 対応）

> 2026-09-04 起案・**原因は STG で実測して確定**、直し方は未決定。
> **窓口だけ自オリジンで実体は Clerk という中間形が原因。名乗る issuer は自分（`…pages.dev`）なのに、
> 認可の応答を返すのは Clerk（`credible-stork-66.clerk.accounts.dev`）で、そこをコトノハは触れない。
> しかも「`iss` を返します」という Clerk の申告まで自分の名前で転載している。** 直すには
> Clerk を素直に指すか、認可サーバーごと自前に持つかのどちらかへ寄せるしかない。
> 実測で他の環（DCR・PKCE・401・各エンドポイント）は全部通ったので、**まず前者を試す**。

## 0. このメモで決めたいこと

1. **自前の認可サーバー（AS）を持つか**。持つなら Clerk は「誰がログインしているか」を答える
   身元確認だけに退き、OAuth の発行・検証はコトノハ側が行う。
2. その前に**ファサードを外す実験**（Clerk の issuer を素直に指す版）を stg で試すか。
   通れば自前 AS は要らない。**実測後は「まずこれを試すべき」に傾いた**——壊れている環が
   書き換え 1 か所だけだと分かったため（→ §2-B）。
3. `search` / `fetch` ツールを足すか。ChatGPT の**開発者モードを使わない人でも読める**ようになる
   代わりに、ツールの見え方が変わる（→ §8-2）。

**スコープ**：ChatGPT（Web の開発者モードおよび通常のコネクタ）から `/api/mcp` へ繋ぐまで。
**対象外**：Claude と Genspark の既存経路（動いているものは壊さないことだけを条件にする）、
MCP のツール設計そのもの、コトノハ-grove- 側の公開 API。

**確かめた範囲**：2026-09-04 に **STG（`stg.novel-studio-b2m.pages.dev`）へ実際に叩いて**
ディスカバリ 4 本・401 のチャレンジ・DCR・認可の飛び先を観測した（生の値は §9）。
**本番（`cotonoha-leaf.org`）は未観測**で、Clerk のインスタンスが違うだけで構図は同じと見ている。
ChatGPT のコネクタ画面そのものは未検証（§2-E の線が残る）。

---

## 1. 前提 — いまの認可は「窓口だけ自分、実体は Clerk」

2026-08 の `acd0299` で、OAuth の窓口を同一オリジンへ移した（本番に入っている）。組み立ては 3 層ある。

**ディスカバリ**（`functions/_middleware.ts:68-99`）。ルート直下の
`/.well-known/oauth-protected-resource` と `/.well-known/oauth-authorization-server`、
それに `/.well-known/openid-configuration` をミドルウェアが横取りする。保護リソースの
メタデータ（PRM）は `resource` に `${origin}/api/mcp`、`authorization_servers` に**自オリジン**を書く。
認可サーバーのメタデータ（AS メタデータ）は Clerk の同名ドキュメントを取ってきて、
`issuer` と各エンドポイントを自オリジンへ差し替えて配る（`oauth-metadata.ts:93-106`）。

**窓口**（`functions/api/oauth/[[path]].ts`）。`/api/oauth/token` などはサーバー側 fetch で
Clerk へ中継し、`/api/oauth/authorize` だけは 302 で Clerk のログイン画面へ飛ばす（`:113`）。
PKCE の値も `resource` も素通しする。

**検証**（`functions/api/_lib/mcp-auth.ts:71-95`）。`/api/mcp` は Bearer を受け、`mcp_` で始まれば
D1 の `mcp_tokens` を引き、そうでなければ Clerk SDK の `authenticateRequest` で OAuth トークンとして
検証する。会員判定は毎回 D1 の `subscriptions` を見る。

この形の要点は、**認可の応答（利用者のブラウザが Clerk から redirect_uri へ戻る 302）が
コトノハを一度も通らない**ことにある。ここを通らない以上、応答の中身は書き換えようがない。

---

## 2. 診断 — 名乗りは自オリジン、応答は Clerk。この食い違いが刺さる

### A. 認可応答の `iss` が一致しない（**実測で確定**・2026-09-04 STG）

RFC 9207 は、認可サーバーが認可応答に自分の `iss` を載せ、クライアントがメタデータの `issuer` と
突き合わせることを定めている。OpenAI はコネクタ用の固定 redirect_uri
（`https://chatgpt.com/connector_platform_oauth_redirect`）を使う条件として、
**`authorization_response_iss_parameter_supported: true` を名乗ること、メタデータの `issuer` と
PRM の `authorization_servers` を同じ値にすること、成功・失敗どちらの認可応答にも `iss` を返すこと**を
挙げている。

いまのコトノハは、前の 2 つを満たし、3 つ目だけを構造的に満たせない。**STG で実測した値がそのまま
証拠になっている**（→ §9）。名乗りは `issuer: https://stg.novel-studio-b2m.pages.dev` で
`authorization_response_iss_parameter_supported: true`、ところが `/api/oauth/authorize` の飛び先は
`https://credible-stork-66.clerk.accounts.dev/oauth/authorize`。`iss` を書き込むのは Clerk で、
その 302 はコトノハを通らない。`buildFacadeAuthServerMetadata` は `issuer` とエンドポイントだけを
差し替えて残りを上流のまま配る（`oauth-metadata.ts:97`）ので、**Clerk の「`iss` を返します」という
申告ごと自オリジンの名前で転載している**。クライアントから見れば
「expected `https://stg.novel-studio-b2m.pages.dev`, received `https://credible-stork-66.clerk.accounts.dev`」。
本番も構図は同じで、Clerk 側が `clerk.cotonoha-leaf.org` に変わるだけ。

利用者の見立て（「認証のときのドメインの違い」）は、この形で当たっていた。

### B. ファサードそのものが唯一の障害物である可能性（確度：中→やや高）

ファサードは「ChatGPT は PRM の `authorization_servers` を辿らず、MCP ホストの well-known を
直接読む」という前提で作った（`_middleware.ts` 冒頭のコメント）。ところが OpenAI の現在の説明は
**PRM を読んでそこから認可サーバーへ辿る**手順で書かれている。前提が変わっていれば、
Clerk の issuer を素直に指すだけで通り、書き換えが唯一の障害物ということになる。
A 以外の鎖（DCR・PKCE・401 のチャレンジ・各エンドポイント）は実測で全部通っているので、
**壊れている環は書き換え 1 か所だけ**という読みが濃くなった。外せば Clerk の issuer で一貫し、
`iss` の不一致は消える。残る不確かさは「ChatGPT が PRM を辿って別ドメインの AS へ行くか」の一点。

### C. `MCP_OAUTH_ISSUER` 未設定で HTML が返る（**否定**・STG は 4 本とも 200 の JSON）

AS メタデータの分岐は `issuer` が無いと `return null` でミドルウェアを抜け（`_middleware.ts:97`）、
そのまま SPA/404 の HTML に落ちる。PRM のほうも `authorization_servers: []` という、
仕様上ありえない空配列を配る。クライアントから見れば「OAuth を実装していないサーバー」で、
エラー文言はディスカバリ失敗になる。STG では値が入っていて、この経路は踏んでいなかった。
ただし**落ちるときは JSON で落ちるべき**なのは変わらないので、堅牢化として残す。

### D. 401 が案内する PRM のパスが標準形でない（**確認**・単独では致命傷ではない）

`/api/mcp` の 401 は `resource_metadata="…/api/mcp/oauth-protected-resource"` を案内する
（`functions/api/mcp/index.ts:50`）。RFC 9728 の標準形は
`…/.well-known/oauth-protected-resource/api/mcp` で、こちらもミドルウェアが同じ内容で配っている。
案内は標準形へ寄せ、非標準パスは互換のため残す。

### E. 開発者モードでないと、書き込みツールはそもそも出ない（確度：高・OAuth とは別問題）

ChatGPT の通常のコネクタ枠は検索と取得に寄せた作りで、任意の MCP ツールを呼べるのは
**開発者モード**（Pro / Plus / Business / Enterprise / Edu、Web 版）に限られる。
OAuth が通っても、開発者モードに入っていなければ `set_episode` を呼ぶところまで行かない。
「繋がらない」の中身がここだった可能性も残るので、実測（§7）では**どの画面のどの文言で失敗したか**を
先に確かめる。

### F. Clerk の動的クライアント登録（DCR）が厳しい（**否定**・ChatGPT と同じ形で通った）

Clerk の DCR は `client_uri` の扱いが RFC 7591 より厳しく、MCP Inspector が弾かれた報告がある。
ChatGPT と同じ形（`client_uri: https://chatgpt.com`・固定 redirect_uri・`token_endpoint_auth_method: "none"`）で
STG に投げたところ**受理された**ので、この線は消えた。なお AS メタデータに
`client_id_metadata_document_supported` は出ていない＝ChatGPT は CIMD ではなく DCR に落ちてくる。

### G. ID トークンでも同じ不一致が起きる（実測・A と同じ病気）

`/.well-known/openid-configuration` は `id_token_signing_alg_values_supported: ["RS256"]` と
`claims_supported` の `iss` を上流のまま配っている。ID トークンを発行するのは Clerk なので、
その `iss` は Clerk のドメイン。OIDC として検証するクライアントは A と同じ理由で落ちる。
`service_documentation` に `https://clerk.com/docs/oauth/scoped-access` がそのまま出ているのも同根で、
**「上流の申告を、自分の名前で配っている」**という 1 つの設計ミスが 3 か所に出ている。

### H. DCR の応答から `refresh_token` が落ちる（未解明・接続が後で死ぬ疑い）

登録要求に `grant_types: ["authorization_code", "refresh_token"]` を入れても、Clerk の応答は
`["authorization_code"]` だけを返す（`scope` には `offline_access` が残る）。更新が本当に効かないなら、
アクセストークンの期限が切れた時点で**繋がっていた接続が黙って死ぬ**。A を直した後に、
実際にトークン交換まで通して確かめる（→ §7 Phase 1 の確認項目）。

### I. 要求スコープに `openid` が混ざると、ログイン直後に弾かれる（**実測で確定**）

**Phase 1 のあと ChatGPT はディスカバリを通過した**（コネクタ画面が Clerk のエンドポイントを検出し、
DCR を選べる状態になった）。それでもログイン後に「接続で問題が発生しました」で落ちる。
手で認可を通したところ、Clerk が理由を返した。

```
error=invalid_scope
error_description=The OAuth 2.0 Client is not allowed to request scope 'openid'.
iss=https://credible-stork-66.clerk.accounts.dev
```

**Clerk は DCR で登録したクライアントに `openid` を許さない。** 登録応答の
`"scope":"email offline_access profile"` がそのままの意味だった（`openid` が無い）。
ChatGPT の `oauth_config` は `default_scopes: null` のままだが、`scopes_supported` を
要求スコープとして送っている。だから **Clerk 由来の 6 個でも、こちらが出した 4 個でも、
`openid` が入っている限り同じ場所で落ちる**。画面には汎用のエラーしか出ないので、
外からは原因が見えない。

ここには 2 つの学びがある。ひとつは、**PRM の `scopes_supported` は「使える一覧」ではなく
「これを要求せよ」という指示として読まれる**こと。1 語間違えると全部落ちる。もうひとつは、
その値を**認可サーバーが実際にそのクライアントへ許すもの**に揃える必要があること
（Clerk の AS メタデータが名乗る 6 個は、DCR クライアントに許される 3 つとは違う）。

対処は `DEFAULT_MCP_SCOPES` を Clerk が DCR クライアントへ割り当てる 3 つ
（`profile email offline_access`）に揃えること。`openid` を入れないことをテストで固定した。

なお、この実測は RFC 9207 の解決も裏づけている——エラー応答に
`iss=https://credible-stork-66.clerk.accounts.dev` が付き、PRM の `authorization_servers` と一致する。
Phase 1 前ならここで不一致になっていた。

---

## 3. ChatGPT 側の要件（2026-09 時点で確認できたぶん）

| 要件 | 内容 | いまの実装 |
|---|---|---|
| PRM | `/.well-known/oauth-protected-resource` を置き、`resource` と `authorization_servers` を書く | 満たす |
| AS メタデータ | `issuer` が PRM の `authorization_servers` と一致 | 満たす（名乗りだけ） |
| 認可応答の `iss` | 成功・失敗の両方で返す。メタデータの `issuer` と完全一致 | **満たせない**（§2-A） |
| PKCE | S256 必須 | `code_challenge_methods_supported: ["S256"]`・**実測で問題なし** |
| クライアント登録 | CIMD 優先、DCR も可 | DCR が**実測で通る**。CIMD は名乗っていない（§2-F） |
| `resource` | RFC 8707 を送ってくる | 素通し・**検証していない** |
| 固定 redirect_uri | `https://chatgpt.com/connector_platform_oauth_redirect` | DCR で**そのまま登録できた** |
| ツール | 書き込みは開発者モードのみ | 27 ツール（§2-E） |

---

## 4. 選択肢 — 「応答を自分で返せるか」で分かれる

| | 案1 ファサード撤去（Clerk 直指し） | 案2 ファサード＋コールバック | 案3 自前 AS（本命） |
|---|---|---|---|
| 直る確度 | 中〜高（§2-B。他の環は実測で通っている） | 中（実質は案3の劣化版） | 高（要件を全部自分で満たせる） |
| `iss` を返せるか | Clerk の issuer で一貫（不一致は消える） | 返せる | 返せる |
| 実装量 | 削るだけ（数十行） | 中（結局トークンを自分で発行することになる） | 大（AS 一式＋同意画面＋D1 4 表） |
| 既存利用者への影響 | なし | なし | なし（検証は 3 系統の併存・§5 D-OAUTH-COMPAT） |
| 抱える責任 | Clerk 任せのまま | 中途半端に両方 | **PKCE・コード再利用・リダイレクト検証を自分で持つ** |
| 将来 | Clerk の OAuth 仕様変更に毎回振られる | 同上 | 仕様追従を自分の手で打てる |

案2 は、Clerk へ渡す redirect_uri を自分のコールバックにして応答を書き換える形だが、
Clerk 側に登録できる redirect_uri は 1 つのクライアントに紐づくので、下流の多数のクライアントを
1 つに束ねる＝**結局こちらでトークンを発行する**ことになる。案3 との差は「身元確認を Clerk の
セッションで取るか OAuth で取るか」だけで、労力はほぼ変わらない。**案2 は採らない。**

**現時点の傾き**：まず案1 を stg で試し、通らなければ案3。実測前は案1 に賭けていなかったが、
**A 以外の環が全部通っていた**（DCR・PKCE・401・エンドポイント）ので、壊れている 1 か所を外すだけで
繋がる目が出てきた。残る不確かさは「ChatGPT が PRM を辿って別ドメインの AS へ行くか」だけで、
これは stg に 1 回デプロイすれば答えが出る。案1 で通らなかったときも、その失敗が
「同一ホストの AS メタデータを要求している」という証拠になり、案3 の裏づけになる。

---

## 5. 設計（案3・自前の認可サーバー）

| ID | 決定 |
|---|---|
| **D-OAUTH-SELF** | **認可サーバーはコトノハ自身**。`issuer` ＝ `https://cotonoha-leaf.org`（stg は自分の preview オリジン）で、AS メタデータは Clerk から取ってこず自分で組む。Clerk は「いま誰がログインしているか」を答える身元確認に退く。`MCP_OAUTH_ISSUER` と `oauth-upstream.ts` は**互換のため残す**（既存の Clerk 発行トークンを検証し続ける・D-OAUTH-COMPAT）。 |
| **D-OAUTH-ISS** | 認可応答は**必ず `iss` を付ける**（成功・`access_denied`・`invalid_scope` すべて）。メタデータには `authorization_response_iss_parameter_supported: true` を書く。名乗りと応答を同じコードで組み立て、テストで固定する（§2-A の再発防止）。 |
| **D-OAUTH-CONSENT** | 同意画面は**アプリ内の画面**にする。`GET /api/oauth/authorize` はパラメータを検査して D1 に一時保存し、`#/connect?rid=…` へ 302 する。画面は Clerk のログイン状態をそのまま使い（未ログインなら既存の `openSignIn` モーダル。ページ URL は変わらないので戻り先の受け渡しが要らない）、許可を押したら `POST /api/oauth/approve` が**認可コードを発行して飛び先の URL を返す**。承認 API の認証は既存の Clerk Bearer 経路（`verifyMember`）をそのまま使う＝Workers 側で Cookie とハンドシェイクを相手にしない。 |
| **D-OAUTH-PKCE** | **公開クライアントのみ・PKCE S256 必須**。`code_challenge` 無し、`plain`、`client_secret` 前提の登録はすべて拒否。`token_endpoint_auth_methods_supported: ["none"]`。 |
| **D-OAUTH-REDIRECT** | `redirect_uri` は登録済みの値と**完全一致**でのみ許す（前方一致もワイルドカードも無し）。一致しないときは**リダイレクトせず**、その場でエラー画面を返す（オープンリダイレクタを作らない）。 |
| **D-OAUTH-CLIENT** | クライアント登録は 2 経路。**CIMD**（`client_id` が https の URL）は文書を取得して `client_id` フィールドが取得元 URL と一致することを確かめ、24 時間キャッシュする。**DCR**（`POST /api/oauth/register`）は RFC 7591 の最小形（`redirect_uris` 必須・`token_endpoint_auth_method: "none"`）で受け、D1 に積む。メタデータに `client_id_metadata_document_supported: true` と `registration_endpoint` を出す。DCR は無認証で開くので**レート制限を必ず付ける**（既存 `checkRateLimit` はキーが `user_id` の 1 行なので、そのままは使えない。IP 単位の別表か、`dcr:<ip>` をキーにした派生を足す）。 |
| **D-OAUTH-RESOURCE** | `resource`（RFC 8707）を受け取ったら `${origin}/api/mcp` と突き合わせ、違えば `invalid_target`。発行したトークンにも resource を刻み、`/api/mcp` は自分向けのトークンだけ受け付ける。**いまは誰向けのトークンでも通る**ので、これはセキュリティ上の前進でもある。 |
| **D-OAUTH-TOKEN** | アクセストークンは不透明なランダム 32 byte（接頭辞 `mcpa_`）、リフレッシュは `mcpr_`。**平文は保存せず SHA-256 のみ**（`mcp_tokens` と同じ作法・`mcp-token.ts` の `hashMcpToken` を流用）。アクセスは 1 時間、リフレッシュは 90 日で**使うたびに回転**（旧トークンは即失効。再利用を検知したらその系統をまとめて失効）。認可コードは 60 秒・1 回限り。 |
| **D-OAUTH-COMPAT** | `/api/mcp` の検証は**3 系統の併存**にする。`mcp_`（既存の長期トークン）→ `mcpa_`（自前 OAuth）→ Clerk SDK 検証（既存の Clerk 発行 OAuth トークン）の順。**Clerk 経路は消さない**——Claude で既に繋いでいる利用者のトークンが生きているので、消すと次のリフレッシュまで気づかれずに切れる（CLAUDE.md「後方互換性」）。会員判定は今までどおり毎回 D1。 |
| **D-OAUTH-403** | 非会員が認可しに来たときは、**403 の JSON でなく同意画面で断る**。「AI に繋ぐにはクラウドプランが必要です」とプランへの導線を出す。いまは接続を押した先で汎用の失敗表示になって理由が分からない。`/api/mcp` 側の 403（`index.ts:169`）は fail-closed のまま残す。 |
| **D-OAUTH-DISCOVERY** | ディスカバリは**落ちるときも JSON**。`/.well-known/oauth-authorization-server`（＋ `/.well-known/openid-configuration`、＋ RFC 8414 のパス付き形）を自分で組んで返し、SPA の HTML に落とさない（§2-C）。401 の `resource_metadata` は標準パスへ寄せる（§2-D）。 |

### 置き場所

純ロジック（パラメータ検査・PKCE 照合・メタデータ組み立て・飛び先 URL 生成）は
`functions/api/_lib/oauth-server.ts` に置き、SQL は `oauth-store.ts` に分ける
（掲示板の `board-store.ts` と同じ分け方）。`src/core/` には置かない——UI と共有しないサーバー専用の
判断で、React 非依存の境界を跨がない。SQL は掲示板と同じく実 SQLite に当てるテスト
（`board/real-d1.ts` の作法）を用意する。同意画面は
`src/ui/components/OAuthConsent/`、API クライアントは `src/ui/_api/oauth.ts`。

### D1（migration `0010_oauth.sql`）

`oauth_clients`（client_id・種別 dcr/cimd・redirect_uris の JSON・名前・登録時刻）、
`oauth_requests`（同意画面へ渡す一時領域。rid・client_id・redirect_uri・state・scope・resource・
code_challenge・失効時刻）、`oauth_codes`（コードのハッシュ・user_id・client_id・redirect_uri・
code_challenge・resource・失効時刻）、`oauth_tokens`（トークンのハッシュ・種別・user_id・client_id・
scope・resource・失効時刻・回転元）。期限切れの掃除は token 発行のたびに同じトランザクションで
まとめて消す（cron を増やさない）。

### 画面と文言

接続ダイアログ（`McpConnectDialog`）のタブは今 `claude` / `genspark` の 2 つ。ChatGPT を足し、
**開発者モードの入れ方から書く**（§2-E）。同意画面の文言は `toc-copy` スキルの語彙で書く。

---

## 6. テストで固定すること

`iss` が成功・拒否の両方に付くこと。`redirect_uri` 不一致でリダイレクトしないこと。
`code_challenge` 無しを拒むこと。コードが 2 回使えないこと。リフレッシュの回転と再利用検知。
`resource` 不一致で `invalid_target`。**`mcp_` と Clerk 発行トークンが従来どおり通ること**
（D-OAUTH-COMPAT の回帰。既存テスト `mcp-auth.test.ts` を壊さない）。
ディスカバリが常に JSON で、`issuer` が PRM の `authorization_servers` と一致すること。

---

## 7. 段取り

**Phase 0（実測）— 2026-09-04 に STG で完了**。ディスカバリ 4 本・401 のチャレンジ・DCR・
認可の飛び先を観測した（生の値は §9）。結果は §2 の各項に反映済み——A と D と G を確認、C と F を否定、
H が新しく出た。**残りは ChatGPT のコネクタ画面での実地確認だけ**（どの画面のどの文言で落ちるか。
とくに §2-E の開発者モードの線）。本番（`cotonoha-leaf.org`）は同じ手順で叩けば確かめられるが、
STG と同じ結果になるはずなので急がない。

**Phase 1（実験）— 2026-09-04 に STG へデプロイ済み。ディスカバリは通過、認可後にまだ失敗**。ファサードの**書き換えだけ**を外した。PRM の
`authorization_servers` は Clerk の issuer を指し、`/.well-known/oauth-authorization-server` と
`/.well-known/openid-configuration` は **JSON の 404**（HTML に落とさない＝§2-C の堅牢化も同時に果たす）。
**`/api/oauth/*` の中継そのものは残す**——既存クライアントがそこを token_endpoint として覚えている
可能性があり、消すと更新が切れる。401 の `resource_metadata` は標準パスへ寄せた（§2-D）。
`buildFacadeAuthServerMetadata` は使われなくなったので消し、代わりに `functions/_middleware.test.ts` で
**「自オリジンを認可サーバーとして名乗らない」を機械で固定**した（同じ穴に落ちないため）。

**結果**：ChatGPT はディスカバリを通過した（コネクタ画面が Clerk のエンドポイントを検出し、DCR を
選べる状態になった）。§2-A と §2-B は解決。ただし認可後に失敗が残り、`oauth_config` から §2-I
（スコープが空）が見つかったので、PRM に既定スコープを出す修正を足した。**その効果は次の
デプロイで確認する。**

これでも直らないときの残りの容疑者は 3 つ。Clerk が RFC 8707 の `resource` を拒む、
コトノハの OAuth 検証がトークンを受け取れない（401）、会員判定で弾いている（403・ChatGPT で
ログインしたアカウントが STG の `subscriptions` に無い）。手で認可コードを取ってトークン交換まで
通せば、ChatGPT を介さずにどれかが決まる。

**Phase 2（本命）**。§5 の自前 AS を stg で実装し、ChatGPT・Claude・MCP Inspector の 3 つで通す。
Claude の既存接続が生きていることを確認してから本番へ。

**Phase 3（後追い）**。接続ダイアログに ChatGPT のタブ、同意画面の文言、`search` / `fetch`（§8-2）。

---

## 8. 未解決の論点

**1. `/.well-known/openid-configuration` をどう名乗るか。** 自前 AS は OIDC プロバイダではないので、
OAuth のメタデータをそのまま置くと `jwks_uri` や `id_token_signing_alg_values_supported` を
欠いた不完全な OIDC 文書になる。**暫定スタンス**：同じ内容を置く。MCP クライアントはここを
AS メタデータの代替として読むだけで、厳密な OIDC 検証をするクライアントは MCP の文脈にいない。
実測で弾かれたら 404 に切り替える。

**2. `search` / `fetch` を足すか。** 足せば開発者モードなしの ChatGPT でも「読む」用途で使える。
一方でツールが 29 になり、既存クライアントの選択肢も増える。**暫定スタンス**：Phase 3 で足す。
本文を読ませたい相談（「この設定と矛盾していない？」）は開発者モードなしの層のほうが多いと見る。

**3. Clerk のセッションを Workers で直接読む道を捨ててよいか。** D-OAUTH-CONSENT は
同意画面を SPA に置いて既存の Bearer 経路に寄せる設計だが、`authorize` の中で Cookie を検証できれば
画面を 1 枚省ける。**暫定スタンス**：省かない。同意画面は「何を許すのか」を見せる場所として
それ自体に価値があり、非会員への案内（D-OAUTH-403）も置ける。

**4. 開発者モードの案内をどこまで書くか。** ChatGPT 側の UI は変わりやすく、手順を細かく書くほど
陳腐化する。**暫定スタンス**：接続ダイアログには「設定 →コネクタ →開発者モード」程度に留め、
詳しい手順は掲示板のお知らせスレに置いて直しやすくする。

---

## 9. 測定ログ（2026-09-04・STG）

`https://stg.novel-studio-b2m.pages.dev` に対して観測した生の値。要点だけ抜く。

**PRM**（`/.well-known/oauth-protected-resource` と `…/api/mcp` は同一内容）

```json
{"resource":"https://stg.novel-studio-b2m.pages.dev/api/mcp",
 "authorization_servers":["https://stg.novel-studio-b2m.pages.dev"],
 "bearer_methods_supported":["header"],"resource_name":"コトノハ-leaf-"}
```

**AS メタデータ**（`/.well-known/oauth-authorization-server`・抜粋）

```json
{"issuer":"https://stg.novel-studio-b2m.pages.dev",
 "authorization_endpoint":"https://stg.novel-studio-b2m.pages.dev/api/oauth/authorize",
 "registration_endpoint":"https://stg.novel-studio-b2m.pages.dev/api/oauth/register",
 "code_challenge_methods_supported":["S256"],
 "token_endpoint_auth_methods_supported":["client_secret_basic","none","client_secret_post"],
 "id_token_signing_alg_values_supported":["RS256"],
 "service_documentation":"https://clerk.com/docs/oauth/scoped-access",
 "authorization_response_iss_parameter_supported":true}
```

**401 のチャレンジ**（`POST /api/mcp`）

```
www-authenticate: Bearer error="invalid_token",
  resource_metadata="https://stg.novel-studio-b2m.pages.dev/api/mcp/oauth-protected-resource"
```

**DCR**（ChatGPT と同じ形で `POST /api/oauth/register`）。受理された。ただし要求した
`grant_types` のうち `refresh_token` が応答から落ちている（§2-H）。

```json
{"client_id":"vPk9CHmgFL7KzH2u","client_name":"chatgpt-probe","client_uri":"https://chatgpt.com",
 "redirect_uris":["https://chatgpt.com/connector_platform_oauth_redirect"],
 "grant_types":["authorization_code"],"scope":"email offline_access profile",
 "token_endpoint_auth_method":"none","application_type":"web"}
```

**認可の飛び先**（`GET /api/oauth/authorize` の `Location`）。ここが決め手。

```
https://credible-stork-66.clerk.accounts.dev/oauth/authorize?...
```

名乗った issuer は `https://stg.novel-studio-b2m.pages.dev`、応答を書くのは
`https://credible-stork-66.clerk.accounts.dev`。**この 2 つが一致しないまま
「`iss` を返します」と宣言している**のが §2-A。

なお、この測定で STG の Clerk に `chatgpt-probe`（`vPk9CHmgFL7KzH2u`）というクライアントが
1 件登録された。**用が済んだら Clerk ダッシュボードから消す。**
