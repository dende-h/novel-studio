import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { type BackupState, deserializeBackup, serializeBackup } from './index'

const work = (id: string, title = 'T'): Work => ({ id, title, episodes: [], updatedAt: 100 })

const state: BackupState = {
  works: [work('w1', '作品1'), work('w2', '作品2')],
  trash: [{ work: work('t1', 'ゴミ'), trashedAt: 500 }],
  profile: { penName: '紫式部' },
  activity: [{ date: '2026-07-12', added: 100, removed: 0, net: 100, saves: 1, updatedAt: 1 }],
  ideas: [{ id: 'i1', text: 'ネタ', createdAt: 10, updatedAt: 10 }],
  structures: [{ id: 's1', workId: 'w1', kind: 'outline', nodes: [], edges: [], updatedAt: 20 }],
  plots: [
    {
      id: 'p1',
      workId: 'w1',
      title: '本編プロット',
      sections: [{ id: 'sec1', title: '第一幕', beatIds: [] }],
      beats: [],
      lines: [],
      foreshadows: [],
      secrets: [],
      world: [{ id: 'n1', slot: 'rules', body: '死者は生き返らない', updatedAt: 25 }],
      updatedAt: 30,
    },
  ],
  stagings: [
    { workId: 'w1', episodeId: 'e1', cues: [{ blockId: 'b1', speaker: '光' }], updatedAt: 40 },
  ],
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
    expect(back.activity.map((a) => a.date)).toEqual(['2026-07-12'])
    expect(back.ideas.map((i) => i.id)).toEqual(['i1'])
    expect(back.structures.map((s) => s.id)).toEqual(['s1'])
  })

  it('activity 欠落の旧バックアップ（version 1）も既定 [] で復元できる（後方互換）', () => {
    const old = JSON.stringify({ version: 1, createdAt: 1, works: [], trash: [], profile: {} })
    expect(deserializeBackup(old).activity).toEqual([])
  })

  it('ideas 欠落の旧バックアップ（version 1）も既定 [] で復元できる（後方互換）', () => {
    const old = JSON.stringify({
      version: 1,
      createdAt: 1,
      works: [],
      trash: [],
      profile: {},
      activity: [],
    })
    expect(deserializeBackup(old).ideas).toEqual([])
  })

  it('structures 欠落の旧バックアップも既定 [] で復元できる（後方互換）', () => {
    const old = JSON.stringify({
      version: 1,
      createdAt: 1,
      works: [],
      trash: [],
      profile: {},
      activity: [],
      ideas: [],
    })
    expect(deserializeBackup(old).structures).toEqual([])
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
    const json = serializeBackup(
      {
        works: [],
        trash: [],
        profile: {},
        activity: [],
        ideas: [],
        structures: [],
        plots: [],
        stagings: [],
      },
      0,
    )
    const back = deserializeBackup(json)
    expect(back.works).toEqual([])
    expect(back.trash).toEqual([])
  })
})

describe('世界観設定の保全', () => {
  // world は Plot の一部なので、バックアップ・復元・クラウド同期の器へ自動的に相乗りする。
  // ただし「相乗りしているつもり」で落ちるのが一番怖いので、往復で残ることを明示的に固定する。
  it('書き出し → 読み込みの往復で世界観設定が残る', () => {
    const round = deserializeBackup(serializeBackup(state, 0))
    expect(round.plots[0]?.world).toEqual([
      { id: 'n1', slot: 'rules', body: '死者は生き返らない', updatedAt: 25 },
    ])
  })
})
