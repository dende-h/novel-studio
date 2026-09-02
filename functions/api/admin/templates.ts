/// <reference types="@cloudflare/workers-types" />
/**
 * /api/admin/templates — 運営テンプレ（背景・立ち絵）の管理（D-GAME-TEMPLATE-CMS・**staff だけ**）。
 *
 *   GET    = 目録（非表示も含む・no-store）
 *   PUT    = `?kind=&slug=` で 1 枚を投入・置き換え。body は TemplatePutInput（WebP 化済みの data URL）。
 *            実体を R2 `_templates/<kind>/<slug>.webp`（＋ `.thumb.webp`）に置き、目録の項目を上書きする。
 *            表示名・分類・時間帯は**渡した項目だけ**書き換える（既にある項目は据え置き）。
 *   PATCH  = 目録の項目の書き換え（表示名・分類・時間帯・並び・非表示・分類の表示名）。
 *   DELETE = `?kind=&slug=` を非表示にする（一覧から外すだけ。実体と項目は残す＝既存作品の参照を壊さない）。
 *
 * staff でなければすべて **404**（管理の口があることを教えない）。読み口は functions/game-templates/。
 * 画像の変換（WebP・サムネ・tone）はブラウザ側で済ませて送る＝ここに画像処理は無い。
 */

import {
  applyTemplatePatch,
  isTemplateSlug,
  parseTemplateFilename,
  type TemplateEntry,
  type TemplateKind,
  TemplatePatchInputSchema,
  TemplatePutInputSchema,
} from '../../../src/core/game/templates'
import { dataUrlMime, decodeDataUrl } from '../../../src/core/image'
import { type ClerkEnv, json } from '../_lib/auth'
import { verifyStaff } from '../_lib/staff'
import {
  readTemplateManifest,
  templateObjectKey,
  writeTemplateManifest,
} from '../_lib/templates-store'

interface Env extends ClerkEnv {
  DB: D1Database
  MEDIA: R2Bucket
}

/** 実体の data URL の上限（持ち込み素材と同じ 1.5MB）とサムネの上限。 */
export const TEMPLATE_MAX_DATA_URL = 1_500_000
export const TEMPLATE_THUMB_MAX_DATA_URL = 300_000
const MAX_BODY_BYTES = TEMPLATE_MAX_DATA_URL + TEMPLATE_THUMB_MAX_DATA_URL + 16 * 1024

const IMAGE_MIMES = new Set(['image/webp', 'image/png', 'image/jpeg'])

type Ctx = Parameters<PagesFunction<Env>>[0]

const notFound = () => json({ error: 'not_found' }, 404)

const noStore = (data: unknown, status = 200): Response => {
  const res = json(data, status)
  res.headers.set('cache-control', 'private, no-store')
  return res
}

async function requireStaff(context: Ctx): Promise<Response | null> {
  const userId = await verifyStaff(context.request, context.env)
  return userId ? null : notFound()
}

function targetOf(request: Request): { kind: TemplateKind; slug: string } | null {
  const q = new URL(request.url).searchParams
  const kind = q.get('kind')
  const slug = q.get('slug') ?? ''
  if ((kind !== 'bg' && kind !== 'sprite') || !isTemplateSlug(slug)) return null
  return { kind, slug }
}

/** 内容ハッシュ（SHA-256 の先頭 16 桁）。URL の `?v=` に載せて immutable キャッシュを効かせる。 */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

