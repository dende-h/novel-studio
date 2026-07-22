// Cloudflare Pages Functions のミドルウェア。
// 全リクエスト（静的ファイル含む）の前段で実行される。
//
// 役割は2つ:
// 1. OAuth ディスカバリ（RFC 9728 / RFC 8414）を **ルート直下の .well-known で・無認証で** 返す。
//    ChatGPT などの MCP クライアントは resource_metadata ヘッダを辿らず、リソースドメインの
//    ルート `/.well-known/oauth-protected-resource` を直接叩く。ここが 404 や（stg の）ベーシック
//    認証 401 だと、認可画面に到達する前に「接続で問題が発生しました」で失敗する。
//    ※ Claude は 401 の WWW-Authenticate（/api/mcp/oauth-protected-resource）経由で従来どおり動く。
// 2. Preview(=stg)環境のみベーシック認証で保護する。
//    認証情報は Cloudflare ダッシュボードの「Preview」スコープにのみ設定し、
//    本番(main)では未設定のままにすることで本番は認証なしで素通しする。
//    （CLI経由の Direct Upload シークレットは context.env へ届かない既知不具合が
//      あるため、認証情報はダッシュボードで設定すること）

import { buildProtectedResourceMetadata } from './api/_lib/oauth-metadata'

interface Env {
  BASIC_AUTH_USER?: string
  BASIC_AUTH_PASS?: string
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

/**
 * OAuth ディスカバリ要求ならレスポンスを返す（該当しなければ null）。
 * ベーシック認証より前段で処理し、stg でも無認証で到達できるようにする。
 */
function oauthDiscovery(context: MiddlewareContext, url: URL): Response | null {
  const path = url.pathname
  const isPrm =
    path === '/.well-known/oauth-protected-resource' ||
    // RFC 9728 の path-aware 形式（リソースが /api/mcp のとき）。
    path === '/.well-known/oauth-protected-resource/api/mcp'
  const isAsRedirect = path === '/.well-known/oauth-authorization-server'

  if (!isPrm && !isAsRedirect) return null
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: DISCOVERY_CORS })
  }

  if (isPrm) {
    const meta = buildProtectedResourceMetadata({
      // リソースの正準 URI＝MCP エンドポイント（同一オリジンの /api/mcp）。
      resource: `${url.origin}/api/mcp`,
      authorizationServers: context.env.MCP_OAUTH_ISSUER ? [context.env.MCP_OAUTH_ISSUER] : [],
      scopesSupported: context.env.MCP_OAUTH_SCOPES?.split(/\s+/).filter(Boolean),
      resourceName: 'Novel Studio',
    })
    return new Response(JSON.stringify(meta), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=3600',
        ...DISCOVERY_CORS,
      },
    })
  }

  // AS メタデータをリソースドメイン側で探すクライアント向けの保険。
  // 認可サーバーは Clerk（別ホスト）なので、その issuer の同名ドキュメントへ委譲する。
  if (context.env.MCP_OAUTH_ISSUER) {
    const target = `${context.env.MCP_OAUTH_ISSUER.replace(/\/$/, '')}/.well-known/oauth-authorization-server`
    return new Response(null, { status: 302, headers: { location: target, ...DISCOVERY_CORS } })
  }
  return null
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const url = new URL(context.request.url)

  // 1) OAuth ディスカバリはベーシック認証・ルーティングより前に、無認証で返す。
  const discovery = oauthDiscovery(context, url)
  if (discovery) return discovery

  // 2) /api/* は各 Function 側で Clerk(Bearer JWT) を検証する。ここでベーシック認証
  //    （Basic ヘッダ前提）に通すと Bearer リクエストが 401 になり stg でセッション API が
  //    全て弾かれるため、API パスはミドルウェアの対象外にする。
  if (url.pathname.startsWith('/api/')) {
    return context.next()
  }

  const { BASIC_AUTH_USER, BASIC_AUTH_PASS } = context.env

  // 認証情報が無い環境（=本番）は素通しする。
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASS) {
    return context.next()
  }

  const header = context.request.headers.get('Authorization')
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice('Basic '.length))
    const sep = decoded.indexOf(':')
    const user = decoded.slice(0, sep)
    const pass = decoded.slice(sep + 1)
    if (user === BASIC_AUTH_USER && pass === BASIC_AUTH_PASS) {
      return context.next()
    }
  }

  return new Response('認証が必要です。', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="novel-studio (staging)", charset="UTF-8"',
    },
  })
}
