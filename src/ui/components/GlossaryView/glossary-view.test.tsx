import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Appearances } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import type { GlossaryFormValues } from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { GlossaryView } from './glossary-view'

function entry(p: Partial<GlossaryEntry> & { id: string; name: string }): GlossaryEntry {
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    category: p.category,
    reading: p.reading,
    summary: p.summary,
    body: p.body,
    authorNote: p.authorNote,
    createdAt: 0,
    updatedAt: 0,
  }
}

const ENTRIES: GlossaryEntry[] = [
  entry({
    id: 'a',
    name: 'アリス',
    reading: 'ありす',
    category: '人物',
    summary: '主人公。[[ボブ]]の幼なじみ。',
    aliases: ['Alice'],
  }),
  entry({ id: 'b', name: 'ボブ', category: '人物' }),
  entry({ id: 't', name: '王都', category: '地名', summary: '概要のみ', body: '旧・詳細の文' }),
]

const appearances: Record<string, Appearances> = {
  a: { episodeIds: ['e1', 'e2'], refCount: 5 },
  b: { episodeIds: [], refCount: 0 },
  t: { episodeIds: ['e1'], refCount: 1 },
}

/**
 * 適用結果が次の描画に反映される **stateful** なハーネス。
 * onApply を受け取るだけのモックだと「作成した項目がその場で選ばれる」「改名が一覧へ出る」
 * を検証できない（world-view.test で学んだ形）。
 */
function setup(initial: GlossaryEntry[] = ENTRIES) {
  const calls = {
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  }
  function Harness() {
    const [entries, setEntries] = useState(initial)
    return (
      <GlossaryView
        entries={entries}
        getAppearances={(e) => appearances[e.id] ?? { episodeIds: [], refCount: 0 }}
        onCreate={async (name) => {
          calls.onCreate(name)
          if (entries.some((e) => e.name === name))
            throw new Error(`「${name}」は既存の項目と重複しています`)
          const id = `new-${name}`
          setEntries((cur) => [...cur, entry({ id, name })])
          return id
        }}
        onUpdate={async (id, values: GlossaryFormValues) => {
          calls.onUpdate(id, values)
          setEntries((cur) =>
            cur.map((e) =>
              e.id === id
                ? {
                    ...e,
                    aliases: values.aliases,
                    category: values.category || undefined,
                    reading: values.reading || undefined,
                    summary: values.summary || undefined,
                    body: undefined,
                    authorNote: values.authorNote || undefined,
                  }
                : e,
            ),
          )
        }}
        onRename={async (id, newName, opts) => {
          calls.onRename(id, newName, opts)
          if (newName === '重複名') throw new Error('「重複名」は既存の項目と重複しています')
          setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, name: newName } : e)))
        }}
        onDelete={(id) => {
          calls.onDelete(id)
          setEntries((cur) => cur.filter((e) => e.id !== id))
        }}
      />
    )
  }
  render(<Harness />)
  return calls
}

const openEntry = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `「${name}」を編集` }))

