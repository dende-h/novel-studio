/// <reference types="@cloudflare/workers-types" />
import { createClerkClient } from '@clerk/backend'
import { isActiveMember } from './membership'

export interface ClerkEnv {
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  /** JWT 公開鍵（PEM）。あればネットワークレス検証になる（任意）。 */
  CLERK_JWT_KEY?: string
  /** CSRF 対策の許可オリジン（カンマ区切り・任意）。 */
  CLERK_AUTHORIZED_PARTIES?: string
}

/** Clerk セッションを検証し auth オブジェクトを返す。未認証・未設定は null。 */
async function authenticate(request: Request, env: ClerkEnv) {
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) return null
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  })
  const authorizedParties = env.CLERK_AUTHORIZED_PARTIES?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const state = await clerk.authenticateRequest(request, {
    jwtKey: env.CLERK_JWT_KEY,
    authorizedParties,
  })
  if (!state.isAuthenticated) return null
  return state.toAuth()
}

/** Clerk セッションを検証し userId を返す。未認証・未設定は null。 */
export async function verifyUserId(request: Request, env: ClerkEnv): Promise<string | null> {
  const auth = await authenticate(request, env)
  return auth?.userId ?? null
}

/**
 * Clerk セッションを検証し userId と会員（有効なサブスク保持）かを返す。未認証・未設定は null。
 * 会員判定は Clerk のクレームでなく D1 `subscriptions`（Stripe webhook が更新）を単一の真実にする。
 * 同期 API の 402 ゲートに使う。env に D1 バインディング `DB` が必要。
 */
export async function verifyMember(
  request: Request,
  env: ClerkEnv & { DB: D1Database },
): Promise<{ userId: string; isMember: boolean } | null> {
  const userId = await verifyUserId(request, env)
  if (!userId) return null
  return { userId, isMember: await isActiveMember(env.DB, userId) }
}

/** JSON レスポンス helper。 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
