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
    expect(plan).toEqual({ toPull: [], toPush: [], toTrashLocal: [], snapshotBeforePull: [] })
  })

  it('両方あり・ハッシュ一致 → 何もしない', () => {
    const plan = planLoginSync([local()], [remote()])
    expect(plan).toEqual({ toPull: [], toPush: [], toTrashLocal: [], snapshotBeforePull: [] })
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
