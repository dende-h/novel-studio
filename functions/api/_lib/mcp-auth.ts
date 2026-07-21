/// <reference types="@cloudflare/workers-types" />
/**
 * MCP エンドポイントの認証解決（二系統）。
 * 1) Clerk 発行の OAuth アクセストークン — Clerk SDK の authenticateRequest(acceptsToken:'oauth_token')
 *    で検証。JWT/opaque どちらの形式でも SDK が吸収する（手書きの JWKS 検証は形式差で失敗するため不採用）。
 *    会員判定はトークンでなく Clerk バックエンドの購読照会で行う。
 * 2) 従来の `mcp_` 長期トークン — 上級者・request-headers 用のフォールバック（互換）。
 * どちらも userId に解決する。read-only 用途。
 */

import { createClerkClient } from '@clerk/backend'
import { PLAN_KEY } from '../../../src/core/billing/plan'
import { resolveMcpUser } from './mcp-token'

/** OAuth 検証＋会員照会に必要な環境変数（既存の Clerk 資格情報を使う）。 */
export interface McpAuthEnv {
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
}

export interface McpPrincipal {
  userId: string
  isMember: boolean
  via: 'oauth' | 'token'
}

/** テスト時に差し替え可能な依存（OAuth 検証・会員照会）。 */
export interface McpAuthDeps {
  verifyOAuth?: (request: Request, env: McpAuthEnv) => Promise<string | null>
  isMember?: (userId: string) => Promise<boolean>
}

/** Authorization ヘッダから Bearer トークンを取り出す。 */
export function bearerOf(request: Request): string {
  const h = request.headers.get('Authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

/**
 * Clerk 発行 OAuth アクセストークンを検証して userId を返す（JWT/opaque 両対応）。
 * 資格情報が無い・未認証・失敗なら null。
 */
export async function verifyOAuthUserId(request: Request, env: McpAuthEnv): Promise<string | null> {
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) return null
  try {
    const clerk = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    })
    const state = await clerk.authenticateRequest(request, { acceptsToken: 'oauth_token' })
    if (!state.isAuthenticated) return null
    const auth = state.toAuth() as { userId?: string | null } | null
    return auth?.userId ?? null
  } catch {
    return null
  }
}

/**
 * userId が cloud プランの有効な購読を持つかを Clerk Backend Billing で照会する（fail-closed）。
 * プランクレームに依存しないので堅い（OAuth トークンにはプランクレームが載らないため）。
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
 * MCP リクエストの認証を解決する。`mcp_` トークンはそのまま、それ以外は Clerk OAuth として検証。
 * OAuth 経路の会員判定は Clerk バックエンド照会（deps で差し替え可）。認証不能なら null。
 */
export async function resolveMcpAuth(
  request: Request,
  env: McpAuthEnv,
  db: D1Database,
  deps?: McpAuthDeps,
): Promise<McpPrincipal | null> {
  const token = bearerOf(request)
  if (!token) return null

  // 1) 従来の `mcp_` 長期トークン（会員が発行）。存在＝アクセス可（互換）。
  if (token.startsWith('mcp_')) {
    const userId = await resolveMcpUser(db, token)
    return userId ? { userId, isMember: true, via: 'token' } : null
  }

  // 2) Clerk 発行 OAuth アクセストークン。
  const verify = deps?.verifyOAuth ?? verifyOAuthUserId
  const userId = await verify(request, env)
  if (!userId) return null
  const member = deps?.isMember ? await deps.isMember(userId) : await isCloudMember(userId, env)
  return { userId, isMember: member, via: 'oauth' }
}
