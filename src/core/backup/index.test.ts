import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { type BackupState, deserializeBackup, serializeBackup } from './index'

const work = (id: string, title = 'T'): Work => ({ id, title, episodes: [], updatedAt: 100 })

const state: BackupState = {
  works: [work('w1', '作品1'), work('w2', '作品2')],
  trash: [{ work: work('t1', 'ゴミ'), trashedAt: 500 }],
  profile: { penName: '紫式部' },
}

describe('serializeBackup / deserializeBackup（全体バックアップの直列化）', () => {
  it('全状態（作品・ゴミ箱・プロフィール・時刻）を往復できる', () => {
    const json = serializeBackup(state, 1234)
    const back = deserializeBackup(json)
    expect(back.version).toBe(1)
    expect(back.createdAt).toBe(1234)
    expect(back.works.map((w) => w.id)).toEqual(['w1', 'w2'])
    expect(back.trash).toEqual([{ work: work('t1', 'ゴミ'), trashedAt: 500 }])
    expect(back.profile).toEqual({ penName: '紫式部' })
  })

  it('version 不正は弾く（壊れた/将来形のバックアップを復元しない）', () => {
    const bad = JSON.stringify({ version: 999, createdAt: 1, works: [], trash: [], profile: {} })
    expect(() => deserializeBackup(bad)).toThrow()
  })

  it('スキーマ不正（works が配列でない）は弾く', () => {
    const bad = JSON.stringify({ version: 1, createdAt: 1, works: {}, trash: [], profile: {} })
    expect(() => deserializeBackup(bad)).toThrow()
  })

  it('空状態も往復できる', () => {
    const json = serializeBackup({ works: [], trash: [], profile: {} }, 0)
    const back = deserializeBackup(json)
    expect(back.works).toEqual([])
    expect(back.trash).toEqual([])
  })
})
