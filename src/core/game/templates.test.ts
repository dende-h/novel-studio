import { describe, expect, it } from 'vitest'
import { PRESET_BACKGROUNDS } from './presets'
import { PRESET_SPRITES } from './spritePresets'
import {
  catalogBackgroundKeys,
  categoriesOf,
  categoryLabelOf,
  defaultTemplateLabel,
  EMPTY_TEMPLATE_MANIFEST,
  isTemplateSlug,
  mergeBackgroundCatalog,
  mergeSpriteCatalog,
  parseTemplateFilename,
  parseTemplateKey,
  parseTemplateTsv,
  type TemplateEntry,
  type TemplateManifest,
  TemplateManifestSchema,
  templateAssetId,
  templateUrl,
  toneGradientSvg,
  visibleTemplates,
} from './templates'

const entry = (
  over: Partial<TemplateEntry> & Pick<TemplateEntry, 'kind' | 'slug'>,
): TemplateEntry => ({
  label: '',
  category: over.slug.split('-')[0] ?? '',
  tone: ['#111111', '#222222', '#333333'],
  mime: 'image/webp',
  bytes: 1000,
  hash: 'h1',
  updatedAt: 1,
  ...over,
})

const manifest = (
  entries: TemplateEntry[],
  over: Partial<TemplateManifest> = {},
): TemplateManifest => ({
  ...EMPTY_TEMPLATE_MANIFEST,
  entries,
  ...over,
})

describe('ファイル名 → キー（命名規則）', () => {
  it('背景は <場所>[-<変種>]-<時間帯>、立ち絵は silhouette-<人物像>', () => {
    expect(parseTemplateFilename('town-alley-night.png')).toEqual({
      kind: 'bg',
      slug: 'town-alley-night',
      category: 'town',
      time: 'night',
    })
    expect(parseTemplateFilename('silhouette-woman.png')).toEqual({
      kind: 'sprite',
      slug: 'silhouette-woman',
      category: 'woman',
    })
  })

  it('時間帯の無い背景・パス付き・大文字・拡張子違いも通す', () => {
    expect(parseTemplateFilename('abstract.webp')).toEqual({
      kind: 'bg',
      slug: 'abstract',
      category: 'abstract',
    })
    expect(parseTemplateFilename('out/bg/Room-Day.PNG')?.slug).toBe('room-day')
    expect(parseTemplateFilename('C:\\img\\sky-dusk.jpeg')?.slug).toBe('sky-dusk')
  })

  it('規則に合わない名前は null（アンダースコア・空白・日本語・silhouette だけ）', () => {
    expect(parseTemplateFilename('town_alley.png')).toBeNull()
    expect(parseTemplateFilename('town alley.png')).toBeNull()
    expect(parseTemplateFilename('街.png')).toBeNull()
    expect(parseTemplateFilename('silhouette.png')).toBeNull()
    expect(parseTemplateFilename('-town.png')).toBeNull()
  })

  it('slug の形と長さ', () => {
    expect(isTemplateSlug('a')).toBe(true)
    expect(isTemplateSlug('a'.repeat(64))).toBe(true)
    expect(isTemplateSlug('a'.repeat(65))).toBe(false)
    expect(isTemplateSlug('')).toBe(false)
    expect(isTemplateSlug('a--b')).toBe(false)
  })
})

