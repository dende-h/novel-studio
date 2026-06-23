/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/sync/manifest — ユーザーの全 Work の同期メタをバッチで返す（Phase 2）。
 * R2 には触らず D1 のみ。クライアントはこれとローカル状態を突き合わせて pull/push を決める。
 */

import type { ManifestEntry } from '../../../src/core/sync/manifest'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'

interface Env extends ClerkEnv {
  DB: D1Database
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const { results } = await context.env.DB.prepare(
    `SELECT work_id, updated_at, deleted, doc_hash, media_hash, (doc_size + media_size) AS size
     FROM works WHERE user_id = ?`,
  )
    .bind(userId)
    .all<{
      work_id: string
      updated_at: number
      deleted: number
      doc_hash: string
      media_hash: string
      size: number
    }>()

  const entries: ManifestEntry[] = results.map((r) => ({
    workId: r.work_id,
    updatedAt: r.updated_at,
    deleted: r.deleted === 1,
    docHash: r.doc_hash,
    mediaHash: r.media_hash,
    size: r.size,
  }))

  return json({ entries })
}
