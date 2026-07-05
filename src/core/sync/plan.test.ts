import { describe, expect, it } from 'vitest'
import type { ManifestEntry } from './manifest'
import { type LocalEntry, planAutosavePush, planLoginSync } from './plan'

const local = (over: Partial<LocalEntry> = {}): LocalEntry => ({
  workId: 'w1',
  updatedAt: 10,
  docHash: 'd',
  mediaHash: '',
  ...over,
})

const remote = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  workId: 'w1',
  updatedAt: 10,
  deleted: false,
  docHash: 'd',
  mediaHash: '',
  size: 0,
  ...over,
})

const EMPTY_PLAN = {
  toPull: [],
  toPush: [],
  toTrashLocal: [],
  toRestoreLocal: [],
  toPushTrash: [],
  snapshotBeforePull: [],
}

describe('planLoginSync（ログイン時の全双方向計画）', () => {
  it('ローカルのみ → push', () => {
    const plan = planLoginSync([local()], [])
    expect(plan.toPush).toEqual(['w1'])
    expect(plan.toPull).toEqual([])
  })

  it('リモートのみ（生存）→ pull', () => {
    const plan = planLoginSync([], [remote()])
    expect(plan.toPull).toEqual(['w1'])
    expect(plan.toPush).toEqual([])
  })

  it('リモートのみ・削除済み → 何もしない', () => {
    const plan = planLoginSync([], [remote({ deleted: true })])
    expect(plan).toEqual(EMPTY_PLAN)
  })

  it('両方あり・ハッシュ一致 → 何もしない', () => {
    const plan = planLoginSync([local()], [remote()])
    expect(plan).toEqual(EMPTY_PLAN)
  })

  it('両方あり・remote が新しく内容差 → pull＋退避', () => {
    const plan = planLoginSync(
      [local({ updatedAt: 10, docHash: 'old' })],
      [remote({ updatedAt: 20, docHash: 'new' })],
    )
    expect(plan.toPull).toEqual(['w1'])
    expect(plan.snapshotBeforePull).toEqual(['w1'])
  })

  it('両方あり・local が新しい → push', () => {
    const plan = planLoginSync(
      [local({ updatedAt: 30, docHash: 'new' })],
      [remote({ updatedAt: 20, docHash: 'old' })],
    )
    expect(plan.toPush).toEqual(['w1'])
    expect(plan.toPull).toEqual([])
  })

  it('両方あり・remote 削除済み・local が古い → ローカルもゴミ箱へ', () => {
    const plan = planLoginSync(
      [local({ updatedAt: 10 })],
      [remote({ deleted: true, updatedAt: 20 })],
    )
    expect(plan.toTrashLocal).toEqual(['w1'])
  })

  it('両方あり・remote 削除済み・local が新しい → push（復活）', () => {
    const plan = planLoginSync(
      [local({ updatedAt: 30 })],
      [remote({ deleted: true, updatedAt: 20 })],
    )
    expect(plan.toPush).toEqual(['w1'])
    expect(plan.toTrashLocal).toEqual([])
  })

  it('複数 Work を分類できる', () => {
    const plan = planLoginSync(
      [local({ workId: 'a' }), local({ workId: 'b', updatedAt: 30, docHash: 'new' })],
      [remote({ workId: 'b', updatedAt: 20, docHash: 'old' }), remote({ workId: 'c' })],
    )
    expect(plan.toPush.sort()).toEqual(['a', 'b'])
    expect(plan.toPull).toEqual(['c'])
  })
})

describe('planLoginSync（ゴミ箱状態の同期＝共有ゴミ箱）', () => {
  // trashed のローカルは updatedAt に trashedAt（ゴミ箱へ入れた時刻）を入れて渡す規約。
  const trashedLocal = (at: number, over: Partial<LocalEntry> = {}): LocalEntry =>
    local({ trashedAt: at, updatedAt: at, docHash: '', ...over })

  it('【回帰の核】別端末で削除→pull で復活しない：ローカル trashed（新）→ サーバへ trash 伝播', () => {
    const plan = planLoginSync([trashedLocal(20)], [remote({ updatedAt: 10 })])
    expect(plan.toPushTrash).toEqual(['w1'])
    expect(plan.toPull).toEqual([]) // ← 旧実装ではここが ['w1']（復活）だった
    expect(plan.toTrashLocal).toEqual([])
  })

  it('リモートが trashed・ローカル active（古い）→ ローカルもゴミ箱へ（削除の伝播）', () => {
    const plan = planLoginSync(
      [local({ updatedAt: 10 })],
      [remote({ updatedAt: 20, trashedAt: 20 })],
    )
    expect(plan.toTrashLocal).toEqual(['w1'])
    expect(plan.toPull).toEqual([])
  })

  it('リモートが trashed・ローカル active の編集が新しい → 復活（push で active 化）', () => {
    const plan = planLoginSync(
      [local({ updatedAt: 30, docHash: 'new' })],
      [remote({ updatedAt: 20, trashedAt: 20 })],
    )
    expect(plan.toPush).toEqual(['w1'])
    expect(plan.toTrashLocal).toEqual([])
  })

  it('ローカル trashed・リモート active が新しい（他端末で復元/編集）→ ローカルを復元', () => {
    const plan = planLoginSync([trashedLocal(10)], [remote({ updatedAt: 20 })])
    expect(plan.toRestoreLocal).toEqual(['w1'])
    expect(plan.toPushTrash).toEqual([])
  })

  it('両方 trashed → 何もしない', () => {
    const plan = planLoginSync([trashedLocal(20)], [remote({ updatedAt: 20, trashedAt: 20 })])
    expect(plan).toEqual(EMPTY_PLAN)
  })

  it('ローカルのみ trashed（未同期のゴミ箱）→ 何もしない（push しない）', () => {
    const plan = planLoginSync([trashedLocal(20)], [])
    expect(plan).toEqual(EMPTY_PLAN)
  })

  it('リモートのみ trashed（手元に無い）→ materialize しない', () => {
    const plan = planLoginSync([], [remote({ updatedAt: 20, trashedAt: 20 })])
    expect(plan).toEqual(EMPTY_PLAN)
  })

  it('リモート purged・ローカル trashed → ローカル TTL に任せる（何もしない）', () => {
    const plan = planLoginSync([trashedLocal(10)], [remote({ deleted: true, updatedAt: 20 })])
    expect(plan).toEqual(EMPTY_PLAN)
  })
})

describe('planAutosavePush（変わったパートだけ push）', () => {
  it('未同期（lastSynced=null）→ doc を push', () => {
    expect(planAutosavePush({ docHash: 'd', mediaHash: '' }, null)).toEqual({
      shouldPush: true,
      parts: ['doc'],
    })
  })

  it('変化なし → push しない', () => {
    const h = { docHash: 'd', mediaHash: 'm' }
    expect(planAutosavePush(h, h)).toEqual({ shouldPush: false, parts: [] })
  })

  it('media だけ変わった → media を push', () => {
    expect(
      planAutosavePush({ docHash: 'd', mediaHash: 'm2' }, { docHash: 'd', mediaHash: 'm1' }),
    ).toEqual({
      shouldPush: true,
      parts: ['media'],
    })
  })

  it('両方変わった → doc・media を push', () => {
    expect(
      planAutosavePush({ docHash: 'd2', mediaHash: 'm2' }, { docHash: 'd1', mediaHash: 'm1' }),
    ).toEqual({
      shouldPush: true,
      parts: ['doc', 'media'],
    })
  })
})
