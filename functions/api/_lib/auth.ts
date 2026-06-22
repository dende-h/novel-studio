import { createClerkClient } from '@clerk/backend'

export interface ClerkEnv {
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  /** JWT 公開鍵（PEM）。あればネットワークレス検証になる（任意）。 */
  CLERK_JWT_KEY?: string
  /** CSRF 対策の許可オリジン（カンマ区切り・任意）。 */
  CLERK_AUTHORIZED_PARTIES?: string
}

/** Clerk セッションを検証し userId を返す。未認証・未設定は null。 */
export async function verifyUserId(request: Request, env: ClerkEnv): Promise<string | null> {
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
  return state.toAuth()?.userId ?? null
}

/** JSON レスポンス helper。 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
