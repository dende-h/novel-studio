import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileRepository } from '../core/profile'
import { SnapshotRepository } from '../core/snapshot/snapshotRepository'
import { ActivityRepository } from '../core/storage/activityRepository'
import { MemoryStore } from '../core/storage/memoryStore'
import { StructureRepository } from '../core/storage/structureRepository'
import type { KeyValueStore } from '../core/storage/types'
import { WorkRepository } from '../core/storage/workRepository'
import { App } from './App'
import { createEditorStore, type EditorStore } from './store/editorStore'

const makeStore = (kv: KeyValueStore = new MemoryStore()): EditorStore => {
  let n = 0
  const repo = new WorkRepository(kv)
  const snapshotRepo = new SnapshotRepository(kv)
  const profileRepo = new ProfileRepository(kv)
  const activityRepo = new ActivityRepository(kv)
  return createEditorStore({
    repo,
    snapshotRepo,
    profileRepo,
    activityRepo,
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

  it('プレビューの @参照は用語集に在れば解決リンク、無ければ未解決点線で描く', async () => {
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

  it('「新しいエピソード」ダイアログで話を作成しサブリストに表示', async () => {
    const store = makeStore()
    await store.createWork('作品ワン')
    render(<App store={store} />)

    fireEvent.click(screen.getByRole('button', { name: '新しいエピソード' }))
    const input = await screen.findByLabelText('話タイトル')
    fireEvent.change(input, { target: { value: '序章' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(await screen.findByRole('button', { name: '序章' })).toBeInTheDocument()
  })

  it('サイドバー「用語集」で用語集画面へ切替え、作成した項目が一覧に出てプレビューで解決する', async () => {
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

    // 用語集画面へ → 作成
    fireEvent.click(screen.getByRole('button', { name: '用語集' }))
    expect(await screen.findByRole('heading', { name: '用語集' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'アリス' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    // 作成した項目がその場で選ばれ、編集面に開く（一覧の行にも出る）
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('アリス'))
    expect(screen.getByRole('button', { name: '「アリス」を編集' })).toBeInTheDocument()

    // 本文を書くへ戻ると参照が解決済みリンクになる
    fireEvent.click(screen.getByRole('button', { name: '本文を書く' }))
    await waitFor(() => {
      const ref = document.querySelector('.preview .ref[data-ref-name="アリス"]')
      expect(ref?.classList.contains('ref--unresolved')).toBe(false)
    })
  })

  it('プレビューの解決済み @参照をクリックすると用語集パネルに用語のチラ見が出る', async () => {
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

    // 閉じるとパネルが消える
    fireEvent.click(screen.getByRole('button', { name: '用語集パネルを閉じる' }))
    expect(screen.queryByText('物語の主人公。')).toBeNull()
  })

  it('ツールバーの「用語集パネル」トグルで、この話に登場する用語チップが見える', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    await store.addGlossaryEntry({ name: 'アリス' })
    render(<App store={store} />)

    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '[[アリス]]が来た' },
    })
    fireEvent.click(screen.getByRole('button', { name: '用語集パネル' }))
    expect(await screen.findByText('この話に登場')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アリス' })).toBeInTheDocument()
  })

  it('一括置換：検索語の件数を出し、すべて置換で本文へ反映する', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    const textarea = await screen.findByRole('textbox', { name: '本文' })
    fireEvent.change(textarea, { target: { value: '猫が来た。猫が鳴いた。' } })

    // 置換パネルを開く
    fireEvent.click(screen.getByRole('button', { name: '置換' }))
    expect(screen.getByText('この話の本文だけを対象に置換します')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('検索する語'), { target: { value: '猫' } })
    expect(screen.getByText('2件 見つかりました')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('置換後の語'), { target: { value: '犬' } })
    fireEvent.click(screen.getByRole('button', { name: 'すべて置換' }))

    expect(textarea).toHaveValue('犬が来た。犬が鳴いた。')
    // 適用後はパネルが閉じる
    expect(screen.queryByLabelText('検索する語')).toBeNull()
  })

  it('一括置換：0件のときは「すべて置換」が無効', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: 'こんにちは' },
    })
    fireEvent.click(screen.getByRole('button', { name: '置換' }))
    fireEvent.change(screen.getByLabelText('検索する語'), { target: { value: '猫' } })
    expect(screen.getByText('0件 見つかりました')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'すべて置換' })).toBeDisabled()
  })

  it('プレビューの組み方向はツールバーで切替でき、既定は縦書き', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)
    await screen.findByRole('textbox', { name: '本文' })

    const vertical = screen.getByRole('button', { name: '縦書き' })
    const horizontal = screen.getByRole('button', { name: '横書き' })
    expect(vertical.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.preview')?.className).toContain('[writing-mode:vertical-rl]')

    fireEvent.click(horizontal)
    expect(horizontal.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.preview')?.className).not.toContain(
      '[writing-mode:vertical-rl]',
    )
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

/**
 * 構造化3機能（アウトライン／相関図／マインドマップ）は PC 専用。
 * dnd-kit / React Flow のノード・辺の削除が opacity-0 group-hover のみでタッチから到達できず、
 * 中途半端に動くものを出すより閉じる、という判断（D-EDIT-4）。
 */
describe('App（構造ツールの画面幅ゲート）', () => {
  const setWidth = (width: number) => {
    const { happyDOM } = window as unknown as {
      happyDOM: { setViewport: (v: { width: number }) => void }
    }
    act(() => {
      happyDOM.setViewport({ width })
    })
  }

  const renderWithStructure = async (kv: KeyValueStore = new MemoryStore()) => {
    const store = makeStore(kv)
    await seedWorkEpisode(store)
    return render(<App store={store} structureRepo={new StructureRepository(kv)} canUseStructure />)
  }

  afterEach(() => setWidth(1280))

  it('広い画面では構造ツールの入口が出る', async () => {
    setWidth(1280)
    await renderWithStructure()
    expect(await screen.findByRole('button', { name: 'アウトライン' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '相関図' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'マインドマップ' })).toBeInTheDocument()
  })

  it('狭い画面では構造ツールの入口を出さない', async () => {
    setWidth(390)
    await renderWithStructure()
    await screen.findByRole('textbox', { name: '本文' })
    expect(screen.queryByRole('button', { name: 'アウトライン' })).toBeNull()
    expect(screen.queryByRole('button', { name: '相関図' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'マインドマップ' })).toBeNull()
  })

  // 回転・分割ビュー・ウィンドウ縮小で「操作できない画面に閉じ込められる」ことを防ぐ。
  // 入口を CSS で隠すだけでは activeScreen が残ってしまうため、JS で本文へ戻している。
  it('構造ツールを開いたまま狭くすると本文へ戻る（閉じ込め防止）', async () => {
    setWidth(1280)
    await renderWithStructure()

    fireEvent.click(await screen.findByRole('button', { name: 'アウトライン' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '本文' })).toBeNull())

    setWidth(390)
    // 本文エディタが戻ってくる＝activeScreen が 'episodes' にリセットされた
    expect(await screen.findByRole('textbox', { name: '本文' })).toBeInTheDocument()
  })
})

