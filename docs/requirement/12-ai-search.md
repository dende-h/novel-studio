# 12 — 検索と AI 検索からの流入（COT-22〜28 の leaf 側）

> 2026-10-08 起案・同日 leaf のコード分を実装（ブランチ `feat/cot-22-24-ai-search`）。
> **AI に聞かれたとき、コトノハ-leaf- の強みと「MCP で自分の AI からつなげる」ことを正しく答えてもらう。**
> そのために、JS を実行しないクローラーにも読める案内（静的ページ・llms.txt・JSON-LD）と、
> MCP サーバーの名刺（Server Card）を置いた。leaf は学習用クローラーも許可する（§1）。

## 0. 決めたこと

| # | 決定 | 理由 |
|---|---|---|
| D-AIS-TRAIN | **leaf は学習用 AI クローラーも許可する。grove だけ拒否する。** COT-23・COT-25 の「両方拒否」は改めた | leaf は原稿を公開していない（ローカルファースト）ので、学習を拒む本文が無い。拒むと AI の元の知識にコトノハ-leaf- が入らず、検索で引けたときにしか勧められなくなる。grove は利用者の作品を載せているので拒否を守る |
| D-AIS-PRIVATE | **利用者のデータの窓口（/api/）は、どのホストでも索引に載せない** | バックアップ・同期・MCP・OAuth はすべて /api/。守りの本体は認証で、robots.txt の Disallow と X-Robots-Tag は重ねがけ（`functions/_middleware.ts` の `isPrivatePath`） |
| D-AIS-PAGE | **AI 連携の案内は、JS なしで全文が読める静的ページ `/lp/ai/` に置く** | `/` は SPA で、JS を実行しない AI クローラーには空に見える。LP の MCP の説明は一段落しかなかった |
| D-AIS-CATALOG | **AI 向けのカタログは 4 層にする**：`/lp/ai/`（人と AI が読む HTML）／`/llms.txt`・`/llms-full.txt`（Markdown）／JSON-LD（`/`・`/lp/`・`/lp/ai/`）／MCP Server Card＋AI Catalog | 読み手ごとに入口が違う。AI 検索は HTML、LLM 向けツールは llms.txt、検索エンジンは JSON-LD、MCP クライアントと目録は Server Card を読む |
| D-AIS-REGISTRY | **公式 MCP Registry に `org.cotonoha-leaf/leaf` で載せる**（HTTP 認証） | 主な読み手は GitHub（VS Code）などの二次レジストリ。Registry はまだ preview で、Claude や ChatGPT が直接読む一次情報は見つかっていない（2026-10 時点）。費用はほぼゼロなので載せておく |

## 1. 置いたもの

| パス | 中身 | 正本・見張り |
|---|---|---|
| `/robots.txt` | `User-agent: *` に `Content-Signal: search=yes, ai-input=yes, ai-train=yes`、`Disallow: /api/` | `functions/static-seo.test.ts`（どのグループも /api/ を閉じる・全体を閉じない） |
| `/llms.txt` | 概要と主要ページ（llmstxt.org の形） | 同上（H1・引用・絶対 URL） |
| `/llms-full.txt` | 機能・料金・MCP のつなぎ方・ツール一覧・原稿の扱いの全部 | 同上（ツール一覧が `MCP_TOOLS` と過不足なく一致） |
| `/lp/ai/` | AI 連携（MCP）の案内ページ | 同上（ツール一覧・FAQ と JSON-LD の一致） |
| `/lp/` | JSON-LD（Organization・WebSite・WebApplication・FAQPage）、FAQ に MCP の 1 問、`/lp/ai/` への導線 | 同上（FAQ と JSON-LD の一致・料金・meta description） |
| `/`（index.html） | JSON-LD（WebSite・WebApplication の最小構成）と `<noscript>` の説明 | 同上 |
| `/sitemap.xml` | `/lp/ai/` を追加、更新日を更新 | 同上（public/ の静的 HTML がすべて載っている） |
| `/.well-known/ai-catalog.json` | AI Catalog（SEP-2127）。名刺の URL を指す | `functions/_middleware.ts`・`_middleware.test.ts` |
| `/api/mcp/server-card` | MCP Server Card。名前・説明・版・接続先 | `functions/api/_lib/server-card.ts`・`server-card.test.ts`（`server.json` と一致） |
| `/.well-known/mcp-registry-auth` | MCP Registry の HTTP 認証用の公開鍵 | 秘密鍵はリポジトリの外（§3） |
| `server.json`（リポジトリ直下） | MCP Registry に出す定義 | `server-card.test.ts` |

SW（PWA）のナビゲーション置き換えから、llms.txt・robots.txt・sitemap.xml・.well-known を外した
（`vite.config.ts` の `navigateFallbackDenylist`）。一度アプリを開いた人が直接開いても、アプリの画面に化けない。

## 2. 直すときの約束

- **MCP のツールを足し引きしたら**、`/lp/ai/` と `/llms-full.txt` のツール一覧も直す（テストが落ちて知らせる）。
- **MCP の版（`SERVER_INFO.version`）を上げたら**、`server.json` の `version` も上げ、本番に出たあと
  Registry へ出し直す（§3）。Registry の版は出したら変えられず、同じ版は二度出せない。
