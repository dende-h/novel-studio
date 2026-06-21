import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProfileRepository } from '../core/profile'
import { SnapshotRepository } from '../core/snapshot/snapshotRepository'
import { MemoryStore } from '../core/storage/memoryStore'
import type { KeyValueStore } from '../core/storage/types'
import { WorkRepository } from '../core/storage/workRepository'
import { App } from './App'
import { createEditorStore, type EditorStore } from './store/editorStore'

const makeStore = (kv: KeyValueStore = new MemoryStore()): EditorStore => {
  let n = 0
  const repo = new WorkRepository(kv)
  const snapshotRepo = new SnapshotRepository(kv)
  const profileRepo = new ProfileRepository(kv)
  return createEditorStore({
    repo,
    snapshotRepo,
    profileRepo,
    genId: () => `id${++n}`,
    now: () => Date.now(),
    snapshotMinIntervalMs: 0,
    trashTtlMs: Number.MAX_SAFE_INTEGER,
  })
}

const seedWorkEpisode = async (store: EditorStore) => {
  await store.createWork('作品ワン')
  await store.createEpisode('第一話')
}

describe('App（エディタ結合：本文/プレビュー・自動保存・履歴）', () => {
  it('作品が開かれていない時はライブラリ誘導を表示', () => {
    render(<App store={makeStore()} />)
    expect(screen.getByText(/ライブラリから作品を開いて/)).toBeInTheDocument()
  })

  it('本文入力でライブプレビューが追従（ルビ/傍点）', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    const textarea = await screen.findByRole('textbox', { name: '本文' })
    fireEvent.change(textarea, { target: { value: '漢字《かんじ》\n《《重要》》' } })

    await waitFor(() => {
      expect(document.querySelector('.preview ruby rt')?.textContent).toBe('かんじ')
      expect(document.querySelector('.preview em.dots')?.textContent).toBe('重要')
    })
  })

  it('プレビューの @参照は図鑑に在れば解決リンク、無ければ未解決点線で描く', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    await store.addGlossaryEntry({ name: 'アリス' })
    render(<App store={store} />)

    const textarea = await screen.findByRole('textbox', { name: '本文' })
    fireEvent.change(textarea, { target: { value: '[[アリス]]と[[謎の人物]]' } })

    await waitFor(() => {
      expect(document.querySelectorAll('.preview .ref')).toHaveLength(2)
    })
    const resolved = document.querySelector('.preview .ref[data-ref-name="アリス"]')
    const unresolved = document.querySelector('.preview .ref[data-ref-name="謎の人物"]')
    expect(resolved?.classList.contains('ref--unresolved')).toBe(false)
    expect(unresolved?.classList.contains('ref--unresolved')).toBe(true)
    expect(resolved?.textContent).toBe('アリス')
  })

  it('自動保存で永続化され、再読込相当で本文を復元できる', async () => {
    const kv = new MemoryStore()
    const store1 = makeStore(kv)
    await seedWorkEpisode(store1)
    const workId = store1.getSnapshot().work?.id ?? ''

    const { unmount } = render(<App store={store1} />)
    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '保存される本文' },
    })
    await waitFor(() => expect(screen.getByText('保存済み')).toBeInTheDocument(), { timeout: 2000 })
    unmount()

    // 同じ永続ストアの別エディタ = 再読込
    const store2 = makeStore(kv)
    await store2.openWork(workId)
    render(<App store={store2} />)
    expect(await screen.findByRole('textbox', { name: '本文' })).toHaveValue('保存される本文')
  })

  it('「新しいエピソードを追加」ダイアログで話を作成しサブリストに表示', async () => {
    const store = makeStore()
    await store.createWork('作品ワン')
    render(<App store={store} />)

    fireEvent.click(screen.getByRole('button', { name: '新しいエピソードを追加' }))
    const input = await screen.findByLabelText('話タイトル')
    fireEvent.change(input, { target: { value: '序章' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(await screen.findByRole('button', { name: '序章' })).toBeInTheDocument()
  })

  it('サイドバー「図鑑」で図鑑画面へ切替え、作成した項目が一覧に出てプレビューで解決する', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    // 本文に未解決の参照を書いておく
    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '[[アリス]]が来た' },
    })
    await waitFor(() => {
      const ref = document.querySelector('.preview .ref[data-ref-name="アリス"]')
      expect(ref?.classList.contains('ref--unresolved')).toBe(true)
    })

    // 図鑑画面へ → 作成
    fireEvent.click(screen.getByRole('button', { name: '図鑑' }))
    expect(await screen.findByRole('heading', { name: '図鑑' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新規' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'アリス' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(await screen.findByRole('heading', { name: 'アリス' })).toBeInTheDocument()

    // エピソードへ戻ると参照が解決済みリンクになる
    fireEvent.click(screen.getByRole('button', { name: 'エピソード' }))
    await waitFor(() => {
      const ref = document.querySelector('.preview .ref[data-ref-name="アリス"]')
      expect(ref?.classList.contains('ref--unresolved')).toBe(false)
    })
  })

  it('プレビューの解決済み @参照をクリックすると aside に用語のピークが出る', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    await store.addGlossaryEntry({ name: 'アリス', summary: '物語の主人公。' })
    render(<App store={store} />)

    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '[[アリス]]が来た' },
    })
    const ref = await waitFor(() => {
      const el = document.querySelector('.preview .ref[data-ref-name="アリス"]')
      if (!el) throw new Error('ref 未描画')
      return el
    })
    fireEvent.click(ref)

    expect(await screen.findByRole('heading', { name: 'アリス' })).toBeInTheDocument()
    expect(screen.getByText('物語の主人公。')).toBeInTheDocument()

    // 閉じるとピークが消える
    fireEvent.click(screen.getByRole('button', { name: 'ピークを閉じる' }))
    expect(screen.queryByText('物語の主人公。')).toBeNull()
  })

  it('プレビューの未解決 @参照をクリックすると当該名でクイック作成フォームが開く', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '[[謎の人物]]が現れた' },
    })
    const ref = await waitFor(() => {
      const el = document.querySelector('.preview .ref[data-ref-name="謎の人物"]')
      if (!el) throw new Error('ref 未描画')
      return el
    })
    fireEvent.click(ref)

    const nameField = await screen.findByLabelText('名前')
    expect(nameField).toHaveValue('謎の人物')

    // 作成すると参照が解決済みになる
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await waitFor(() => {
      const el = document.querySelector('.preview .ref[data-ref-name="謎の人物"]')
      expect(el?.classList.contains('ref--unresolved')).toBe(false)
    })
  })

  it('保存すると履歴パネルに版が記録される（トグルで開閉できる）', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: 'テスト本文' },
    })
    await waitFor(() => expect(screen.getByText('保存済み')).toBeInTheDocument(), { timeout: 2000 })

    // 初期は履歴ドロワー非表示
    expect(screen.queryByText('ローカル・セーフティネット')).toBeNull()

    // 履歴トグルで開く
    fireEvent.click(screen.getByRole('button', { name: '履歴' }))
    expect(screen.getByText('ローカル・セーフティネット')).toBeInTheDocument()
    expect(screen.getByText('現在の版')).toBeInTheDocument()

    // 閉じるボタンで閉じる
    fireEvent.click(screen.getByRole('button', { name: '履歴を閉じる' }))
    expect(screen.queryByText('ローカル・セーフティネット')).toBeNull()
  })
})
