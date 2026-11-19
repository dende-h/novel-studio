/// <reference types="@cloudflare/workers-types" />

import { decryptPart, importKey } from './crypto'

interface StorageEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}

export const isNarrationHash = (hash: unknown): hash is string =>
  typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)

function extractHashes(entry: unknown): string[] {
  if (!entry || typeof entry !== 'object' || !('audio' in entry)) return []
  const audio = entry.audio
  if (!audio || typeof audio !== 'object') return []
  return Object.values(audio).filter(isNarrationHash)
}

export const narrationWorkHashes = (plaintext: string): string[] => [
  ...new Set(extractHashes(JSON.parse(plaintext))),
]

function snapshotHashes(plaintext: string): string[] {
  // Older non-narration backups were accepted as opaque payloads.
  try {
    const entries: unknown = JSON.parse(plaintext)?.narrations
    return Array.isArray(entries) ? [...new Set(entries.flatMap(extractHashes))] : []
  } catch {
    return []
  }
}

export const narrationAssetKey = (userId: string, hash: string, version: string | null) =>
  `${userId}/narration-library/${hash}${version ? '/' + version : ''}`

export async function narrationStorageUsed(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(a.size),0) AS used FROM narration_assets a
       WHERE a.user_id=? AND a.hash IN (
         SELECT h.value FROM narration_asset_refs r, json_each(r.hashes) h
         WHERE r.user_id=a.user_id AND r.scope='current'
       )`,
    )
    .bind(userId)
    .first<{ used: number }>()
  return row?.used ?? 0
}

/** Register before writing the blob. A failed or superseded write is collected after its audit. */
export async function putNarrationSnapshot(
  env: StorageEnv,
  userId: string,
  objectKey: string,
  plaintext: string,
  blob: ArrayBuffer,
  customMetadata: Record<string, string> = {},
) {
  customMetadata = { ...customMetadata, narrationRef: 'none' }
  const hashes = snapshotHashes(plaintext)
  if (hashes.length) {
    const token = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO narration_asset_refs(user_id,scope,ref_id,hashes,object_key,checked_at)
       VALUES(?,?,?,?,?,?)`,
    )
      .bind(
        userId,
        objectKey.endsWith('/live') ? 'live' : 'archive',
        token,
        JSON.stringify(hashes),
        objectKey,
        Date.now(),
      )
      .run()
    customMetadata = { ...customMetadata, narrationRef: token }
  }
  await env.MEDIA.put(objectKey, blob, { customMetadata })
}

export function replaceCurrentNarrationRefs(
  db: D1Database,
  userId: string,
  workId: string,
  docKey: string,
  hashes: string[],
) {
  // Match the version written by this CAS, not another sync that won the race.
  const versionExists =
    'EXISTS (SELECT 1 FROM works WHERE user_id=? AND work_id=? AND doc_key=? AND deleted=0)'
  return [
    db
      .prepare(
        `DELETE FROM narration_asset_refs WHERE user_id=? AND scope='current' AND ref_id=?
       AND ${versionExists}`,
      )
      .bind(userId, workId, userId, workId, docKey),
    db
      .prepare(
        `INSERT INTO narration_asset_refs(user_id,scope,ref_id,hashes)
       SELECT ?, 'current', ?, ? WHERE ${versionExists}`,
      )
      .bind(userId, workId, JSON.stringify(hashes), userId, workId, docKey),
    db
      .prepare(
        'UPDATE works SET narration_indexed=1 WHERE user_id=? AND work_id=? AND doc_key=? AND deleted=0',
      )
      .bind(userId, workId, docKey),
  ]
}

/** Reindex old sync blobs in small batches. A concurrent sync wins over the original version. */
export async function indexCurrentNarration(env: StorageEnv, userId: string, replacing = '') {
  const entries = (
    await env.DB.prepare(
      `SELECT work_id, doc_key FROM works
       WHERE user_id=? AND work_id LIKE 'narration:%' AND deleted=0 AND narration_indexed=0 AND work_id<>?
       LIMIT 9`,
    )
      .bind(userId, replacing)
      .all<{ work_id: string; doc_key: string }>()
  ).results
  if (!entries.length) return true
  const key = await importKey(env.ENCRYPTION_KEY)
  for (const entry of entries.slice(0, 8)) {
    const original = await env.MEDIA.get(entry.doc_key)
    if (!original) return false
    const plaintext = await decryptPart(
      new Uint8Array(await original.arrayBuffer()),
      key,
      `${userId}:${entry.work_id}:doc`,
    )
    await env.DB.batch(
      replaceCurrentNarrationRefs(
        env.DB,
        userId,
        entry.work_id,
        entry.doc_key,
        narrationWorkHashes(plaintext),
      ),
    )
  }
  return entries.length <= 8
}

/** Old restore points were saved without an index. Retain their audio until we have read them all. */
export async function indexLegacyNarration(env: StorageEnv, userId: string) {
  if (
    await env.DB.prepare('SELECT 1 FROM narration_storage_indexed WHERE user_id=?')
      .bind(userId)
      .first()
  )
    return
  if (!(await indexCurrentNarration(env, userId))) return
  const backups: R2Object[] = []
  let cursor: string | undefined
  do {
    const options = { prefix: `${userId}/backups/`, cursor, include: ['customMetadata'] }
    const list = await env.MEDIA.list(options)
    backups.push(...list.objects)
    cursor = list.truncated ? list.cursor : undefined
  } while (cursor)
  const [live, refs] = await Promise.all([
    env.MEDIA.head(`${userId}/live`),
    env.DB.prepare("SELECT ref_id FROM narration_asset_refs WHERE user_id=? AND scope!='current'")
      .bind(userId)
      .all<{ ref_id: string }>(),
  ])
  const indexed = new Set(refs.results.map((row) => row.ref_id))
  const old = [...backups, ...(live ? [live] : [])].filter(
    (obj) => !obj.customMetadata?.narrationRef && !indexed.has(`etag:${obj.key}:${obj.etag}`),
  )
  const key = await importKey(env.ENCRYPTION_KEY)
  for (const obj of old.slice(0, 4)) {
    const blob = await env.MEDIA.get(obj.key, { onlyIf: { etagMatches: obj.etag } })
    if (!blob || !('arrayBuffer' in blob)) return
    const isLive = obj.key === `${userId}/live`
    const aad = isLive ? `${userId}:live` : `${userId}:backup:${obj.key.split('/').at(-1)}`
    const plain = await decryptPart(new Uint8Array(await blob.arrayBuffer()), key, aad)
    await env.DB.prepare(
      `INSERT OR IGNORE INTO narration_asset_refs(user_id,scope,ref_id,hashes,object_key,checked_at)
       VALUES(?,?,?,?,?,?)`,
    )
      .bind(
        userId,
        isLive ? 'live' : 'archive',
        `etag:${obj.key}:${obj.etag}`,
        JSON.stringify(snapshotHashes(plain)),
        obj.key,
        Date.now(),
      )
      .run()
  }
  if (old.length <= 4) {
    await env.DB.prepare('INSERT OR IGNORE INTO narration_storage_indexed(user_id) VALUES(?)')
      .bind(userId)
      .run()
  }
}
