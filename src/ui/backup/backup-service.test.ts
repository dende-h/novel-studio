import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { type BackupState, deserializeBackup, serializeBackup } from '@/core/backup'
import type { Work } from '@/core/schema'
import { isSyncSuspended, syncEpoch } from '@/ui/sync/sync-gate'
import {
  type BackupDeps,
  createBackupService,
  createLocalBackupIO,
  createLocalBackupService,
} from './backup-service'

const work = (id: string): Work => ({ id, title: id, episodes: [], updatedAt: 1 })

function makeDeps(over: Partial<BackupDeps> = {}) {
  const state = {
    works: [work('a')],
    trash: [],
    profile: { penName: 'p' },
    activity: [],
    ideas: [],
    structures: [],
    plots: [],
  }
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
      remote.set('live', plaintext)
      return 'ok' as const
    },
    getLiveRemote: async () => remote.get('live') ?? null,
    getLiveMeta: async () =>
      remote.has('live') ? { exists: true, aiEditedAt: 1234 } : { exists: false, aiEditedAt: null },
    listRemote: async () =>
      [...remote.keys()].map((id) => ({ id, createdAt: Number(id), size: 0 })),
    getRemote: async (id) => remote.get(id) ?? null,
    deleteRemote: async (id) => remote.delete(id),
    now: () => 100,
    ...over,
  }
  return { deps, created, live, replaced, remote, state }
}

describe('createLocalBackupService（ローカル・ファイルバックアップ）', () => {
  const io = (state: BackupState, onReplace?: (s: BackupState) => void) => ({
    gather: async () => state,
    replaceAll: async (s: BackupState) => {
      onReplace?.(s)
    },
  })

  it('exportPlaintext は現在の全状態を CloudBackup 形式 JSON にする', async () => {
    const state: BackupState = {
      works: [work('a')],
      trash: [],
      profile: { penName: 'p' },
      activity: [],
      ideas: [{ id: 'i1', text: 'ネタ', createdAt: 1, updatedAt: 1 }],
      structures: [],
      plots: [],
    }
    const svc = createLocalBackupService(io(state), () => 999)
    const back = deserializeBackup(await svc.exportPlaintext())
    expect(back.createdAt).toBe(999)
    expect(back.works.map((w) => w.id)).toEqual(['a'])
    expect(back.ideas.map((i) => i.id)).toEqual(['i1'])
  })

  it('restorePlaintext は JSON を全状態へ復元し replaceAll に渡す', async () => {
    let restored: BackupState | undefined
    const empty: BackupState = {
      works: [],
      trash: [],
      profile: {},
      activity: [],
      ideas: [],
      structures: [],
      plots: [],
    }
    const svc = createLocalBackupService(
      io(empty, (s) => {
        restored = s
      }),
    )
    const json = serializeBackup(
      {
        works: [work('r')],
        trash: [],
        profile: {},
        activity: [],
        ideas: [{ id: 'i2', text: 'x', createdAt: 2, updatedAt: 2 }],
        plots: [
          {
            id: 'pl1',
            workId: 'w1',
            title: '本編プロット',
            sections: [{ id: 'sec1', title: '第一幕', beatIds: ['b1'] }],
            beats: [
              {
                id: 'b1',
                title: '出会い',
                castRefs: [],
                placeRefs: [],
                lineRefs: [],
                status: 'idea',
              },
            ],
            lines: [],
            foreshadows: [],
            secrets: [{ id: 's1', title: 'ユキの正体', truth: '管理AI' }],
            world: [{ id: 'n1', slot: 'rules', body: '死者は生き返らない', updatedAt: 4 }],
            updatedAt: 4,
          },
        ],
        structures: [
          { id: 'st1', workId: 'w1', kind: 'chart', nodes: [], edges: [], updatedAt: 3 },
        ],
      },
      5,
    )
    await svc.restorePlaintext(json)
    expect(restored?.works.map((w) => w.id)).toEqual(['r'])
    expect(restored?.ideas.map((i) => i.id)).toEqual(['i2'])
    // 構造データ（アウトライン／相関図／マインドマップ）
    expect(restored?.structures.map((s) => s.id)).toEqual(['st1'])
    // プロット。ビート・秘密の真相・世界観設定まで、中身ごと戻ること
    expect(restored?.plots[0]).toMatchObject({
      id: 'pl1',
      beats: [{ id: 'b1', title: '出会い' }],
      secrets: [{ id: 's1', truth: '管理AI' }],
      world: [{ slot: 'rules', body: '死者は生き返らない' }],
    })
  })

  it('restorePlaintext は壊れた JSON で throw する', async () => {
    const empty: BackupState = {
      works: [],
      trash: [],
      profile: {},
      activity: [],
      ideas: [],
      structures: [],
      plots: [],
    }
    await expect(createLocalBackupService(io(empty)).restorePlaintext('not json')).rejects.toThrow()
  })
})

