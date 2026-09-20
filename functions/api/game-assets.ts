/// <reference types="@cloudflare/workers-types" />
/**
 * /api/game-assets — 持ち込みゲーム素材のクラウド保管（R2 ホスティング・G2 後半）。
 * 設計は docs/requirement/07-novel-game.md §4.4・§9（D-GAME-PRICE: 独自素材のホスティングは有料）。
 *
 *   GET    = `?id=` で 1 件を復号ダウンロード（UserGameAsset の JSON）／`?id` 無しで一覧（id とサイズ）。
 *   PUT    = `?id=` で 1 件を暗号化保存。枚数上限（HOSTED_ASSET_LIMIT・同 id の置き換えは数えない）と
 *            サイズ上限を enforce。超過は 409 / 413。
 *   DELETE = `?id=` で 1 件削除。
 *
 * 認証は Clerk JWT の**会員のみ**（バックアップと同じ流儀・セッション非依存）。
 * R2 キーは `${userId}/gameassets/${id}` ＝ 既存の purge（`${userId}/` 前置一括削除）に相乗りする。
 * 実体は同期には載せず、演出エディタが下り（この端末に無い分の取り込み）、
 * 素材の追加・管理画面が上り（保存・削除）を受け持つ。
 */

import {
  HOSTED_ASSET_LIMIT,
  HOSTED_ASSET_MAX_BYTES,
  hostedAssetVerdict,
  UserGameAssetSchema,
} from '../../src/core/game/assets'
import { type ClerkEnv, json, verifyMember } from './_lib/auth'
import { decryptPart, encryptPart, importKey } from './_lib/crypto'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}

const prefixOf = (userId: string) => `${userId}/gameassets/`
const keyOf = (userId: string, id: string) => `${prefixOf(userId)}${id}`
const aadOf = (userId: string, id: string) => `${userId}:gameasset:${id}`

/** 素材 id（クライアントの crypto.randomUUID）。R2 キーに入るので形を縛る。 */
export function isValidAssetId(id: string): boolean {
  return /^[0-9A-Za-z-]{1,64}$/.test(id)
}

/** リクエスト body の安全弁（dataUrl 上限＋メタ分の余白）。 */
const MAX_BODY_BYTES = HOSTED_ASSET_MAX_BYTES + 64 * 1024

type Ctx = Parameters<PagesFunction<Env>>[0]

/** Clerk JWT で member を検証。失敗時は Response、成功時は userId。 */
async function requireMember(context: Ctx): Promise<{ userId: string } | { error: Response }> {
  const m = await verifyMember(context.request, context.env)
  if (!m) return { error: json({ error: 'unauthorized' }, 401) }
  if (!m.isMember) return { error: json({ error: 'subscription_required' }, 402) }
  return { userId: m.userId }
}

async function listIds(
  bucket: R2Bucket,
  userId: string,
): Promise<Array<{ id: string; size: number }>> {
  const out: Array<{ id: string; size: number }> = []
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ prefix: prefixOf(userId), cursor })
    for (const o of listed.objects) {
      out.push({ id: o.key.slice(prefixOf(userId).length), size: o.size })
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  return out
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const id = new URL(context.request.url).searchParams.get('id')
  if (id) {
    if (!isValidAssetId(id)) return json({ error: 'bad_request' }, 400)
    const obj = await context.env.MEDIA.get(keyOf(userId, id))
    if (!obj) return json({ error: 'not_found' }, 404)
    const key = await importKey(context.env.ENCRYPTION_KEY)
    const blob = new Uint8Array(await obj.arrayBuffer())
    const plaintext = await decryptPart(blob, key, aadOf(userId, id))
    return new Response(plaintext, { headers: { 'content-type': 'application/json' } })
  }

  const assets = await listIds(context.env.MEDIA, userId)
  return json({ assets, limit: HOSTED_ASSET_LIMIT })
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const id = new URL(context.request.url).searchParams.get('id')
  if (!id || !isValidAssetId(id)) return json({ error: 'bad_request' }, 400)

  const plaintext = await context.request.text()
  if (!plaintext || plaintext.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)

  // 中身を検証してから預かる（壊れた JSON を保管して他端末の取り込みを壊さない）。
  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const asset = UserGameAssetSchema.safeParse(parsed)
  if (!asset.success || asset.data.id !== id) return json({ error: 'bad_request' }, 400)

  const existing = await listIds(context.env.MEDIA, userId)
  const verdict = hostedAssetVerdict(
    asset.data,
    existing.map((e) => e.id),
  )
  if (verdict === 'too_large') return json({ error: 'too_large' }, 413)
  if (verdict === 'limit_reached') {
    return json({ error: 'limit_reached', limit: HOSTED_ASSET_LIMIT }, 409)
  }

  const key = await importKey(context.env.ENCRYPTION_KEY)
  const blob = await encryptPart(plaintext, key, aadOf(userId, id))
  await context.env.MEDIA.put(keyOf(userId, id), blob as unknown as ArrayBuffer)
  return json({ ok: true })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const id = new URL(context.request.url).searchParams.get('id')
  if (!id || !isValidAssetId(id)) return json({ error: 'bad_request' }, 400)
  await context.env.MEDIA.delete(keyOf(userId, id))
  return json({ ok: true })
}
