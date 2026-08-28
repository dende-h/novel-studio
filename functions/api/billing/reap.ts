/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/reap — 解約して猶予が切れたアカウントを片付ける掃除ジョブ。
 * **解約者：猶予（grace_until）が切れたもの**だけを、データ＋Clerk ログインごと削除する
 *（再開は再登録）。会員（active/trialing）は絶対に消さない。
 *
 * **一度も課金していないアカウントは削除しない。** 無料アカウントに期限は無い
 *（理由は src/core/billing/reap-policy.ts のコメント）。以前は登録から 30 日で消していたが、
 * 無料アカウントに開いている機能（構想の道具・掲示板）と案内に反していたため外した。
 *
 * 破壊的なので判定は純関数 shouldReap に集約。全 Clerk ユーザーを走査するため、
 * 削除しながらのページずれを避けて「走査で対象を集める→まとめて削除」の 2 パスにする。
 * Pages はネイティブ cron 非対応 → .github/workflows/reap.yml が REAP_SECRET 付きで日次に叩く。
 */
import { createClerkClient } from '@clerk/backend'
import { shouldReap } from '../../../src/core/billing/reap-policy'
import { json } from '../_lib/auth'
import { readSubscription } from '../_lib/membership'
import { deleteClerkUser, purgeCloudData } from '../_lib/purge'

interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  REAP_SECRET?: string
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
}

const PAGE = 100
const MAX_PAGES = 50 // 安全弁（最大 5000 ユーザーで打ち切り）

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  if (!env.REAP_SECRET) return json({ error: 'not_configured' }, 500)
  if (request.headers.get('authorization') !== `Bearer ${env.REAP_SECRET}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) {
    return json({ error: 'clerk_not_configured' }, 500)
  }

  const now = Date.now()
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  })

  // パス1：全ユーザーを走査し、削除対象の userId を集める（この間は削除しない）。
  const toDelete: string[] = []
  let scanned = 0
  let capped = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await clerk.users.getUserList({ limit: PAGE, offset: page * PAGE })
    const users = res.data
    for (const u of users) {
      scanned++
      const sub = await readSubscription(env.DB, u.id)
      const isMember = sub?.status === 'active' || sub?.status === 'trialing'
      if (
        shouldReap({
          isMember,
          graceUntil: sub?.grace_until ?? 0,
          now,
        })
      ) {
        toDelete.push(u.id)
      }
    }
    if (users.length < PAGE) break
    if (page === MAX_PAGES - 1) capped = true
  }

  // パス2：まとめて完全削除（データ→ログイン→サブスク行）。1 件の失敗で全体を止めない。
  let purged = 0
  for (const userId of toDelete) {
    try {
      await purgeCloudData(env, userId)
      await deleteClerkUser(env, userId)
      await env.DB.prepare('DELETE FROM subscriptions WHERE user_id = ?').bind(userId).run()
      purged++
    } catch (err) {
      console.error('reap: failed for', userId, err)
    }
  }

  if (capped)
    console.warn(`reap: user scan capped at ${MAX_PAGES * PAGE}; some accounts not checked`)
  return json({ ok: true, scanned, purged, capped })
}
