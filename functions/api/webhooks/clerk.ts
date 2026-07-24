/// <reference types="@cloudflare/workers-types" />
/**
 * /api/webhooks/clerk — Clerk Billing webhook（失効＝クラウドアカウント削除・案A）。
 *
 * 処理の流れ：
 *   1. `CLERK_WEBHOOK_SECRET` が無ければ検証不能＝設定不備として 500（破壊的処理は絶対に行わない）。
 *   2. svix 署名（svix-id / svix-timestamp / svix-signature）を検証（自前 Web Crypto・依存追加なし）。
 *      不正・期限切れは 401。
 *   3. 本文を JSON パース（失敗は 400）。
 *   4. `interpretBillingEvent`（純関数・破壊的処理の単一判断点）で行動を決める。
 *      `delete-account` 以外は ACK して何もしない（無料プランの ended・canceled・pastDue 等）。
 *   5. `delete-account` のときだけ `deleteCloudAccount` を実行。
 *
 * 冪等性：同じ svix-id の再送でも結果が変わらないよう、削除は各段「存在しなくても無害」に保つ。
 */

import { createClerkClient } from '@clerk/backend'
import { interpretBillingEvent } from '../../../src/core/billing/webhook-event'
import { type ClerkEnv, json } from '../_lib/auth'
import { verifySvix } from '../_lib/svix'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  CLERK_WEBHOOK_SECRET?: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  if (!env.CLERK_WEBHOOK_SECRET) {
    // 署名鍵が無い＝検証不能。破壊的処理は一切行わず、設定不備として 500 を返す。
    return json({ error: 'webhook_not_configured' }, 500)
  }

  // 署名検証は raw body に対して行うので、パース前に text() で読む。
  const body = await request.text()
  let verified: boolean
  try {
    verified = await verifySvix(
      env.CLERK_WEBHOOK_SECRET,
      {
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signature: request.headers.get('svix-signature'),
      },
      body,
      Date.now(),
    )
  } catch (err) {
    // 秘密鍵が不正（base64 不正・空文字など）で検証自体が不能＝設定不備。破壊処理せず 500。
    console.error('webhook: signature verification threw', err)
    return json({ error: 'webhook_verification_error' }, 500)
  }
  if (!verified) return json({ error: 'invalid_signature' }, 401)

  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const action = interpretBillingEvent(event)
  if (action.kind !== 'delete-account') {
    // 無料プランの ended（昇格時）・canceled（期末解約予約）・pastDue（グレース）・型不正など。ACK のみ。
    return json({ ok: true, ignored: action.reason })
  }

  try {
    await deleteCloudAccount(env, action.userId)
  } catch (err) {
    // R2/D1/Clerk のいずれかが失敗。データは部分的に消えている可能性があるが、各段は冪等なので
    // 500 を返して Clerk に webhook を再送させ、再試行で完遂させる（200 を返すと再送が止まる）。
    console.error('webhook: deleteCloudAccount failed; returning 500 to trigger retry', err)
    return json({ error: 'deletion_failed' }, 500)
  }
  return json({ ok: true, deleted: action.userId })
}

/**
 * クラウド側のアカウントとデータを冪等に削除する（端末ローカルの IndexedDB 小説は保持＝案A）。
 *   1. R2 の `${userId}/` プレフィックス配下のブロブを全削除（doc/media、ページングを辿る）。
 *   2. D1 の works / sessions / rate_limits 行を削除。sessions 削除＝全端末を強制サインアウト。
 *   3. Clerk ユーザーを削除（404＝既に削除済みは冪等として許容、それ以外は throw）。
 * データ削除（プライバシー上重要）を先に終え、Clerk 削除を最後に置く。いずれかが失敗したら
 * throw して呼び出し側で 500→Clerk 再送に繋ぐ。各段は冪等なので二重実行されても無害。
 */
async function deleteCloudAccount(env: Env, userId: string): Promise<void> {
  // 1. R2: ユーザー配下を一覧しながら一括削除（truncated を辿る）。
  let cursor: string | undefined
  do {
    const listed = await env.MEDIA.list({ prefix: `${userId}/`, cursor })
    if (listed.objects.length > 0) {
      await env.MEDIA.delete(listed.objects.map((o) => o.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  // 2. D1: 同期メタ・セッション（＝強制サインアウト）・レート制限の残骸を削除。batch で 1 往復に
  //    まとめる＝暗黙トランザクションで「3 本の途中で中断して片肺削除」を防ぐ（冪等性は維持）。
  await env.DB.batch([
    env.DB.prepare('DELETE FROM works WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM rate_limits WHERE user_id = ?').bind(userId),
  ])

  // 3. Clerk ユーザー削除。404（既に削除済み＝再送・手動削除）は冪等として無視し、
  //    それ以外の失敗は throw して呼び出し側で 500→再送に繋ぐ（握りつぶさない）。
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  })
  try {
    await clerk.users.deleteUser(userId)
  } catch (err) {
    if (isNotFound(err)) return // 既に存在しない＝冪等に成功扱い。
    throw err
  }
}

/** Clerk API エラーが 404（リソース不在）かどうか。 */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: unknown }).status === 404
  )
}
