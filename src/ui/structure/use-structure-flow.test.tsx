import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '@/core/storage/memoryStore'
import { StructureRepository } from '@/core/storage/structureRepository'
import type { Structure } from '@/core/structure'
import { announceSyncApplied } from '@/ui/sync/sync-touch'
import { useStructureFlow } from './use-structure-flow'

/**
 * 相関図（useStructureFlow）の同期まわりの回帰テスト：
 * - 「開いただけ」で updatedAt を刻印して保存しない（LWW で他端末の実編集に勝ってしまう事故の再発防止）
 * - 同期の pull 適用通知（sync-applied）で、未保存編集が無ければ開いたまま反映する
 */

const chart = (over: Partial<Structure> = {}): Structure => ({
  id: 'w1:chart',
  workId: 'w1',
  kind: 'chart',
  nodes: [{ id: 'n1', kind: 'character', label: '主人公' }],
  edges: [],
  updatedAt: 100,
  ...over,
})

function makeRepo(seed?: Structure) {
  const store = new MemoryStore()
  const repo = new StructureRepository(
    store,
    () => 'gen',
    () => 999_999,
  )
  const save = vi.spyOn(repo, 'save')
  if (seed) void repo.put(seed)
  return { repo, save }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useStructureFlow と同期', () => {
  it('開いただけ（内容不変）では保存しない＝updatedAt を刻印しない', async () => {
    const { repo, save } = makeRepo(chart())
    const { result } = renderHook(() => useStructureFlow(repo, 'w1', 'chart'))
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result.current.ready).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(save).not.toHaveBeenCalled()
    expect((await repo.get('w1:chart'))?.updatedAt).toBe(100) // 時計は進んでいない
  })

  it('実際に編集したときは保存する', async () => {
    const { repo, save } = makeRepo(chart())
    const { result } = renderHook(() => useStructureFlow(repo, 'w1', 'chart'))
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    act(() => {
      result.current.setNodeLabel('n1', '改名した主人公')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect((await repo.get('w1:chart'))?.nodes[0]?.label).toBe('改名した主人公')
  })

  it('同期の pull 適用通知で、未保存編集が無ければ開いたまま反映する', async () => {
    const { repo } = makeRepo(chart())
    const { result } = renderHook(() => useStructureFlow(repo, 'w1', 'chart'))
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // 別端末の編集が pull で IDB に入った体（updatedAt が前進）
    await act(async () => {
      await repo.put(
        chart({
          nodes: [{ id: 'n1', kind: 'character', label: '別端末の改名' }],
          updatedAt: 500,
        }),
      )
      announceSyncApplied()
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve() // 反映の async 処理を flush（fake timers 下では waitFor が使えない）
    })

    expect(result.current.nodes[0]?.data.label).toBe('別端末の改名')
  })
})
