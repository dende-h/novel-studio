# Cloudflare で AI エージェントを作る・迎える — 2026年9月版の実務ガイド

Cloudflare は「速く配る網」から「エージェントが住み着く実行環境」へ重心を移した。2026年の変更のほとんどは、この一文で説明がつく。Pages より Workers、ブラウザ描画より Browser Run、AutoRAG より AI Search、`McpAgent` より `createMcpHandler` ——名前が変わったものはどれも、人間のアクセスを前提にした設計から、機械のアクセスを前提にした設計への置き換えである。

- **調査時点**: 2026-09-04。出典は Cloudflare 公式ドキュメントと changelog（docs MCP サーバ経由で取得）、および仕様側の一次情報。
- **対象読者**: コトノハ（novel-studio）の開発者。Workers/Pages Functions・D1・R2・Wrangler は触ったことがあり、MCP サーバも自前で1本動かしている前提で書く。
- **読み方**: 1〜3章は初回に通読してほしい。全体地図・エージェントの実体・MCP の現在地で、4章以降を読むための足場になる。4章以降は引く用。目次から必要な章だけ開いて構わない。9章に逆引き表、10章にこのリポジトリ固有の話、末尾に用語集を置いた。
- **確信度の扱い**: 公式ドキュメントで裏の取れた記述は断定で書く。ドキュメント外の情報や、beta で動く可能性の高い数字には【要確認】を付けた。

---

## 第1部 まず押さえる

### 1. 地図: 二階建ての建物で、増築が続いているのは上の階だけ

Cloudflare のプロダクトは、下の階と上の階に分けて考えると迷いにくい。

下の階は昔からある「世界中に置いた拠点でリクエストを受ける仕組み」——CDN、DNS、WAF、Bot 管理。ここは基本的に変わらない。コトノハで言えば、独自ドメインを載せて TLS を張り、Bot を弾いている部分がこれにあたる。

上の階が「その拠点でアプリのコードを走らせる仕組み」で、2020年代に増築が続いてきた。JavaScript を実行する Workers、その Worker ごとに1個の状態と SQLite を持たせる Durable Objects、SQL の D1、オブジェクトストレージの R2。コトノハはこの階に建っている。

2026年に増えたのは、上の階のさらに上——エージェントを走らせるための階だ。Agents SDK、Browser Run、Sandbox、Dynamic Workers、AI Gateway、AI Search。これらはどれも既存の Workers と Durable Objects の上に乗っていて、新しい実行基盤が来たわけではない。**エージェント向けの新機能はすべて Durable Objects の応用として理解できる**——この一点を押さえておくと、後続の章がだいぶ軽くなる。

#### 名前が変わったもの、地位が変わったもの

2026年の改名・格下げをまとめておく。古い記事を読むときの読み替え表として使ってほしい。

| 旧 | 新 | 何が変わったか |
| --- | --- | --- |
| Cloudflare Pages | Workers（Static Assets） | 新規は Workers 推奨。Pages のドキュメント冒頭に「本当に Pages でいいですか」の警告が出るようになった |
| Browser Rendering | Browser Run | 名前だけでなく、Live View・CDP エンドポイント・録画・WebMCP が入って別物に近い |
| AutoRAG | AI Search | 2025-09 に改名。OpenAI・Anthropic など外部モデルも選べるようになった |
| `McpAgent`（Agents SDK） | `createMcpHandler` | `McpAgent` は非推奨かつ機能凍結。詳細は3章 |
| Browser Rendering の `/sse` | `/mcp`（Streamable HTTP） | `/sse` は URL としては生きているが、中身は Streamable HTTP。旧 HTTP+SSE トランスポートは提供終了 |
| Worker Loader（機能名） | Dynamic Workers（製品名） | ドキュメントが `/dynamic-workers/` に独立し、課金体系も付いた |

Pages については、コトノハが現に Pages Functions で動いているので、10章で移行の要否を別に扱う。

#### 課金の目安（2026年9月時点）

コストの桁感だけ先に置いておく。細部は各章と公式の料金ページに譲る。

| 対象 | 無料枠 | 超過分 |
| --- | --- | --- |
| Workers AI（推論） | 10,000 Neurons/日 | $0.011 / 1,000 Neurons |
| Durable Objects SQLite | 読み 500万行/日、書き 10万行/日、5GB | 読み $0.001/百万行、書き $1.00/百万行、$0.20/GB-月 |
| Dynamic Workers | 月1,000本（Paid のみ） | +$0.002 / 1本 / 日 |
| Workers トレース | 1日20万イベント（Free） | 月2,000万込み +$0.60/百万（2026-10-01 課金開始） |
| Pipelines | 月50GB | 変換 $0.04/GB、出力 $0.03〜0.06/GB |

D1 は2026-09-01 から、無料プランで日次の行読み書き上限を超えるとクエリが**失敗するようになった**。それまでは超過しても通っていたので、無料枠で動かしている環境は注意がいる。

### 2. エージェントの正体は「眠るサーバ」— Agents SDK

一般に AI エージェントというと、モデルにツールを渡してループを回すプログラムを指す。Cloudflare の Agents SDK が引き受けるのは、そのループの中身ではなく**ループを何日も生かしておく側**だ。ここを取り違えると、SDK の API がなぜこの形なのか分からなくなる。

#### 2-1. 1インスタンス＝1 Durable Object＝1 SQLite

`agents` パッケージの `Agent` クラスを継承すると、インスタンスが Durable Object になる。

