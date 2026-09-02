import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Staging } from '@/core/game'
import type { UserGameAsset } from '@/core/game/assets'
import { presetBgSvg } from '@/core/game/presets'
import { presetSpriteDataUrl } from '@/core/game/spritePresets'
import {
  type CatalogBackground,
  type CatalogSprite,
  mergeBackgroundCatalog,
  mergeSpriteCatalog,
  type TemplateEntry,
  type TemplateManifest,
  TemplateManifestSchema,
  type TemplateVariant,
  templateAssetId,
  templateUrl,
  toneGradientSvg,
} from '@/core/game/templates'
import { bytesToDataUrl } from '@/core/image'
import { fetchTemplateBytes, fetchTemplateManifest } from '@/ui/_api/game-templates'

/**
 * 運営テンプレの目録を画面へ配る（アプリ全体で 1 つ・`useSyncExternalStore`）。
 *
 * - 起動時ではなく、演出エディタ・書き出し・図鑑の立ち絵欄が最初に開いたときに読む。
 * - 直近の目録は localStorage に控え、取れないとき（オフライン）はそれを使う。
 *   何も無ければ null ＝ 組み込み SVG だけの一覧になる（今までどおり動く）。
 * - 実体（WebP）は使うときに取り、同じ URL は 1 セッション 1 回だけ取る。
 */

const CACHE_KEY = 'ns-game-templates'

let manifest: TemplateManifest | null = null
let loading: Promise<TemplateManifest | null> | null = null
const listeners = new Set<() => void>()

const notify = () => {
  for (const cb of listeners) cb()
}

function readCache(): TemplateManifest | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = TemplateManifestSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function writeCache(m: TemplateManifest): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m))
  } catch {
    // 控えが取れなくても動く（容量制限・プライベートモード）
  }
}

