import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { BUNDLE_VERSION, exportBundle, importBundle } from '.'

const work: Work = {
  id: 'w1',
  title: '作品',
  episodes: [
    {
      id: 'e1',
      title: '第一話',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [{ type: 'ruby', base: '漢字', reading: 'かんじ' }],
        },
        { id: 'b2', type: 'sceneBreak' },
      ],
    },
  ],
}

describe('bundle（構造化バンドル export/import）', () => {
  it('exportBundle は version 付き JSON', () => {
    const parsed = JSON.parse(exportBundle([work]))
    expect(parsed.version).toBe(BUNDLE_VERSION)
    expect(parsed.works).toHaveLength(1)
  })

  it('export→import で恒等', () => {
    expect(importBundle(exportBundle([work]))).toEqual([work])
  })

  it('作品0件の往復', () => {
    expect(importBundle(exportBundle([]))).toEqual([])
  })

  it('壊れた JSON を安全に拒否（例外で落ちない）', () => {
    expect(() => importBundle('{壊れ')).toThrow()
  })

  it('未知 version を拒否（既定 = 拒否）', () => {
    expect(() => importBundle(JSON.stringify({ version: 999, works: [] }))).toThrow()
  })

  it('スキーマ違反 bundle を拒否', () => {
    expect(() =>
      importBundle(JSON.stringify({ version: BUNDLE_VERSION, works: [{ id: 'x' }] })),
    ).toThrow()
  })

  // ── glossary 検証（P1・WorkSchema 経由） ──
  const glossaryWork: Work = {
    id: 'w2',
    title: '辞書つき',
    episodes: [
      {
        id: 'e1',
        title: '第一話',
        blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ type: 'ref', name: 'アリス' }] }],
      },
    ],
    glossary: [{ id: 'g1', name: 'アリス', aliases: ['アリ'], createdAt: 1, updatedAt: 2 }],
  }

  it('GBN1: glossary 無し旧バンドルを受理（後方互換・glossary 不在）', () => {
    const imported = importBundle(exportBundle([work]))
    expect(imported[0]?.glossary).toBeUndefined()
  })

  it('GBN2: glossary entry の name 欠落 bundle を拒否', () => {
    const bad = {
      version: BUNDLE_VERSION,
      works: [{ ...work, glossary: [{ id: 'g1', aliases: [], createdAt: 0, updatedAt: 0 }] }],
    }
    expect(() => importBundle(JSON.stringify(bad))).toThrow()
  })

  it('GBN4: glossary 込み Work の export→import 恒等', () => {
    expect(importBundle(exportBundle([glossaryWork]))).toEqual([glossaryWork])
  })

  // GBN3（未知フィールド付き entry の受理/拒否）は D-SCHEMA-1 未決のため保留
  it.todo('GBN3: GlossaryEntry の未知フィールド（将来 spoiler 等）の扱い（D-SCHEMA-1）')
})
