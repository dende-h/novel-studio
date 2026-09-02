import { z } from 'zod'
import {
  type GamePlace,
  type GameTime,
  PRESET_BACKGROUNDS,
  PRESET_PLACE_LABELS,
  PRESET_TIME_LABELS,
  type PresetBackground,
} from './presets'
import { PRESET_SPRITE_TONE, PRESET_SPRITES, type PresetSprite } from './spritePresets'

/**
 * 運営テンプレの**目録**（D-GAME-TEMPLATE-CMS）。
 *
 * テンプレ背景・立ち絵の実体は R2（`_templates/<kind>/<slug>.webp`）にあり、何があるかは
 * `manifest.json`（この形）で配られる。運営は管理ページから足す・置き換える・非表示にする。
 * キーは今までどおり `preset:bg/<slug>` / `preset:sprite/<slug>`＝**ファイル名がそのまま契約**。
 *
 * 目録が無い・取れない状態でも今までどおり動く：組み込みの SVG（presets.ts の 24 枚と
 * spritePresets.ts の 6 種）は目録に画像が無いあいだの**控え**で、画像が当たれば
 * 同じキーのまま本画像に切り替わる（旧作品の参照を壊さない）。
 *
 * ここは純 TS。取得（fetch）と R2 の読み書きは UI 層／Functions が担う。
 */

export type TemplateKind = 'bg' | 'sprite'
export const TEMPLATE_KINDS: readonly TemplateKind[] = ['bg', 'sprite']
export const TEMPLATE_TIMES: readonly GameTime[] = ['day', 'dusk', 'night']

/** ファイル名＝slug の形（小文字英数字とハイフンだけ・先頭末尾にハイフン無し）。 */
export const TEMPLATE_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const TEMPLATE_SLUG_MAX = 64
export const isTemplateSlug = (s: string): boolean =>
  s.length > 0 && s.length <= TEMPLATE_SLUG_MAX && TEMPLATE_SLUG_RE.test(s)

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const ToneSchema = z.tuple([
  z.string().regex(HEX_COLOR),
  z.string().regex(HEX_COLOR),
  z.string().regex(HEX_COLOR),
])

export const TemplateEntrySchema = z.object({
  kind: z.enum(['bg', 'sprite']),
  slug: z.string(),
  /** 一覧・クレジットに出す表示名（空なら slug から作る） */
  label: z.string(),
  /** 一覧の絞り込み（背景＝場所の語・立ち絵＝人物像の語） */
  category: z.string(),
  /** 背景だけ。時間帯の無い絵は省略 */
  time: z.enum(['day', 'dusk', 'night']).optional(),
  /** 上・中・下の3色（共有カードの下地・クロスフェードの間の色・取得できないときの控え） */
  tone: ToneSchema,
  mime: z.string(),
  bytes: z.number(),
  /** 実体の内容ハッシュ。URL の `?v=` に付けて immutable キャッシュを効かせる */
  hash: z.string(),
  thumbHash: z.string().optional(),
  /** 一覧から外す（既存作品の参照は生かす＝削除ではない） */
  hidden: z.boolean().optional(),
  order: z.number().optional(),
  updatedAt: z.number(),
})
export type TemplateEntry = z.infer<typeof TemplateEntrySchema>

const CategoryLabels = z.record(z.string(), z.string()).optional().default({})

export const TemplateManifestSchema = z.object({
  v: z.literal(1),
  updatedAt: z.number().optional().default(0),
  /** 分類の語 → 表示名（bg と sprite で別々）。無い語は組み込みの表か語そのものを出す */
  categories: z
    .object({ bg: CategoryLabels, sprite: CategoryLabels })
    .optional()
    .default(() => ({ bg: {}, sprite: {} })),
  entries: z.array(TemplateEntrySchema).optional().default([]),
})
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>

export const EMPTY_TEMPLATE_MANIFEST: TemplateManifest = {
  v: 1,
  updatedAt: 0,
  categories: { bg: {}, sprite: {} },
  entries: [],
}

// ---------------------------------------------------------------------------
// キー・パス
// ---------------------------------------------------------------------------

export const templateKey = (kind: TemplateKind, slug: string): string => `preset:${kind}/${slug}`

/** `preset:bg/<slug>` を分解する。テンプレのキーでなければ null。 */
export function parseTemplateKey(key: string): { kind: TemplateKind; slug: string } | null {
  const m = /^preset:(bg|sprite)\/(.+)$/.exec(key)
  if (!m || !m[1] || !m[2]) return null
  return { kind: m[1] as TemplateKind, slug: m[2] }
}

