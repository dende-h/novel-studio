import { createClerkClient } from '@clerk/backend'
import { PLAN_KEY } from '../../../src/core/billing/plan'

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
 * Clerk セッションを検証し userId と会員（課金プラン保持）かを返す。未認証・未設定は null。
 * 会員判定は JWT クレーム（`has({ plan: PLAN_KEY })`）のみ＝追加ネットワーク無し・単一の真実
 * （D-SYNC-PRICE）。同期 API の 402 ゲートに使う。
 */
export async function verifyMember(
  request: Request,
  env: ClerkEnv,
): Promise<{ userId: string; isMember: boolean } | null> {
  const auth = await authenticate(request, env)
  if (!auth?.userId) return null
  return { userId: auth.userId, isMember: auth.has({ plan: PLAN_KEY }) }
}

/** JSON レスポンス helper。 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
