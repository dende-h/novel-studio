import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { countEpisodeChars, countWorkChars } from './index'

const work = (): Work => ({
  id: 'w1',
  title: 'A',
  episodes: [
    {
      id: 'e1',
      title: '第一話',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [
            { type: 'text', text: '吾輩は' }, // 3
            { type: 'ruby', base: '猫', reading: 'ねこ' }, // base=1（読みは数えない）
            { type: 'text', text: 'である' }, // 3
          ],
        },
        { id: 'b2', type: 'sceneBreak' }, // 0
        {
          id: 'b3',
          type: 'paragraph',
          inlines: [{ type: 'emphasisDots', text: '名前' }], // 2
        },
      ],
    },
    {
      id: 'e2',
      title: '第二話',
      blocks: [{ id: 'b4', type: 'paragraph', inlines: [{ type: 'text', text: 'まだ無い' }] }], // 4
    },
  ],
})

describe('文字数集計', () => {
  it('countEpisodeChars は本文長（ルビは親文字・読みは除外・傍点は本文・sceneBreak は0）', () => {
    const w = work()
    expect(countEpisodeChars(w.episodes[0] as Work['episodes'][number])).toBe(9)
    expect(countEpisodeChars(w.episodes[1] as Work['episodes'][number])).toBe(4)
  })

  it('countWorkChars は全話合計', () => {
    expect(countWorkChars(work())).toBe(13)
  })

  it('空作品は 0', () => {
    expect(countWorkChars({ id: 'x', title: '空', episodes: [] })).toBe(0)
  })
})