/**
 * 書き出し・投稿でテンプレ背景を素材として運ぶときの id（`tpl-` 前置＝枚数に数えない・
 * 契約 v5 の `asset:<id>` に載る）。同じ絵なら常に同じ id＝作品ぶん1回だけ送れる。
 */
export const templateAssetId = (kind: TemplateKind, slug: string): string => `tpl-${kind}-${slug}`

export type TemplateVariant = 'full' | 'thumb'

/** 配信パス（Pages Functions `functions/game-templates/[[path]].ts` が R2 から返す）。 */
export function templatePath(kind: TemplateKind, slug: string, variant: TemplateVariant = 'full') {
  return `/game-templates/${kind}/${slug}${variant === 'thumb' ? '.thumb' : ''}.webp`
}

/** 実体の URL（内容ハッシュ付き＝置き換えたら URL が変わる）。 */
export function templateUrl(entry: TemplateEntry, variant: TemplateVariant = 'full'): string {
  const v = variant === 'thumb' ? (entry.thumbHash ?? entry.hash) : entry.hash
  return `${templatePath(entry.kind, entry.slug, variant)}?v=${encodeURIComponent(v)}`
}

// ---------------------------------------------------------------------------
// ファイル名 → キー（管理ページの一括投入・命名規則は docs/requirement/07-novel-game.md §4.1）
// ---------------------------------------------------------------------------

export interface ParsedTemplateName {
  kind: TemplateKind
  slug: string
  category: string
  time?: GameTime
}

/**
 * `town-alley-night.png` → 背景・場所 `town`・時間帯 `night`。
 * `silhouette-woman.png` → 立ち絵・人物像 `woman`。規則に合わなければ null。
 */
export function parseTemplateFilename(name: string): ParsedTemplateName | null {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.(png|webp|jpe?g|avif|gif)$/i, '')
    .toLowerCase()
  if (!isTemplateSlug(base)) return null
  const segs = base.split('-')
  if (segs[0] === 'silhouette') {
    const category = segs[1]
    if (!category) return null
    return { kind: 'sprite', slug: base, category }
  }
  const category = segs[0]
  if (!category) return null
  const last = segs[segs.length - 1]
  const time = segs.length >= 2 && last && isGameTime(last) ? last : undefined
  return { kind: 'bg', slug: base, category, ...(time ? { time } : {}) }
}

const isGameTime = (s: string): s is GameTime => (TEMPLATE_TIMES as readonly string[]).includes(s)

// ---------------------------------------------------------------------------
// 表示名
// ---------------------------------------------------------------------------

/** 組み込みシルエットの人物像の語 → 表示名（`シルエット（女性）` の中身）。 */
const SPRITE_WORD_LABELS: Record<string, string> = Object.fromEntries(
  PRESET_SPRITES.map((p) => [
    p.slug.replace(/^silhouette-/, ''),
    p.label.replace(/^シルエット（(.*)）$/, '$1'),
  ]),
)

/** 分類の語の表示名。目録 → 組み込みの表 → 語そのもの、の順。 */
export function categoryLabelOf(
  manifest: TemplateManifest | null | undefined,
  kind: TemplateKind,
  word: string,
): string {
  const custom = manifest?.categories[kind][word]
  if (custom) return custom
  if (kind === 'bg') return PRESET_PLACE_LABELS[word as GamePlace] ?? word
  return SPRITE_WORD_LABELS[word] ?? word
}

/** 時間帯の表示名（昼・夕・夜）。 */
export const timeLabelOf = (time: GameTime): string => PRESET_TIME_LABELS[time]

/** ファイル名から作る既定の表示名（`街（夜）`・`シルエット（女性）`）。管理ページはあとから直せる。 */
export function defaultTemplateLabel(parsed: ParsedTemplateName, categoryLabel: string): string {
  if (parsed.kind === 'sprite') return `シルエット（${categoryLabel}）`
  return parsed.time ? `${categoryLabel}（${timeLabelOf(parsed.time)}）` : categoryLabel
}

// ---------------------------------------------------------------------------
// 目録と組み込みの合流（画面・書き出しが見る一覧）
// ---------------------------------------------------------------------------

export interface CatalogBackground {
  key: string
  slug: string
  label: string
  category: string
  time?: GameTime
  tone: [string, string, string]
  /** 目録にある実体（無ければ組み込み SVG か tone の控えで描く） */
  entry?: TemplateEntry
  /** 組み込み SVG（画像が無いあいだの実体・旧作品の控え） */
  builtin?: PresetBackground
  /** 一覧から外されている（既存の参照は描ける） */
  hidden: boolean
}

