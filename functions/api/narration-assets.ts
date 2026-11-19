/// <reference types="@cloudflare/workers-types" />
import {
  audioHash,
  NARRATION_AUDIO_MAX_BYTES,
  NARRATION_STORAGE_LIMIT,
} from '../../src/core/narration/backup'
import { type ClerkEnv, json, verifyBackupAccess } from './_lib/auth'
import { importKey } from './_lib/crypto'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}
const headers = { 'cache-control': 'private, no-store', 'content-type': 'audio/mpeg' }
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const access = await verifyBackupAccess(request, env)
  if (!access) return json({ error: 'unauthorized' }, 401)
  if (request.method === 'PUT' ? !access.isMember : !access.canRestore)
    return json({ error: 'subscription_required' }, 402)
  const user = access.userId
  const hash = new URL(request.url).searchParams.get('hash')
  if (!hash && request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT COALESCE(SUM(size),0) AS used FROM narration_assets WHERE user_id=?',
    )
      .bind(user)
      .first<{ used: number }>()
    return json({ used: row?.used ?? 0, limit: NARRATION_STORAGE_LIMIT })
  }
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'bad_request' }, 400)
  const key = user + '/narration-library/' + hash
  const aad = new TextEncoder().encode(user + ':narration-library:' + hash)
  const row = await env.DB.prepare(
    'SELECT size,ready FROM narration_assets WHERE user_id=? AND hash=?',
  )
    .bind(user, hash)
    .first<{ size: number; ready: number }>()
  if (request.method === 'HEAD')
    return new Response(null, { status: row?.ready ? 200 : 404, headers })
  if (request.method === 'GET') {
    if (!row?.ready) return json({ error: 'not_found' }, 404)
    const obj = await env.MEDIA.get(key)
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
  if (row?.ready) return json({ ok: true })
  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO narration_assets(user_id,hash,size,created_at) VALUES(?,?,?,?)',
    )
      .bind(user, hash, size, Date.now())
      .run()
  } catch (error) {
    if (String(error).includes('narration_storage_full'))
      return json({ error: 'storage_full', limit: NARRATION_STORAGE_LIMIT }, 409)
    throw error
  }
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
  await env.MEDIA.put(key, result)
  await env.DB.prepare('UPDATE narration_assets SET ready=1 WHERE user_id=? AND hash=?')
    .bind(user, hash)
    .run()
  return json({ ok: true })
}