describe('キー・id・URL', () => {
  it('preset:bg/<slug> を分解し、テンプレ以外は null', () => {
    expect(parseTemplateKey('preset:bg/room-day')).toEqual({ kind: 'bg', slug: 'room-day' })
    expect(parseTemplateKey('preset:sprite/silhouette-man')).toEqual({
      kind: 'sprite',
      slug: 'silhouette-man',
    })
    expect(parseTemplateKey('user:abc')).toBeNull()
    expect(parseTemplateKey('preset:se/rain')).toBeNull()
  })

  it('素材 id は tpl- 前置（枚数に数えない）で、同じ絵なら常に同じ', () => {
    expect(templateAssetId('bg', 'room-day')).toBe('tpl-bg-room-day')
  })

  it('URL は内容ハッシュ付き。サムネは thumbHash（無ければ hash）', () => {
    const e = entry({ kind: 'bg', slug: 'room-day', hash: 'abc', thumbHash: 'def' })
    expect(templateUrl(e)).toBe('/game-templates/bg/room-day.webp?v=abc')
    expect(templateUrl(e, 'thumb')).toBe('/game-templates/bg/room-day.thumb.webp?v=def')
    expect(templateUrl(entry({ kind: 'bg', slug: 'x', hash: 'q' }), 'thumb')).toBe(
      '/game-templates/bg/x.thumb.webp?v=q',
    )
  })
})

describe('表示名', () => {
  it('分類の表示名は 目録 → 組み込み → 語そのもの の順', () => {
    const m = manifest([], { categories: { bg: { town: '街なか' }, sprite: {} } })
    expect(categoryLabelOf(m, 'bg', 'town')).toBe('街なか')
    expect(categoryLabelOf(null, 'bg', 'town')).toBe('街')
    expect(categoryLabelOf(null, 'sprite', 'woman')).toBe('女性')
    expect(categoryLabelOf(null, 'bg', 'school')).toBe('school')
  })

  it('既定の表示名は 場所（時間帯）／シルエット（人物像）', () => {
    expect(
      defaultTemplateLabel(
        { kind: 'bg', slug: 'town-night', category: 'town', time: 'night' },
        '街',
      ),
    ).toBe('街（夜）')
    expect(
      defaultTemplateLabel({ kind: 'bg', slug: 'abstract', category: 'abstract' }, '抽象'),
    ).toBe('抽象')
    expect(
      defaultTemplateLabel({ kind: 'sprite', slug: 'silhouette-woman', category: 'woman' }, '女性'),
    ).toBe('シルエット（女性）')
  })
})

describe('目録の検証（Zod）', () => {
  it('entries と categories は省略でき、空で埋まる', () => {
    const parsed = TemplateManifestSchema.parse({ v: 1 })
    expect(parsed.entries).toEqual([])
    expect(parsed.categories).toEqual({ bg: {}, sprite: {} })
  })

  it('tone は #rrggbb だけ（SVG に埋める値なので形を縛る）', () => {
    const bad = TemplateManifestSchema.safeParse({
      v: 1,
      entries: [entry({ kind: 'bg', slug: 'x', tone: ['red', '#000000', '#000000'] })],
    })
    expect(bad.success).toBe(false)
  })
})

