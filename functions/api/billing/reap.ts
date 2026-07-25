/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/reap — 猶予期限切れのクラウドデータを削除する（ログインは残す）。
 * 失効（subscription.deleted）時に grace_until = now+30日 を立て、その期限を過ぎた行を
 * ここで purge する。Cloudflare Pages はネイティブ cron 非対応のため、日次の GitHub Actions
 * （.github/workflows/reap.yml）が REAP_SECRET 付きでこのエンドポイントを叩く。
 */
import { json } from '../_lib/auth'
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
  const rows = await env.DB.prepare(
    `SELECT user_id FROM subscriptions
       WHERE grace_until > 0 AND grace_until <= ? AND status NOT IN ('active','trialing')`,
  )
    .bind(now)
    .all<{ user_id: string }>()

  let purged = 0
  for (const r of rows.results ?? []) {
    await purgeCloudData(env, r.user_id)
    // 再 purge しないよう grace を消す（subscriptions 行＝customer マッピングは残す）。
    await env.DB.prepare(
      'UPDATE subscriptions SET grace_until = 0, updated_at = ? WHERE user_id = ?',
    )
      .bind(now, r.user_id)
      .run()
    purged++
  }

  return json({ ok: true, purged })
}