```ts
import { Agent, routeAgentRequest } from "agents";

export class MyAgent extends Agent<Env, State> {
  // this.state / this.setState()  … クライアントと自動同期する状態
  // this.sql`SELECT ...`          … このインスタンス専用の SQLite
  // this.schedule(...)            … 未来の自分を起こす
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env))
      ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

インスタンスは名前で一意に決まる。同じ名前を渡せば、世界中どこからアクセスしても必ず同じインスタンスに繋がる。だからユーザーIDやチケット番号を名前にすれば、セッションストアを別に用意する必要がなくなる。作れる数に実質的な上限はなく、ユーザーごとに1個ずつ作る運用が想定されている。

Wrangler 側では Durable Object のバインディングと、SQLite バックエンドを指定する migration が要る。`new_sqlite_classes` を忘れると状態が保存されない。

```jsonc
{
  "durable_objects": { "bindings": [{ "name": "MyAgent", "class_name": "MyAgent" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MyAgent"] }]
}
```

#### 2-2. エージェントは常時走らない。眠って、起きて、たまに落ちる

Durable Object は次の3つで退去（eviction）させられる。この数字が SDK の設計理由そのものなので、覚えておく価値がある。

- リクエストも WebSocket もない状態が **約70〜140秒**続いたとき
- コード更新やランタイム再起動のとき（**1日1〜2回**、タイミングは非決定的）
- alarm ハンドラが**15分**を超えたとき

生き残るのは `setState()` した状態、`this.sql` のテーブル、スケジュール、WebSocket 接続ごとの状態、そして後述する fiber のチェックポイント。消えるのはメモリ上の変数、`setTimeout`、実行中の fetch、クロージャである。つまり「関数の途中で3分待つ」は書けない。

そこで用意されているのが `runFiber()` だ。処理の開始時に SQLite へ1行書き、`ctx.stash()` で途中経過を記録し、途中で落ちたら次回起動時に `onFiberRecovered()` が呼ばれる。

```ts
await this.runFiber(`task:${task.id}`, async (ctx) => {
  const resources = await this.gatherResources(task);
  ctx.stash({ phase: "prepared", resources, task });   // ここまでは終わった、の記録
  const result = await this.runSubAgent(task, resources);
  ctx.stash({ phase: "executed", result, task });
});

async onFiberRecovered(ctx: FiberRecoveryContext) {
  const snap = ctx.snapshot as { phase: string; task: Task };
  if (snap.phase === "prepared") await this.executeTask(snap.task);
}
```

自動リプレイではない点に注意がいる。何を「復旧」と呼ぶかはこちらが決める。Webhook のように配信が再送されうる入り口では、冪等キー付きで受理だけ先に返す `startFiber()` のほうが向く。

`wrangler dev` でも本番と同じように動く。プロセスを Ctrl-C で落として再起動すれば復旧処理が走るので、テストは手元でできる。

#### 2-3. 4層になっている。どこから継承するかで書く量が変わる

継承の階層は `DurableObject` → `Server` → `Agent` → `AIChatAgent` の順で、上に行くほど自由、下に行くほど出来合いになる。さらにその外側に「ループそのものを引き受ける」ハーネスがある。

| 選択肢 | パッケージ | 向く場面 |
| --- | --- | --- |
| `Agent` | `agents` | チャットでない。状態・スケジュール・WebSocket だけ欲しい |
| `AIChatAgent` + `useAgentChat` | `@cloudflare/ai-chat` | チャットUI。履歴の SQLite 保存、再開可能なストリーム、承認フローが最初から付く |
| `Think` | `@cloudflare/think` | ループ・ツール選択・ワークスペース・スキル・メッセンジャー連携まで込み（実験的） |
| Flue | `@flue/runtime`（サードパーティ） | 別のハーネスを使いたい。トレースは Cloudflare 側が拾う |

チャットを作るなら `AIChatAgent` から始めるのが素直だ。メッセージは SQLite に自動で保存され、通信が切れてもストリームの途中から再開でき、複数タブへ WebSocket でブロードキャストされる。行サイズが SQLite の上限に近づいたら自動で圧縮もする。

#### 2-4. 危ないツールは実行前に止める

人間の承認を挟む仕組みは、ツール定義側の `needsApproval` に集約された。以前あった `toolsRequiringConfirmation`（全体リスト方式）と `detectToolsRequiringConfirmation()` は非推奨で、ツール単位の指定に置き換わっている。クライアント側では `addToolResult` が `addToolOutput` に改名された。

拒否のしかたは2通りあって、使い分けに意味がある。`addToolApprovalResponse({ id, approved: false })` は汎用の拒否メッセージを返し、既定では会話をそのまま続ける。理由をモデルに伝えたいなら `addToolOutput` に `state: "output-error"` を渡す。ただしこちらは自動継続しないので、続けたければ `sendMessage()` を自分で呼ぶ。

```ts
addToolOutput({
  toolCallId: part.toolCallId,
  state: "output-error",
  errorText: "ユーザーが却下: 今四半期の予算では足りない",
});
```

#### 2-5. ツールの置き場所は3つ、渡し方は2つ

ツールがどこで動くかは、Worker（サーバ側のバインディングや秘密情報を使う）、ブラウザ（位置情報・クリップボード・ローカルストレージ）、別のエージェント（`runAgentTool()` で委譲）の3択になる。

渡し方はこれと直交していて、1つずつ直接呼ばせるか、Code Mode を使うかを選ぶ。

Code Mode は、ツールを個別に列挙する代わりに「コード実行ツール」を1個だけモデルに渡す方式だ。モデルは型付きのツール群を呼ぶ JavaScript を書き、そのコードが隔離された Dynamic Worker の中で走る。中間結果はサンドボックスに留まり、最終的な値だけがモデルの文脈に返る。ツールが多いほど効く。

Cloudflare 自身の API MCP サーバがこの効果の実測値を出している。2,594 エンドポイントを素の MCP ツールとして並べると約117万トークン、必須パラメータだけに削っても約24万トークン。Code Mode なら `search()` と `execute()` の2ツール、**約1,000トークン**で済む。

```ts
import { createCodeTool } from "@cloudflare/codemode/ai";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";

const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
const codemode = createCodeTool({ tools: myTools, executor });
const result = streamText({ model, tools: { codemode }, messages });
```

`DynamicWorkerExecutor` は既定で `fetch()` と `connect()` を塞ぐ（`globalOutbound: null`）。`console.log` は捕捉されて実行結果に入り、タイムアウトは既定30秒。`wrangler` 側には `[[worker_loaders]] binding = "LOADER"` が要る。

#### 2-6. 記憶の管理には別の層が用意されている

会話が長くなったときの圧縮と、会話をまたぐ長期記憶は、状態管理とは別の API になっている。

Session API（`agents/experimental/memory/session`）は、システムプロンプトを「コンテキストブロック」に分けて組み立て、古いメッセージを要約で畳む。元のメッセージは SQLite に残り、要約は読み出し時に被せる非破壊のオーバーレイとして働く。トークン数の見積もりは tiktoken ではなく `max(文字数/4, 単語数*1.3)` の概算で、これは tiktoken の 80〜120MB のヒープが Workers の 128MB 制限に収まらないための割り切りだと明記されている。

Agent Memory は会話から永続的な記憶を抽出する別プロダクトで、`ingest()`（会話から自動抽出）・`remember()`（明示的に覚える）・`recall()`（検索）の3つを持つ。`ingest()` は毎ターン呼ばず、ユーザーが離脱したあとや圧縮のタイミングでまとめて呼ぶよう案内されている。

#### 2-7. 観測は Workers のトレース基盤に相乗りする

`wrangler.jsonc` に `observability.traces.enabled` を立てるだけで、`invoke_agent` → `chat` → `execute_tool` → `tool_approval` という入れ子のスパンがダッシュボードに出る。Think と Flue は自動、素の AI SDK は `wrapAISDK(ai)` で1回包む。

メッセージとツール引数の中身は既定で記録されない。`storeMessages` / `storeTools` を明示的に true にしたときだけ入る。個人情報が乗る場所なので、この既定は妥当だと筆者は考える。

なお、エージェント名にリクエストIDやユーザーIDを混ぜてはいけない。ダッシュボード上で無数の別エージェントに見えてしまう。名前は実装単位（`booking-agent`）、IDはインスタンス単位（`booking-agent-production`）、会話IDは会話単位、と3つを分けて渡す。

### 3. MCP サーバは「建てる」から「セッションを持たない関数」へ変わった

外部のAIクライアントに自分のアプリの操作を渡す標準規格を、Model Context Protocol（MCP）と呼ぶ。ツール（呼べる関数）、リソース（読めるデータ）、プロンプト（定型の指示）の3つを JSON-RPC 2.0 で公開する。コトノハが `/api/mcp` で提供しているものがまさにこれで、Claude や ChatGPT から作品を編集できるのはこの規格のおかげである。

2026年のMCPまわりの変更は、ひとことで言えば**セッションを捨てた**ことに尽きる。

#### 3-1. 2026-07-28 仕様: リクエストごとに使い捨てのサーバ

新しい仕様（2026-07-28）では、リクエスト1本ごとに新しいサーバを組み立てて捨てる。MCP プロトコル上のセッションも、それを保持する Durable Object も要らない。Cloudflare 自身のMCPサーバは2026-07-28にこの方式へ切り替わり、Agents SDK は v0.20.0 で対応した。

旧クライアント（2025年の Streamable HTTP）からのステートレスなリクエストも同じ `/mcp` が受ける。設定変更なしに繋ぎ直せるクライアントがほとんどだ。ただし**SSE トランスポートを強制する設定のクライアントだけは動かない**。`/sse` という URL は残っているが、中身は Streamable HTTP のエイリアスに置き換わっていて、旧 HTTP+SSE の実装はもう応答しない。クライアント側を Streamable HTTP か自動判別に変える必要がある。

#### 3-2. 新規は `createMcpHandler`、`McpAgent` は凍結された

Agents SDK のサーバ側APIは2本立てになった。

| API | import | 中身 |
| --- | --- | --- |
| `createMcpHandler` | `agents/mcp/server` | ステートレス。`@modelcontextprotocol/server` v2 を使う。旧クライアントとの互換も既定で持つ |
| `createLegacyMcpHandler` | `agents/mcp` | `WorkerTransport` によるセッション方式。`@modelcontextprotocol/sdk` v1 系 |

そして `McpAgent` は**非推奨かつ機能凍結**である。既存のサーバは移行対象で、新規に書いてはいけない。ドキュメントにも「新しい `McpAgent` サーバを作らないこと」と明記された。

最小構成はこうなる。ファクトリ関数を渡し、リクエストごとにサーバを組み立てる形だ。

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({ name: "example-server", version: "1.0.0" });
  server.registerTool(
    "hello",
    { description: "Return a greeting", inputSchema: { name: z.string().optional() } },
    async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name ?? "World"}!` }] }),
  );
  return server;
}

