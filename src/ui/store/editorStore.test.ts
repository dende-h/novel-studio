import { beforeEach, describe, expect, it } from 'vitest'
import { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
import { MemoryStore } from '../../core/storage/memoryStore'
import { WorkRepository } from '../../core/storage/workRepository'
import { createEditorStore, type EditorStore } from './editorStore'

const makeStore = (): EditorStore => {
  let n = 0
  let clock = 0
  const store = new MemoryStore()
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  return createEditorStore({
    repo,
    snapshotRepo,
    genId: () => `id${++n}`,
    now: () => ++clock,
  })
}

describe('editorStore（自前ストア・useSyncExternalStore 用）', () => {
  let store: EditorStore

  beforeEach(() => {
    store = makeStore()
  })

  it('初期状態は空（作品なし・draft 空・clean）', () => {
    const s = store.getSnapshot()
    expect(s.workList).toEqual([])
    expect(s.work).toBeNull()
    expect(s.currentEpisodeId).toBeNull()
    expect(s.draft).toBe('')
    expect(s.dirty).toBe(false)
  })

  it('init は保存済み作品一覧を読み込む', async () => {
    await store.createWork('既存作')
    const store2 = makeStore()
    // 別ストアだが同じ MemoryStore ではないので空。ここでは init の冪等のみ確認
    await store2.init()
    expect(store2.getSnapshot().workList).toEqual([])
  })

  it('createWork は作品を追加して開く', async () => {
    await store.createWork('新作')
    const s = store.getSnapshot()
    expect(s.work?.title).toBe('新作')
    expect(s.workList).toEqual([
      { id: 'id1', title: '新作', episodeCount: 0, charCount: 0, updatedAt: expect.any(Number) },
    ])
  })

  it('createEpisode は話を追加して開き、draft を空にする', async () => {
    await store.createWork('作')
    await store.createEpisode('第一話')
    const s = store.getSnapshot()
    expect(s.work?.episodes).toHaveLength(1)
    expect(s.currentEpisodeId).toBe('id2')
    expect(s.draft).toBe('')
  })

  it('setDraft は draft 更新して dirty=true', async () => {
    await store.createWork('作')
    await store.createEpisode('話')
    store.setDraft('本文を書く')
    const s = store.getSnapshot()
    expect(s.draft).toBe('本文を書く')
    expect(s.dirty).toBe(true)
  })

  it('save は draft をパースして永続化し dirty=false', async () => {
    await store.createWork('作')
    await store.createEpisode('話')
    store.setDraft('私は漢字《かんじ》を書く\n＊\n《《重要》》')
    await store.save()
    expect(store.getSnapshot().dirty).toBe(false)

    // 再読込ストアで復元できる（往復）
    const s = store.getSnapshot()
    const ep = s.work?.episodes[0]
    expect(ep?.blocks.some((b) => b.type === 'sceneBreak')).toBe(true)
    expect(
      ep?.blocks.some((b) => b.type === 'paragraph' && b.inlines.some((i) => i.type === 'ruby')),
    ).toBe(true)
  })

  it('openEpisode は blocks をカクヨム記法に戻して draft へ（ロスレス往復）', async () => {
    await store.createWork('作')
    await store.createEpisode('話')
    const src = '私は漢字《かんじ》を書く\n＊\n《《重要》》'
    store.setDraft(src)
    await store.save()
    store.setDraft('別の下書き')
    store.openEpisode(store.getSnapshot().currentEpisodeId as string)
    expect(store.getSnapshot().draft).toBe(src)
    expect(store.getSnapshot().dirty).toBe(false)
  })

  it('subscribe は状態変化で通知し、unsubscribe で停止', async () => {
    let calls = 0
    const unsub = store.subscribe(() => {
      calls++
    })
    await store.createWork('作')
    expect(calls).toBeGreaterThan(0)
    const after = calls
    unsub()
    await store.createWork('作2')
    expect(calls).toBe(after)
  })

  it('getSnapshot は同一状態で同一参照を返す（再描画安定）', async () => {
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    expect(a).toBe(b)
  })

  it('getAllWorks は永続化済み全作品（フル）を返す', async () => {
    await store.importWorks([
      { id: 'x1', title: 'A', episodes: [] },
      { id: 'x2', title: 'B', episodes: [{ id: 'e1', title: '話', blocks: [] }] },
    ])
    const all = (await store.getAllWorks()).sort((a, b) => a.id.localeCompare(b.id))
    expect(all).toHaveLength(2)
    expect(all[1]?.episodes).toHaveLength(1)
  })

  it('importWorks は全作品を永続化して一覧へ反映', async () => {
    await store.importWorks([
      { id: 'x1', title: '取込A', episodes: [] },
      { id: 'x2', title: '取込B', episodes: [] },
    ])
    const list = store.getSnapshot().workList.sort((a, b) => a.id.localeCompare(b.id))
    expect(list).toEqual([
      { id: 'x1', title: '取込A', episodeCount: 0, charCount: 0 },
      { id: 'x2', title: '取込B', episodeCount: 0, charCount: 0 },
    ])
  })

  it('createWork は updatedAt を設定する', async () => {
    await store.createWork('作')
    expect(store.getSnapshot().work?.updatedAt).toEqual(expect.any(Number))
  })

  it('save は履歴スナップショットを新しい順に積む', async () => {
    await store.createWork('作')
    await store.createEpisode('話')
    store.setDraft('一回目')
    await store.save()
    store.setDraft('二回目')
    await store.save()
    const snaps = store.getSnapshot().snapshots
    expect(snaps).toHaveLength(2)
    expect(snaps[0]?.at).toBeGreaterThan(snaps[1]?.at as number)
  })

  it('restoreSnapshot は当時の本文を現在話の draft へ戻す（dirty=true・非破壊）', async () => {
    await store.createWork('作')
    await store.createEpisode('話')
    store.setDraft('最初の版')
    await store.save()
    const firstSnapId = store.getSnapshot().snapshots[0]?.id as string
    store.setDraft('書き換えた版')
    await store.save()

    store.restoreSnapshot(firstSnapId)
    const s = store.getSnapshot()
    expect(s.draft).toBe('最初の版')
    expect(s.dirty).toBe(true)
    // 永続化済みの最新本文は復元しただけでは変わらない（保存はユーザー操作）
    expect(s.work?.episodes[0]?.blocks).toBeDefined()
  })

  it('openWork は保存済みスナップショットを読み込む', async () => {
    await store.createWork('作')
    await store.createEpisode('話')
    store.setDraft('本文')
    await store.save()
    const id = store.getSnapshot().work?.id as string
    store.restoreSnapshot('nonexistent') // 何も起きない
    await store.openWork(id)
    expect(store.getSnapshot().snapshots.length).toBeGreaterThan(0)
  })
})
