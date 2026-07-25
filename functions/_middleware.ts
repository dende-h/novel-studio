// Cloudflare Pages Functions のミドルウェア。
// 全リクエスト（静的ファイル含む）の前段で実行される。
//
// 役割：OAuth ディスカバリ（RFC 9728 / RFC 8414）を **ルート直下の .well-known で** 返す。
// ChatGPT などの MCP クライアントは resource_metadata ヘッダを辿らず、リソースドメインの
// ルート `/.well-known/oauth-protected-resource` を直接叩く。ここが 404 だと、認可画面に
// 到達する前に接続失敗する。
// ※ Claude は 401 の WWW-Authenticate（/api/mcp/oauth-protected-resource）経由で従来どおり動く。
//
// かつて Preview(=stg) をベーシック認証（BASIC_AUTH_USER/PASS）で保護していたが撤去した。
// ダッシュボードに残った同名の環境変数はもう参照されない（残っていても無害）。

import { buildProtectedResourceMetadata } from './api/_lib/oauth-metadata'

interface Env {
  /** 認可サーバー(Clerk)の issuer URL。PRM の authorization_servers に載せる。 */
  MCP_OAUTH_ISSUER?: string
  /** 対応スコープ（スペース区切り・任意）。 */
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
 * OAuth ディスカバリ要求ならレスポンスを返す（該当しなければ null）。
 *
 * ChatGPT は PRM の authorization_servers ポインタを辿らず、AS メタデータ／OIDC 設定を
 * MCP ホスト側の well-known へ直接叩き、しかも 302 リダイレクトを追わないことがある。
 * そこで AS 系ドキュメントは Clerk から取得して **200 JSON でそのまま中継**する
 * （取得失敗時のみ Clerk へ 302 フォールバック）。Claude は従来どおりポインタ経由で動く。
 */
async function oauthDiscovery(context: MiddlewareContext, url: URL): Promise<Response | null> {
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

  if (isPrm) {
    const meta = buildProtectedResourceMetadata({
      // リソースの正準 URI＝MCP エンドポイント（同一オリジンの /api/mcp）。
      resource: `${url.origin}/api/mcp`,
      authorizationServers: context.env.MCP_OAUTH_ISSUER ? [context.env.MCP_OAUTH_ISSUER] : [],
      scopesSupported: context.env.MCP_OAUTH_SCOPES?.split(/\s+/).filter(Boolean),
      resourceName: 'コトノハ-leaf-',
    })
    return jsonDiscovery(JSON.stringify(meta))
  }

  // isAsMeta：Clerk の同名ドキュメント（同じ well-known パス）を取得して 200 で中継する。
  const issuer = context.env.MCP_OAUTH_ISSUER?.replace(/\/$/, '')
  if (!issuer) return null
  const upstream = `${issuer}${path}`
  try {
    const res = await fetch(upstream, { headers: { accept: 'application/json' } })
    if (res.ok) return jsonDiscovery(await res.text())
  } catch {
    // 取得失敗時は下の 302 へフォールバック。
  }
  return new Response(null, { status: 302, headers: { location: upstream, ...DISCOVERY_CORS } })
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const url = new URL(context.request.url)
  const discovery = await oauthDiscovery(context, url)
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
