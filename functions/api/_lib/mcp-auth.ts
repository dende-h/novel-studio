/// <reference types="@cloudflare/workers-types" />
/**
 * MCP エンドポイントの認証解決（**三系統の併存**）。順に試し、最初に解けたものを使う。
 *
 * 1) `mcp_` 長期トークン — 画面から発行する上級者向け（Genspark 等の Bearer 設定）。
 * 2) `mcpa_` 自前 OAuth のアクセストークン — 2026-09 の Phase 2 で入った本命
 *    （`functions/api/oauth/[[path]].ts` が発行・D1 `oauth_tokens`）。
 * 3) Clerk 発行の OAuth アクセストークン — ファサード時代に繋いだ利用者の互換。
 *    Clerk SDK の authenticateRequest(acceptsToken:'oauth_token') で検証する
 *    （手書きの JWKS 検証は JWT/opaque の形式差で失敗するため不採用）。
 *
 * **3 を消してはいけない。** 既に接続済みの Claude が持っているトークンがこの経路で、
 * 消すと次のリフレッシュまで気づかれずに切れる（CLAUDE.md「後方互換性」）。
 * 会員判定はどの経路でも D1 `subscriptions` を都度照会する（fail-closed）。
 */

import { createClerkClient } from '@clerk/backend'
import { resolveMcpUser } from './mcp-token'
import { isActiveMember } from './membership'
import { hashSecret, isOurs, OAUTH_PREFIX } from './oauth-server'
import { readToken } from './oauth-store'

/** OAuth 検証＋会員照会に必要な環境変数（既存の Clerk 資格情報を使う）。 */
export interface McpAuthEnv {
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
}

export interface McpPrincipal {
  userId: string
  isMember: boolean
  /** どの系統で解けたか（self ＝自前 OAuth・oauth ＝ Clerk 発行・token ＝ mcp_）。 */
  via: 'self' | 'oauth' | 'token'
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
 * userId が有効な会員（active/trialing のサブスク）かを D1 `subscriptions` で照会する（fail-closed）。
 * Stripe 直課金移行により、Clerk のプランクレーム／Billing 照会でなく D1 を単一の真実にする。
 */
export async function isCloudMember(userId: string, db: D1Database): Promise<boolean> {
  return await isActiveMember(db, userId)
}

/**
 * MCP リクエストの認証を解決する。`mcp_` トークンはそのまま、それ以外は Clerk OAuth として検証。
 * OAuth 経路の会員判定は D1 `subscriptions` 照会（deps で差し替え可）。認証不能なら null。
 */
export async function resolveMcpAuth(
  request: Request,
  env: McpAuthEnv,
  db: D1Database,
  deps?: McpAuthDeps,
): Promise<McpPrincipal | null> {
  const token = bearerOf(request)
  if (!token) return null

  const checkMember = (uid: string) =>
    deps?.isMember ? deps.isMember(uid) : isCloudMember(uid, db)

  // 1) 従来の `mcp_` 長期トークン（会員が発行）。会員判定は D1 で都度確認する
  //    （失効したら発行済みトークンでもアクセスを止める＝OAuth 経路と同条件）。
  if (token.startsWith('mcp_')) {
    const userId = await resolveMcpUser(db, token)
    if (!userId) return null
    return { userId, isMember: await checkMember(userId), via: 'token' }
  }

  // 2) 自前 OAuth のアクセストークン（D1 の oauth_tokens・期限は読み出し側が見る）。
  if (isOurs(token, OAUTH_PREFIX.access)) {
    const found = await readToken(db, await hashSecret(token), 'access', Date.now())
    if (!found) return null
    return { userId: found.userId, isMember: await checkMember(found.userId), via: 'self' }
  }

  // 3) Clerk 発行 OAuth アクセストークン（ファサード時代の互換）。
  const verify = deps?.verifyOAuth ?? verifyOAuthUserId
  const userId = await verify(request, env)
  if (!userId) return null
  return { userId, isMember: await checkMember(userId), via: 'oauth' }
}
