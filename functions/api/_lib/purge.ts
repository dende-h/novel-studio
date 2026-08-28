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
 *  掲示板だけは消さずに伏せる（下記）。subscriptions 行には触れない
 *（呼び出し側 reaper が完全削除時にまとめて消す）。`now` は省略時に現在時刻。 */
export async function purgeCloudData(
  env: PurgeEnv,
  userId: string,
  now: number = Date.now(),
): Promise<void> {
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
    // 掲示板は「消さずに伏せる」。投稿を消すと、他の人の返信が虫食いの会話になる
    //（利用規約 第6条の2・docs/requirement/09-board.md D-BOARD-DELETE）。
    // deleted_at を立てるだけにして、表示名は API 側で「削除済み」に差し替える。
    // name_key は残す＝退会した人の名前を後から名乗れないようにする（なりすまし防止）。
    env.DB.prepare(
      'UPDATE board_profiles SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at = 0',
    ).bind(now, now, userId),
  ])
}
