import { fireEvent, render, screen, within } from '@testing-library/react'
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

describe('GlossaryView（辞書一覧・検索・カテゴリ・CRUD）', () => {
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
    fireEvent.change(screen.getByLabelText('辞書を検索'), { target: { value: 'ありす' } })
    expect(screen.getByRole('heading', { name: 'アリス' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '王都' })).toBeNull()
  })

  it('カテゴリチップで絞り込む', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '地名' }))
    expect(screen.getByRole('heading', { name: '王都' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'アリス' })).toBeNull()
  })

  it('「新規」で作成フォームを開き、入力して onCreate を呼ぶ', () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新規' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'キャロル' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'キャロル' }))
  })

  it('編集フォームは name を読み取り専用にし、onUpdate を呼ぶ', () => {
    const { onUpdate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '「アリス」を編集' }))
    const nameInput = screen.getByLabelText('名前') as HTMLInputElement
    expect(nameInput.value).toBe('アリス')
    expect(nameInput.readOnly).toBe(true)
    fireEvent.change(screen.getByLabelText('概要'), { target: { value: '改訂概要' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onUpdate).toHaveBeenCalledWith('a', expect.objectContaining({ summary: '改訂概要' }))
  })

  it('改名ダイアログで rewriteBody を選び onRename を呼ぶ', () => {
    const { onRename } = setup()
    fireEvent.click(screen.getByRole('button', { name: '「アリス」を改名' }))
    fireEvent.change(screen.getByLabelText('新しい名前'), { target: { value: 'アリサ' } })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    expect(onRename).toHaveBeenCalledWith('a', 'アリサ', { rewriteBody: true })
  })

  it('削除は確認後に onDelete を呼ぶ', () => {
    const { onDelete } = setup()
    fireEvent.click(screen.getByRole('button', { name: '「アリス」を削除' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '削除する' }))
    expect(onDelete).toHaveBeenCalledWith('a')
  })

  it('作成が衝突で reject されるとエラーを表示しダイアログを保つ', async () => {
    setup({
      onCreate: vi.fn().mockRejectedValue(new Error('「アリス」は既存の項目と重複しています')),
    })
    fireEvent.click(screen.getByRole('button', { name: '新規' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'アリス' } })
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('重複')
    // ダイアログは閉じない（名前入力が残る）
    expect(screen.getByLabelText('名前')).toBeInTheDocument()
  })

  it('項目が無い時は空状態を表示', () => {
    setup({ entries: [] })
    expect(screen.getByText(/まだ辞書がありません/)).toBeInTheDocument()
  })
})
