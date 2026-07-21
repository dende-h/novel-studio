/// <reference types="@cloudflare/workers-types" />
/**
 * MCP エンドポイントの認証解決（二系統）。
 * 1) Clerk 発行の OAuth アクセストークン（JWT）— コネクタからの標準的な接続。会員判定は
 *    トークンのクレームでなく Clerk バックエンドの購読照会で行う（プランクレームは
 *    セッショントークン専用で OAuth トークンには載らないため）。
 * 2) 従来の `mcp_` 長期トークン — 上級者・Claude request-headers 用のフォールバック（互換）。
 * どちらも userId に解決する。read-only 用途なので書き込みは扱わない。
 */

import { createClerkClient } from '@clerk/backend'
import { PLAN_KEY } from '../../../src/core/billing/plan'
import { verifyRs256Jwt } from './jwt-verify'
import { resolveMcpUser } from './mcp-token'

/** OAuth 検証＋会員照会に必要な環境変数。OAuth 系が未設定なら従来トークンのみ有効。 */
export interface McpAuthEnv {
  /** 認可サーバー(Clerk)の issuer URL。 */
  MCP_OAUTH_ISSUER?: string
  /** このリソースの audience（＝MCP の正準 URI）。 */
  MCP_OAUTH_AUDIENCE?: string
  /** 会員照会（Clerk Backend Billing）に使う。 */
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
}

export interface McpPrincipal {
  userId: string
  isMember: boolean
  via: 'oauth' | 'token'
}

/** テスト時に差し替え可能な依存（JWKS 取得・現在時刻・会員照会）。 */
export interface McpAuthDeps {
  getJwks?: (issuer: string) => Promise<JsonWebKey[]>
  now?: number
  isMember?: (userId: string) => Promise<boolean>
}

/** Authorization ヘッダから Bearer トークンを取り出す。 */
export function bearerOf(request: Request): string {
  const h = request.headers.get('Authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

/** issuer の JWKS を取得する（本番用）。テストでは deps.getJwks で差し替える。 */
async function fetchJwks(issuer: string): Promise<JsonWebKey[]> {
  const base = issuer.replace(/\/$/, '')
  const res = await fetch(`${base}/.well-known/jwks.json`)
  if (!res.ok) return []
  const body = (await res.json()) as { keys?: JsonWebKey[] }
  return Array.isArray(body.keys) ? body.keys : []
}

/**
 * Clerk 発行 OAuth アクセストークンを検証し userId(sub) を返す。
 * MCP_OAUTH_ISSUER/AUDIENCE 未設定（結線前）や検証失敗なら null。
 */
export async function verifyOAuthUserId(
  token: string,
  env: McpAuthEnv,
  deps?: McpAuthDeps,
): Promise<string | null> {
  if (!env.MCP_OAUTH_ISSUER || !env.MCP_OAUTH_AUDIENCE) return null
  const getJwks = deps?.getJwks ?? fetchJwks
  const jwks = await getJwks(env.MCP_OAUTH_ISSUER)
  if (jwks.length === 0) return null
  const claims = await verifyRs256Jwt(token, jwks, {
    issuer: env.MCP_OAUTH_ISSUER,
    audience: env.MCP_OAUTH_AUDIENCE,
    now: deps?.now,
  })
  return typeof claims?.sub === 'string' ? claims.sub : null
}

/**
 * userId が cloud プランの有効な購読を持つかを Clerk Backend Billing で照会する。
 * 照会不能・失敗・未設定は false（fail-closed）。プランクレームに依存しないので堅い。
 */
export async function isCloudMember(userId: string, env: McpAuthEnv): Promise<boolean> {
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) return false
  try {
    const clerk = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    })
    const sub = await clerk.billing.getUserBillingSubscription(userId)
    return sub.subscriptionItems.some(
      (item) => item.status === 'active' && item.plan?.slug === PLAN_KEY,
    )
  } catch {
    return false
  }
}

/**
 * MCP リクエストの認証を解決する。OAuth（Clerk）を優先し、`mcp_` トークンへフォールバック。
 * OAuth 経路の会員判定は Clerk Backend 照会（deps.isMember で差し替え可）。
 * 認証不能なら null（呼び出し側が 401＋WWW-Authenticate を返す）。
 */
export async function resolveMcpAuth(
  request: Request,
  env: McpAuthEnv,
  db: D1Database,
  deps?: McpAuthDeps,
): Promise<McpPrincipal | null> {
  const token = bearerOf(request)
  if (!token) return null

  // 1) Clerk 発行 OAuth アクセストークン（`mcp_` 以外＝JWT の可能性）。
  if (!token.startsWith('mcp_')) {
    const userId = await verifyOAuthUserId(token, env, deps)
    if (userId) {
      const member = deps?.isMember ? await deps.isMember(userId) : await isCloudMember(userId, env)
      return { userId, isMember: member, via: 'oauth' }
    }
  }

  // 2) 従来の `mcp_` 長期トークン。会員が発行したものなので存在＝アクセス可（互換）。
  const userId = await resolveMcpUser(db, token)
  return userId ? { userId, isMember: true, via: 'token' } : null
}