export interface CatalogSprite {
  key: string
  slug: string
  label: string
  category: string
  tone: [string, string, string]
  entry?: TemplateEntry
  builtin?: PresetSprite
  hidden: boolean
}

/** `order` があるものを先に昇順、無いものは並びのまま（安定ソート）。 */
function sortByOrder<T extends { entry?: TemplateEntry }>(list: T[]): T[] {
  const key = (x: T) => x.entry?.order ?? Number.MAX_SAFE_INTEGER
  return [...list].sort((a, b) => key(a) - key(b))
}

/**
 * 背景の一覧＝組み込み 24 枚に目録を重ね、目録だけにある絵を後ろに足す。
 * 組み込みと同じ slug の画像が目録にあれば、キーはそのままに実体だけ画像になる。
 */
export function mergeBackgroundCatalog(manifest: TemplateManifest | null): CatalogBackground[] {
  const entries = new Map(
    (manifest?.entries ?? []).filter((e) => e.kind === 'bg').map((e) => [e.slug, e]),
  )
  const out: CatalogBackground[] = []
  for (const b of PRESET_BACKGROUNDS) {
    const e = entries.get(b.slug)
    entries.delete(b.slug)
    out.push({
      key: b.key,
      slug: b.slug,
      label: e?.label || b.label,
      category: e?.category || b.place,
      time: e?.time ?? b.time,
      tone: e?.tone ?? b.tone,
      ...(e ? { entry: e } : {}),
      builtin: b,
      hidden: e?.hidden === true,
    })
  }
  for (const e of entries.values()) {
    out.push({
      key: templateKey('bg', e.slug),
      slug: e.slug,
      label: e.label || e.slug,
      category: e.category,
      ...(e.time ? { time: e.time } : {}),
      tone: e.tone,
      entry: e,
      hidden: e.hidden === true,
    })
  }
  return sortByOrder(out)
}

/** 立ち絵の一覧（組み込みシルエット 6 種＋目録）。 */
export function mergeSpriteCatalog(manifest: TemplateManifest | null): CatalogSprite[] {
  const entries = new Map(
    (manifest?.entries ?? []).filter((e) => e.kind === 'sprite').map((e) => [e.slug, e]),
  )
  const out: CatalogSprite[] = []
  for (const p of PRESET_SPRITES) {
    const e = entries.get(p.slug)
    entries.delete(p.slug)
    out.push({
      key: p.key,
      slug: p.slug,
      label: e?.label || p.label,
      category: e?.category || p.slug.replace(/^silhouette-/, ''),
      tone: e?.tone ?? PRESET_SPRITE_TONE,
      ...(e ? { entry: e } : {}),
      builtin: p,
      hidden: e?.hidden === true,
    })
  }
  for (const e of entries.values()) {
    out.push({
      key: templateKey('sprite', e.slug),
      slug: e.slug,
      label: e.label || e.slug,
      category: e.category,
      tone: e.tone,
      entry: e,
      hidden: e.hidden === true,
    })
  }
  return sortByOrder(out)
}

/** 一覧に出すものだけ（非表示を除く）。 */
export const visibleTemplates = <T extends { hidden: boolean }>(list: readonly T[]): T[] =>
  list.filter((x) => !x.hidden)

/** 一覧に現れる分類（出現順・件数つき）。 */
export function categoriesOf<T extends { category: string }>(
  list: readonly T[],
): Array<{ category: string; count: number }> {
  const out: Array<{ category: string; count: number }> = []
  for (const x of list) {
    const hit = out.find((c) => c.category === x.category)
    if (hit) hit.count += 1
    else out.push({ category: x.category, count: 1 })
  }
  return out
}

/** 目録が知っている背景キー（非表示も含む＝既存の参照を検証で弾かない）。 */
export function catalogBackgroundKeys(manifest: TemplateManifest | null): Set<string> {
  return new Set(mergeBackgroundCatalog(manifest).map((b) => b.key))
}

/**
 * 実体を取れないときの控え（tone 3 色の縦グラデーション・1280×720）。
 * 目録だけにある絵は組み込み SVG を持たないので、これで場面の色だけは保つ。
 */
export function toneGradientSvg([top, mid, bottom]: [string, string, string]): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    `<stop offset="0" stop-color="${top}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${bottom}"/>` +
    '</linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/></svg>'
  )
}

// ---------------------------------------------------------------------------
// 管理 API の入力（functions/api/admin/templates.ts と src/ui/_api/game-templates.ts の契約）
// ---------------------------------------------------------------------------

