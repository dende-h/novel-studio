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

  it('createSnapshot は画像（表紙・図鑑サムネ）を版に含めない（履歴肥大の防止）', () => {
    const w: Work = {
      id: 'w1',
      title: '初稿',
      episodes: [],
      coverImage: 'data:image/jpeg;base64,COVER',
      glossary: [
        {
          id: 'g1',
          name: 'アリス',
          aliases: [],
          thumbnail: 'data:image/jpeg;base64,THUMB',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }
    const s = createSnapshot(w, 1000, 's1')
    expect(s.work.coverImage).toBeUndefined()
    expect(s.work.glossary?.[0]?.thumbnail).toBeUndefined()
    // 本文・その他のメタは保持する。
    expect(s.work.title).toBe('初稿')
    expect(s.work.glossary?.[0]?.name).toBe('アリス')
    // 元の work は破壊しない。
    expect(w.coverImage).toBe('data:image/jpeg;base64,COVER')
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
