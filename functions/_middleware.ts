// Cloudflare Pages Functions のミドルウェア。
// 全リクエスト（静的ファイル含む）の前段で実行される。
//
// 役割：OAuth ディスカバリ（RFC 9728）を **ルート直下の .well-known で** 返す。
// MCP クライアントは resource_metadata ヘッダを辿らず、リソースドメインのルート
// `/.well-known/oauth-protected-resource` を直接叩くことがある。ここが 404 だと、
// 認可画面に到達する前に接続失敗する。
//
// **認可サーバーは自分**（2026-09 Phase 2・docs/requirement/10-mcp-oauth.md §4 案3）。
// 実体は `functions/api/oauth/[[path]].ts`。ここで配るメタデータも、認可応答の `iss` を書くのも
// 同じ自オリジンなので、RFC 9207 の照合が素直に通る。
//
// **一度やって失敗した形**を繰り返さないこと：issuer だけ自オリジンに書き換えて、応答は Clerk に
// 書かせる（＝こちらを通らない）中間形。あれは必ず不一致になる。名乗るなら、応答も自分で書く。
// 上流（Clerk）の申告をこのホストの名前で転載するのも同じ穴（§2-G）——**上流の値は混ぜない**。
//
// 旧クライアント（Clerk 側に登録がある）のために `/api/oauth/*` の中継は残してある。
// ディスカバリからは案内しないが、消すとトークン更新が黙って切れる。
//
// かつて Preview(=stg) をベーシック認証（BASIC_AUTH_USER/PASS）で保護していたが撤去した。
// ダッシュボードに残った同名の環境変数はもう参照されない（残っていても無害）。

import { buildProtectedResourceMetadata, parseScopes } from './api/_lib/oauth-metadata'
import { buildAuthServerMetadata } from './api/_lib/oauth-server'

interface Env {
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

  // 認可サーバーのメタデータ（RFC 8414）。openid-configuration にも同じものを配る——
  // MCP クライアントはそこを AS メタデータの代替として読むだけで、OIDC として検証しない。
  if (isAsMeta) return jsonDiscovery(JSON.stringify(buildAuthServerMetadata(url.origin)))

  const meta = buildProtectedResourceMetadata({
    // リソースの正準 URI＝MCP エンドポイント（同一オリジンの /api/mcp）。
    resource: `${url.origin}/api/mcp`,
    // 認可サーバーも自分。名乗りと、認可応答の iss を書く主体が一致している。
    authorizationServers: [url.origin],
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
