/// <reference types="@cloudflare/workers-types" />
/**
 * /api/sync/work — Work 1 件の同期本体（CAS push / pull / ゴミ箱伝播 / purge）。
 *   GET    = `?id=` で平文 Work JSON を復号ダウンロード（x-doc-hash 等のメタヘッダ付き）。
 *   PUT    = CAS push。`x-base-hash`（最後に同期した docHash）が一致するときだけ受理し、
 *            ずれていたら 409 でサーバ側メタを返す＝「黙った上書き」を構造的に排除する。
 *   PATCH  = ゴミ箱状態（trashed_at）だけを LWW で伝播（blob 不変）。
 *   DELETE = purge。行をトゥームストーン（deleted=1）にして blob を消す（行は残し削除を伝播）。
 *
 * 変更系（PUT/PATCH/DELETE）は 60 req/min/user のレート制限をかける。
 * R2 キーは `${userId}/works/${workId}/doc`（reaper の `${userId}/` prefix purge が効く）。
 */

import { type ClerkEnv, json, verifyMember } from '../_lib/auth'
import { decryptPart, encryptPart, importKey, sha256Hex } from '../_lib/crypto'
import { checkRateLimit } from '../_lib/rate-limit'
import { type RemoteWorkMeta, toMeta } from './manifest'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}

/** 平文 1 Work の上限（doc 1 オブジェクトに画像込みのため大きめ）。 */
const MAX_DOC_BYTES = 25 * 1024 * 1024
/** ユーザー合計（live 行の doc_size 合計）の上限。 */
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024

const docKeyOf = (userId: string, workId: string) => `${userId}/works/${workId}/doc`
const aadOf = (userId: string, workId: string) => `${userId}:${workId}:doc`

type Ctx = Parameters<PagesFunction<Env>>[0]

/** D1 `works` の 1 行（media 列は当面未使用）。 */
interface WorkRow {
  user_id: string
  work_id: string
  updated_at: number
  deleted: number
  doc_key: string
  doc_hash: string
  doc_size: number
  synced_at: number
  trashed_at: number
}

/** Clerk JWT で member を検証し、workId も取り出す。失敗時は Response。 */
async function requireMemberWork(
  context: Ctx,
): Promise<{ userId: string; workId: string } | { error: Response }> {
  const m = await verifyMember(context.request, context.env)
  if (!m) return { error: json({ error: 'unauthorized' }, 401) }
  if (!m.isMember) return { error: json({ error: 'subscription_required' }, 402) }
  const workId = new URL(context.request.url).searchParams.get('id')
  if (!workId) return { error: json({ error: 'missing_id' }, 400) }
  return { userId: m.userId, workId }
}

/** works の 1 行を引く（無ければ null）。 */
async function readRow(db: D1Database, userId: string, workId: string): Promise<WorkRow | null> {
  return await db
    .prepare(
      `SELECT user_id, work_id, updated_at, deleted, doc_key, doc_hash, doc_size, synced_at, trashed_at
       FROM works WHERE user_id = ? AND work_id = ?`,
    )
    .bind(userId, workId)
    .first<WorkRow>()
}

/**
 * 行が無いときの 409 用メタ。サーバに痕跡が無い＝トゥームストーン相当として返し、
 * クライアントの再 reconcile が「base '' で push し直す」側に倒れるようにする。
 */
