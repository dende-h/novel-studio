/// <reference types="@cloudflare/workers-types" />
/**
 * MCP エンドポイントの認証解決（二系統）。
 * 1) Clerk 発行の OAuth アクセストークン（JWT）— コネクタからの標準的な接続。
 * 2) 従来の `mcp_` 長期トークン — 上級者・Claude request-headers 用のフォールバック（互換）。
 * どちらも userId に解決する。read-only 用途なので書き込みは扱わない。
 */

import { PLAN_KEY } from '../../../src/core/billing/plan'
import { type JwtClaims, verifyRs256Jwt } from './jwt-verify'
import { resolveMcpUser } from './mcp-token'

/** OAuth 結線に必要な環境変数。未設定なら OAuth 検証はスキップ（＝結線前は 2 の従来トークンのみ有効）。 */
export interface McpOAuthEnv {
  /** 認可サーバー(Clerk)の issuer URL。 */
  MCP_OAUTH_ISSUER?: string
  /** このリソースの audience（＝MCP の正準 URI）。 */
  MCP_OAUTH_AUDIENCE?: string
}

export interface McpPrincipal {
  userId: string
  isMember: boolean
  via: 'oauth' | 'token'
}

/** Authorization ヘッダから Bearer トークンを取り出す。 */
export function bearerOf(request: Request): string {
  const h = request.headers.get('Authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

/** OAuth クレームから cloud 会員かを判定する（scope もしくは plan クレームに PLAN_KEY）。 */
function deriveIsMember(claims: JwtClaims): boolean {
  const scope = typeof claims.scope === 'string' ? claims.scope.split(/\s+/) : []
  if (scope.includes(PLAN_KEY)) return true
  // Clerk の plan クレーム表現（結線時に実クレーム形で最終確認する）。
  const pla = claims.pla
  if (typeof pla === 'string' && pla.split(',').includes(PLAN_KEY)) return true
  return false
}

/** issuer の JWKS を取得する（本番用）。テストでは resolveMcpAuth に注入して差し替える。 */
async function fetchJwks(issuer: string): Promise<JsonWebKey[]> {
  const base = issuer.replace(/\/$/, '')
  const res = await fetch(`${base}/.well-known/jwks.json`)
  if (!res.ok) return []
  const body = (await res.json()) as { keys?: JsonWebKey[] }
  return Array.isArray(body.keys) ? body.keys : []
}

/**
 * Clerk 発行 OAuth アクセストークンを検証して principal を返す。
 * MCP_OAUTH_ISSUER/AUDIENCE 未設定（結線前）や検証失敗なら null。
 */
export async function verifyClerkOAuthToken(
  token: string,
  env: McpOAuthEnv,
  deps?: { getJwks?: (issuer: string) => Promise<JsonWebKey[]>; now?: number },
): Promise<McpPrincipal | null> {
  if (!env.MCP_OAUTH_ISSUER || !env.MCP_OAUTH_AUDIENCE) return null
  const getJwks = deps?.getJwks ?? fetchJwks
  const jwks = await getJwks(env.MCP_OAUTH_ISSUER)
  if (jwks.length === 0) return null
  const claims = await verifyRs256Jwt(token, jwks, {
    issuer: env.MCP_OAUTH_ISSUER,
    audience: env.MCP_OAUTH_AUDIENCE,
    now: deps?.now,
  })
  if (!claims?.sub) return null
  return { userId: claims.sub, isMember: deriveIsMember(claims), via: 'oauth' }
}

/**
 * MCP リクエストの認証を解決する。OAuth（Clerk）を優先し、`mcp_` トークンへフォールバック。
 * 認証不能なら null（呼び出し側が 401＋WWW-Authenticate を返す）。
 */
export async function resolveMcpAuth(
  request: Request,
  env: McpOAuthEnv,
  db: D1Database,
  deps?: { getJwks?: (issuer: string) => Promise<JsonWebKey[]>; now?: number },
): Promise<McpPrincipal | null> {
  const token = bearerOf(request)
  if (!token) return null

  // 1) Clerk 発行 OAuth アクセストークン（`mcp_` 以外＝JWT の可能性）。
  if (!token.startsWith('mcp_')) {
    const oauth = await verifyClerkOAuthToken(token, env, deps)
    if (oauth) return oauth
  }

  // 2) 従来の `mcp_` 長期トークン。会員が発行したものなので存在＝アクセス可（互換）。
  const userId = await resolveMcpUser(db, token)
  return userId ? { userId, isMember: true, via: 'token' } : null
}