describe('組み込みと目録の合流', () => {
  it('目録が無ければ組み込み 24 枚がそのまま（画像は無い・非表示も無い）', () => {
    const list = mergeBackgroundCatalog(null)
    expect(list).toHaveLength(PRESET_BACKGROUNDS.length)
    expect(list.every((b) => b.builtin && !b.entry && !b.hidden)).toBe(true)
    expect(list[0]?.key).toBe('preset:bg/room-day')
    expect(list[0]?.category).toBe('room')
  })

  it('組み込みと同じ slug の画像はキーそのままに実体が付く（旧作品の参照が本画像に切り替わる）', () => {
    const e = entry({
      kind: 'bg',
      slug: 'room-day',
      label: '',
      tone: ['#aaaaaa', '#bbbbbb', '#cccccc'],
    })
    const list = mergeBackgroundCatalog(manifest([e]))
    const room = list.find((b) => b.key === 'preset:bg/room-day')
    expect(room?.entry).toBe(e)
    expect(room?.builtin).toBeDefined()
    expect(room?.label).toBe('室内（昼）') // 目録の label が空なら組み込みの名前
    expect(room?.tone).toEqual(['#aaaaaa', '#bbbbbb', '#cccccc'])
    expect(list).toHaveLength(PRESET_BACKGROUNDS.length)
  })

  it('目録だけの絵は後ろに足され、組み込み SVG を持たない', () => {
    const e = entry({
      kind: 'bg',
      slug: 'school-hall-day',
      label: '学校の廊下（昼）',
      category: 'school',
      time: 'day',
    })
    const list = mergeBackgroundCatalog(manifest([e]))
    const last = list[list.length - 1]
    expect(last?.key).toBe('preset:bg/school-hall-day')
    expect(last?.builtin).toBeUndefined()
    expect(last?.label).toBe('学校の廊下（昼）')
    expect(catalogBackgroundKeys(manifest([e])).has('preset:bg/school-hall-day')).toBe(true)
  })

  it('order があるものが先に昇順、無いものは元の並び', () => {
    const list = mergeBackgroundCatalog(
      manifest([
        entry({ kind: 'bg', slug: 'z-day', order: 2 }),
        entry({ kind: 'bg', slug: 'a-day', order: 1 }),
      ]),
    )
    expect(list[0]?.slug).toBe('a-day')
    expect(list[1]?.slug).toBe('z-day')
    expect(list[2]?.slug).toBe('room-day')
  })

  it('非表示は一覧から外れるが、キーとしては残る（既存の参照を壊さない）', () => {
    const m = manifest([entry({ kind: 'bg', slug: 'room-day', hidden: true })])
    const list = mergeBackgroundCatalog(m)
    expect(list.find((b) => b.slug === 'room-day')?.hidden).toBe(true)
    expect(visibleTemplates(list).some((b) => b.slug === 'room-day')).toBe(false)
    expect(catalogBackgroundKeys(m).has('preset:bg/room-day')).toBe(true)
  })

  it('立ち絵も同じ規則（組み込み 6 種＋目録・人物像の語が分類）', () => {
    const list = mergeSpriteCatalog(
      manifest([
        entry({
          kind: 'sprite',
          slug: 'silhouette-knight',
          category: 'knight',
          label: 'シルエット（騎士）',
        }),
      ]),
    )
    expect(list).toHaveLength(PRESET_SPRITES.length + 1)
    expect(list[0]?.category).toBe('woman')
    expect(list[list.length - 1]?.key).toBe('preset:sprite/silhouette-knight')
  })

  it('分類は出現順に件数つきで並ぶ', () => {
    expect(
      categoriesOf(mergeBackgroundCatalog(null)).map((c) => `${c.category}:${c.count}`),
    ).toEqual([
      'room:3',
      'hallway:3',
      'town:3',
      'nature:3',
      'road:3',
      'sky:3',
      'dark:3',
      'abstract:3',
    ])
  })
})

describe('toneGradientSvg（実体を取れないときの控え）', () => {
  it('3 色を含む 1280×720 の SVG', () => {
    const svg = toneGradientSvg(['#111111', '#222222', '#333333'])
    expect(svg).toContain('viewBox="0 0 1280 720"')
    expect(svg).toContain('#111111')
    expect(svg).toContain('#333333')
  })
})

describe('parseTemplateTsv（表示名の一括取り込み）', () => {
  it('ファイル名・表示名・分類を読み、見出し行は飛ばす', () => {
    const { rows, skipped } = parseTemplateTsv(
      [
        '新ファイル名\t元ファイル名\t表示名\t場所\t時間帯\t備考',
        'town-alley-night.png\tIMG_001.png\t路地（夜）\ttown\tnight\t',
        'silhouette-woman.png\tIMG_002.png\tシルエット（女性）\t女性\t\t',
        '',
      ].join('\n'),
    )
    expect(rows).toEqual([
      { kind: 'bg', slug: 'town-alley-night', label: '路地（夜）', category: 'town' },
      { kind: 'sprite', slug: 'silhouette-woman', label: 'シルエット（女性）' },
    ])
    expect(skipped).toHaveLength(1)
  })
})