export default {
  fetch(request, env, ctx) {
    return createMcpHandler(createServer)(request, env, ctx);
  },
};
```

移行で踏みやすい落とし穴が1つある。`createMcpHandler` が返す関数を**そのまま default export してはいけない**。Wrangler は関数の default export を `WorkerEntrypoint` クラスとして解釈するため、上のようにオブジェクトの `fetch()` の中で呼ぶ必要がある。

`agents/mcp/server` という独立した入り口になったのは、バンドルサイズのためでもある。この入り口からは `McpAgent`・`WorkerTransport`・MCP クライアントのトランスポート・SDK v1 系が引きずり込まれない。

状態を持ちたい場合はどうするか。カウンタを覚える、ゲームの盤面を保持する、前回のAPI呼び出しの結果をキャッシュする——こうした用途は `McpAgent` の存在理由だったが、いまは Agent 側に状態を持たせ、MCP ハンドラからそれを呼ぶ形に分ける。

#### 3-3. 認可は OAuth 2.1 のサブセット。4つの型がある

MCP の認可は OAuth 2.1 のサブセットで規定されている。Cloudflare は `workers-oauth-provider` ライブラリを出していて、次の4通りで使える。

Cloudflare Access を認可サーバにする型、GitHub や Google など第三者のプロバイダに繋ぐ型、Stytch・Auth0・WorkOS のような認可サービスを挟む型、そして Worker 自身がフロー全体を実装する型。第三者プロバイダを使う場合も、MCPクライアントに渡すトークンは**MCPサーバ側（つまり自分の Worker）が発行する**——仕様がそう定めているので、上流のトークンをそのまま横流ししてはいけない。

```ts
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: MyMCPServer.serve("/mcp"),
  defaultHandler: MyAuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
```

認証情報のツールからの参照は、ステートレス版では `context.http.authInfo` に標準のトークンメタデータが入る（`McpAgent` の `this.props` に相当）。

#### 3-4. エージェント側からMCPを使うときは `addMcpServer()`

逆向き——自分のエージェントが外部のMCPサーバを使う側——も Agents SDK に入っている。

```ts
const result = await this.addMcpServer("github", "https://mcp.github.com/mcp");
if (result.state === "authenticating") return Response.redirect(result.authUrl);

await this.mcp.waitForConnections();
const tools = this.mcp.getAITools();   // AI SDK にそのまま渡せる形
```

接続はエージェントの SQLite に保存され、繋いだ瞬間からそのサーバのツールが全部使える。Bearer トークンや Cloudflare Access のヘッダが要るサーバには `transport.headers` で渡す。React 側は `useAgent` の `onMcpUpdate` で接続状況とツール一覧をリアルタイムに受け取れる。

#### 3-5. Cloudflare 自身のMCPサーバ

自分のアカウントを AI から操作したいときのために、Cloudflare が managed のリモートMCPサーバを運用している。使い分けは2つ。

`https://mcp.cloudflare.com/mcp` が Cloudflare API 全体（2,500以上のエンドポイント）を `search()` と `execute()` の2ツールで包んだもの。前章で触れた Code Mode 方式で、トークン消費が一定に保たれる。ドキュメント検索専用なら `https://docs.mcp.cloudflare.com/mcp` があり、これは本ガイドの調査にも使った。

