/// <reference types="@cloudflare/workers-types" />
/**
 * /api/backup — クラウド全体バックアップ（バックアップ/復元モデル・**セッション非依存**）。
 *   POST   = 平文バンドル JSON を受け取り gzip→AES-GCM で暗号化し R2 に保存。id を返す。
 *   GET    = `?id=` で 1 件を復号ダウンロード（平文バンドルを返す）／`?id` 無しで一覧（新しい順）。
 *   DELETE = `?id=` で 1 件削除。
 *
 * 認証は Clerk JWT（member）のみ＝X-Session-Token / 単一アクティブセッションに依存しない
 * （明示バックアップ/リストアなので同時編集の衝突が無く、複数端末に常時ログインできる）。
 * R2 キーは `${userId}/backups/${createdAt}-${rand}`。id 先頭に createdAt を埋め、一覧の並びに使う。
 */

import { type ClerkEnv, json, verifyBackupAccess, verifyMember } from './_lib/auth'
import { decryptPart, encryptPart, importKey } from './_lib/crypto'

interface Env extends ClerkEnv {
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}

/** 全体バックアップ 1 件の上限（安全弁）。Cloudflare のリクエスト body 上限も別途効く。 */
const MAX_BACKUP_BYTES = 100 * 1024 * 1024
/** 保持世代（超過分は古いものから間引く）。 */
const KEEP = 20

const prefixOf = (userId: string) => `${userId}/backups/`
const keyOf = (userId: string, id: string) => `${prefixOf(userId)}${id}`
const aadOf = (userId: string, id: string) => `${userId}:backup:${id}`
const createdAtOf = (id: string) => Number(id.split('-')[0]) || 0

type Ctx = Parameters<PagesFunction<Env>>[0]

/** Clerk JWT で member を検証。失敗時は Response、成功時は userId。 */
async function requireMember(context: Ctx): Promise<{ userId: string } | { error: Response }> {
  const m = await verifyMember(context.request, context.env)
  if (!m) return { error: json({ error: 'unauthorized' }, 401) }
  if (!m.isMember) return { error: json({ error: 'subscription_required' }, 402) }
  return { userId: m.userId }
}

/**
 * 復元系（GET の一覧・?id 取得）のアクセス判定。会員に加え **解約後の猶予期間内も許可**。
 * isMember も返し、呼び出し側で ?live（MCP ライブ）だけ会員限定に絞れるようにする。
 */
async function requireRestore(
  context: Ctx,
): Promise<{ userId: string; isMember: boolean } | { error: Response }> {
  const a = await verifyBackupAccess(context.request, context.env)
  if (!a) return { error: json({ error: 'unauthorized' }, 401) }
  if (!a.canRestore) return { error: json({ error: 'subscription_required' }, 402) }
  return { userId: a.userId, isMember: a.isMember }
}

async function listKeys(
  bucket: R2Bucket,
  userId: string,
): Promise<Array<{ key: string; id: string; size: number }>> {
  const out: Array<{ key: string; id: string; size: number }> = []
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ prefix: prefixOf(userId), cursor })
    for (const o of listed.objects) {
      out.push({ key: o.key, id: o.key.slice(prefixOf(userId).length), size: o.size })
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  return out
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const plaintext = await context.request.text()
  if (!plaintext || plaintext.length > MAX_BACKUP_BYTES) return json({ error: 'bad_request' }, 400)

  const createdAt = Date.now()
  const id = `${createdAt}-${crypto.randomUUID().slice(0, 8)}`
  const key = await importKey(context.env.ENCRYPTION_KEY)
  const blob = await encryptPart(plaintext, key, aadOf(userId, id))
  await context.env.MEDIA.put(keyOf(userId, id), blob as unknown as ArrayBuffer)

  // 保持世代を超えた古いバックアップを間引く（createdAt 降順で KEEP 件を残す）。
  const keys = await listKeys(context.env.MEDIA, userId)
  keys.sort((a, b) => createdAtOf(b.id) - createdAtOf(a.id))
  const stale = keys.slice(KEEP).map((k) => k.key)
  if (stale.length > 0) await context.env.MEDIA.delete(stale)

  return json({ id, createdAt })
}

/**
 * PUT = MCP 用ライブスナップショット。**版は作らず 1 オブジェクト `${userId}/live` に上書き**する
 * （AI が最新の作品を読めるよう会員の編集をデバウンスで反映・一覧やバックアップ世代には出ない）。
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const plaintext = await context.request.text()
  if (!plaintext || plaintext.length > MAX_BACKUP_BYTES) return json({ error: 'bad_request' }, 400)

  const key = await importKey(context.env.ENCRYPTION_KEY)
  const blob = await encryptPart(plaintext, key, `${userId}:live`)
  await context.env.MEDIA.put(`${userId}/live`, blob as unknown as ArrayBuffer)
  return json({ ok: true })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // 復元（一覧・?id）は会員に加え解約後の猶予期間内も許可。?live（MCP）だけ会員限定に絞る。
  const m = await requireRestore(context)
  if ('error' in m) return m.error
  const { userId, isMember } = m

  const params = new URL(context.request.url).searchParams

  // ライブスナップショット（MCP 用）は会員のみ。猶予中は復元だけ許可し、ここは 402 で弾く。
  if (params.get('live') && !isMember) {
    return json({ error: 'subscription_required' }, 402)
  }

  // ?live=meta = ライブスナップショットの有無と AI 最終編集時刻だけを軽量に返す（本体は送らない）。
  // aiEditedAt は MCP 書き込みが刻む目印。ブラウザの pushLive で上書きされると消える（未取り込みなし）。
  if (params.get('live') === 'meta') {
    const head = await context.env.MEDIA.head(`${userId}/live`)
    if (!head) return json({ exists: false, aiEditedAt: null })
    const ai = head.customMetadata?.aiEditedAt
    return json({ exists: true, aiEditedAt: ai ? Number(ai) : null })
  }

  // ?live=1 = MCP 用ライブスナップショットを復号ダウンロード（AI の書き込みを取り込むため）。
  if (params.get('live') === '1') {
    const obj = await context.env.MEDIA.get(`${userId}/live`)
    if (!obj) return json({ error: 'not_found' }, 404)
    const key = await importKey(context.env.ENCRYPTION_KEY)
    const blob = new Uint8Array(await obj.arrayBuffer())
    const plaintext = await decryptPart(blob, key, `${userId}:live`)
    return new Response(plaintext, { headers: { 'content-type': 'application/json' } })
  }

  const id = params.get('id')
  if (id) {
    const obj = await context.env.MEDIA.get(keyOf(userId, id))
    if (!obj) return json({ error: 'not_found' }, 404)
    const key = await importKey(context.env.ENCRYPTION_KEY)
    const blob = new Uint8Array(await obj.arrayBuffer())
    const plaintext = await decryptPart(blob, key, aadOf(userId, id))
    return new Response(plaintext, { headers: { 'content-type': 'application/json' } })
  }

  const keys = await listKeys(context.env.MEDIA, userId)
  const backups = keys
    .map((k) => ({ id: k.id, createdAt: createdAtOf(k.id), size: k.size }))
    .sort((a, b) => b.createdAt - a.createdAt)
  return json({ backups })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const id = new URL(context.request.url).searchParams.get('id')
  if (!id) return json({ error: 'missing_id' }, 400)
  await context.env.MEDIA.delete(keyOf(userId, id))
  return json({ ok: true })
}
