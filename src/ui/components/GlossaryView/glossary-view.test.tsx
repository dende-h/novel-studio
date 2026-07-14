import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Appearances } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
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
    summary: '主人公',
    aliases: ['Alice'],
  }),
  entry({ id: 'b', name: 'ボブ', category: '人物' }),
  entry({ id: 't', name: '王都', category: '地名' }),
]

const appearances: Record<string, Appearances> = {
  a: { episodeIds: ['e1', 'e2'], refCount: 5 },
  b: { episodeIds: [], refCount: 0 },
  t: { episodeIds: ['e1'], refCount: 1 },
}

function setup(over: Partial<React.ComponentProps<typeof GlossaryView>> = {}) {
  const props = {
    entries: ENTRIES,
    getAppearances: (e: GlossaryEntry) => appearances[e.id] ?? { episodeIds: [], refCount: 0 },
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  }
  render(<GlossaryView {...props} />)
  return props
}

describe('GlossaryView（図鑑一覧・検索・カテゴリ・CRUD）', () => {
  it('項目名・概要・登場数を一覧表示する', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'アリス' })).toBeInTheDocument()
    expect(screen.getByText('主人公')).toBeInTheDocument()
    expect(screen.getByText('別名: Alice')).toBeInTheDocument()
    expect(screen.getByText('2話・5回 登場')).toBeInTheDocument()
    expect(screen.getByText('未使用')).toBeInTheDocument() // ボブ
  })

  it('検索は name・別名・読みに部分一致（body 等は対象外）', () => {
    setup()
    fireEvent.change(screen.getByLabelText('図鑑を検索'), { target: { value: 'ありす' } })
    expect(screen.getByRole('heading', { name: 'アリス' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '王都' })).toBeNull()
  })

  it('カテゴリチップで絞り込む', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '地名' }))
    expect(screen.getByRole('heading', { name: '王都' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'アリス' })).toBeNull()
  })

  it('「新しく登録」で作成フォームを開き、入力して onCreate を呼ぶ', () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'キャロル' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'キャロル' }))
  })

  it('カード押下で閲覧ダイアログが開き、内容を表示する', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '「アリス」の詳細を開く' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('ありす')).toBeInTheDocument()
    expect(within(dialog).getByText('主人公')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '削除' })).toBeInTheDocument()
  })

  it('閲覧→「編集」でフォームを開き、名前以外の変更は onUpdate のみ呼ぶ', async () => {
    const { onUpdate, onRename } = setup()
    fireEvent.click(screen.getByRole('button', { name: '「アリス」の詳細を開く' }))
    fireEvent.click(await screen.findByRole('button', { name: '編集' }))
    const nameInput = (await screen.findByLabelText('名前')) as HTMLInputElement
    expect(nameInput.value).toBe('アリス')
    expect(nameInput.readOnly).toBe(false)
    fireEvent.change(screen.getByLabelText('概要（任意）'), { target: { value: '改訂概要' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('a', expect.objectContaining({ summary: '改訂概要' })),
    )
    expect(onRename).not.toHaveBeenCalled()
  })

  it('編集フォームで名前を変えると onRename（自動別名退避）→ onUpdate の順に呼ぶ', async () => {
    const { onUpdate, onRename } = setup()
    fireEvent.click(screen.getByRole('button', { name: '「アリス」の詳細を開く' }))
    fireEvent.click(await screen.findByRole('button', { name: '編集' }))
    fireEvent.change(await screen.findByLabelText('名前'), { target: { value: 'アリサ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith('a', 'アリサ', { rewriteBody: false }),
    )
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('a', expect.objectContaining({ name: 'アリサ' })),
    )
  })

  it('カテゴリは固定リストのプルダウン（既存の自由入力値も選択肢に残る）', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '「王都」の詳細を開く' }))
    fireEvent.click(await screen.findByRole('button', { name: '編集' }))
    const select = (await screen.findByLabelText('カテゴリ')) as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toEqual(['未分類', '人物', '場所', '用語', '世界観', 'アイテム', '地名'])
    expect(select.value).toBe('地名') // 旧・自由入力値が保全される
  })

  it('閲覧→「削除」は確認後に onDelete を呼ぶ', async () => {
    const { onDelete } = setup()
    fireEvent.click(screen.getByRole('button', { name: '「アリス」の詳細を開く' }))
    fireEvent.click(await screen.findByRole('button', { name: '削除' }))
    const confirm = await screen.findByRole('button', { name: '削除する' })
    fireEvent.click(confirm)
    expect(onDelete).toHaveBeenCalledWith('a')
  })

  it('作成が衝突で reject されるとエラーを表示しダイアログを保つ', async () => {
    setup({
      onCreate: vi.fn().mockRejectedValue(new Error('「アリス」は既存の項目と重複しています')),
    })
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'アリス' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('重複')
    // ダイアログは閉じない（名前入力が残る）
    expect(screen.getByLabelText('名前')).toBeInTheDocument()
  })

  it('項目が無い時は空状態を表示', () => {
    setup({ entries: [] })
    expect(screen.getByText(/まだ図鑑がありません/)).toBeInTheDocument()
  })
})