Claude Code なら `/plugin marketplace add cloudflare/skills` で、MCPサーバとスキルとスラッシュコマンドがまとめて入る。

#### 3-6. 組織で使わせるなら MCP server portal を挟む

複数のMCPサーバを1つのHTTPエンドポイントに束ねて、Cloudflare Access の認証と監査を通す仕組みを MCP server portal と呼ぶ。Zero Trust 側の機能で、全プランで使える。

管理者はポータルごとに公開するツールとプロンプトを選べる。名前と説明を上書きするエイリアスも張れるので、上流のサーバに手を入れずに「AIが選び間違えにくい名前」に直せる。文脈量の削減オプションも2つあり、`optimize_context=minimize_tools` でツールの説明とスキーマを剥がして名前だけにすると**最大5倍**のトークン節約になる（必要になった時点で `query` ツールで取りに行く）。ポータル自体に Code Mode を効かせることもでき、ポリシーは off / opt-in / on by default / enforced の4段階。

Gateway 側では MCP トラフィックの自動判別も入った。HTTPポリシーの `Is MCP`（`experimental.is_mcp`）セレクタで、承認済みポータル以外を通るMCP通信を遮断する、といった規則が書ける（beta）。

---

## 第2部 必要なときに引く

### 4. WebMCP — ウェブページが自分のツールを名乗る

ここまでのMCPは、サーバに接続して使う仕組みだった。WebMCP はそれを**ブラウザの中に持ち込んだ**もので、開いているページ自身が「このサイトでできること」を型付きの関数としてブラウザに登録する。エージェントは登録された一覧を見て、その場で呼ぶ。

なぜこれが要るのか。今のエージェントによるブラウザ操作は、スクリーンショットを撮る→どこを押すか考える→クリックする、のループでできている。遅いうえに、UIが少し変わるだけで壊れる。WebMCP なら `searchFlights()` や `bookTicket()` を型付きの引数で直接呼べる。Cloudflare の changelog はこの違いを「インターネットは人間のために作られたので、AIエージェントとして回遊するのは今のところ信頼性が低い」という一文で説明している。

#### 4-1. サーバMCPとの違いを1枚で

| | サーバMCP（3章） | WebMCP（この章） |
| --- | --- | --- |
| ツールの置き場所 | 自分のサーバ（Worker） | 開いているウェブページ |
| 接続の起点 | クライアントがURLへ接続 | ページを開いた時点で登録済み |
| 認証 | OAuth 2.1 | ページのログインセッションをそのまま使う |
| 呼び出しの往復 | ネットワーク越し | ブラウザ内で完結 |
| 標準化の主体 | Anthropic ほか（MCP 仕様） | W3C Web Machine Learning CG（Google・Microsoft が編集） |
| 成熟度 | 実用段階 | Origin Trial 段階 |

両者は競合しない。同じページで、ページ固有の操作（スクロール、フォーム入力）を WebMCP で、サーバ側の操作（保存、決済）をサーバMCPで公開し、エージェントからは1つの道具箱に見せる——という組み合わせが想定されている。

#### 4-2. ブラウザAPIの現状: 置き場所が `navigator` から `document` へ動いた

仕様は W3C の Web Machine Learning Community Group で策定中で、2026年2月10日に公表された。Chrome では 149 から Origin Trial が走っている。

ここで注意がいるのは、**APIの置き場所が仕様の途中で移動したこと**だ。初期の Chrome ビルドは `navigator.modelContext` に生やしていたが、ツールはページに属するという整理から `document.modelContext` へ移された。Chrome 150 で `navigator.modelContext` は非推奨になり、アクセスすると初回に警告が出る別名として残る。初期の `provideContext()` / `clearContext()` は2026年3月の改訂で削除され、いまは `registerTool()` / `unregisterTool()` だけが宣言手段になっている。

【要確認】この移行の詳細（Chrome のバージョン番号、Origin Trial の終了時期）は Cloudflare のドキュメント外の情報で、公式仕様と Chrome のドキュメントに直接あたって裏を取れていない。**実装する前に必ず一次情報を確認してほしい**。Cloudflare 側の記述と Agents SDK の実装はいまも `navigator.modelContext` を前提に書かれているので、両対応で書くのが安全だと筆者は考える。

ページ側のツール登録はこの形になる。

```js
if ("modelContext" in navigator) {
  navigator.modelContext.registerTool({
    name: "page.scroll_to_section",
    description: "Scroll the page to a named section",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async execute({ id }) {
      document.getElementById(String(id))?.scrollIntoView({ behavior: "smooth" });
      return "ok";
    },
  });
}
```

#### 4-3. Cloudflare の関わりは2方向ある。混同しやすい

Cloudflare の WebMCP 対応は、**呼ぶ側**と**名乗る側**の両方にある。別の製品なので、分けて覚える。

##### (a) 呼ぶ側 — Browser Run が WebMCP 対応サイトを操作する

Browser Run（旧 Browser Rendering）で起動したブラウザから、WebMCP を公開しているサイトのツールを見つけて呼べる。2026-04-15 に入った。

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/devtools/browser?lab=true&keep_alive=300000" \
  -H "Authorization: Bearer {api_token}"
```

`lab=true` が要点で、これを付けると Chrome beta が動く実験用プールのインスタンスが割り当てられる。安定版に来ていないブラウザ機能を試すための枠だ。セッション内では次の2つを使う。

- `navigator.modelContextTesting.listTools()` — そのサイトが公開しているツールの一覧
- `navigator.modelContextTesting.executeTool()` — 型付きの引数で実行

機微な操作の前でユーザーの確認待ちに入るツールもあり、その一時停止も扱える。CDP エンドポイント経由でMCPクライアントを繋げば、エージェントが直接この経路を使える。

##### (b) 名乗る側 — Agents SDK のブリッジがサーバのツールをページに登録する

`agents/experimental/webmcp` は逆向きで、**自分のMCPサーバのツールを、ページ内のブラウザAIから呼べるようにする**アダプタだ。名前が紛らわしいので整理すると、これは「サーバのツールをブラウザの道具箱に相乗りさせる橋」である。

```js
import { registerWebMcp } from "agents/experimental/webmcp";

