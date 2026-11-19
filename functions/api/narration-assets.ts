/// <reference types="@cloudflare/workers-types" />
import {
  audioHash,
  NARRATION_AUDIO_MAX_BYTES,
  NARRATION_STORAGE_LIMIT,
} from '../../src/core/narration/backup'
import { type ClerkEnv, json, verifyBackupAccess } from './_lib/auth'
import { importKey } from './_lib/crypto'
import {
  indexCurrentNarration,
  indexLegacyNarration,
  isNarrationHash,
  narrationAssetKey,
  narrationStorageUsed,
} from './_lib/narration-storage'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}
const headers = { 'cache-control': 'private, no-store', 'content-type': 'audio/mpeg' }
export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const access = await verifyBackupAccess(request, env)
  if (!access) return json({ error: 'unauthorized' }, 401)
  if (request.method === 'PUT' ? !access.isMember : !access.canRestore)
    return json({ error: 'subscription_required' }, 402)
  const user = access.userId
  const hash = new URL(request.url).searchParams.get('hash')
  if (!hash && request.method === 'GET') {
    if (access.isMember) {
      const indexed = await indexCurrentNarration(env, user)
      if (!indexed) return json({ error: 'indexing' }, 503)
      waitUntil?.(indexLegacyNarration(env, user).catch(() => {}))
    }
    return json({ used: await narrationStorageUsed(env.DB, user), limit: NARRATION_STORAGE_LIMIT })
  }
  if (!isNarrationHash(hash)) return json({ error: 'bad_request' }, 400)
  const aad = new TextEncoder().encode(user + ':narration-library:' + hash)
  const readAsset = () =>
    env.DB.prepare('SELECT ready,storage_version FROM narration_assets WHERE user_id=? AND hash=?')
      .bind(user, hash)
      .first<{ ready: number; storage_version: string | null }>()
  const row = await readAsset()
  if (request.method === 'HEAD') {
    if (access.isMember && row?.ready === 1) {
      const touched = await env.DB.prepare(
        'UPDATE narration_assets SET touched_at=? WHERE user_id=? AND hash=? AND ready=1 RETURNING hash',
      )
        .bind(Date.now(), user, hash)
        .first()
      return new Response(null, { status: touched ? 200 : 404, headers })
    }
    return new Response(null, { status: row?.ready === 1 ? 200 : 404, headers })
  }
  if (request.method === 'GET') {
    if (row?.ready !== 1) return json({ error: 'not_found' }, 404)
    const obj = await env.MEDIA.get(narrationAssetKey(user, hash, row.storage_version))
    if (!obj) return json({ error: 'not_found' }, 404)
    const bytes = new Uint8Array(await obj.arrayBuffer())
    const data = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aad },
      await importKey(env.ENCRYPTION_KEY),
      bytes.slice(12),
    )
    return new Response(data, { headers })
  }
  if (request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405)
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'bad_request' }, 400)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > NARRATION_AUDIO_MAX_BYTES) {
      await reader.cancel()
      return json({ error: 'too_large' }, 413)
    }
    chunks.push(part.value)
  }
  if (!size) return json({ error: 'bad_request' }, 400)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  if ((await audioHash(bytes)) !== hash) return json({ error: 'hash_mismatch' }, 400)
  try {
    await env.DB.prepare(
      `INSERT INTO narration_assets(user_id,hash,size,created_at,touched_at,storage_version)
       VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,hash) DO UPDATE
       SET touched_at=excluded.touched_at WHERE narration_assets.ready IN (0,1)`,
    )
      .bind(user, hash, size, Date.now(), Date.now(), crypto.randomUUID())
      .run()
  } catch (error) {
    if (String(error).includes('narration_upload_capacity'))
      return json({ error: 'storage_full', limit: NARRATION_STORAGE_LIMIT }, 409)
    throw error
  }
  const reserved = await readAsset()
  if (reserved?.ready === 1) return json({ ok: true })
  if (!reserved || reserved.ready !== 0) return json({ error: 'try_again' }, 503)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      await importKey(env.ENCRYPTION_KEY),
      bytes,
    ),
  )
  const result = new Uint8Array(12 + encrypted.length)
  result.set(iv)
  result.set(encrypted, 12)
  await env.MEDIA.put(narrationAssetKey(user, hash, reserved.storage_version), result)
  await env.DB.prepare(
    'UPDATE narration_assets SET ready=1 WHERE user_id=? AND hash=? AND storage_version IS ? AND ready=0',
  )
    .bind(user, hash, reserved.storage_version)
    .run()
  return json({ ok: true })
}
