import { describe, expect, it, vi } from 'vitest'
import { blocksToNotation } from '../../core/exporter/blocksToNotation'
import { ProfileRepository } from '../../core/profile'
import { searchWork } from '../../core/search/workSearch'
import { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
import { ActivityRepository } from '../../core/storage/activityRepository'
import { MemoryStore } from '../../core/storage/memoryStore'
import { WorkRepository } from '../../core/storage/workRepository'
import { createEditorStore } from './editorStore'

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture')
  return value
}

async function fixture() {
  const kv = new MemoryStore()
  const repo = new WorkRepository(kv)
  const snapshotRepo = new SnapshotRepository(kv)
  const activityRepo = new ActivityRepository(kv)
  let id = 0
  let clock = 0
  const store = createEditorStore({
    repo,
    snapshotRepo,
    activityRepo,
    profileRepo: new ProfileRepository(kv),
    genId: () => `search-${++id}`,
    now: () => ++clock,
    snapshotMinIntervalMs: 60000,
    trashTtlMs: 1e9,
  })
  await store.createWork('作品')
  await store.createEpisode('一話')
  store.setDraft('猫 猫')
  await store.save()
  await store.createEpisode('二話')
  store.setDraft('猫😀猫')
  await store.save()
  return { store, repo, snapshotRepo, activityRepo }
}
const request = (store: Awaited<ReturnType<typeof fixture>>['store']) => ({
  workId: required(store.getSnapshot().work).id,
  sources: store.getSearchSources(),
  query: '猫',
  replacement: '犬',
  target: 'all' as const,
})
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('作品全体検索の保存・履歴・競合', () => {
  it('dirtyを履歴/本文へ入れ、単一putで保存し、他欄とblock idを保持する', async () => {
    const { store, repo, snapshotRepo, activityRepo } = await fixture()
    await store.updateWorkMeta(required(store.getSnapshot().work).id, {
      author: '作者',
      description: '説明',
    })
    store.setDraft('猫😀猫 [[猫]]')
    const old = required(store.getSnapshot().work)
    const oldId = required(required(old.episodes[0]).blocks[0]).id
    const save = vi.spyOn(repo, 'saveWork')
    const activity = vi.spyOn(activityRepo, 'record')
    const result = await store.replaceWorkMatches(request(store))
    expect(result).toEqual({ count: 5, committed: true })
    expect(save).toHaveBeenCalledTimes(1)
    expect(activity).toHaveBeenCalledTimes(1)
    const after = store.getSnapshot()
    expect(after.work?.author).toBe('作者')
    expect(after.work?.description).toBe('説明')
    expect(after.work?.episodes[0]?.blocks[0]?.id).toBe(oldId)
    expect(after.draft).toBe('犬😀犬 [[犬]]')
    const snapshots = await snapshotRepo.list(old.id)
    expect(blocksToNotation(required(required(snapshots[0]).work.episodes[1]).blocks)).toBe(
      '猫😀猫 [[猫]]',
    )
    store.setDraft('犬😀犬 [[犬]] 続き')
    await store.save()
    expect(
      blocksToNotation(
        required(required((await snapshotRepo.list(old.id))[1]).work.episodes[1]).blocks,
      ),
    ).toBe('猫😀猫 [[猫]]')
  })
  it('履歴失敗なら本文putせずdraft保持', async () => {
    const { store, repo, snapshotRepo } = await fixture()
    store.setDraft('猫 編集')
    const old = store.getSnapshot().work
    vi.spyOn(snapshotRepo, 'append').mockRejectedValueOnce(new Error('history'))
    const save = vi.spyOn(repo, 'saveWork')
    await expect(store.replaceWorkMatches(request(store))).rejects.toThrow('history')
    expect(save).not.toHaveBeenCalled()
    expect(store.getSnapshot().work).toBe(old)
    expect(store.getSnapshot().draft).toBe('猫 編集')
    expect(store.getSnapshot().workOperation).toBe('idle')
  })
  it('履歴append後の本文失敗でも次のautosaveで置換前履歴を上書きしない', async () => {
    const { store, repo, snapshotRepo } = await fixture()
    store.setDraft('猫 置換前の未保存本文')
    const old = required(store.getSnapshot().work)
    vi.spyOn(repo, 'saveWork').mockRejectedValueOnce(new Error('put/abort'))
    await expect(store.replaceWorkMatches(request(store))).rejects.toThrow('put/abort')
    expect(store.getSnapshot().work).toBe(old)
    expect(store.getSnapshot().draft).toBe('猫 置換前の未保存本文')
    expect(store.getSnapshot().dirty).toBe(true)
    store.setDraft('猫 失敗後に編集')
    await store.save()
    const snapshots = await snapshotRepo.list(old.id)
    expect(blocksToNotation(required(required(snapshots[1]).work.episodes[1]).blocks)).toBe(
      '猫 置換前の未保存本文',
    )
  })
  it('補助処理失敗はcommit済みとして返し、再実行では置換を繰り返さない', async () => {
    const { store, activityRepo } = await fixture()
    const input = request(store)
    vi.spyOn(activityRepo, 'record').mockRejectedValueOnce(new Error('activity'))
    const result = await store.replaceWorkMatches(input)
    expect(result.committed).toBe(true)
    expect(result.warning).toContain('置換は保存しました')
    expect(store.getSnapshot().draft).toBe('犬😀犬')
    await expect(store.replaceWorkMatches(input)).rejects.toThrow('検索し直して')
  })
  it('古い検索と外部本文更新/削除を全内容比較で拒否する', async () => {
    const { store, repo } = await fixture()
    const input = request(store)
    store.setDraft('猫変更')
    await expect(store.replaceWorkMatches(input)).rejects.toThrow('検索し直して')
    const next = request(store)
    const work = required(store.getSnapshot().work)
    await repo.saveWork({ ...work, title: '外部更新', updatedAt: work.updatedAt })
    await expect(store.replaceWorkMatches(next)).rejects.toThrow('検索し直して')
    expect(store.getSnapshot().draft).toBe('猫変更')
    await repo.deleteWork(work.id)
    await expect(store.replaceWorkMatches(next)).rejects.toThrow('検索し直して')
  })
  it('遅いsave完了を待ち、その間のdraft変更も失わない', async () => {
    const { store, repo } = await fixture()
    const gate = deferred()
    const entered = deferred()
    const original = repo.saveWork.bind(repo)
    vi.spyOn(repo, 'saveWork').mockImplementationOnce(async (work) => {
      entered.resolve()
      await gate.promise
      await original(work)
    })
    store.setDraft('猫 先行保存')
    const saving = store.save()
    await entered.promise
    store.setDraft('猫 最新下書き')
    const replacing = store.replaceWorkMatches(request(store))
    expect(store.getSnapshot().workOperation).toBe('replacing')
    store.setDraft('拒否される変更')
    expect(store.getSnapshot().draft).toBe('猫 最新下書き')
    gate.resolve()
    await saving
    await replacing
    expect(store.getSnapshot().draft).toBe('犬 最新下書き')
  })
  it('先行用語集更新の後に古い結果を拒否し、用語集変更を失わない', async () => {
    const { store, repo } = await fixture()
    const gate = deferred()
    const entered = deferred()
    const original = repo.saveWork.bind(repo)
    vi.spyOn(repo, 'saveWork').mockImplementationOnce(async (work) => {
      entered.resolve()
      await gate.promise
      await original(work)
    })
    const adding = store.addGlossaryEntry({ name: '人物' })
    await entered.promise
    const replacing = store.replaceWorkMatches(request(store))
    gate.resolve()
    await adding
    // Search text remains identical; the queued replacement must use the latest metadata.
    await replacing
    expect(store.getSnapshot().work?.glossary?.[0]?.name).toBe('人物')
  })
  it('一致移動はdirtyを保存してから対象話へ移る。保存失敗なら移らない', async () => {
    const { store, repo } = await fixture()
    store.setDraft('猫 未保存')
    const sources = store.getSearchSources()
    const match = required(searchWork(sources, '猫')[0])
    const input = { workId: required(store.getSnapshot().work).id, sources, query: '猫', match }
    const currentId = store.getSnapshot().currentEpisodeId
    vi.spyOn(repo, 'saveWork').mockRejectedValueOnce(new Error('save'))
    await expect(store.navigateWorkMatch(input)).rejects.toThrow('save')
    expect(store.getSnapshot().currentEpisodeId).toBe(currentId)
    expect(store.getSnapshot().draft).toBe('猫 未保存')
    expect(await store.navigateWorkMatch(input)).toEqual({ start: 0, end: 1 })
    expect(store.getSnapshot().currentEpisodeId).toBe(match.episodeId)
    expect(store.getSnapshot().dirty).toBe(false)
  })
  it('同期書き込みが先にロックを取得した後のsave/用語集変更で旧本文を巻き戻さない', async () => {
    const { store, repo } = await fixture()
    const old = required(store.getSnapshot().work)
    store.setDraft('猫 ローカル下書き')
    await repo.saveWork({ ...old, title: '同期されたタイトル' })
    await expect(store.save()).rejects.toThrow('検索し直して')
    await expect(store.addGlossaryEntry({ name: '人物' })).rejects.toThrow('検索し直して')
    expect((await repo.getWork(old.id))?.title).toBe('同期されたタイトル')
    expect(store.getSnapshot().draft).toBe('猫 ローカル下書き')
    expect(store.getSnapshot().dirty).toBe(true)
  })
  it('保存正規化で一致が消えたとき、別の同順位一致へ移動しない', async () => {
    const { store } = await fixture()
    store.setDraft('｜漢字《かんじ》 と ｜かな《よみ》')
    const sources = store.getSearchSources()
    const match = required(
      searchWork(sources, '｜').find((m) => m.episodeId === store.getSnapshot().currentEpisodeId),
    )
    const currentId = store.getSnapshot().currentEpisodeId
    await expect(
      store.navigateWorkMatch({
        workId: required(store.getSnapshot().work).id,
        sources,
        query: '｜',
        match,
      }),
    ).rejects.toThrow('検索し直して')
    expect(store.getSnapshot().currentEpisodeId).toBe(currentId)
  })
  it('一致数が同じでも正規化で前後文脈が変われば移動を中止する', async () => {
    const { store } = await fixture()
    store.setDraft('猫｜漢字《かんじ》')
    const sources = store.getSearchSources()
    const match = required(
      searchWork(sources, '猫').find((m) => m.episodeId === store.getSnapshot().currentEpisodeId),
    )
    await expect(
      store.navigateWorkMatch({
        workId: required(store.getSnapshot().work).id,
        sources,
        query: '猫',
        match,
      }),
    ).rejects.toThrow('検索し直して')
    expect(store.getSnapshot().draft).toBe('猫｜漢字《かんじ》')
  })
  it('1件と無変更を区別し、未変更話を同じ参照で保持する', async () => {
    const { store, snapshotRepo } = await fixture()
    const old = required(store.getSnapshot().work)
    const input = request(store)
    const target = required(searchWork(input.sources, input.query).at(-1))
    await store.replaceWorkMatches({ ...input, target })
    expect(store.getSnapshot().work?.episodes[0]).toBe(old.episodes[0])
    expect(store.getSnapshot().draft).toBe('猫😀犬')
    const snapshots = await snapshotRepo.list(old.id)
    const result = await store.replaceWorkMatches({ ...request(store), replacement: '猫' })
    expect(result).toEqual({ count: 0, committed: false })
    expect(await snapshotRepo.list(old.id)).toEqual(snapshots)
  })
})