const handle = await registerWebMcp({ url: "/mcp" });
```

内部では、`StreamableHTTPClientTransport` でMCPクライアントを開き、`tools/list` をページネーション込みで叩き、1件ずつ `navigator.modelContext` の `ModelContextTool` として登録する。`tools/list_changed` を購読しているので、サーバ側でツールが増減すれば追随する。後片付けは `handle.dispose()`。

ページ固有のツールと混ぜるときは `prefix` で名前空間を分ける。認証ヘッダは毎回取り直せるよう関数で渡せる。

```js
const handle = await registerWebMcp({
  url: "/mcp",
  prefix: "remote.",
  getHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
});
```

複数のサーバを別々の接頭辞で並べることもできる。

```js
const orders  = await registerWebMcp({ url: "/orders/mcp",  prefix: "orders."  });
const billing = await registerWebMcp({ url: "/billing/mcp", prefix: "billing." });
```

オプションは `url` / `headers` / `getHeaders` / `watch`（既定 true）/ `prefix` / `timeoutMs` / `logger` / `quiet` / `onSync` / `onError`。返り値のハンドルは `tools`（登録済みの名前）、`disposed`、`refresh()`、`dispose()` を持つ。

#### 4-4. この橋の限界（実装前に読む）

ドキュメントが明示している制約を、影響の大きい順に挙げる。

**名前の衝突は黙って起きる。** 複数の登録が同じツール名を使っても警告は出ない。`prefix` は装飾ではなく事故防止策だと考えたほうがいい。

**戻り値は文字列に潰れる。** MCP のレスポンスは平坦化され、テキスト項目は改行で連結、画像は data URL になる。構造化された戻り値をそのまま受け取ることは現状できない。

**`watch` は SSE が要る。** サーバが 405 を返す場合、自動追随なしで動き続ける。ツールの増減はページを開き直すまで反映されない。

**`timeoutMs` は1呼び出しごと。** 全体の上限ではないので、多数のツールを連続で呼ぶ処理には別の制御が要る。

**ブラウザ専用。** Worker 内やサーバサイドレンダリング中に import できない。`navigator.modelContext` が存在しない環境では動かない。

アダプタも下地のブラウザAPIも実験段階で、リリース間で変わりうると明記されている。Playwright によるテスト（探索・実行・破棄・並行実行・ページネーション・watch 更新・エラー系）はリポジトリに揃っているので、挙動の確認はそちらが早い。

#### 4-5. コトノハに当てはめるとどうなるか

コトノハはすでに `/api/mcp` でリモートMCPサーバを公開している。ここに `registerWebMcp({ url: "/api/mcp" })` を足せば、ブラウザ内のAIから同じツール群——作品作成、話の差し替え、用語集の更新——が呼べるようになる。認証は既存の `mcp_` トークンか Clerk のセッションを `getHeaders` で渡す形になるだろう。

そのうえで、筆者はいま実装を勧めない。理由は3つある。ブラウザAPIの置き場所が移動中で、いま書いたコードが数か月で書き直しになる可能性が高いこと。戻り値が文字列に潰れる制約は、構造を持つ用語集やプロットの応答と相性が悪いこと。そして、コトノハのMCPはすでに Claude や ChatGPT から使えていて、ブラウザ内AIを追加で通す動機がまだ薄いこと。

仕様が安定し、Chrome の安定版に入った時点で再検討するのが妥当だと考える。それまでは、この章を「動きを追う対象」として置いておけばよい。

### 5. 推論と検索: Workers AI で回し、AI Gateway で束ね、AI Search で引く

この3つは役割が違い、重ねて使う前提で設計されている。Workers AI が推論の実行、AI Gateway が全モデルの入口、AI Search が検索付きの回答生成。

#### Workers AI — Cloudflare が持っているモデルを `env.AI.run()` で呼ぶ

料金は Neuron という単位で、$0.011 / 1,000 Neurons。無料枠は1日10,000 Neurons で、Free と Paid の両方に付く（Paid は超過分が課金されるだけ）。リセットは毎日 00:00 UTC。

2026-07-28 から、重いモデルの一部が Workers Paid 必須になった。`@cf/moonshotai/kimi-k2.6`、`@cf/moonshotai/kimi-k2.7-code`、`@cf/zai-org/glm-5.2`、`@cf/zai-org/glm-5.3` 系、`@cf/deepseek-ai/deepseek-v4` 系。Free で叩くと 403（内部エラー 5035）が返る。無料のまま使えるモデルには `@cf/zai-org/glm-4.7-flash`、`@cf/google/gemma-4-26b-a4b-it`、`@cf/nvidia/nemotron-3-120b-a12b` がある。

日本語まわりでは `@cf/pfnet/plamo-embedding-1b`（Preferred Networks の日本語埋め込みモデル）がカタログにいる。コトノハの本文検索や類似話の抽出に使うなら、多言語の `bge-m3` と並べて比較する候補になる。

#### AI Gateway — 全部のモデル呼び出しをここに通す

2026-08-07 に Workers AI と AI Gateway の入口が統合された。`env.AI.run()` に `gateway` を足すだけで経路が変わる。

```ts
const response = await env.AI.run(
  "@cf/zai-org/glm-5.2",
  { messages: [{ role: "user", content: "..." }] },
  { gateway: { id: "default" } },   // "default" は初回アクセス時に自動作成される
);
```

通した先で効くのが、ログ・キャッシュ・レート制限・自動リトライ・ガードレール・DLP・モデルのフォールバック。リトライは最大5回、間隔100ms〜5秒、バックオフは定数・線形・指数から選ぶ。ヘッダで1リクエストごとに上書きもできる。

課金の統合（Unified Billing）を使うと、Workers AI と OpenAI・Anthropic など外部プロバイダの支払いが1つのクレジット残高にまとまる。副次的な効果として、フロンティアモデルのレート制限が**毎分20リクエストから50リクエストに上がる**。エージェント用途では効いてくる差だと思う。

外部モデルは `openai/gpt-5.5` のような `provider/model` 形式で、Cloudflare の認証だけで REST から叩ける。

#### AI Search — R2 に置いた文書を検索して答えさせる

R2 バケットに文書を入れておくと、埋め込み・インデックス・検索・回答生成までを引き受ける。Vectorize と AI Gateway とパイプラインは自動で用意される。

```ts
const result = await env.AI.autorag("my-ai-search").aiSearch({
  query: "この作品の主人公の設定は？",
  model: "openai/gpt-5",
});
```

検索だけしたいなら `search()`、回答まで欲しいなら `aiSearch()`。メタデータでの絞り込みが効くので、テナントごとにフォルダを切って `folder` で絞れば、利用者ごとの検索を作れる。`filename` や `timestamp` でも絞れる。

`context` という名前のカスタムメタデータを付けておくと、その値が各チャンクに添えられて回答生成時にモデルへ渡る。文書の要約や出典URLを入れておく使い方が案内されている。メタデータは1ベクトルあたり合計10KiB の枠に収まる必要があり、フィルタに使えるのは各文字列の**先頭64バイトまで**。

### 6. エージェントに手足を与える: ブラウザ・サンドボックス・ファイルシステム

エージェントに「外の世界を触らせる」ための道具が、2026年に一通り揃った。用途が重なるので、選び方から書く。

| やりたいこと | 使うもの | 補足 |
| --- | --- | --- |
| ウェブページを見る・操作する | Browser Run | `browser_execute` で CDP を直接叩く。1発ものは Quick Actions |
| モデルが書いたコードを走らせる | Dynamic Workers | 隔離された Worker。Code Mode の下地 |
| Linux が要る処理を走らせる | Containers / Sandbox SDK | 2026-04-13 に GA |
| エージェント専用の作業ディレクトリ | `@cloudflare/computer` | isolate と container を自動で使い分ける（プレビュー） |
| 成果物をバージョン管理して置く | Artifacts | Git 互換ストレージ（beta） |

#### Browser Run

`browser_execute` という単一のツールに集約された。決められた操作の一覧から選ばせるのではなく、モデルが Chrome DevTools Protocol に対してコードを書く。ページの検査、スクリーンショット、描画後の内容の読み取り、フロントエンドのデバッグまで、同じ入口でできる。

セッションは使い捨て・再利用・途中からの昇格の3通り。途中で人間のログインやMFAが要るときに、同じタブとクッキーのまま止めて、承認後に再開できる。

一発で終わる用途には Quick Actions がある。`browser_markdown`（ページをMarkdownで読む）、`browser_extract`（AIで構造化データを抽出）、`browser_links`、`browser_scrape`。こちらは `browser` バインディングだけで動き、Worker Loader もサンドボックスも要らない。結果は `maxChars` で切られるので、文脈が溢れない。

観測系も揃った。Live View で実行中の画面を見て操作を代われる。`recording: true` を渡すと DOM の状態が記録され、終了後にダッシュボードから再生できる。Wrangler にも `wrangler browser` コマンドが入り、APIトークンを渡さずにセッションを管理できる。ダッシュボードには Playground もあるので、Worker を書く前に試せる。

【要確認】Quick Actions は `compatibility_date` が `2026-03-24` 以降であることと、ローカルの `wrangler dev` では browser バインディングに `remote: true` が要る。

#### Dynamic Workers（旧 Worker Loader）

実行時にコードを読み込んで、隔離された Worker として動かす仕組み。バインディングを絞る、Tail Worker でログを取る、`fetch()` を塞ぐ、リソース上限を掛ける、といった制御を呼び出し側が全部握れる。

Durable Object Facets を使うと、動的に読み込んだコードを**自前の SQLite を持つ Durable Object として**動かせる。テナントごとに違うコードが動く SaaS を作るときの部品になる。

料金は少し変わっていて、Worker ID とコードの組み合わせが変わるたびに「新しい Dynamic Worker」として日次でカウントされる。月1,000本まで無料、超過は1本1日あたり $0.002。リクエストとCPU時間は通常の Workers 料金に合流する。Workers Paid のみ。

#### Sandbox SDK と Containers

Sandbox SDK は Containers の上に立つ薄いAPIで、`getSandbox(env.Sandbox, "user-123")` から `exec()` でコマンドを打つ。サンドボックスごとに専用のVMが立つ。

GA までに入った機能を並べると、プレビューURL、Python/JS/TS の永続的なコードインタープリタ、ブラウザから使える PTY 端末、ワークスペースのバックアップと復元、ファイル変更の監視。エージェントのコーディングセッションを止めて再開する、といった運用が組める。

セキュリティ面で効くのが Outbound Workers による**認証情報の注入**だ。送信ハンドラは Workers ランタイム側（サンドボックスの外）で動くので、サンドボックス内のコードに秘密を見せずに、外へ出る直前でトークンを付けられる。TLS の中身の検査、許可・拒否リスト、インスタンスごとの動的なポリシーも書ける。信頼できないコードを走らせる前提の設計として筋がいい。

Sandbox SDK 1.0 は `@next` タグでプレビュー中。新規は `@next` を勧める案内が出ている。

#### `@cloudflare/computer` と Artifacts

`@cloudflare/computer` は2026-08-03 に出たプレビューで、エージェントに「自分のコンピュータ」を渡す。SQLite を裏に持つ仮想ファイルシステムに、クラウドストレージやソースコードから中身を流し込み、`read` `write` `edit` `ls` `exec` のツール群を AI SDK 互換で渡す。実行系は速い isolate（`just-bash` + Dynamic Workers）と、フルの Linux（Containers を FUSE でマウント）を自動で使い分ける。すべての操作がゲートと監査の対象になる。

```ts
import { Workspace } from "@cloudflare/computer";