/** 1 枚の投入・置き換え（`PUT /api/admin/templates?kind=&slug=`）。実体はブラウザで WebP 化済み。 */
export const TemplatePutInputSchema = z.object({
  dataUrl: z.string().refine((s) => s.startsWith('data:image/'), 'data URL が必要'),
  thumbDataUrl: z
    .string()
    .refine((s) => s.startsWith('data:image/'), 'data URL が必要')
    .optional(),
  tone: ToneSchema,
  /** 省略＝据え置き（既にあれば）／無ければ slug から作る */
  label: z.string().max(80).optional(),
  category: z.string().max(40).optional(),
  time: z.enum(['day', 'dusk', 'night']).optional(),
})
export type TemplatePutInput = z.infer<typeof TemplatePutInputSchema>

/** 目録の項目の書き換え（`PATCH /api/admin/templates`）。渡した項目だけ変える（省略＝据え置き）。 */
export const TemplateEntryPatchSchema = z.object({
  kind: z.enum(['bg', 'sprite']),
  slug: z.string(),
  label: z.string().max(80).optional(),
  category: z.string().max(40).optional(),
  /** null ＝ 時間帯を外す */
  time: z.enum(['day', 'dusk', 'night']).nullable().optional(),
  order: z.number().nullable().optional(),
  hidden: z.boolean().optional(),
})
export type TemplateEntryPatch = z.infer<typeof TemplateEntryPatchSchema>

export const TemplatePatchInputSchema = z.object({
  entries: z.array(TemplateEntryPatchSchema).max(500).optional(),
  /** 分類の表示名（渡した語だけ書き換え・空文字で消す） */
  categories: z
    .object({
      bg: z.record(z.string(), z.string().max(40)).optional(),
      sprite: z.record(z.string(), z.string().max(40)).optional(),
    })
    .optional(),
})
export type TemplatePatchInput = z.infer<typeof TemplatePatchInputSchema>

/** 目録へパッチを当てる（サーバの PATCH と管理ページの楽観更新で同じ関数を使う）。 */
export function applyTemplatePatch(
  manifest: TemplateManifest,
  patch: TemplatePatchInput,
  now: number,
): TemplateManifest {
  const entries = manifest.entries.map((e) => {
    const p = patch.entries?.find((x) => x.kind === e.kind && x.slug === e.slug)
    if (!p) return e
    const next: TemplateEntry = { ...e, updatedAt: now }
    if (p.label !== undefined) next.label = p.label
    if (p.category !== undefined && p.category !== '') next.category = p.category
    if (p.time === null) delete next.time
    else if (p.time !== undefined) next.time = p.time
    if (p.order === null) delete next.order
    else if (p.order !== undefined) next.order = p.order
    if (p.hidden !== undefined) {
      if (p.hidden) next.hidden = true
      else delete next.hidden
    }
    return next
  })
  const mergeLabels = (base: Record<string, string>, over?: Record<string, string>) => {
    if (!over) return base
    const out = { ...base }
    for (const [word, label] of Object.entries(over)) {
      if (label === '') delete out[word]
      else out[word] = label
    }
    return out
  }
  return {
    ...manifest,
    updatedAt: now,
    categories: {
      bg: mergeLabels(manifest.categories.bg, patch.categories?.bg),
      sprite: mergeLabels(manifest.categories.sprite, patch.categories?.sprite),
    },
    entries,
  }
}

// ---------------------------------------------------------------------------
// 表示名の一括取り込み（改名 AI が返す bg.tsv / sprite.tsv）
// ---------------------------------------------------------------------------

export interface TemplateTsvRow {
  kind: TemplateKind
  slug: string
  label?: string
  category?: string
}

/**
 * `新ファイル名<TAB>元ファイル名<TAB>表示名<TAB>場所（人物像）<TAB>…` の行を読む。
 * 1 列目がファイル名の規則に合わない行（見出し行など）は skipped に積む。
 * 4 列目は slug と同じ文字種のときだけ分類として採る（日本語で書かれていたら無視）。
 */
export function parseTemplateTsv(text: string): { rows: TemplateTsvRow[]; skipped: string[] } {
  const rows: TemplateTsvRow[] = []
  const skipped: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cols = line.split('\t').map((c) => c.trim())
    const parsed = parseTemplateFilename(cols[0] ?? '')
    if (!parsed) {
      skipped.push(line)
      continue
    }
    const label = cols[2]
    const category = cols[3] && /^[a-z0-9]+$/.test(cols[3]) ? cols[3] : undefined
    rows.push({
      kind: parsed.kind,
      slug: parsed.slug,
      ...(label ? { label } : {}),
      ...(category ? { category } : {}),
    })
  }
  return { rows, skipped }
}