/** data URL を検証して R2 に置き、内容ハッシュを返す。形が違えば null。 */
async function storeImage(
  bucket: R2Bucket,
  key: string,
  dataUrl: string,
  maxLen: number,
): Promise<{ hash: string; bytes: number; mime: string } | null> {
  if (dataUrl.length > maxLen) return null
  const mime = dataUrlMime(dataUrl)
  if (!mime || !IMAGE_MIMES.has(mime)) return null
  let bytes: Uint8Array
  try {
    bytes = decodeDataUrl(dataUrl)
  } catch {
    return null
  }
  if (bytes.byteLength === 0) return null
  const hash = await contentHash(bytes)
  await bucket.put(key, bytes as unknown as ArrayBuffer, { httpMetadata: { contentType: mime } })
  return { hash, bytes: bytes.byteLength, mime }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const denied = await requireStaff(context)
  if (denied) return denied
  return noStore(await readTemplateManifest(context.env.MEDIA))
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const denied = await requireStaff(context)
  if (denied) return denied
  const target = targetOf(context.request)
  if (!target) return json({ error: 'bad_request' }, 400)

  const raw = await context.request.text()
  if (!raw || raw.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(raw)
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const input = TemplatePutInputSchema.safeParse(parsedBody)
  if (!input.success) return json({ error: 'bad_request' }, 400)
  if (input.data.dataUrl.length > TEMPLATE_MAX_DATA_URL) return json({ error: 'too_large' }, 413)
  if ((input.data.thumbDataUrl?.length ?? 0) > TEMPLATE_THUMB_MAX_DATA_URL) {
    return json({ error: 'too_large' }, 413)
  }

  const { kind, slug } = target
  const bucket = context.env.MEDIA
  const full = await storeImage(
    bucket,
    templateObjectKey(kind, slug),
    input.data.dataUrl,
    TEMPLATE_MAX_DATA_URL,
  )
  if (!full) return json({ error: 'bad_request' }, 400)
  const thumb = input.data.thumbDataUrl
    ? await storeImage(
        bucket,
        templateObjectKey(kind, slug, 'thumb'),
        input.data.thumbDataUrl,
        TEMPLATE_THUMB_MAX_DATA_URL,
      )
    : null

  const now = Date.now()
  const manifest = await readTemplateManifest(bucket)
  const existing = manifest.entries.find((e) => e.kind === kind && e.slug === slug)
  // 新規の既定値はファイル名の規則から（分類・時間帯）。表示名は画面側が既定を渡す
  const parsed = parseTemplateFilename(slug)
  const entry: TemplateEntry = {
    ...(existing ?? {}),
    kind,
    slug,
    label: input.data.label ?? existing?.label ?? '',
    category: input.data.category ?? existing?.category ?? parsed?.category ?? slug,
    tone: input.data.tone,
    mime: full.mime,
    bytes: full.bytes,
    hash: full.hash,
    updatedAt: now,
  }
  const time = input.data.time ?? existing?.time ?? parsed?.time
  if (time && kind === 'bg') entry.time = time
  else delete entry.time
  if (thumb) entry.thumbHash = thumb.hash
  else delete entry.thumbHash

  const entries = existing
    ? manifest.entries.map((e) => (e.kind === kind && e.slug === slug ? entry : e))
    : [...manifest.entries, entry]
  await writeTemplateManifest(bucket, { ...manifest, updatedAt: now, entries })
  return noStore({ entry })
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const denied = await requireStaff(context)
  if (denied) return denied
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const patch = TemplatePatchInputSchema.safeParse(body)
  if (!patch.success) return json({ error: 'bad_request' }, 400)
  const bucket = context.env.MEDIA
  const next = applyTemplatePatch(await readTemplateManifest(bucket), patch.data, Date.now())
  await writeTemplateManifest(bucket, next)
  return noStore(next)
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const denied = await requireStaff(context)
  if (denied) return denied
  const target = targetOf(context.request)
  if (!target) return json({ error: 'bad_request' }, 400)
  const bucket = context.env.MEDIA
  const manifest = await readTemplateManifest(bucket)
  if (!manifest.entries.some((e) => e.kind === target.kind && e.slug === target.slug)) {
    return notFound()
  }
  const next = applyTemplatePatch(
    manifest,
    { entries: [{ kind: target.kind, slug: target.slug, hidden: true }] },
    Date.now(),
  )
  await writeTemplateManifest(bucket, next)
  return noStore({ ok: true })
}
