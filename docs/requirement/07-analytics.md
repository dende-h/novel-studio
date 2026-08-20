# アクセス解析 — 何人来たかを Cookie なしで数える

Cloudflare Web Analytics に加えて、**日ごとの実訪問者数**を自前で数える仕組みの設計と運用。

## なぜ足したか

Cloudflare Web Analytics（RUM）は Cookie レス設計で、**訪問者を識別しない**。GraphQL の
`rumPageloadEventsAdaptiveGroups` が返す指標は 2 つだけで、どちらも「回数」であって「人数」ではない。

| 指標 | 中身 |
|---|---|
| `count` | 閲覧されたページ数（PV） |
| `sum.visits` | `document.referrer` のホストが自サイトと一致しないページビュー数（外部からの着地回数） |

ディメンションにも訪問者 ID・IP は無く、`uniq` 系の集計も存在しない。結果として、毎日サイトを
開く運営者自身が毎日カウントされ、**他人が何人来たのかが読めない**。そこを埋めるのが本節の仕組み。

PV・参照元・国の推移は引き続き Cloudflare 側を見る。こちらが受け持つのは人数だけ。

## 仕組み

```
public/hit.js  ──(sendBeacon: {p: パス, r: 参照元})──▶  POST /api/hit  ──▶  D1 visitor_days
```

- **訪問者の符号**：`sha256(ANALYTICS_SALT : JSTの日付 : IP : UA族 : サイト)` の先頭 16 桁。
  IP も UA も保存せず、符号だけを残す。**日付が変わると符号も変わる**ので、日をまたいだ追跡は
  原理的にできない。サイト（leaf / grove）も混ぜるため、サイトをまたいだ突き合わせもできない。
- **UA 族**：`Chrome/Windows` のようにブラウザと OS を粗く丸めた文字列
  （`functions/api/_lib/visitor.ts`）。バージョンが上がっただけで別人になるのを防ぎ、
  同時に「1 つの IP から作れる行数」を数十に抑える（書き込みの上限になる）。
- **1 行の粒度**：`(日付, サイト, 符号)` で 1 行。`hits` はその日のページ読み込み回数
  （SPA の画面遷移は数えない）。`landing_path` と `referer_host` は**その日の最初のヒット**を残す。
- **計測対象**：`cotonoha-leaf.org` と grove の本番ホストだけの許可リスト。`*.pages.dev`（stg・
  プレビュー）と localhost はクライアント側でもサーバ側でも落ちるので、開発中のアクセスは混ざらない。
- **除外できるもの**：明らかなボット UA、Origin が無い直叩き、クライアント IP が取れないリクエスト。
  加えて 1 訪問者あたり 60 件/分のレート制限（`rate_limits` テーブルを流用）。

## 自分を数えないようにする

ブラウザごとに 1 回、次を開く。

```
https://cotonoha-leaf.org/?noanalytics=1        # leaf を除外
https://grove.cotonoha-leaf.org/?noanalytics=1  # grove を除外
```

`localStorage['ns-no-analytics'] = '1'` が入り、以後そのブラウザからはビーコンを送らない。
解除は `?noanalytics=0`。**localStorage はオリジン単位**なので、PC・スマートフォン・別ブラウザ・
シークレットウィンドウはそれぞれ個別に設定が要る（設定し忘れた端末は他人として数えられる）。

同じ導線をプライバシーポリシー（`public/privacy.html`）にも読者向けのオプトアウトとして載せている。

## 読み方（D1 への問い合わせ）

```sql
-- 日別のユニーク訪問者数
SELECT date, site, COUNT(*) AS visitors, SUM(hits) AS loads
FROM visitor_days
WHERE date >= date('now', '-14 days')
GROUP BY date, site
ORDER BY date;

-- 流入元別の「人数」（Cloudflare の visits は回数なので、ここが人数の唯一の答え）
SELECT site, CASE WHEN referer_host = '' THEN '(直接)' ELSE referer_host END AS src,
       COUNT(*) AS visitors
FROM visitor_days
WHERE date >= date('now', '-7 days')
GROUP BY site, src
ORDER BY visitors DESC;

-- 何を最初に開いたか（LP が入口として機能しているか）
SELECT landing_path, COUNT(*) AS visitors
FROM visitor_days
WHERE site = 'leaf' AND date >= date('now', '-7 days')
GROUP BY landing_path
ORDER BY visitors DESC;
```

## 精度の限界（数字を読むときの前提）

- 同じ回線・同じブラウザ族の別人（家族・社内 NAT・大学）は **1 人に潰れる**（過少）
- モバイル回線で IP が変わると **同じ人が 2 人に割れる**（過大）
- 日付は JST 区切り。Cloudflare 側は UTC 区切りなので、日別の数字は 1 日ずれて見えることがある
- 数えられるのは JS が動いたページだけ（`hit.js` を読み込むページ）

厳密な一意性が要る用途には向かない。「先週より人が増えたか」「X からの流入で何人来たか」を
同じ物差しで見るための道具として使う。

## 手順（有効化）

1. `pnpm exec wrangler d1 migrations apply novel-studio --remote`（`0007_visitor_days.sql`）
2. `pnpm exec wrangler pages secret put ANALYTICS_SALT`（任意。未設定でも動く）
3. デプロイ。`?noanalytics=1` を自分の各ブラウザで開く
4. grove 側は `<script src="https://cotonoha-leaf.org/hit.js" defer></script>` を 1 行足すだけ
   （ビーコンは leaf の `/api/hit` に送られる。sendBeacon は text/plain 扱いのため CORS 不要）