describe('createBackupService', () => {
  it('pushLive は現在の全状態をライブスナップショットに上書きする（版は作らない）', async () => {
    const { deps, live, created } = makeDeps()
    const svc = createBackupService(deps)
    await svc.pushLive()
    expect(JSON.parse(live[0] ?? '{}').works[0].id).toBe('a')
    expect(created).toHaveLength(0) // 版バックアップは作らない
  })

  it('pushLive は未取り込みの AI 編集があると ai_edit_pending を返す（AI の成果を守る）', async () => {
    const { deps } = makeDeps({ putLiveRemote: async () => 'ai_edit_pending' as const })
    expect(await createBackupService(deps).pushLive()).toBe('ai_edit_pending')
  })

  it('pullLive は取り込み後に force で目印を消す（自動 push を通常運転へ戻す）', async () => {
    const forced: Array<boolean | undefined> = []
    const { deps, remote } = makeDeps({
      putLiveRemote: async (_plaintext, opts) => {
        forced.push(opts?.force)
        return 'ok' as const
      },
    })
    remote.set(
      'live',
      serializeBackup(
        {
          works: [work('L')],
          trash: [],
          profile: {},
          activity: [],
          ideas: [],
          structures: [],
          plots: [],
        },
        5,
      ),
    )
    await createBackupService(deps).pullLive()
    expect(forced).toEqual([true])
  })

  it('pullLive はライブを取り込み全置換する（無ければ false）', async () => {
    const { deps, replaced, remote } = makeDeps()
    remote.set(
      'live',
      serializeBackup(
        {
          works: [work('L')],
          trash: [],
          profile: {},
          activity: [],
          ideas: [],
          structures: [],
          plots: [],
        },
        5,
      ),
    )
    const svc = createBackupService(deps)
    expect(await svc.pullLive()).toBe(true)
    expect(replaced[0]?.works.map((w) => w.id)).toEqual(['L'])

    const { deps: empty } = makeDeps()
    expect(await createBackupService(empty).pullLive()).toBe(false)
  })

  it('pullLive({backupCurrent:true}) は取り込み前に現在の状態を退避してから全置換する', async () => {
    const { deps, created, replaced, remote } = makeDeps()
    remote.set(
      'live',
      serializeBackup(
        {
          works: [work('L')],
          trash: [],
          profile: {},
          activity: [],
          ideas: [],
          structures: [],
          plots: [],
        },
        5,
      ),
    )
    await createBackupService(deps).pullLive({ backupCurrent: true })
    // 置換前に現在（works=[a]）を安全退避している。
    expect(JSON.parse(created[0] ?? '{}').works[0].id).toBe('a')
    expect(replaced[0]?.works.map((w) => w.id)).toEqual(['L'])
  })

  it('liveInfo はライブの有無と AI 最終編集時刻を返す', async () => {
    const { deps, remote } = makeDeps()
    expect(await createBackupService(deps).liveInfo()).toEqual({ exists: false, aiEditedAt: null })
    remote.set('live', '{}')
    expect(await createBackupService(deps).liveInfo()).toEqual({ exists: true, aiEditedAt: 1234 })
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
      {
        works: [work('restored')],
        trash: [],
        profile: {},
        activity: [],
        ideas: [],
        structures: [],
        plots: [],
      },
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
      {
        works: [work('r')],
        trash: [],
        profile: {},
        activity: [day],
        ideas: [],
        structures: [],
        plots: [],
      },
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

  it('復元はネタ帳（ideas）もローカルへ全置換する', async () => {
    const note = { id: 'i1', text: 'ネタ', createdAt: 5, updatedAt: 5 }
    const target = serializeBackup(
      {
        works: [work('r')],
        trash: [],
        profile: {},
        activity: [],
        ideas: [note],
        structures: [],
        plots: [],
      },
      50,
    )
    let restored: unknown
    const { deps, remote } = makeDeps({
      replaceAll: async (s) => {
        restored = s.ideas
      },
    })
    remote.set('target', target)
    await createBackupService(deps).restore('target')
    expect(restored).toEqual([note])
  })

  it('backupCurrent:true のときだけ、置換前に現在を安全退避してから全置換する', async () => {
    const target = serializeBackup(
      {
        works: [work('restored')],
        trash: [],
        profile: {},
        activity: [],
        ideas: [],
        structures: [],
        plots: [],
      },
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

describe('全置換（復元・AI の変更の取り込み）は自動同期と排他で走る', () => {
  it('createLocalBackupIO の replaceAll は sync-gate の中で実行される', async () => {
    const io = createLocalBackupIO()
    const before = syncEpoch()
    const running = io.replaceAll({
      works: [],
      trash: [],
      profile: {},
      activity: [],
      ideas: [],
      structures: [],
      plots: [],
    })
    // 置換の最中は保留＝走っている reconcile が base を書き戻さない（誤 purge の防止）。
    expect(isSyncSuspended()).toBe(true)
    await running
    expect(isSyncSuspended()).toBe(false)
    expect(syncEpoch()).toBe(before + 2) // 開始と終了で世代が進む＝実行中の同期は stale になる
  })
})
