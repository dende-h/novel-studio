/// <reference types="@cloudflare/workers-types" />
/**
 * /api/sync/manifest — 同期メタの一覧（GET）。
 *
 * D1 `works` のユーザー分全行（active / trashed / tombstone）を RemoteWorkMeta の形で返す。
 * クライアントはこれとローカル状態・syncbase を突き合わせて三方向差分（planReconcile）を組む。
 * 本文（blob）は返さない＝軽量。読み取り系なのでレート制限はかけない。
 */

import { type ClerkEnv, json, verifyMember } from '../_lib/auth'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}

/** サーバ manifest の 1 行（src/core/sync/types.ts と同形の共有契約）。 */
export interface RemoteWorkMeta {
  workId: string
  updatedAt: number
  trashedAt: number
  deleted: 0 | 1
  docHash: string
  docSize: number
  syncedAt: number
}

/** D1 `works` の行（このエンドポイントで使う列のみ）。 */
interface WorkRow {
  work_id: string
  updated_at: number
  trashed_at: number
  deleted: number
  doc_hash: string
  doc_size: number
  synced_at: number
}

/** D1 行 → RemoteWorkMeta。 */
export function toMeta(row: WorkRow): RemoteWorkMeta {
  return {
    workId: row.work_id,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    deleted: row.deleted ? 1 : 0,
    docHash: row.doc_hash,
    docSize: row.doc_size,
    syncedAt: row.synced_at,
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const m = await verifyMember(context.request, context.env)
  if (!m) return json({ error: 'unauthorized' }, 401)
  if (!m.isMember) return json({ error: 'subscription_required' }, 402)

  const { results } = await context.env.DB.prepare(
    `SELECT work_id, updated_at, trashed_at, deleted, doc_hash, doc_size, synced_at
     FROM works WHERE user_id = ? ORDER BY work_id`,
  )
    .bind(m.userId)
    .all<WorkRow>()

  return json({ works: (results ?? []).map(toMeta) })
}
