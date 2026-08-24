// Cloudflare Pages Functions のミドルウェア。
// 全リクエスト（静的ファイル含む）の前段で実行される。
//
// 役割：OAuth ディスカバリ（RFC 9728 / RFC 8414）を **ルート直下の .well-known で** 返す。
// ChatGPT などの MCP クライアントは resource_metadata ヘッダを辿らず、リソースドメインの
// ルート `/.well-known/oauth-protected-resource` を直接叩く。ここが 404 だと、認可画面に
// 到達する前に接続失敗する。
//
// さらに ChatGPT は AS メタデータ／OIDC 設定も **MCP ホスト側の** well-known へ直接叩き、
// RFC 8414 §3.3 のとおり「引いたホスト＝issuer」を要求する。Clerk のドキュメントをそのまま
// 中継すると issuer が *.clerk.accounts.dev になって弾かれるため、issuer と窓口を自オリジンへ
// 書き換えた版を配る（実体は /api/oauth/* が Clerk へ中継する）。
// トークンを発行・検証するのは従来どおり Clerk なので、発行済みトークンには影響しない。
//
// かつて Preview(=stg) をベーシック認証（BASIC_AUTH_USER/PASS）で保護していたが撤去した。
// ダッシュボードに残った同名の環境変数はもう参照されない（残っていても無害）。

import {
  buildFacadeAuthServerMetadata,
  buildProtectedResourceMetadata,
} from './api/_lib/oauth-metadata'
import { fetchUpstreamAs, normalizeIssuer } from './api/_lib/oauth-upstream'

interface Env {
  /** 上流の認可サーバー(Clerk)の issuer URL。窓口の中継先として使う。 */
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

/** ディスカバリを組めないときの応答。誤った内容を配るより落ちて見せる（no-store）。 */
const discoveryUnavailable = (): Response =>
  new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...DISCOVERY_CORS,
    },
  })

/** OAuth ディスカバリ要求ならレスポンスを返す（該当しなければ null）。 */
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

  const issuer = normalizeIssuer(context.env.MCP_OAUTH_ISSUER)

  if (isPrm) {
    const meta = buildProtectedResourceMetadata({
      // リソースの正準 URI＝MCP エンドポイント（同一オリジンの /api/mcp）。
      resource: `${url.origin}/api/mcp`,
      // 認可サーバーも同一オリジンを名乗る（実体は /api/oauth/* が Clerk へ中継）。
      // 上流が未設定のときは名乗れないので空にする。
      authorizationServers: issuer ? [url.origin] : [],
      scopesSupported: context.env.MCP_OAUTH_SCOPES?.split(/\s+/).filter(Boolean),
      resourceName: 'コトノハ-leaf-',
    })
    return jsonDiscovery(JSON.stringify(meta))
  }

  // isAsMeta：上流(Clerk)の同名ドキュメントを取り、issuer と窓口を自オリジンへ書き換えて配る。
  if (!issuer) return null
  const upstream = await fetchUpstreamAs(issuer, path)
  if (!upstream) return discoveryUnavailable()
  return jsonDiscovery(JSON.stringify(buildFacadeAuthServerMetadata(upstream, url.origin)))
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
