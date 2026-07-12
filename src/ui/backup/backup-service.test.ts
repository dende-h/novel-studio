import { describe, expect, it, vi } from 'vitest'
import { serializeBackup } from '@/core/backup'
import type { Work } from '@/core/schema'
import { type BackupDeps, createBackupService } from './backup-service'

const work = (id: string): Work => ({ id, title: id, episodes: [], updatedAt: 1 })

function makeDeps(over: Partial<BackupDeps> = {}) {
  const state = { works: [work('a')], trash: [], profile: { penName: 'p' }, activity: [] }
  const created: string[] = []
  const live: string[] = []
  const replaced: Array<{ works: Work[] }> = []
  const remote = new Map<string, string>()
  const deps: BackupDeps = {
    gather: async () => state,
    replaceAll: async (s) => {
      replaced.push({ works: s.works })
    },
    createRemote: async (plaintext) => {
      created.push(plaintext)
      const id = `${created.length}`
      remote.set(id, plaintext)
      return { id, createdAt: created.length }
    },
    putLiveRemote: async (plaintext) => {
      live.push(plaintext)
      return true
    },
    listRemote: async () =>
      [...remote.keys()].map((id) => ({ id, createdAt: Number(id), size: 0 })),
    getRemote: async (id) => remote.get(id) ?? null,
    deleteRemote: async (id) => remote.delete(id),
    now: () => 100,
    ...over,
  }
  return { deps, created, live, replaced, remote, state }
}

describe('createBackupService', () => {
  it('pushLive は現在の全状態をライブスナップショットに上書きする（版は作らない）', async () => {
    const { deps, live, created } = makeDeps()
    const svc = createBackupService(deps)
    await svc.pushLive()
    expect(JSON.parse(live[0] ?? '{}').works[0].id).toBe('a')
    expect(created).toHaveLength(0) // 版バックアップは作らない
  })

  it('backupNow は現在の全状態を直列化して保存する', async () => {
    const { deps, created } = makeDeps()
    const svc = createBackupService(deps)
    const res = await svc.backupNow()
    expect(res?.id).toBe('1')
    expect(JSON.parse(created[0] ?? '{}').works[0].id).toBe('a')
  })

  it('復元は既定では安全退避しない（バックアップを増やさない）', async () => {
    const target = serializeBackup(
      { works: [work('restored')], trash: [], profile: {}, activity: [] },
      50,
    )
    const { deps, created, replaced, remote } = makeDeps()
    remote.set('target', target)

    const svc = createBackupService(deps)
    const ok = await svc.restore('target')

    expect(ok).toBe(true)
    expect(created).toHaveLength(0) // 安全退避（作成）は起きない
    expect(replaced[0]?.works.map((w) => w.id)).toEqual(['restored']) // 全置換はする
  })

  it('復元は執筆活動（activity）もローカルへ全置換する', async () => {
    const day = { date: '2026-07-11', added: 40, removed: 0, net: 40, saves: 1, updatedAt: 9 }
    const target = serializeBackup(
      { works: [work('r')], trash: [], profile: {}, activity: [day] },
      50,
    )
    let restored: unknown
    const { deps, remote } = makeDeps({
      replaceAll: async (s) => {
        restored = s.activity
      },
    })
    remote.set('target', target)
    await createBackupService(deps).restore('target')
    expect(restored).toEqual([day])
  })

  it('backupCurrent:true のときだけ、置換前に現在を安全退避してから全置換する', async () => {
    const target = serializeBackup(
      { works: [work('restored')], trash: [], profile: {}, activity: [] },
      50,
    )
    const { deps, created, replaced, remote } = makeDeps()
    remote.set('target', target)

    const svc = createBackupService(deps)
    await svc.restore('target', { backupCurrent: true })

    // 置換前に現在（works=[a]）を安全退避している。
    expect(JSON.parse(created[0] ?? '{}').works[0].id).toBe('a')
    expect(replaced[0]?.works.map((w) => w.id)).toEqual(['restored'])
  })

  it('壊れたバックアップは検証で弾き、全置換しない（データ保護）', async () => {
    const { deps, replaced, remote } = makeDeps()
    remote.set('broken', '{"version":999}') // スキーマ不正
    const svc = createBackupService(deps)
    await expect(svc.restore('broken')).rejects.toThrow()
    expect(replaced).toHaveLength(0) // 置換は起きていない
  })

  it('取得できない（null）なら false・全置換しない', async () => {
    const { deps, replaced } = makeDeps({ getRemote: async () => null })
    const svc = createBackupService(deps)
    expect(await svc.restore('missing')).toBe(false)
    expect(replaced).toHaveLength(0)
  })

  it('list / remove を委譲する', async () => {
    const del = vi.fn(async () => true)
    const { deps, remote } = makeDeps({ deleteRemote: del })
    remote.set('x', '{}')
    const svc = createBackupService(deps)
    expect((await svc.list()).map((b) => b.id)).toContain('x')
    await svc.remove('x')
    expect(del).toHaveBeenCalledWith('x')
  })
})