- **接続手順の文言は 4 か所を揃える**：接続画面（`McpConnectDialog`）・ヘルプ（`HelpPage`）・`/lp/ai/`・`/llms-full.txt`。
- **LP の FAQ を直したら**、`/lp/` の JSON-LD の FAQPage も同じ文言に直す（テストが落ちて知らせる）。
- **静的ページを足したら** sitemap にも足す。規約類や LP を直したら、同じコミットで sitemap の `lastmod` も直す。
- 料金を変えたら、LP の表示・JSON-LD の `offers`・`/lp/ai/`・`/llms.txt`・`/llms-full.txt` を一緒に直す。

## 3. 本番に出たあとの作業（管理画面・手作業）

### 3-1. MCP Registry へ載せる（COT-24 の延長・D-AIS-REGISTRY）

前提：本番の `https://cotonoha-leaf.org/.well-known/mcp-registry-auth` が 200 で公開鍵を返すこと
（リダイレクト・チャレンジがあると認証に落ちる）。秘密鍵は `~/.config/cotonoha-leaf/mcp-registry-ed25519.pem`
（権限 600・2026-10-08 作成）。失くしたら鍵を作り直し、公開鍵のファイルを差し替えて本番に出す。

```bash
# mcp-publisher（Linux 版のリリースバイナリ）
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_linux_amd64.tar.gz" | tar xz mcp-publisher
PRIVATE_KEY="$(openssl pkey -in ~/.config/cotonoha-leaf/mcp-registry-ed25519.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
./mcp-publisher login http --domain cotonoha-leaf.org --private-key "$PRIVATE_KEY"
./mcp-publisher publish   # リポジトリ直下の server.json を出す
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=org.cotonoha-leaf/leaf"
```

署名の時刻は Registry の時計と ±15 秒以内である必要がある（WSL の時計がずれていたら合わせる）。

### 3-2. Cloudflare で grove の学習用クローラーを止める（COT-25 を D-AIS-TRAIN に合わせて）

leaf と grove は同じゾーン（`cotonoha-leaf.org`）にある。**ゾーン全体で止めると leaf も止まる**ので、
ホスト名で分ける。

1. ダッシュボード → ゾーン `cotonoha-leaf.org` → **AI Crawl Control** を開き、用途が Training の
   クローラー（GPTBot・ClaudeBot・CCBot・Bytespider・meta-externalagent など）を Block にする。
   Search と Agent（OAI-SearchBot・Claude-SearchBot・PerplexityBot・ChatGPT-User・Claude-User）は Allow のまま。
   「Block AI Scrapers and Crawlers」の一括トグルは使わない（引用用まで止まる）。
2. AI Crawl Control が作る WAF カスタムルール「AI Crawl Control」を開き、式に
   `and http.host eq "grove.cotonoha-leaf.org"` を足す（この編集は、のちのダッシュボード操作でも保たれる）。
3. Security Settings の「Configure AI bot policies」が、leaf を巻き込む設定（Block on all pages）に
   なっていないか確かめる。
4. 確認：
   - `curl -A GPTBot https://grove.cotonoha-leaf.org/` → 403
   - `curl -A GPTBot https://cotonoha-leaf.org/lp/` → 200（leaf は許可）
   - `curl -A OAI-SearchBot https://grove.cotonoha-leaf.org/` → 200
5. 1 週間後に AI Crawl Control の統計で Blocked と、許可したクローラーのアクセス数を見る。

`cf.verified_bot_category`（`AI Crawler` など）で書く方法もあるが、Bot Management の変数で、
無料プランで使えるかは確かめられていない。上の手順は無料プランでも通る。

### 3-3. Bing Webmaster Tools（COT-26）

1. https://www.bing.com/webmasters で `cotonoha-leaf.org` を追加する（Google Search Console からの取り込みが最短）。
2. `https://cotonoha-leaf.org/sitemap.xml` を送信する。grove は G-1（COT-18）のあとで同じ手順。
3. 確認：sitemap が「成功」、`site:cotonoha-leaf.org` の Bing 検索で `/lp/` と `/lp/ai/` が出る。

### 3-4. 構造化データの確認（COT-22）

- schema.org の Validator（https://validator.schema.org/）で `/`・`/lp/`・`/lp/ai/` がエラー 0。
- Google のリッチリザルトテストの「エラー 0」は完了条件にしない。ソフトウェアアプリのリッチリザルトは
  評価かレビューが必須で（コトノハには無い・作らない）、FAQ のリッチリザルトは 2026-05 に廃止された。
  JSON-LD は Bing と AI がサイトを理解するために置いている。

## 4. 残っていること

| チケット | 中身 | 状態 |
|---|---|---|
| COT-18〜21 | grove の sitemap・JSON-LD・robots（学習用は拒否）・llms.txt | 未着手（novel-platform リポ） |
| COT-25 | §3-2 | 本番に出たあと |
| COT-26 | §3-3 | 本番に出たあと |
| COT-27 | 参照元を「AI 検索／検索／SNS」に分けて週次で見る | 未着手（`referer_host` は `functions/api/hit.ts` が記録済み） |
| COT-28 | note・Zenn の紹介記事と相互リンク | 未着手 |
| — | Claude のコネクタ一覧・ChatGPT のアプリ一覧への掲載申請 | 未検討（Registry とは別の窓口） |