export class Agent {
  workspace = new Workspace({ storage: this.ctx.storage });
}
```

Artifacts は Git 互換のストレージ。リポジトリを数千万個作れる前提で設計されていて、エージェント1体につき1リポジトリ、あるいはユーザー1人につき1リポジトリという使い方が想定されている。Workers バインディング・REST API・Git プロトコルの3つの顔を持ち、`git clone https://x:${REPO_TOKEN}@artifacts.cloudflare.net/<namespace>/<repo>.git` がそのまま通る。エージェントは Git を知っているのだから Git で渡す、という発想である。beta で、参加は申請制。

### 7. 土台側で起きたこと（既存アプリに効く変更）

エージェントと直接の関係はないが、既存アプリに影響する変更をまとめる。

**D1 の無料枠が実効化した。** 2026-09-01 以降、Workers Free プランで日次の行読み・行書き上限を超えるとクエリがエラーを返す。UTC の深夜にリセットされる。保存済みデータには影響しない。

**Durable Objects の SQLite ストレージが課金対象になった**（2026-01-07 から）。読み・書き・保存容量の3軸で、単価は D1 と揃えてある。`setAlarm()` は1回につき1行の書き込みとして数えられる。KV 形式のメソッド（`get` `put` `delete` `list`）も内部の隠しテーブルへの読み書きとして課金される。30日ぶんの Point-in-Time Recovery が付く。

