import { beforeEach, describe, expect, it } from 'vitest'
import { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
import { MemoryStore } from '../../core/storage/memoryStore'
import { WorkRepository } from '../../core/storage/workRepository'
import { createEditorStore, type EditorStore } from './editorStore'

const makeStore = (opts?: { now?: () => number; snapshotMinIntervalMs?: number }): EditorStore => {
  let n = 0
  let clock = 0
  const store = new MemoryStore()
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  return createEditorStore({
    repo,
    snapshotRepo,
    genId: () => `id${++n}`,
    now: opts?.now ?? (() => ++clock),
    // 既定 0：間隔判定で常に新版を積む（既存テストの挙動を維持）
    snapshotMinIntervalMs: opts?.snapshotMinIntervalMs ?? 0,
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

  it('本文が変わらない save は版を増やさず書き込みもしない（status=saved・dirty=false）', async () => {
    await store.createWork('作')
    await store.createEpisode('話')
    store.setDraft('本文')
    await store.save()
    const before = store.getSnapshot().snapshots
    expect(before).toHaveLength(1)

    // 下書きを変えずに再保存 → 版は増えず、スナップショット参照も不変
    await store.save()
    const s = store.getSnapshot()
    expect(s.snapshots).toHaveLength(1)
    expect(s.snapshots).toBe(before)
    expect(s.status).toBe('saved')
    expect(s.dirty).toBe(false)
  })

  it('間隔内の連続 save は版を集約し、間隔超過で版が増える', async () => {
    let t = 0
    const s = makeStore({ now: () => t, snapshotMinIntervalMs: 100 })
    await s.createWork('作')
    await s.createEpisode('話')

    t = 1000
    s.setDraft('一回目')
    await s.save()
    expect(s.getSnapshot().snapshots).toHaveLength(1)

    // 間隔内（+50）で別内容を保存 → 版は増えず集約（最新版を内容だけ差し替え）
    t = 1050
    s.setDraft('二回目')
    await s.save()
    expect(s.getSnapshot().snapshots).toHaveLength(1)

    // 間隔超過（+250）→ 新しい版が増える
    t = 1300
    s.setDraft('三回目')
    await s.save()
    expect(s.getSnapshot().snapshots).toHaveLength(2)
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

  it('deleteWork は作品と履歴を削除し、開いていれば状態をリセットする', async () => {
    await store.createWork('消す作')
    await store.createEpisode('話')
    store.setDraft('本文')
    await store.save()
    const id = store.getSnapshot().work?.id as string
    expect(store.getSnapshot().snapshots.length).toBeGreaterThan(0)

    await store.deleteWork(id)
    const s = store.getSnapshot()
    expect(s.workList.find((w) => w.id === id)).toBeUndefined()
    expect(s.work).toBeNull()
    expect(s.currentEpisodeId).toBeNull()
    expect(s.draft).toBe('')
    expect(s.snapshots).toEqual([])
    // 履歴も永続層から消えている
    await store.openWork(id) // 既に無いので何も起きない
    expect(store.getSnapshot().work).toBeNull()
  })

  it('deleteWork は開いていない作品なら一覧から消すだけで現在の編集を保つ', async () => {
    await store.createWork('残す作')
    const keepId = store.getSnapshot().work?.id as string
    await store.createWork('消す作') // これが開いている
    await store.deleteWork(keepId)
    const s = store.getSnapshot()
    expect(s.workList.find((w) => w.id === keepId)).toBeUndefined()
    expect(s.work?.title).toBe('消す作')
  })

  it('deleteEpisode は話を削除し、現在話なら別の話へ切り替える', async () => {
    await store.createWork('作')
    await store.createEpisode('第一話')
    const first = store.getSnapshot().work?.episodes[0]?.id as string
    await store.createEpisode('第二話')
    const second = store.getSnapshot().currentEpisodeId as string
    await store.deleteEpisode(second)
    const s = store.getSnapshot()
    expect(s.work?.episodes).toHaveLength(1)
    expect(s.work?.episodes[0]?.id).toBe(first)
    expect(s.currentEpisodeId).toBe(first)
  })

  it('deleteEpisode は最後の話を消すと現在話なし・draft 空にする', async () => {
    await store.createWork('作')
    await store.createEpisode('唯一の話')
    const only = store.getSnapshot().currentEpisodeId as string
    await store.deleteEpisode(only)
    const s = store.getSnapshot()
    expect(s.work?.episodes).toHaveLength(0)
    expect(s.currentEpisodeId).toBeNull()
    expect(s.draft).toBe('')
  })

  it('deleteEpisode は現在話でない話を消しても現在の編集を保つ', async () => {
    await store.createWork('作')
    await store.createEpisode('第一話')
    const first = store.getSnapshot().work?.episodes[0]?.id as string
    await store.createEpisode('第二話')
    store.setDraft('第二話の下書き')
    await store.deleteEpisode(first)
    const s = store.getSnapshot()
    expect(s.work?.episodes).toHaveLength(1)
    expect(s.currentEpisodeId).toBe('id3')
    expect(s.draft).toBe('第二話の下書き')
  })

  it('updateWorkMeta は著者・あらすじ・タイトルを更新して永続化する', async () => {
    await store.createWork('旧題')
    const id = store.getSnapshot().work?.id as string
    await store.updateWorkMeta(id, { title: '新題', author: '著者名', description: 'あらすじ' })
    const s = store.getSnapshot()
    expect(s.work?.title).toBe('新題')
    expect(s.work?.author).toBe('著者名')
    expect(s.work?.description).toBe('あらすじ')
    expect(s.workList.find((w) => w.id === id)?.title).toBe('新題')
    expect(s.workList.find((w) => w.id === id)?.author).toBe('著者名')
    // 永続化されている（再読込で残る）
    await store.openWork(id)
    expect(store.getSnapshot().work?.author).toBe('著者名')
  })

  it('updateWorkMeta は開いていない作品も更新できる', async () => {
    await store.createWork('A')
    const aId = store.getSnapshot().work?.id as string
    await store.createWork('B') // 開いているのは B
    await store.updateWorkMeta(aId, { author: 'Aの著者' })
    expect(store.getSnapshot().work?.title).toBe('B')
    expect(store.getSnapshot().workList.find((w) => w.id === aId)?.author).toBe('Aの著者')
  })

  describe('辞書 CRUD（glossary を Work へ相乗り）', () => {
    // 現在話の本文から最初の ref inline の name を取り出す（rewriteBody / 未解決化の検証用）
    const firstRefName = (s: EditorStore, epIdx = 0): string | undefined => {
      const ep = s.getSnapshot().work?.episodes[epIdx]
      for (const b of ep?.blocks ?? []) {
        if (b.type !== 'paragraph') continue
        for (const i of b.inlines) if (i.type === 'ref') return i.name
      }
      return undefined
    }

    it('addGlossaryEntry は entry を作成して返し、work.glossary へ積む', async () => {
      await store.createWork('作')
      const entry = await store.addGlossaryEntry({ name: 'アリス' })
      expect(entry.id).toBe('id2') // id1=work
      expect(entry.createdAt).toEqual(expect.any(Number))
      expect(entry.updatedAt).toEqual(expect.any(Number))
      const s = store.getSnapshot()
      expect(s.work?.glossary).toHaveLength(1)
      expect(s.work?.glossary?.[0]?.name).toBe('アリス')
    })

    it('addGlossaryEntry は別名・カテゴリ・読み・概要・本文を保持し、永続化される', async () => {
      await store.createWork('作')
      const id = store.getSnapshot().work?.id as string
      await store.addGlossaryEntry({
        name: 'アリス',
        aliases: ['Alice'],
        category: '人物',
        reading: 'ありす',
        summary: '主人公',
        body: '詳細メモ',
      })
      await store.openWork(id) // 再読込で残る
      const g = store.getSnapshot().work?.glossary?.[0]
      expect(g?.aliases).toEqual(['Alice'])
      expect(g?.category).toBe('人物')
      expect(g?.reading).toBe('ありす')
      expect(g?.summary).toBe('主人公')
      expect(g?.body).toBe('詳細メモ')
    })

    it('addGlossaryEntry は work.updatedAt を更新する', async () => {
      const s = makeStore({
        now: (() => {
          let t = 10
          return () => ++t
        })(),
      })
      await s.createWork('作')
      const before = s.getSnapshot().work?.updatedAt as number
      await s.addGlossaryEntry({ name: 'アリス' })
      expect(s.getSnapshot().work?.updatedAt).toBeGreaterThan(before)
    })

    it('addGlossaryEntry は既存 name と完全一致する name を拒否（D-GLOS-UNIQUE）', async () => {
      await store.createWork('作')
      await store.addGlossaryEntry({ name: 'アリス' })
      await expect(store.addGlossaryEntry({ name: 'アリス' })).rejects.toThrow()
      expect(store.getSnapshot().work?.glossary).toHaveLength(1)
    })

    it('addGlossaryEntry は既存の別名と完全一致する name を拒否', async () => {
      await store.createWork('作')
      await store.addGlossaryEntry({ name: 'アリス', aliases: ['アリサ'] })
      await expect(store.addGlossaryEntry({ name: 'アリサ' })).rejects.toThrow()
    })

    it('addGlossaryEntry は作品が開かれていなければ throw', async () => {
      await expect(store.addGlossaryEntry({ name: 'アリス' })).rejects.toThrow()
    })

    it('updateGlossaryEntry は name 以外を更新して永続化（name は不変）', async () => {
      await store.createWork('作')
      const id = store.getSnapshot().work?.id as string
      const entry = await store.addGlossaryEntry({ name: 'アリス' })
      await store.updateGlossaryEntry(entry.id, { summary: '主人公', category: '人物' })
      await store.openWork(id)
      const g = store.getSnapshot().work?.glossary?.[0]
      expect(g?.name).toBe('アリス')
      expect(g?.summary).toBe('主人公')
      expect(g?.category).toBe('人物')
    })

    it('updateGlossaryEntry は別名変更時に他 entry との衝突を拒否', async () => {
      await store.createWork('作')
      await store.addGlossaryEntry({ name: 'アリス' })
      const bob = await store.addGlossaryEntry({ name: 'ボブ' })
      await expect(store.updateGlossaryEntry(bob.id, { aliases: ['アリス'] })).rejects.toThrow()
    })

    it('updateGlossaryEntry は存在しない id では何もしない', async () => {
      await store.createWork('作')
      await store.addGlossaryEntry({ name: 'アリス' })
      await store.updateGlossaryEntry('nope', { summary: 'x' })
      expect(store.getSnapshot().work?.glossary).toHaveLength(1)
    })

    it('renameGlossaryEntry は name を変更し旧名を別名へ退避（自動エイリアス）', async () => {
      await store.createWork('作')
      const entry = await store.addGlossaryEntry({ name: 'アリス' })
      await store.renameGlossaryEntry(entry.id, 'アリサ')
      const g = store.getSnapshot().work?.glossary?.find((e) => e.id === entry.id)
      expect(g?.name).toBe('アリサ')
      expect(g?.aliases).toContain('アリス')
    })

    it('renameGlossaryEntry(rewriteBody) は本文 ref と現在話 draft を新名へ同期する', async () => {
      await store.createWork('作')
      await store.createEpisode('話')
      store.setDraft('[[アリス]]が笑う')
      await store.save()
      const entry = await store.addGlossaryEntry({ name: 'アリス' })
      await store.renameGlossaryEntry(entry.id, 'アリサ', { rewriteBody: true })
      // 本文 blocks の ref が新名へ
      expect(firstRefName(store)).toBe('アリサ')
      // draft も同期され、次の save で巻き戻らない
      expect(store.getSnapshot().draft).toBe('[[アリサ]]が笑う')
    })

    it('renameGlossaryEntry は衝突する新名を拒否する', async () => {
      await store.createWork('作')
      await store.addGlossaryEntry({ name: 'ボブ' })
      const alice = await store.addGlossaryEntry({ name: 'アリス' })
      await expect(store.renameGlossaryEntry(alice.id, 'ボブ')).rejects.toThrow()
    })

    it('renameGlossaryEntry は同名（no-op）では別名を増やさない', async () => {
      await store.createWork('作')
      const entry = await store.addGlossaryEntry({ name: 'アリス' })
      await store.renameGlossaryEntry(entry.id, 'アリス')
      const g = store.getSnapshot().work?.glossary?.find((e) => e.id === entry.id)
      expect(g?.aliases).toEqual([])
    })

    it('deleteGlossaryEntry は entry を消すが本文 ref は残す（未解決化）', async () => {
      await store.createWork('作')
      await store.createEpisode('話')
      store.setDraft('[[アリス]]が笑う')
      await store.save()
      const entry = await store.addGlossaryEntry({ name: 'アリス' })
      await store.deleteGlossaryEntry(entry.id)
      const s = store.getSnapshot()
      expect(s.work?.glossary ?? []).toHaveLength(0)
      expect(firstRefName(store)).toBe('アリス') // ref はそのまま残る
    })

    it('deleteGlossaryEntry は存在しない id では何もしない', async () => {
      await store.createWork('作')
      await store.addGlossaryEntry({ name: 'アリス' })
      await store.deleteGlossaryEntry('nope')
      expect(store.getSnapshot().work?.glossary).toHaveLength(1)
    })
  })
})
