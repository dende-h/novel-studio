---
name: analytics-dashboard
description: コトノハ（leaf）と grove の Web アナリティクスを Cloudflare GraphQL MCP から取得・分析し、HTML ダッシュボード（Artifact）を生成・更新する。ユーザーが「アクセス解析」「アナリティクス」「PV」「訪問数」「流入」「ダッシュボード」「週次レポート」「先週の数字」「LP の効果」など、leaf/grove のトラフィックに関する分析・可視化・レポートを求めたら（明示的に「ダッシュボード」と言わなくても）必ずこのスキルを使う。
---

# leaf / grove Web アナリティクスダッシュボード

Cloudflare Web Analytics（RUM）のデータを GraphQL API から取得し、分析コメント付きの
HTML ダッシュボードを Artifact として発行・更新するスキル。目的は「施策（X 投稿・記事・
共有カード）が効いたか」を毎回同じ物差しで見られるようにすること。

## 前提（データ源）

- Cloudflare **GraphQL MCP コネクタ**のツール（`mcp__Cloudflare_WEB__graphql_query` 等。
  コネクタ名は接続時期で変わり得るので `graphql_query` を ToolSearch で探す）を使う。
  見つからなければ、ユーザーに claude.ai のコネクタ設定で
  `https://graphql.mcp.cloudflare.com/mcp` の接続（Cloudflare OAuth）を依頼して止まる。
- アカウントタグ: `1a6d8db5896f635cdbccd792bce24e2d`
- データセット: `rumPageloadEventsAdaptiveGroups`（アカウント配下・Web Analytics の実体）

### ホスト→プロダクトの対応（集計時にこの軸で束ねる）

| requestHost | 意味 |
|---|---|
| `cotonoha-leaf.org` | **leaf**（`/lp/`＝LP、`/`＝執筆アプリ、`/privacy` 等＝法務） |
| `grove.cotonoha-leaf.org`・`cotonoha-grove.org` | **grove**（小説投稿プラットフォーム） |
| `novel-studio-b2m.pages.dev` ほか `*.pages.dev` | **stg/preview**＝開発者自身。ユーザー指標から除外し、脚注で件数だけ触れる |

## データ取得

期間は既定で「直近 7 日」と「その前の 7 日」（前週比のため）。初回や「全期間」の依頼では
28 日程度に広げる。1 回の `graphql_query` にエイリアスでまとめると往復が減る：

```graphql
query {
  viewer {
    accounts(filter: {accountTag: "1a6d8db5896f635cdbccd792bce24e2d"}) {
      daily: rumPageloadEventsAdaptiveGroups(limit: 100,
        filter: {datetime_geq: "<開始ISO>"}, orderBy: [date_ASC]) {
        count sum { visits } dimensions { date requestHost }
      }
      byPath: rumPageloadEventsAdaptiveGroups(limit: 50,
        filter: {datetime_geq: "<開始ISO>"}) {
        count sum { visits } dimensions { requestHost requestPath }
      }
      byReferer: rumPageloadEventsAdaptiveGroups(limit: 30,
        filter: {datetime_geq: "<開始ISO>"}) {
        count dimensions { refererHost }
      }
      byCountry: rumPageloadEventsAdaptiveGroups(limit: 20,
        filter: {datetime_geq: "<開始ISO>"}) {
        count dimensions { countryName }
      }
    }
  }
}
```

読み方の注意（ダッシュボードにも脚注として必ず載せる）：
- **サンプリング集計**のため count は概算（しばしば 10 の倍数）。1 桁の差は誤差。
- `refererHost: "t.co"` ＝ X（旧 Twitter）経由。`""` ＝直接アクセス。
  自ドメイン（grove.cotonoha-leaf.org 等）＝サイト内回遊。
- visits ≒ セッション数。PV と visits が近い日は「1 人が 1 ページずつ」＝開発者自身の
  可能性が高い。

## 分析（ダッシュボードに載せるコメント）

数字の羅列でなく判断を書く。最低限：
1. **前週比**：leaf / grove それぞれの PV・訪問数の増減と、その説明（施策・スパイク源）
2. **ファネル**：leaf の `/lp/` PV → `/`（アプリ）PV。LP が刺さっているかの主指標
3. **流入**：t.co（X）・検索・直接の内訳変化。施策を打った日と突き合わせる
4. **grove の回遊**：/home → 作品 → エピソードの流れが起きているか

## ダッシュボード生成

1. `dataviz` スキルと `artifact-design` スキルを**書き始める前に**読み込む（チャート・
   配色・テーマ対応の作法はそちらに従う）。
2. 構成（1 ページ・上から）：
   - KPI タイル：直近 7 日の leaf PV／grove PV／訪問数／X 経由 PV（各前週比付き）
   - 日別チャート（leaf と grove を別系列・stg は含めない）
   - leaf ファネル（LP → アプリ）と grove ページ内訳
   - 参照元・国の表
   - 分析コメント（上記 4 点）と、サンプリング脚注・データ取得日時
3. **Artifact の URL を安定させる**：ファイル名は常に `kotonoha-analytics.html`。
   既存ダッシュボードは
   `https://claude.ai/code/artifact/08eb2db1-0e4b-40ef-a61d-423d62d48aa9`
   —— `Artifact` ツールに `url` としてこれを渡して**更新**する（新 URL を作らない。
   見つからない・削除済みのときだけ `action: "list"` で探すか新規作成し、この行を書き換える）。
   `<title>` は「コトノハ解析」、favicon は「📊」で固定。
4. 発行後、チャットにも要点 3〜5 行（前週比・目立った変化・次に見るべき点）を書く。
