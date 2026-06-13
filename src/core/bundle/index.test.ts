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
})
