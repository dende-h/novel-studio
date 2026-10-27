/// <reference types="@cloudflare/workers-types" />
/**
 * クラウド版のデータ削除（`purgeCloudData`）。reaper（/api/billing/reap）が、解約して猶予が
 * 切れた人のクラウドのデータを消すのに使う。各段は冪等。端末ローカルの IndexedDB 小説は対象外。
 *
 * **ログイン（Clerk のアカウント）と掲示板には触れない。** 解約しても無料アカウントとして
 * 使い続けられる（構想の道具・掲示板・コトノハ-grove- への投稿）。かつては「アカウント＝課金者」を
 * 保つためにログインごと消し、掲示板の投稿も伏せていたが、一度も課金していない無料アカウントは
 * 残るのに、課金したことのある人だけがアカウントを失う逆転になっていたので外した。
 */

export interface PurgeEnv {
  DB: D1Database
  MEDIA: R2Bucket
}

/** クラウド版のデータ（R2 の `${userId}/` と D1 works/sessions/rate_limits/mcp_tokens/oauth_tokens/activity）を
 *  冪等削除。R2 の `${userId}/` 配下はバックアップ・ライブスナップショット・同期の本体・持ち込み素材で、
 *  どれも会員の機能。掲示板（無料の機能）と subscriptions 行（課金の履歴）には触れない。 */
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

  // 2. D1: 同期メタ・旧セッション・同期のレート制限・MCP トークン・執筆の記録（同期ぶん）を
  //    1 往復で削除。MCP トークンも消す＝失効後に AI からの読み取りを止める。
  //    掲示板の枠（`board:${userId}`）と subscriptions は残す。
  await env.DB.batch([
    env.DB.prepare('DELETE FROM works WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM rate_limits WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM mcp_tokens WHERE user_id = ?').bind(userId),
    // 自前 OAuth のトークン（migration 0010）。消し忘れると、失効後も AI から読める。
    env.DB.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM activity WHERE user_id = ?').bind(userId),
  ])
}