export function subscribeTemplateCatalog(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const templateManifestSnapshot = (): TemplateManifest | null => manifest

/** 目録を読む（同時に呼ばれても取得は 1 回）。`force` で読み直す（管理ページの保存後）。 */
export function loadTemplateCatalog(
  opts: { force?: boolean } = {},
): Promise<TemplateManifest | null> {
  if (manifest && !opts.force) return Promise.resolve(manifest)
  if (loading) return loading
  loading = (async () => {
    if (!manifest) {
      const cached = readCache()
      if (cached) {
        manifest = cached
        notify()
      }
    }
    const fresh = await fetchTemplateManifest()
    if (fresh) {
      manifest = fresh
      writeCache(fresh)
      notify()
    }
    return manifest
  })().finally(() => {
    loading = null
  })
  return loading
}

/** 管理ページが保存した目録をその場で配る（読み直しを待たない）。テストの差し込みにも使う。 */
export function setTemplateCatalog(m: TemplateManifest | null): void {
  manifest = m
  if (m) writeCache(m)
  notify()
}

export interface TemplateCatalog {
  manifest: TemplateManifest | null
  backgrounds: CatalogBackground[]
  sprites: CatalogSprite[]
}

/** 画面用：目録（無ければ組み込みだけ）を合流済みの一覧で返し、初回に読みに行く。 */
export function useTemplateCatalog(): TemplateCatalog {
  const m = useSyncExternalStore(subscribeTemplateCatalog, templateManifestSnapshot, () => null)
  useEffect(() => {
    void loadTemplateCatalog()
  }, [])
  return useMemo(
    () => ({ manifest: m, backgrounds: mergeBackgroundCatalog(m), sprites: mergeSpriteCatalog(m) }),
    [m],
  )
}

// ---------------------------------------------------------------------------
// 表示用の src と実体の取得
// ---------------------------------------------------------------------------

const svgDataUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/** 一覧・プレビューに出す背景の src（画像 → 組み込み SVG → tone の控え）。 */
export function templateBgSrc(bg: CatalogBackground, variant: TemplateVariant = 'full'): string {
  if (bg.entry) return templateUrl(bg.entry, variant)
  if (bg.builtin) return svgDataUrl(presetBgSvg(bg.builtin))
  return svgDataUrl(toneGradientSvg(bg.tone))
}

/** 一覧に出す立ち絵の src（画像 → 組み込み SVG）。どちらも無いことは無い（目録の項目は画像を持つ）。 */
export function templateSpriteSrc(sp: CatalogSprite, variant: TemplateVariant = 'full'): string {
  if (sp.entry) return templateUrl(sp.entry, variant)
  if (sp.builtin) return presetSpriteDataUrl(sp.builtin)
  return ''
}

export interface TemplateImage {
  bytes: Uint8Array
  mime: string
  dataUrl: string
}

const images = new Map<string, Promise<TemplateImage | null>>()

/** 実体を取る（同じ URL は 1 回）。取れなければ null（呼び出し側が控えに倒す）。 */
export function loadTemplateImage(entry: TemplateEntry): Promise<TemplateImage | null> {
  const url = templateUrl(entry)
  let p = images.get(url)
  if (!p) {
    p = fetchTemplateBytes(url).then((r) =>
      r ? { bytes: r.bytes, mime: r.mime, dataUrl: bytesToDataUrl(r.bytes, r.mime) } : null,
    )
    // 失敗は覚えない（次に開いたときにもう一度取りに行く）
    p.then((r) => {
      if (!r) images.delete(url)
    })
    images.set(url, p)
  }
  return p
}

/** 演出譜と既定背景が指すテンプレ背景のキー（重複なし・`preset:bg/` だけ）。 */
export function templateBgKeysOf(
  stagings: readonly Staging[],
  extra: readonly (string | undefined)[] = [],
): string[] {
  const keys = new Set<string>()
  for (const s of stagings) for (const c of s.cues) if (c.bg) keys.add(c.bg)
  for (const k of extra) if (k) keys.add(k)
  return [...keys].filter((k) => k.startsWith('preset:bg/'))
}

export interface ResolvedTemplateBackgrounds {
  /** 書き出し・投稿へ渡す素材（テンプレ由来＝`preset` 付き・id は `tpl-bg-<slug>`） */
  assets: UserGameAsset[]
  /** 目録にはあるが実体を取れなかったキー（組み込み SVG を持たないもの） */
  missing: string[]
}

/**
 * 演出譜が指すテンプレ背景を、書き出し・投稿に載せる素材の形にする。
 * - 目録に画像があるキーは実体を取って素材にする（同じキーの組み込み SVG より優先される）。
 * - 画像の無い組み込みキーは何もしない（exporter が SVG を描く）。
 * - 実体を取れない目録だけの絵は、`fallback: 'gradient'` なら tone の控えを素材にし、
 *   `'none'` なら `missing` に積む（投稿は控えを送らず、作者に知らせて止める）。
 */
export async function resolveTemplateBackgrounds(
  keys: readonly string[],
  backgrounds: readonly CatalogBackground[],
  opts: { fallback: 'gradient' | 'none' },
): Promise<ResolvedTemplateBackgrounds> {
  const byKey = new Map(backgrounds.map((b) => [b.key, b]))
  const assets: UserGameAsset[] = []
  const missing: string[] = []
  for (const key of keys) {
    const bg = byKey.get(key)
    if (!bg?.entry) continue
    const img = await loadTemplateImage(bg.entry)
    if (img) {
      assets.push(templateBgAsset(bg, img.dataUrl))
      continue
    }
    if (bg.builtin) continue
    if (opts.fallback === 'gradient') {
      assets.push(
        templateBgAsset(bg, `data:image/svg+xml;base64,${btoa(toneGradientSvg(bg.tone))}`),
      )
    } else {
      missing.push(key)
    }
  }
  return { assets, missing }
}

function templateBgAsset(bg: CatalogBackground, dataUrl: string): UserGameAsset {
  return {
    id: templateAssetId('bg', bg.slug),
    kind: 'bg',
    name: bg.label,
    dataUrl,
    tone: bg.tone,
    preset: bg.key,
    createdAt: bg.entry?.updatedAt ?? 0,
  }
}

/** テンプレ立ち絵を話者へ割り当てるときの実体（画像 → 組み込み SVG）。取れなければ null。 */
export async function templateSpriteDataUrl(sp: CatalogSprite): Promise<string | null> {
  if (sp.entry) {
    const img = await loadTemplateImage(sp.entry)
    if (img) return img.dataUrl
    return sp.builtin ? presetSpriteDataUrl(sp.builtin) : null
  }
  return sp.builtin ? presetSpriteDataUrl(sp.builtin) : null
}
