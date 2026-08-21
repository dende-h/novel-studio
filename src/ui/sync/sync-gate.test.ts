import { describe, expect, it } from 'vitest'
import { isSyncSuspended, syncEpoch, withSyncSuspended } from './sync-gate'

describe('sync-gate（全置換と自動同期の排他）', () => {
  it('区間の開始で世代が進み、中は suspended、終了でまた進む', async () => {
    const before = syncEpoch()
    expect(isSyncSuspended()).toBe(false)

    let inside: { epoch: number; suspended: boolean } | null = null
    await withSyncSuspended(async () => {
      inside = { epoch: syncEpoch(), suspended: isSyncSuspended() }
    })

    expect(inside).toEqual({ epoch: before + 1, suspended: true })
    expect(isSyncSuspended()).toBe(false)
    expect(syncEpoch()).toBe(before + 2)
  })

  it('例外が出ても保留は必ず解除される（同期が永久停止しない）', async () => {
    await expect(
      withSyncSuspended(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(isSyncSuspended()).toBe(false)
  })

  it('入れ子でも、いちばん外側が終わるまで suspended のまま', async () => {
    await withSyncSuspended(async () => {
      await withSyncSuspended(async () => {})
      expect(isSyncSuspended()).toBe(true) // 内側が終わっても外側が生きている
    })
    expect(isSyncSuspended()).toBe(false)
  })
})
