/// <reference types="@cloudflare/workers-types" />
/**
 * /api/mcp/oauth-protected-resource — OAuth 2.0 Protected Resource Metadata（RFC 9728）。
 * MCP を OAuth リソースサーバーとして名乗り、認可サーバーの在り処をクライアントへ示す。
 * 401 応答の WWW-Authenticate から、このドキュメントの URL が案内される（Claude はこの経路）。
 *
 * 認可サーバーは**自オリジンを名乗る**。窓口の実体は /api/oauth/* が Clerk へ中継する
 * （同一オリジンでないと ChatGPT が弾くため。詳細は functions/_middleware.ts の頭を参照）。
 * ルート直下の /.well-known/oauth-protected-resource と内容を揃えること。
 */

import { buildProtectedResourceMetadata } from '../_lib/oauth-metadata'
import { normalizeIssuer } from '../_lib/oauth-upstream'

interface Env {
  /** 上流の認可サーバー(Clerk)の issuer URL。未設定なら認可サーバーを名乗らない。 */
  MCP_OAUTH_ISSUER?: string
  /** 対応スコープ（スペース区切り・任意）。 */
  MCP_OAUTH_SCOPES?: string
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS })

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const issuer = normalizeIssuer(context.env.MCP_OAUTH_ISSUER)
  const meta = buildProtectedResourceMetadata({
    // リソースの正準 URI＝MCP エンドポイント（同一オリジンの /api/mcp）。
    resource: `${url.origin}/api/mcp`,
    authorizationServers: issuer ? [url.origin] : [],
    scopesSupported: context.env.MCP_OAUTH_SCOPES?.split(/\s+/).filter(Boolean),
    resourceName: 'コトノハ-leaf-',
  })
  return new Response(JSON.stringify(meta), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
      ...CORS,
    },
  })
}
