/// <reference types="@cloudflare/workers-types" />
/**
 * クラウド側のユーザーデータを冪等に削除する（**ログイン＝Clerk ユーザーは残す**）。
 * 猶予期間つき削除（reaper）で使う。削除するのは R2 の `${userId}/` 配下と、D1 の
 * works / sessions / rate_limits / mcp_tokens。subscriptions 行は残す（Stripe customer の
 * マッピングを保持し、再課金時に重複 customer を作らないため。reaper が grace_until=0 に更新する）。
 * 各段は「存在しなくても無害」＝冪等。端末ローカルの IndexedDB 小説は対象外。
 */
export interface PurgeEnv {
  DB: D1Database
  MEDIA: R2Bucket
}

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

  // 2. D1: 同期メタ・セッション（＝強制サインアウト）・レート制限・MCP トークンを 1 往復で削除。
  //    MCP トークンも消す＝失効後に AI からの読み取りを止める。subscriptions は残す。
  await env.DB.batch([
    env.DB.prepare('DELETE FROM works WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM rate_limits WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM mcp_tokens WHERE user_id = ?').bind(userId),
  ])
}