function absentMeta(workId: string): RemoteWorkMeta {
  return { workId, updatedAt: 0, trashedAt: 0, deleted: 1, docHash: '', docSize: 0, syncedAt: 0 }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const m = await requireMemberWork(context)
  if ('error' in m) return m.error
  const { userId, workId } = m

  const row = await readRow(context.env.DB, userId, workId)
  if (!row || row.deleted) return json({ error: 'not_found' }, 404)

  const obj = await context.env.MEDIA.get(row.doc_key)
  if (!obj) return json({ error: 'not_found' }, 404)
  const key = await importKey(context.env.ENCRYPTION_KEY)
  const plaintext = await decryptPart(
    new Uint8Array(await obj.arrayBuffer()),
    key,
    aadOf(userId, workId),
  )
  return new Response(plaintext, {
    headers: {
      'content-type': 'application/json',
      'x-doc-hash': row.doc_hash,
      'x-updated-at': String(row.updated_at),
      'x-trashed-at': String(row.trashed_at),
    },
  })
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const m = await requireMemberWork(context)
  if ('error' in m) return m.error
  const { userId, workId } = m

  // 判定順は仕様通り: 認証 → レート → 25MB → 行 SELECT → CAS → 1GB → 保存。
  if (!(await checkRateLimit(context.env.DB, userId, Date.now()))) {
    return json({ error: 'rate_limited' }, 429)
  }

  const plaintext = await context.request.text()
  const docSize = new TextEncoder().encode(plaintext).byteLength
  if (docSize > MAX_DOC_BYTES) return json({ error: 'too_large' }, 413)

  const baseHash = context.request.headers.get('x-base-hash') ?? ''
  const updatedAt = Number(context.request.headers.get('x-updated-at'))
  const trashedAt = Number(context.request.headers.get('x-trashed-at')) || 0
  if (!plaintext || !Number.isFinite(updatedAt)) return json({ error: 'bad_request' }, 400)

  const row = await readRow(context.env.DB, userId, workId)

  // CAS 規則: 行なし＝新規（base ''）のみ / tombstone＝編集勝ち（updated_at 前進）のみ /
  // live＝base 一致のみ受理。それ以外は 409 で現在のメタを返し、クライアントに再 reconcile させる。
  // ここでの事前判定は早期リターン用で、確定判定は下の**条件付き書き込み**（WHERE に CAS 条件を
  // 含め changes を見る）が行う＝SELECT と書き込みの間に別端末の PUT が滑り込んでも後勝ちの
  // 黙った上書きにならない。
  if (!row) {
    if (baseHash !== '') return json({ error: 'conflict', meta: absentMeta(workId) }, 409)
  } else if (row.deleted) {
    if (!(updatedAt > row.updated_at)) return json({ error: 'conflict', meta: toMeta(row) }, 409)
  } else if (baseHash !== row.doc_hash) {
    return json({ error: 'conflict', meta: toMeta(row) }, 409)
  }

  // ユーザー合計クォータ（live 行の合計。当該 work の旧 size は差し替えなので除外）。
  const total = await context.env.DB.prepare(
    `SELECT COALESCE(SUM(doc_size), 0) AS total
     FROM works WHERE user_id = ? AND deleted = 0 AND work_id <> ?`,
  )
    .bind(userId, workId)
    .first<{ total: number }>()
  if ((total?.total ?? 0) + docSize > MAX_TOTAL_BYTES) {
    return json({ error: 'quota_exceeded' }, 507)
  }

  const docHash = await sha256Hex(plaintext)
  const docKey = docKeyOf(userId, workId)
  const syncedAt = Date.now()

  // 条件付き書き込み（CAS の確定判定）。0 行更新＝競り負け → 現在メタで 409。
  const written = !row
    ? await context.env.DB.prepare(
        `INSERT INTO works
           (user_id, work_id, updated_at, deleted, doc_key, doc_hash, doc_size,
            media_key, media_hash, media_size, synced_at, trashed_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, NULL, '', 0, ?, ?)
         ON CONFLICT(user_id, work_id) DO NOTHING`,
      )
        .bind(userId, workId, updatedAt, docKey, docHash, docSize, syncedAt, trashedAt)
        .run()
    : row.deleted
      ? await context.env.DB.prepare(
          `UPDATE works SET updated_at = ?, deleted = 0, doc_key = ?, doc_hash = ?,
             doc_size = ?, synced_at = ?, trashed_at = ?
           WHERE user_id = ? AND work_id = ? AND deleted = 1 AND updated_at < ?`,
        )
          .bind(updatedAt, docKey, docHash, docSize, syncedAt, trashedAt, userId, workId, updatedAt)
          .run()
      : await context.env.DB.prepare(
          `UPDATE works SET updated_at = ?, deleted = 0, doc_key = ?, doc_hash = ?,
             doc_size = ?, synced_at = ?, trashed_at = ?
           WHERE user_id = ? AND work_id = ? AND deleted = 0 AND doc_hash = ?`,
        )
          .bind(updatedAt, docKey, docHash, docSize, syncedAt, trashedAt, userId, workId, baseHash)
          .run()
  if ((written.meta?.changes ?? 0) < 1) {
    const cur = await readRow(context.env.DB, userId, workId)
    return json({ error: 'conflict', meta: cur ? toMeta(cur) : absentMeta(workId) }, 409)
  }

  // blob は D1 の CAS が通ってから書く。逆順だと競り負けた側が blob だけ上書きし、
  // 行の doc_hash と実体が食い違う（勝者の本文が失われる）ため。
  const key = await importKey(context.env.ENCRYPTION_KEY)
  const blob = await encryptPart(plaintext, key, aadOf(userId, workId))
  await context.env.MEDIA.put(docKey, blob as unknown as ArrayBuffer)

  return json({ docHash, syncedAt })
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const m = await requireMemberWork(context)
  if ('error' in m) return m.error
  const { userId, workId } = m

  if (!(await checkRateLimit(context.env.DB, userId, Date.now()))) {
    return json({ error: 'rate_limited' }, 429)
  }

  let body: { trashedAt: number; updatedAt: number }
  try {
    body = await context.request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (!Number.isFinite(body?.trashedAt) || !Number.isFinite(body?.updatedAt)) {
    return json({ error: 'bad_request' }, 400)
  }

  const row = await readRow(context.env.DB, userId, workId)
  if (!row || row.deleted) return json({ error: 'not_found' }, 404)
  // 古い patch は棄却（LWW）。updated_at が進んでいる側のゴミ箱状態を正とする。
  if (body.updatedAt < row.updated_at) return json({ error: 'conflict', meta: toMeta(row) }, 409)

  const syncedAt = Date.now()
  await context.env.DB.prepare(
    `UPDATE works SET trashed_at = ?, updated_at = ?, synced_at = ?
     WHERE user_id = ? AND work_id = ?`,
  )
    .bind(body.trashedAt, body.updatedAt, syncedAt, userId, workId)
    .run()

  return json({
    meta: toMeta({
      ...row,
      trashed_at: body.trashedAt,
      updated_at: body.updatedAt,
      synced_at: syncedAt,
    }),
  })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const m = await requireMemberWork(context)
  if ('error' in m) return m.error
  const { userId, workId } = m

  if (!(await checkRateLimit(context.env.DB, userId, Date.now()))) {
    return json({ error: 'rate_limited' }, 429)
  }

  const at = Number(new URL(context.request.url).searchParams.get('at')) || Date.now()
  const row = await readRow(context.env.DB, userId, workId)
  // 行なし・すでにトゥームストーンは冪等に成功（伝播すべきものが無い/済んでいる）。
  if (!row || row.deleted) return json({ ok: true })

  // 古い purge は棄却（LWW・編集勝ち）: 行の updated_at の方が新しい＝purge 後に別端末が
  // 編集を push している。削除で新しい編集を消さない（D-SYNC-TOMBSTONE の「編集が新しければ勝つ」）。
  if (at < row.updated_at) return json({ error: 'conflict', meta: toMeta(row) }, 409)

  // トゥームストーン化: blob を消し、行は残して他端末へ削除を伝播する。
  await context.env.DB.prepare(
    `UPDATE works SET deleted = 1, updated_at = ?, synced_at = ?
     WHERE user_id = ? AND work_id = ?`,
  )
    .bind(at, Date.now(), userId, workId)
    .run()
  await context.env.MEDIA.delete(row.doc_key)

  return json({ ok: true })
}
