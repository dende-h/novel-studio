// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '@/core/storage/memoryStore'
import { ProofreadRepository } from '@/core/storage/proofreadRepository'
import { subscribeSyncTouch, touchSync, withSyncTouch } from './sync-touch'

/**
 * withSyncTouch の契約：指定した変更系メソッドが**完了した後**にだけ sync-touch を鳴らす。
 * Root は推敲の判断の repo を `withSyncTouch(repo, ['save', 'remove', 'removeByWork'])` で包み、
 * 判断だけの変更でも同期の送信と自動バックアップの静止判定が動くようにする（COT-40 FR-5）。
 */

const record = (workId: string, episodeId: string) => ({
  workId,
  episodeId,
  decisions: [
    {
      blockId: 'b1',
      code: 'variant',
      text: '出来る',
      nth: 0,
      anchor: 'contains',
      verdict: 'fix',
      decidedAt: 1,
    },
  ],
  updatedAt: 1,
})

const unsubs: Array<() => void> = []
afterEach(() => {
  for (const u of unsubs.splice(0)) u()
})
const listen = () => {
  const listener = vi.fn()
  unsubs.push(subscribeSyncTouch(listener))
  return listener
}

describe('withSyncTouch（Repository の変更を同期へ通知する包み）', () => {
  it('推敲の判断の save・remove・removeByWork は、完了後に sync-touch のリスナーを呼ぶ', async () => {
    const inner = new ProofreadRepository(new MemoryStore())
    const repo = withSyncTouch(inner, ['save', 'remove', 'removeByWork'])
    const listener = listen()

    await repo.save(record('w1', 'e1'))
    expect(listener).toHaveBeenCalledTimes(1)
    // 通知の時点で保存は終わっている（購読側が読み直すと新しい判断が見える）
    expect(await inner.get('w1', 'e1')).toBeDefined()

    await repo.remove('w1', 'e1')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(await inner.get('w1', 'e1')).toBeUndefined()

    await repo.removeByWork('w1')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('指定していないメソッド（読み出し）は鳴らさず、そのまま結果を返す', async () => {
    const inner = new ProofreadRepository(new MemoryStore())
    await inner.save(record('w1', 'e1'))
    const repo = withSyncTouch(inner, ['save'])
    const listener = listen()

    expect(await repo.get('w1', 'e1')).toEqual(record('w1', 'e1'))
    expect(await repo.list()).toHaveLength(1)
    await repo.put(record('w1', 'e2')) // put は同期の pull 用。包みの対象外
    expect(listener).not.toHaveBeenCalled()
  })

  it('包んだメソッドの戻り値をそのまま返す', async () => {
    const target = { add: async (a: number, b: number) => a + b }
    const wrapped = withSyncTouch(target, ['add'])
    const listener = listen()
    expect(await wrapped.add(1, 2)).toBe(3)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('失敗したメソッドは鳴らさず、例外をそのまま伝える', async () => {
    const target = {
      save: async () => {
        throw new Error('書けない')
      },
    }
    const wrapped = withSyncTouch(target, ['save'])
    const listener = listen()
    await expect(wrapped.save()).rejects.toThrow('書けない')
    expect(listener).not.toHaveBeenCalled()
  })

  it('複数のリスナーに届き、解除したリスナーには届かない', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeSyncTouch(a)
    unsubs.push(subscribeSyncTouch(b))
    touchSync()
    offA()
    touchSync()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })
})
