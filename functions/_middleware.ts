// Cloudflare Pages Functions のミドルウェア。
// 全リクエスト（静的ファイル含む）の前段で実行される。
//
// 役割：OAuth ディスカバリ（RFC 9728）を **ルート直下の .well-known で** 返す。
// MCP クライアントは resource_metadata ヘッダを辿らず、リソースドメインのルート
// `/.well-known/oauth-protected-resource` を直接叩くことがある。ここが 404 だと、
// 認可画面に到達する前に接続失敗する。
//
// **認可サーバーは自分ではなく Clerk を名乗る**（2026-09・docs/requirement/10-mcp-oauth.md）。
// 一時期、ChatGPT 対策として issuer と窓口を自オリジンへ書き換えた AS メタデータを配っていたが、
// これが原因で繋がらなかった。名乗る issuer は自分（このホスト）なのに、認可応答の `iss` を
// 書くのは Clerk で、そこはこちらを通らない＝ RFC 9207 の照合に必ず落ちる。STG での実測でも
// 名乗り `https://stg.novel-studio-b2m.pages.dev` に対して飛び先が
// `https://credible-stork-66.clerk.accounts.dev` だった。よって：
//   * PRM の `authorization_servers` は **Clerk の issuer** をそのまま指す。
//   * このホストの `/.well-known/oauth-authorization-server`（と openid-configuration）は
//     **404 を JSON で返す**。ここに何かを置くと「このホストが認可サーバーだ」と名乗ることになる。
//   * `/api/oauth/*` の中継は**残す**。既に接続済みのクライアントがそこを token_endpoint として
//     覚えている可能性があり、消すとトークン更新が黙って切れる。
//
// かつて Preview(=stg) をベーシック認証（BASIC_AUTH_USER/PASS）で保護していたが撤去した。
// ダッシュボードに残った同名の環境変数はもう参照されない（残っていても無害）。

import { buildProtectedResourceMetadata, parseScopes } from './api/_lib/oauth-metadata'
import { normalizeIssuer } from './api/_lib/oauth-upstream'

interface Env {
  /** 認可サーバー(Clerk)の issuer URL。PRM がクライアントへ案内する先。 */
  MCP_OAUTH_ISSUER?: string
  /** 要求してほしいスコープ（スペース区切り・任意。未設定なら DEFAULT_MCP_SCOPES）。 */
  MCP_OAUTH_SCOPES?: string
}

interface MiddlewareContext {
  request: Request
  env: Env
  next: () => Promise<Response>
}

const DISCOVERY_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

const jsonDiscovery = (body: string): Response =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
      ...DISCOVERY_CORS,
    },
  })

/**
 * 「このホストは認可サーバーではない」という応答。
 * **HTML（SPA や Pages の 404 ページ）に落とさない**のが要点で、落とすと
 * クライアントからは「壊れた JSON を返すサーバー」に見える（原因の切り分けができなくなる）。
 * 認可サーバーの在り処は PRM の `authorization_servers` にある。
 */
const notAuthorizationServer = (): Response =>
  new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...DISCOVERY_CORS,
    },
  })

/** OAuth ディスカバリ要求ならレスポンスを返す（該当しなければ null）。 */
function oauthDiscovery(context: MiddlewareContext, url: URL): Response | null {
  const path = url.pathname
  const isPrm =
    path === '/.well-known/oauth-protected-resource' ||
    // RFC 9728 の path-aware 形式（リソースが /api/mcp のとき）。
    path === '/.well-known/oauth-protected-resource/api/mcp'
  const isAsMeta =
    path === '/.well-known/oauth-authorization-server' ||
    path === '/.well-known/openid-configuration'

  if (!isPrm && !isAsMeta) return null
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: DISCOVERY_CORS })
  }

  if (isAsMeta) return notAuthorizationServer()

  const issuer = normalizeIssuer(context.env.MCP_OAUTH_ISSUER)
  const meta = buildProtectedResourceMetadata({
    // リソースの正準 URI＝MCP エンドポイント（同一オリジンの /api/mcp）。
    resource: `${url.origin}/api/mcp`,
    // 認可サーバー＝Clerk。未設定のときは名乗れないので空にする。
    authorizationServers: issuer ? [issuer] : [],
    scopesSupported: parseScopes(context.env.MCP_OAUTH_SCOPES),
    resourceName: 'コトノハ-leaf-',
  })
  return jsonDiscovery(JSON.stringify(meta))
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const url = new URL(context.request.url)
  const discovery = oauthDiscovery(context, url)
  const response = discovery ?? (await context.next())

  // SEO：本番の正規ドメインは cotonoha-leaf.org に一本化する。本番デプロイは
  // novel-studio-b2m.pages.dev でも同じ内容が配信され、stg は *.pages.dev のプレビュー。
  // これらが検索インデックスに載ると重複コンテンツになるため、**ホスト名が .pages.dev で
  // 終わるときだけ** X-Robots-Tag: noindex を付ける。cotonoha-leaf.org は該当しないので
  // 絶対に noindex にならない（許可リスト型＝本番を検索から消す方向には決して倒れない）。
  if (url.hostname.endsWith('.pages.dev')) {
    const res = new Response(response.body, response)
    res.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return res
  }
  return response
}
