/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/reap — 「アカウント＝有料課金者（＋猶予中）」を保つ掃除ジョブ。
 * 会員でない Clerk アカウントのうち、
 *   - 解約者：猶予（grace_until）が切れたもの
 *   - 未課金：サインアップから NEVER_PAID_MS 経過したもの（Checkout 中断・未購読の離脱を含む）
 * を **データ＋Clerk ログインごと削除**（再開は再登録）。会員（active/trialing）は絶対に消さない。
 *
 * 破壊的なので判定は純関数 shouldReap に集約。全 Clerk ユーザーを走査するため、
 * 削除しながらのページずれを避けて「走査で対象を集める→まとめて削除」の 2 パスにする。
 * Pages はネイティブ cron 非対応 → .github/workflows/reap.yml が REAP_SECRET 付きで日次に叩く。
 * ※ 本番切替直後は、既存アカウントが未課金・作成が古い＝即削除対象になりうる。運用注意（再課金を先に）。
 */
import { createClerkClient } from '@clerk/backend'
import { NEVER_PAID_MS, shouldReap } from '../../../src/core/billing/reap-policy'
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
          accountCreatedAt: u.createdAt,
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
  return json({ ok: true, scanned, purged, neverPaidDays: NEVER_PAID_MS / 86_400_000, capped })
}
