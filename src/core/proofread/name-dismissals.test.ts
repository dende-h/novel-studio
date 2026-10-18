import { describe, expect, it } from 'vitest'
import {
  dismissedSet,
  dismissName,
  type NameDismissals,
  NameDismissalsSchema,
  restoreName,
} from './name-dismissals'

describe('外した語（COT-59 FR-5）', () => {
  it('記録が無ければ新しく作り、語と時刻を足す', () => {
    expect(dismissName(undefined, 'w1', '新宿', 100)).toEqual({
      workId: 'w1',
      words: [{ text: '新宿', at: 100 }],
      updatedAt: 100,
    })
  })

  it('外した順に足し、もう外した語は同じ参照のまま返す', () => {
    const a = dismissName(undefined, 'w1', '新宿', 100)
    const b = dismissName(a, 'w1', 'エルフ', 200)
    expect(b.words.map((w) => w.text)).toEqual(['新宿', 'エルフ'])
    expect(b.updatedAt).toBe(200)
    expect(dismissName(b, 'w1', '新宿', 300)).toBe(b)
  })

  it('戻すと記録から消え、外していない語なら同じ参照のまま', () => {
    const r: NameDismissals = {
      workId: 'w1',
      words: [
        { text: '新宿', at: 100 },
        { text: 'エルフ', at: 200 },
      ],
      updatedAt: 200,
    }
    const restored = restoreName(r, '新宿', 300)
    expect(restored.words.map((w) => w.text)).toEqual(['エルフ'])
    expect(restored.updatedAt).toBe(300)
    expect(restoreName(r, '湊斗', 300)).toBe(r)
  })

  it('dismissedSet は記録が無ければ空', () => {
    expect(dismissedSet(undefined).size).toBe(0)
    expect([...dismissedSet(dismissName(undefined, 'w1', '新宿', 1))]).toEqual(['新宿'])
  })

  it('スキーマ：words が無い記録は空で読み、updatedAt が無い記録は読めない', () => {
    expect(NameDismissalsSchema.parse({ workId: 'w1', updatedAt: 1 }).words).toEqual([])
    expect(NameDismissalsSchema.safeParse({ workId: 'w1', words: [] }).success).toBe(false)
  })
})
