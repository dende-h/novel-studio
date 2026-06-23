/// <reference types="@cloudflare/workers-types" />
/**
 * /api/sync/work?id=<workId> — 1 Work の pull / push / purge（Phase 2）。
 *   GET    = pull（R2 から doc/media を復号・展開して平文で返す）
 *   PUT    = push（平文 part を受け取り canonicalize→gzip→AES-GCM で R2 保存・D1 upsert）
 *   DELETE = purge（R2 ブロブ削除・D1 を deleted=1 のトゥームストーンに）
 * 平文を TLS で送り、at-rest 暗号化はサーバが行う（E2E 暗号化ではない）。
 * push の検査順：session(409) → rate(429) → size(413) → quota(507) → R2 put → D1 upsert。
 */

import { canonicalize } from '../../../src/core/sync/normalize'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import { decryptPart, encryptPart, importKey, sha256Hex } from '../_lib/crypto'
import { r2Key } from '../_lib/r2keys'
import { checkRateLimit } from '../_lib/ratelimit'
import { isCurrentSession } from '../_lib/session-check'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}

interface WorkRow {
  user_id: string
  work_id: string
  updated_at: number
  deleted: number
  doc_key: string
  doc_hash: string
  doc_size: number
  media_key: string | null
  media_hash: string
  media_size: number
  synced_at: number
}

interface PushBody {
  updatedAt: number
  parts: Array<'doc' | 'media'>
  doc?: unknown
  media?: unknown
}

const MAX_WORK_BYTES = 25 * 1024 * 1024
const MAX_USER_BYTES = 1024 * 1024 * 1024

async function getRow(db: D1Database, userId: string, workId: string): Promise<WorkRow | null> {
  return db
    .prepare('SELECT * FROM works WHERE user_id = ? AND work_id = ?')
    .bind(userId, workId)
    .first<WorkRow>()
}

async function quotaUsedBytes(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COALESCE(SUM(doc_size + media_size), 0) AS total FROM works WHERE user_id = ? AND deleted = 0',
    )
    .bind(userId)
    .first<{ total: number }>()
  return row?.total ?? 0
}

/** 認証・work id・セッションをまとめて検証。失敗時は Response、成功時は識別子を返す。 */
async function authorize(
  context: Parameters<PagesFunction<Env>>[0],
): Promise<{ userId: string; workId: string } | Response> {
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const workId = new URL(context.request.url).searchParams.get('id')
  if (!workId) return json({ error: 'missing_id' }, 400)

  const token = context.request.headers.get('X-Session-Token') ?? ''
  if (!(await isCurrentSession(context.env.DB, userId, token))) {
    return json({ status: 'superseded' }, 409)
  }
  return { userId, workId }
}