**`deleteAll()` が alarm も消すようになった**（`compatibility_date` が `2026-02-24` 以降）。これまでは `deleteAlarm()` を別に呼ぶ必要があった。

**Workflows の上限が上がった。** 1インスタンスあたりのステップ数が既定10,000、設定で25,000まで。以前は1,024だったので、子ワークフローに分割していた処理をそのまま書けるようになった。`step.do()` の第2引数の `ctx.attempt` で現在が何回目の再試行かを読める。リトライ間隔に関数を渡せるようになり、「レート制限エラーなら長く待ち、ネットワークエラーなら短く」といった分岐が書ける。課金は2026-08-10 開始。

**Email Service が公開 beta に入った。** `env.EMAIL.send()` で Worker から送れる。REST API と、`smtp.mx.cloudflare.net:465` の認証付きSMTPも使える（ユーザー名は `api_token` 固定、パスワードは「Email Sending: Edit」権限のAPIトークン）。受信側の Email Routing と合わせて Cloudflare Email Service という1つの製品になった。エージェントには `onEmail` フックが用意されている。

**Workers のトレースが実装された。** `tracing.startActiveSpan()` と `span.end()` がランタイムAPIとして入り、コールバック1回では終わらない処理（ストリームの消費など）にもスパンを張れる。beta 期間中は無料で、2026-10-01 から Workers Logs と同じ枠・同じ単価で課金される。

**Python と JavaScript の Worker が RPC で相互に呼べる。** Service バインディング経由で、追加の依存もスキーマ定義もシリアライズのコードも要らない。例外は呼び出し元へ伝播する。

**R2 SQL に分析系の構文が入った。** ウィンドウ関数、`QUALIFY`、`DISTINCT ON`、集合演算（`UNION` / `INTERSECT` / `EXCEPT`）、`GROUPING SETS` / `ROLLUP` / `CUBE`、`MEDIAN` や `PERCENTILE_CONT` などの厳密な集計。R2 Data Catalog（R2 バケットに組み込みの Apache Iceberg カタログ）に入れたテーブルを `wrangler r2 sql query` で引ける。

### 8. 迎える側の話: エージェントを通す、止める、課金する

ここまでは作る側だった。自分のサイトに来るエージェントをどう扱うかも、2026年に道具が増えた領域である。

**AI Crawl Control と pay per crawl。** AIクローラーに対してゾーン単位で価格を設定し、支払い意思のないアクセスには `HTTP 402 Payment Required` と価格を返す。Cloudflare が Merchant of Record として決済も持つ。クローラー側は Web Bot Auth で身元を証明し、`crawler-exact-price` か `crawler-max-price` を署名対象に含めて送る（ヘッダの改竄と再送攻撃を塞ぐため、この署名は必須になった）。最低価格は1クロールあたり $0.001。クローラーごとに「課金する / 無料で通す / 遮断する」を選べる。closed beta。

検索エンジンのクローラーを遮断・課金すると SEO に影響するので、ダッシュボードの Category 列で区別してから設定する。

**Redirects for AI Training。** `<link rel="canonical">` を既に張っているサイトなら、トグル1つで済む機能。検証済みのAI学習クローラーが重複ページや廃止ページを取りに来たとき、canonical 先へ 301 を返す。人間・検索エンジン・AI検索エージェントには元のページを返す。Pro 以上で追加費用なし。

**エージェント間の決済。** HTTP 402 を土台にした支払いプロトコルが2つ、Agents SDK に組み込まれている。x402（Coinbase 発、Cloudflare が x402 Foundation の創設メンバー）はステーブルコイン決済で、`PAYMENT-REQUIRED` `PAYMENT-SIGNATURE` `PAYMENT-RESPONSE` の3ヘッダを使う。Machine Payments Protocol（MPP）は `WWW-Authenticate: Payment` を使い、カード（Stripe 経由）や継続課金にも対応し、x402 とも後方互換がある。サーバ側は `withX402` と `paidTool`、クライアント側は `withX402Client` で、`402` の処理と人間の承認を挟める。

**組織の中でのAI利用の可視化。** Gateway が MCP 通信を自動判別するようになり、Insights & Logs に AI security report が追加された。DLP は ChatGPT・Claude・Gemini・Perplexity へのプロンプトを検査してトピック分類できる。

### 9. 逆引き: 「〜したい」から引く

#### 状態を持つチャットボットを作りたい → `AIChatAgent` + `useAgentChat`
`@cloudflare/ai-chat` を入れて Durable Object を1つ張る。履歴の保存・ストリームの再開・承認フローが最初から付いてくる。→ 2-3

#### 外部AIから自分のアプリを操作させたい → `createMcpHandler`
`McpAgent` は使わない。認可は `workers-oauth-provider`。→ 3-2、3-3

#### 自分のエージェントに外部サービスを使わせたい → `addMcpServer()`
接続はエージェントの SQLite に残る。OAuth が要るサーバは `result.authUrl` へリダイレクトする。→ 3-4

#### ツールが増えすぎて文脈を食う → Code Mode
2,594ツールが約1,000トークンになった実測がある。ポータル経由なら `optimize_context=minimize_tools` でも5倍節約。→ 2-5、3-6

#### 何時間もかかる処理をエージェントにやらせたい → `runFiber()` か Workflows
エージェントの中で完結し、途中経過を自分で管理するなら fiber。ステップごとの再試行と数日単位の待機が要るなら Workflows。→ 2-2、7

#### 信頼できないコードを走らせたい → Dynamic Workers か Sandbox SDK
JavaScript が数十ミリ秒で動けばいい場合は Dynamic Workers。Linux のバイナリやパッケージマネージャが要るなら Sandbox。→ 6

#### ログイン後の画面をエージェントに操作させたい → Browser Run + Live View
セッションを一時停止して人間がログインし、同じタブのまま再開できる。→ 6

#### 自分のドキュメントについて答えさせたい → AI Search
R2 に文書を置いて `aiSearch()` を呼ぶ。テナント分離はフォルダ + `folder` フィルタ。→ 5

#### AIクローラーからの収益化・遮断 → AI Crawl Control
価格設定は closed beta、遮断は今すぐできる。→ 8

#### エージェントの挙動を追いたい → Workers トレース
`observability.traces.enabled` を立てるだけ。ペイロードの記録は明示的に有効化する。→ 2-7

### 10. コトノハ（このリポジトリ）に効く順に

