import { describe, expect, it } from 'vitest'
import { BlockSchema, GlossaryEntrySchema, InlineSchema, WorkSchema } from './index'

describe('InlineSchema（ref 追加・P1）', () => {
  it('GSC1: ref を受理する', () => {
    expect(InlineSchema.safeParse({ type: 'ref', name: 'アリス' }).success).toBe(true)
  })

  it('GSC2: ref の name 欠落を拒否する', () => {
    expect(InlineSchema.safeParse({ type: 'ref' }).success).toBe(false)
  })

  it('既存 inline（text/ruby/傍点）は引き続き受理（回帰）', () => {
    expect(InlineSchema.safeParse({ type: 'text', text: 'x' }).success).toBe(true)
    expect(InlineSchema.safeParse({ type: 'ruby', base: '漢', reading: 'かん' }).success).toBe(true)
    expect(InlineSchema.safeParse({ type: 'emphasisDots', text: '強' }).success).toBe(true)
  })
})

describe('WorkSchema（glossary 相乗り・P1）', () => {
  const base = { id: 'w1', title: '作', episodes: [] }

  it('GSC3: glossary 省略の旧 Work を許容（後方互換）', () => {
    expect(WorkSchema.safeParse(base).success).toBe(true)
  })

  it('glossary 配列を持つ Work を受理', () => {
    const entry = {
      id: 'g1',
      name: 'アリス',
      aliases: [],
      createdAt: 1,
      updatedAt: 1,
    }
    expect(WorkSchema.safeParse({ ...base, glossary: [entry] }).success).toBe(true)
  })
})

describe('BlockSchema（sceneBreak 廃止・後方互換）', () => {
  it('paragraph を受理する', () => {
    expect(
      BlockSchema.safeParse({ id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: 'x' }] })
        .success,
    ).toBe(true)
  })

  it('旧 sceneBreak ブロックは空段落へ正規化される（読込互換）', () => {
    expect(BlockSchema.parse({ id: 'b2', type: 'sceneBreak' })).toEqual({
      id: 'b2',
      type: 'paragraph',
      inlines: [],
    })
  })

  it('sceneBreak を含む旧 Work も弾かず読み込める', () => {
    const res = WorkSchema.safeParse({
      id: 'w1',
      title: '作',
      episodes: [{ id: 'e1', title: '一', blocks: [{ id: 'b1', type: 'sceneBreak' }] }],
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.episodes[0]?.blocks[0]).toEqual({ id: 'b1', type: 'paragraph', inlines: [] })
    }
  })
})

describe('GlossaryEntrySchema（P1）', () => {
  const valid = { id: 'g1', name: 'アリス', aliases: ['アリサ'], createdAt: 1, updatedAt: 2 }

  it('GSC4: 必須項目を満たす entry を受理', () => {
    expect(GlossaryEntrySchema.safeParse(valid).success).toBe(true)
  })

  it('任意項目（category/reading/summary/body）も受理', () => {
    expect(
      GlossaryEntrySchema.safeParse({
        ...valid,
        category: '人物',
        reading: 'ありす',
        summary: '主人公',
        body: '詳細',
      }).success,
    ).toBe(true)
  })

  it('GSC5: name 欠落を拒否', () => {
    const { name, ...noName } = valid
    expect(GlossaryEntrySchema.safeParse(noName).success).toBe(false)
  })
})