describe('GlossaryView（左右2カラム：一覧・検索・その場編集）', () => {
  it('一覧に名前と分類・未使用が出て、選ぶと編集面が開く', () => {
    setup()
    expect(screen.getByRole('button', { name: '「アリス」を編集' })).toBeInTheDocument()
    expect(screen.getByText('人物 ・ 未使用')).toBeInTheDocument() // ボブ
    openEntry('アリス')
    expect(screen.getByLabelText('名前')).toHaveValue('アリス')
    expect(screen.getByLabelText('読み（任意）')).toHaveValue('ありす')
    expect(screen.getByLabelText('別名（読点区切り・任意）')).toHaveValue('Alice')
    expect(screen.getByText(/2話・5回 登場/)).toBeInTheDocument()
  })

  it('検索は name・別名・読みに部分一致', () => {
    setup()
    fireEvent.change(screen.getByLabelText('用語集を検索'), { target: { value: 'ありす' } })
    expect(screen.getByRole('button', { name: '「アリス」を編集' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '「王都」を編集' })).toBeNull()
  })

  it('カテゴリチップで絞り込む', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '地名' }))
    expect(screen.getByRole('button', { name: '「王都」を編集' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '「アリス」を編集' })).toBeNull()
  })

  it('「新しく登録」は名前だけで作り、その場で選ばれて書き始められる', async () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'キャロル' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('キャロル'))
    // 作成した項目が選ばれ、編集面で続きを書ける
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('キャロル'))
  })

  it('作成が重複で reject されるとエラーを表示しダイアログを保つ', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'アリス' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('重複')
    expect(screen.getByLabelText('名前')).toBeInTheDocument()
  })

  it('公開情報は旧データ（概要＋詳細）を結合して 1 欄で開く', () => {
    setup()
    openEntry('王都')
    // 中身があるので既定はプレビュー＝結合された文が読める
    expect(screen.getByText(/概要のみ/)).toBeInTheDocument()
    expect(screen.getByText(/旧・詳細の文/)).toBeInTheDocument()
  })

  it('公開情報を書いて欄を離れると、結合済みの summary で onUpdate（body は畳む）', async () => {
    const { onUpdate } = setup()
    openEntry('ボブ') // 公開情報が空＝編集モードで開く
    const box = screen.getByLabelText('公開情報')
    fireEvent.change(box, { target: { value: '灯台守。' } })
    fireEvent.blur(box)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('b', expect.objectContaining({ summary: '灯台守。' })),
    )
    // GlossaryFormValues に body は無い＝旧・詳細は保存経路で畳まれる
    expect(onUpdate.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('作者メモも欄を離れるとその場で確定する', async () => {
    const { onUpdate } = setup()
    openEntry('ボブ')
    const note = screen.getByLabelText('作者メモ')
    fireEvent.change(note, { target: { value: '正体は管理AI' } })
    fireEvent.blur(note)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        'b',
        expect.objectContaining({ authorNote: '正体は管理AI' }),
      ),
    )
  })

  it('名前は blur で onRename され、一覧にも新名が出る', async () => {
    const { onRename } = setup()
    openEntry('アリス')
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: 'アリサ' } })
    fireEvent.blur(name)
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith('a', 'アリサ', { rewriteBody: false }),
    )
    expect(await screen.findByRole('button', { name: '「アリサ」を編集' })).toBeInTheDocument()
  })

  it('改名が重複で reject されるとエラーを表示する', async () => {
    setup()
    openEntry('アリス')
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: '重複名' } })
    fireEvent.blur(name)
    expect(await screen.findByRole('alert')).toHaveTextContent('重複')
  })

  it('カテゴリは固定リストのプルダウン（既存の自由入力値も選択肢に残る）', () => {
    setup()
    openEntry('王都')
    const select = screen.getByLabelText('カテゴリ') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toEqual(['未分類', '人物', '場所', '組織', '用語', 'アイテム', '生物', '地名'])
    expect(select.value).toBe('地名') // 旧・自由入力値が保全される
  })

  it('削除は確認後に onDelete、一覧から消えて選択も解ける', async () => {
    const { onDelete } = setup()
    openEntry('アリス')
    fireEvent.click(screen.getByRole('button', { name: '「アリス」を削除' }))
    fireEvent.click(await screen.findByRole('button', { name: '削除する' }))
    expect(onDelete).toHaveBeenCalledWith('a')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '「アリス」を編集' })).toBeNull(),
    )
    expect(screen.queryByLabelText('名前')).toBeNull()
  })

  it('プレビューの [[用語]] クリックは右のチラ見で開き、編集対象は変わらない', async () => {
    setup()
    openEntry('アリス') // 公開情報に [[ボブ]] が居る＝既定プレビューでリンクになる
    const ref = await screen.findByRole('link', { name: 'ボブ' })
    fireEvent.click(ref)
    // チラ見ドロワーにボブが出るが、編集面はアリスのまま（書いている場所を失わない）
    const peek = await screen.findByRole('complementary', { name: '用語のチラ見' })
    expect(within(peek).getByRole('heading', { name: 'ボブ' })).toBeInTheDocument()
    expect(screen.getByLabelText('名前')).toHaveValue('アリス')
    // 「この項目を編集」で初めて切り替わり、ドロワーは閉じる
    fireEvent.click(within(peek).getByRole('button', { name: 'この項目を編集' }))
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('ボブ'))
    expect(screen.queryByRole('complementary', { name: '用語のチラ見' })).toBeNull()
  })

  it('チラ見は閉じるボタンで消え、編集面はそのまま', async () => {
    setup()
    openEntry('アリス')
    fireEvent.click(await screen.findByRole('link', { name: 'ボブ' }))
    const peek = await screen.findByRole('complementary', { name: '用語のチラ見' })
    fireEvent.click(within(peek).getByRole('button', { name: 'チラ見を閉じる' }))
    expect(screen.queryByRole('complementary', { name: '用語のチラ見' })).toBeNull()
    expect(screen.getByLabelText('名前')).toHaveValue('アリス')
  })

  it('項目が無い時は空状態を表示', () => {
    setup([])
    expect(screen.getByText(/まだ用語集がありません/)).toBeInTheDocument()
  })
})