このリポジトリは Vite + React 19 + Pages Functions で、D1・R2・Clerk・Stripe を束ね、`/api/mcp` に自前のMCPサーバ（`functions/api/_lib/mcp-server.ts`、約960行）を持っている。前章までを踏まえて、影響のある順に並べる。

#### 影響が大きい: MCP の SSE 経路が消えた件を確認する

コトノハのMCPサーバは `2025-06-18` をプロトコル版として宣言し、クライアントが要求した版をそのまま返している。JSON-RPC 2.0 の Streamable HTTP で実装しているので、Cloudflare 側の `/sse` 廃止の影響は受けない。ただし**接続してくるクライアントが SSE トランスポートを強制していないか**は確認する価値がある。もし旧 HTTP+SSE を前提にしたクライアントが残っていれば、Streamable HTTP か自動判別に切り替えてもらう案内が要る。

2026-07-28 仕様への対応そのものは急がなくていい。新仕様のクライアントも旧来のステートレスなリクエストを受け付ける側と互換があり、既存の実装がすぐ壊れる話ではない。ただし自前実装である以上、仕様の追随はこちらの仕事になる。Agents SDK の `createMcpHandler` へ寄せれば互換の維持を任せられるが、いまの実装は OAuth 中継を含めて自前で組み上がっているので、載せ替えのコストは小さくない。判断は別途。

#### 影響が中くらい: Pages → Workers の移行を検討対象に載せる

Cloudflare は新規プロジェクトを Workers に寄せる方針を明言していて、Pages のドキュメントにも警告が出るようになった。ただし**Pages が止まるとは書かれていない**。静的アセットは Pages でも Workers でも無料で、Pages Functions は Workers と同じ単価で課金されるので、コスト面の差はない。

移行して得られるのは機能差だ。Durable Objects を同じプロジェクト内で持てる（いまは別Workerに切り出してバインディングを張る必要がある）、Cron Triggers が使える、Observability が充実している。逆に手間になるのは、`pages_build_output_dir` を `assets.directory` に置き換える設定変更と、`functions/` ディレクトリを Worker にコンパイルする作業、そしてプレビュー環境の作り分け（いまの `[[env.preview.d1_databases]]` による本番/stg 分離）の設計し直しである。

エージェント機能を本気で足すなら Durable Objects が要るので、そのときが移行の潮時になる。逆に言えば、いまのまま同期とバックアップを回すだけなら急ぐ理由はない。

#### 影響が小さい: 日本語埋め込みモデルと AI Search

将来、作品横断の検索や「似た話」の抽出をやるなら、`@cf/pfnet/plamo-embedding-1b`（日本語特化）と `@cf/baai/bge-m3`（多言語・100言語以上）が候補になる。R2 に本文を置く構成なら AI Search がそのまま乗る。ただしコトノハは**ローカルファースト**で本文が IndexedDB にあり、クラウド側には暗号化ブロブしか置かない設計なので、そのままでは AI Search に食わせられない。検索機能をサーバ側に置くかどうかは、暗号化の設計まで戻って考える必要がある。

#### 様子見: WebMCP

4-5 に書いたとおり、ブラウザAPIの置き場所が移動中で、戻り値の平坦化もコトノハの構造化データと相性が悪い。仕様が Chrome の安定版に入るまで待つ。

---

## 用語集

| 用語 | 意味 |
| --- | --- |
| **Agents SDK** | `agents` パッケージ。Durable Object を土台に、状態同期・スケジュール・WebSocket・MCP クライアントをまとめたエージェント用ライブラリ |
| **AI Gateway** | すべてのモデル呼び出しの入口。ログ・キャッシュ・レート制限・リトライ・課金統合を担う |
| **AI Search** | R2 の文書を埋め込み・索引化して検索と回答生成まで行う。旧 AutoRAG |
| **Artifacts** | Git 互換のストレージ。エージェント1体につき1リポジトリという規模で使う想定（beta） |
| **Browser Run** | Cloudflare 側で Chrome を動かす仕組み。旧 Browser Rendering |
| **Code Mode** | ツールを個別に列挙せず、モデルにコードを書かせてサンドボックスで実行する方式。トークン消費を大きく削る |
| **Dynamic Workers** | 実行時にコードを読み込んで隔離 Worker として走らせる仕組み。旧称 Worker Loader |
| **Durable Object** | 名前で一意に決まる、状態と SQLite を持つサーバインスタンス。エージェント機能はすべてこの上に立つ |
| **Fiber** | エージェントの処理を SQLite に記録し、途中で落ちても再開できるようにする仕組み（`runFiber` / `startFiber`） |
| **MCP** | Model Context Protocol。ツール・リソース・プロンプトを JSON-RPC 2.0 で公開する規格 |
| **MCP server portal** | 複数のMCPサーバを1エンドポイントに束ね、Cloudflare Access の認証と監査を通す Zero Trust 側の機能 |
| **Neuron** | Workers AI の課金単位。$0.011 / 1,000 Neurons、無料枠は1日10,000 |
| **Sandbox SDK** | Containers の上に立つ、隔離 Linux 環境の TypeScript API |
| **Think** | `@cloudflare/think`。ループ・ツール選択・スキルまで込みの高レベルなエージェントハーネス（実験的） |
| **WebMCP** | ウェブページが自分のツールをブラウザに登録し、エージェントから直接呼べるようにする W3C 提案の仕組み |
| **Web Bot Auth** | クローラーが署名で身元を証明する仕組み。pay per crawl の前提になる |
| **x402 / MPP** | HTTP 402 を土台にしたエージェント向けの支払いプロトコル |

## この文書について

- **最終更新**: 2026-09-04
- **書かれた前提**: Cloudflare 公式ドキュメントと changelog を docs MCP サーバ経由で調査した内容にもとづく。Cloudflare のドキュメントは更新が速く、とくに beta 段階の製品（Artifacts、pay per crawl、Sandbox SDK 1.0、Agent Skills、WebMCP）は数か月で挙動が変わりうる。実装前には必ず一次情報にあたってほしい。
- **【要確認】が付いた記述**: WebMCP のブラウザ側の詳細（4-2）と Browser Run Quick Actions の互換日付（6章）。これらは公式ドキュメント外の情報か、記載を直接確認できなかった項目である。
- **分からないことがあったら**: Cloudflare のドキュメントは `https://developers.cloudflare.com/<product>/llms.txt` に製品ごとの索引がある。AI に調べさせるなら `https://docs.mcp.cloudflare.com/mcp` を MCP サーバとして繋ぐのが速い。この文書で解決しない疑問は、そこから引き直してこの文書を直すところまでやってもらえると助かる。
