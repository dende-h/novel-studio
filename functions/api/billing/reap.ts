/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/reap — 解約して猶予が切れた人の、クラウド版のデータを片付ける掃除ジョブ。
 *
 * 消すのは**クラウドのデータだけ**（`purgeCloudData`）。ログイン（Clerk のアカウント）と掲示板は
 * 残し、無料アカウントとして使い続けられるようにする。subscriptions 行も課金の履歴として残し
 *（2 回目の無料トライアルを付けない判定に使う）、grace_until を 0 に戻して二度目の対象から外す。
 * 会員（active/trialing）は絶対に消さない。一度も課金していないアカウントは猶予を持たないので
 * 対象にならない（理由は src/core/billing/reap-policy.ts のコメント）。
 *
 * 破壊的なので判定は純関数 shouldReap に集約。対象は D1 の subscriptions から直接集める
 *（猶予を持つのは解約者だけなので、Clerk の全ユーザーを走査する必要はない）。
 * 集めてから消すまでの間に再購読した人を巻き込まないよう、消す直前に行を読み直して判定し直す。
 * Pages はネイティブ cron 非対応 → .github/workflows/reap.yml が REAP_SECRET 付きで日次に叩く。
 */
import { shouldReap } from '../../../src/core/billing/reap-policy'
import { json } from '../_lib/auth'
import { readSubscription, type SubscriptionRow } from '../_lib/membership'
import { purgeCloudData } from '../_lib/purge'

interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  REAP_SECRET?: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  if (!env.REAP_SECRET) return json({ error: 'not_configured' }, 500)
  if (request.headers.get('authorization') !== `Bearer ${env.REAP_SECRET}`) {
    return json({ error: 'unauthorized' }, 401)
  }

  const now = Date.now()
  const { results } = await env.DB.prepare(
    `SELECT * FROM subscriptions
       WHERE grace_until > 0 AND grace_until <= ? AND status NOT IN ('active', 'trialing')`,
  )
    .bind(now)
    .all<SubscriptionRow>()

  let purged = 0
  for (const candidate of results) {
    const userId = candidate.user_id
    try {
      // 集めた後に再購読していれば消さない（webhook が active・grace=0 に書き換えている）。
      const sub = await readSubscription(env.DB, userId)
      const isMember = sub?.status === 'active' || sub?.status === 'trialing'
      if (!sub || !shouldReap({ isMember, graceUntil: sub.grace_until, now })) continue
      await purgeCloudData(env, userId)
      await env.DB.prepare(
        `UPDATE subscriptions SET grace_until = 0, updated_at = ?
           WHERE user_id = ? AND status NOT IN ('active', 'trialing')`,
      )
        .bind(now, userId)
        .run()
      purged++
    } catch (err) {
      console.error('reap: failed for', userId, err)
    }
  }

  return json({ ok: true, scanned: results.length, purged })
}
