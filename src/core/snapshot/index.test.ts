import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { createSnapshot, restoreSnapshot, trimSnapshots } from '.'

const work = (title: string): Work => ({ id: 'w1', title, episodes: [] })

describe('snapshot（最小版管理・純ロジック）', () => {
  it('createSnapshot は時刻と work のコピーを持つ（元の変更に不変）', () => {
    const w = work('初稿')
    const s = createSnapshot(w, 1000, 's1')
    expect(s).toEqual({ id: 's1', at: 1000, work: work('初稿') })
    w.title = '改稿'
    expect(s.work.title).toBe('初稿')
  })

  it('restoreSnapshot で当時の work を復元（コピー）', () => {
    const s = createSnapshot(work('初稿'), 1000, 's1')
    const restored = restoreSnapshot(s)
    expect(restored).toEqual(work('初稿'))
    restored.title = '上書き'
    expect(s.work.title).toBe('初稿')
  })

  it('trimSnapshots は新しい順に max 件へ切り詰め', () => {
    const snaps = [1, 2, 3, 4, 5].map((n) => createSnapshot(work('v' + n), n * 10, 's' + n))
    expect(trimSnapshots(snaps, 3).map((s) => s.at)).toEqual([50, 40, 30])
  })

  it('trimSnapshots(max=0) は空', () => {
    const snaps = [createSnapshot(work('v1'), 10, 's1')]
    expect(trimSnapshots(snaps, 0)).toEqual([])
  })
})