async function readPart(
  bucket: R2Bucket,
  key: CryptoKey,
  r2key: string,
  aad: string,
): Promise<unknown> {
  const obj = await bucket.get(r2key)
  if (!obj) return null
  const blob = new Uint8Array(await obj.arrayBuffer())
  return JSON.parse(await decryptPart(blob, key, aad))
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authorize(context)
  if (auth instanceof Response) return auth
  const { userId, workId } = auth

  const row = await getRow(context.env.DB, userId, workId)
  if (!row || row.deleted === 1) return json({ error: 'not_found' }, 404)

  const key = await importKey(context.env.ENCRYPTION_KEY)
  const doc = await readPart(context.env.MEDIA, key, row.doc_key, `${userId}:${workId}:doc`)
  const media = row.media_key
    ? await readPart(context.env.MEDIA, key, row.media_key, `${userId}:${workId}:media`)
    : null

  return json({ doc, media, updatedAt: row.updated_at })
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const auth = await authorize(context)
  if (auth instanceof Response) return auth
  const { userId, workId } = auth

  if (!(await checkRateLimit(context.env.DB, userId, Date.now()))) {
    return json({ error: 'rate_limited' }, 429)
  }

  let body: PushBody
  try {
    body = (await context.request.json()) as PushBody
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (typeof body.updatedAt !== 'number' || !Array.isArray(body.parts)) {
    return json({ error: 'bad_request' }, 400)
  }

  const existing = await getRow(context.env.DB, userId, workId)
  if (!existing && !body.parts.includes('doc')) {
    // 新規 Work は必ず doc を伴う（doc_key/doc_hash は NOT NULL）。
    return json({ error: 'bad_request' }, 400)
  }

  const key = await importKey(context.env.ENCRYPTION_KEY)

  // 送られなかった側は既存値を引き継ぐ。
  let docKey = existing?.doc_key ?? r2Key(userId, workId, 'doc')
  let docHash = existing?.doc_hash ?? ''
  let docSize = existing?.doc_size ?? 0
  let mediaKey = existing?.media_key ?? null
  let mediaHash = existing?.media_hash ?? ''
  let mediaSize = existing?.media_size ?? 0

  let newDocBlob: Uint8Array | null = null
  if (body.parts.includes('doc')) {
    if (typeof body.doc !== 'object' || body.doc === null)
      return json({ error: 'bad_request' }, 400)
    const plaintext = canonicalize(body.doc)
    docHash = await sha256Hex(plaintext)
    newDocBlob = await encryptPart(plaintext, key, `${userId}:${workId}:doc`)
    docSize = newDocBlob.byteLength
    docKey = r2Key(userId, workId, 'doc')
  }

  let newMediaBlob: Uint8Array | null = null
  let deleteMedia = false
  if (body.parts.includes('media')) {
    if (body.media === null) {
      deleteMedia = true
      mediaHash = ''
      mediaSize = 0
      mediaKey = null
    } else if (typeof body.media === 'object') {
      const plaintext = canonicalize(body.media)
      mediaHash = await sha256Hex(plaintext)
      newMediaBlob = await encryptPart(plaintext, key, `${userId}:${workId}:media`)
      mediaSize = newMediaBlob.byteLength
      mediaKey = r2Key(userId, workId, 'media')
    } else {
      return json({ error: 'bad_request' }, 400)
    }
  }

  const workSize = docSize + mediaSize
  if (workSize > MAX_WORK_BYTES) return json({ error: 'work_too_large' }, 413)

  const oldWorkSize =
    existing && existing.deleted === 0 ? existing.doc_size + existing.media_size : 0
  const used = await quotaUsedBytes(context.env.DB, userId)
  if (used - oldWorkSize + workSize > MAX_USER_BYTES) {
    return json({ error: 'quota_exceeded' }, 507)
  }

  if (newDocBlob) await context.env.MEDIA.put(docKey, newDocBlob)
  if (newMediaBlob && mediaKey) await context.env.MEDIA.put(mediaKey, newMediaBlob)
  if (deleteMedia) await context.env.MEDIA.delete(r2Key(userId, workId, 'media'))

  const now = Date.now()
  await context.env.DB.prepare(
    `INSERT INTO works
       (user_id, work_id, updated_at, deleted, doc_key, doc_hash, doc_size, media_key, media_hash, media_size, synced_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, work_id) DO UPDATE SET
       updated_at = excluded.updated_at, deleted = 0,
       doc_key = excluded.doc_key, doc_hash = excluded.doc_hash, doc_size = excluded.doc_size,
       media_key = excluded.media_key, media_hash = excluded.media_hash, media_size = excluded.media_size,
       synced_at = excluded.synced_at`,
  )
    .bind(
      userId,
      workId,
      body.updatedAt,
      docKey,
      docHash,
      docSize,
      mediaKey,
      mediaHash,
      mediaSize,
      now,
    )
    .run()

  return json({ docHash, mediaHash, size: workSize })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const auth = await authorize(context)
  if (auth instanceof Response) return auth
  const { userId, workId } = auth

  await context.env.MEDIA.delete(r2Key(userId, workId, 'doc'))
  await context.env.MEDIA.delete(r2Key(userId, workId, 'media'))

  const now = Date.now()
  await context.env.DB.prepare(
    `INSERT INTO works (user_id, work_id, updated_at, deleted, doc_key, doc_hash, synced_at)
     VALUES (?, ?, ?, 1, ?, '', ?)
     ON CONFLICT(user_id, work_id) DO UPDATE SET
       deleted = 1, doc_hash = '', media_hash = '', doc_size = 0, media_size = 0,
       media_key = NULL, updated_at = excluded.updated_at, synced_at = excluded.synced_at`,
  )
    .bind(userId, workId, now, r2Key(userId, workId, 'doc'), now)
    .run()

  return json({ ok: true })
}
