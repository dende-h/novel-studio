/// <reference types="@cloudflare/workers-types" />
/**
 * /api/admin/templates — 運営テンプレ（背景・立ち絵・効果音）の管理（D-GAME-TEMPLATE-CMS・**staff だけ**）。
 *
 *   GET    = 目録（非表示も含む・no-store）
 *   PUT    = `?kind=&slug=` で 1 件を投入・置き換え。body は TemplatePutInput（画像は WebP 化済みの
 *            data URL・効果音は mp3/m4a の data URL）。実体を R2 `_templates/<kind>/<slug>.<ext>`
 *            （画像は ＋ `.thumb.<ext>`）に置き、目録の項目を上書きする。
 *            表示名・分類・時間帯は**渡した項目だけ**書き換える（既にある項目は据え置き）。
 *   PATCH  = 目録の項目の書き換え（表示名・分類・時間帯・並び・非表示・分類の表示名）。
 *   DELETE = `?kind=&slug=` を非表示にする（一覧から外すだけ。実体と項目は残す＝既存作品の参照を壊さない）。
 *
 * staff でなければすべて **404**（管理の口があることを教えない）。読み口は functions/game-templates/。
 * 画像の変換（WebP・サムネ・tone）と音声の長さ計測はブラウザ側で済ませて送る＝ここにメディア処理は無い。
 */

import {
  applyTemplatePatch,
  isTemplateAudioMime,
  isTemplateImageMime,
  isTemplateSlug,
  parseTemplateFilename,
  TEMPLATE_EXT_BY_MIME,
  type TemplateEntry,
  type TemplateKind,
  TemplatePatchInputSchema,
  TemplatePutInputSchema,
  templateExt,
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

/** 画像の data URL の上限（持ち込み素材と同じ 1.5MB）。 */
export const TEMPLATE_MAX_DATA_URL = 1_500_000
/** 効果音（mp3/m4a）の data URL の上限。ループ用の環境音でも 20 秒 128kbps で 450KB 前後。 */
export const TEMPLATE_SE_MAX_DATA_URL = 2_100_000
export const TEMPLATE_THUMB_MAX_DATA_URL = 300_000
const MAX_BODY_BYTES = TEMPLATE_SE_MAX_DATA_URL + TEMPLATE_THUMB_MAX_DATA_URL + 16 * 1024

const BLACK: [string, string, string] = ['#000000', '#000000', '#000000']

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
  if ((kind !== 'bg' && kind !== 'sprite' && kind !== 'se') || !isTemplateSlug(slug)) return null
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

interface Blob {
  bytes: Uint8Array
  mime: string
}

/**
 * data URL を検証してバイト列にする。形が違う・種別が合わない・大きすぎるときは null。
 * 受ける MIME は TEMPLATE_EXT_BY_MIME にあるものだけ（拡張子が決まる＝配信パスが決まる）。
 */
function decodeTemplateDataUrl(
  dataUrl: string,
  maxLen: number,
  accept: (mime: string) => boolean,
): Blob | null {
  if (dataUrl.length > maxLen) return null
  const mime = dataUrlMime(dataUrl)
  if (!mime || !(mime in TEMPLATE_EXT_BY_MIME) || !accept(mime)) return null
  let bytes: Uint8Array
  try {
    bytes = decodeDataUrl(dataUrl)
  } catch {
    return null
  }
  if (bytes.byteLength === 0) return null
  return { bytes, mime }
}

async function storeBlob(bucket: R2Bucket, key: string, blob: Blob): Promise<string> {
  const hash = await contentHash(blob.bytes)
  await bucket.put(key, blob.bytes as unknown as ArrayBuffer, {
    httpMetadata: { contentType: blob.mime },
  })
  return hash
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
  const { kind, slug } = target
  const isSe = kind === 'se'

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
  const maxFull = isSe ? TEMPLATE_SE_MAX_DATA_URL : TEMPLATE_MAX_DATA_URL
  if (input.data.dataUrl.length > maxFull) return json({ error: 'too_large' }, 413)
  if ((input.data.thumbDataUrl?.length ?? 0) > TEMPLATE_THUMB_MAX_DATA_URL) {
    return json({ error: 'too_large' }, 413)
  }

  // 種別と中身を突き合わせる（効果音に画像・背景に音声は通さない）
  const full = decodeTemplateDataUrl(
    input.data.dataUrl,
    maxFull,
    isSe ? isTemplateAudioMime : isTemplateImageMime,
  )
  if (!full) return json({ error: 'bad_request' }, 400)
  const thumb =
    !isSe && input.data.thumbDataUrl
      ? decodeTemplateDataUrl(
          input.data.thumbDataUrl,
          TEMPLATE_THUMB_MAX_DATA_URL,
          isTemplateImageMime,
        )
      : null
  if (!isSe && input.data.thumbDataUrl && !thumb) return json({ error: 'bad_request' }, 400)

  const bucket = context.env.MEDIA
  const manifest = await readTemplateManifest(bucket)
  const existing = manifest.entries.find((e) => e.kind === kind && e.slug === slug)

  // 置き換えで拡張子が変わる（webp → png 等）と旧キーが残るので、先に消す
  const oldFullKey = existing
    ? templateObjectKey(kind, slug, 'full', templateExt(existing.mime))
    : null
  const oldThumbKey = existing?.thumbHash
    ? templateObjectKey(kind, slug, 'thumb', templateExt(existing.thumbMime ?? existing.mime))
    : null
  const fullKey = templateObjectKey(kind, slug, 'full', templateExt(full.mime))
  const thumbKey = thumb ? templateObjectKey(kind, slug, 'thumb', templateExt(thumb.mime)) : null
  const stale = [oldFullKey, oldThumbKey].filter(
    (k): k is string => Boolean(k) && k !== fullKey && k !== thumbKey,
  )
  if (stale.length > 0) await bucket.delete(stale)

  const hash = await storeBlob(bucket, fullKey, full)
  const thumbHash = thumb && thumbKey ? await storeBlob(bucket, thumbKey, thumb) : null

  const now = Date.now()
  // 新規の既定値はファイル名の規則から（分類・時間帯）。表示名は画面側が既定を渡す
  const parsed = parseTemplateFilename(`${slug}.${templateExt(full.mime)}`)
  const entry: TemplateEntry = {
    ...(existing ?? {}),
    kind,
    slug,
    label: input.data.label ?? existing?.label ?? '',
    category: input.data.category ?? existing?.category ?? parsed?.category ?? slug,
    tone: input.data.tone ?? existing?.tone ?? BLACK,
    mime: full.mime,
    bytes: full.bytes.byteLength,
    hash,
    updatedAt: now,
  }
  const time = input.data.time ?? existing?.time ?? parsed?.time
  if (time && kind === 'bg') entry.time = time
  else delete entry.time
  if (thumb && thumbHash) {
    entry.thumbHash = thumbHash
    entry.thumbMime = thumb.mime
  } else {
    delete entry.thumbHash
    delete entry.thumbMime
  }
  const durationMs = isSe ? (input.data.durationMs ?? existing?.durationMs) : undefined
  if (durationMs !== undefined) entry.durationMs = durationMs
  else delete entry.durationMs

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