/**
 * 執筆の流れを切らないための導線（用語集をその場で編集・作品情報をエディタから編集）。
 * どちらも「画面遷移させない」ことが要件なので、モーダルが開くところまでを見る。
 */
describe('App（執筆中に開く編集モーダル）', () => {
  it('用語集パネルの「編集」は画面遷移せずモーダルを開く', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    await store.addGlossaryEntry({ name: 'アリス', summary: '物語の主人公。' })
    render(<App store={store} />)

    // 本文の @参照クリックでパネルに用語を出す
    fireEvent.change(await screen.findByRole('textbox', { name: '本文' }), {
      target: { value: '[[アリス]]が来た' },
    })
    const ref = await waitFor(() => {
      const el = document.querySelector('.preview .ref[data-ref-name="アリス"]')
      if (!el) throw new Error('ref 未描画')
      return el
    })
    fireEvent.click(ref)

    fireEvent.click(await screen.findByRole('button', { name: '編集' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('名前')).toHaveValue('アリス')

    // 閉じると本文エディタに戻る＝用語集ページへ遷移していない（その場のモーダル）。
    // モーダル表示中は Radix が背景を a11y ツリーから外すため、閉じてから確かめる。
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(await screen.findByRole('textbox', { name: '本文' })).toBeInTheDocument()
  })

  it('用語集パネルの編集で改名すると、旧名を別名に残したまま更新される', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    await store.addGlossaryEntry({ name: 'アリス' })
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
    fireEvent.click(await screen.findByRole('button', { name: '編集' }))

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'アリシア' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => {
      const entry = store.getSnapshot().work?.glossary?.[0]
      expect(entry?.name).toBe('アリシア')
      // 改名前の名前は別名に残るので、本文の [[アリス]] は解決したまま
      expect(entry?.aliases).toContain('アリス')
    })
  })

  it('サイドバーの作品カードから作品情報を編集できる', async () => {
    const store = makeStore()
    await seedWorkEpisode(store)
    render(<App store={store} />)

    fireEvent.click(await screen.findByRole('button', { name: '作品情報を編集' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('タイトル')).toHaveValue('作品ワン')
  })
})
