/// <reference types="@cloudflare/workers-types" />
/**
 * クラウド側のユーザーデータ削除（`purgeCloudData`＝データのみ）と、Clerk ログイン削除
 * （`deleteClerkUser`）。reaper（/api/billing/reap）が「アカウント＝課金者」を保つために使う：
 * 猶予切れ・未課金の掃除では両方（データ＋ログイン）を消し、再開は再登録とする。各段は冪等。
 * 端末ローカルの IndexedDB 小説は対象外。
 */
import { createClerkClient } from '@clerk/backend'

export interface PurgeEnv {
  DB: D1Database
  MEDIA: R2Bucket
}

export interface ClerkDeleteEnv {
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
}

/** Clerk ユーザー（ログイン）を削除。404（既に不在）は冪等成功、それ以外は throw。 */
export async function deleteClerkUser(env: ClerkDeleteEnv, userId: string): Promise<void> {
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) return
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  })
  try {
    await clerk.users.deleteUser(userId)
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: unknown }).status === 404
  )
}

/** クラウドデータ（R2 の `${userId}/` と D1 works/sessions/rate_limits/mcp_tokens/activity）を冪等削除。
 *  subscriptions 行には触れない（呼び出し側 reaper が完全削除時にまとめて消す）。 */
export async function purgeCloudData(env: PurgeEnv, userId: string): Promise<void> {
  // 1. R2: ユーザー配下を一覧しながら一括削除（truncated を辿る）。
  let cursor: string | undefined
  do {
    const listed = await env.MEDIA.list({ prefix: `${userId}/`, cursor })
    if (listed.objects.length > 0) {
      await env.MEDIA.delete(listed.objects.map((o) => o.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  // 2. D1: 同期メタ・セッション（＝強制サインアウト）・レート制限・MCP トークン・
  //    執筆の記録を 1 往復で削除。MCP トークンも消す＝失効後に AI からの読み取りを
  //    止める。subscriptions は残す。
  await env.DB.batch([
    env.DB.prepare('DELETE FROM works WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM rate_limits WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM mcp_tokens WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM activity WHERE user_id = ?').bind(userId),
  ])
}
