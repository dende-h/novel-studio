import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Appearances } from '@/core/glossary'
import type { GlossaryEntry } from '@/core/schema'
import { GlossaryPeek } from './glossary-peek'

const entry: GlossaryEntry = {
  id: 'a',
  name: 'アリス',
  aliases: ['Alice', '姫君'],
  reading: 'ありす',
  category: '人物',
  summary: '物語の主人公。',
  createdAt: 0,
  updatedAt: 0,
}

const appearances: Appearances = { episodeIds: ['e1', 'e2'], refCount: 5 }

const noop = {
  onSelect: () => {},
  onQuickCreate: () => {},
  onClose: () => {},
  onEdit: () => {},
  onNewEntry: () => {},
}

describe('GlossaryPeek（図鑑パネル）', () => {
  it('選択 entry の名前・読み・カテゴリ・別名・概要・登場数を表示', () => {
    render(
      <GlossaryPeek entries={[entry]} draft="" entry={entry} appearances={appearances} {...noop} />,
    )
    expect(screen.getByRole('heading', { name: 'アリス' })).toBeInTheDocument()
    expect(screen.getByText('ありす')).toBeInTheDocument()
    expect(screen.getByText('人物')).toBeInTheDocument()
    expect(screen.getByText(/Alice、姫君/)).toBeInTheDocument()
    expect(screen.getByText('物語の主人公。')).toBeInTheDocument()
    expect(screen.getByText('2話・5回 登場')).toBeInTheDocument()
  })

  it('未使用 entry は「未使用」と表示', () => {
    render(
      <GlossaryPeek
        entries={[entry]}
        draft=""
        entry={{ ...entry, summary: undefined }}
        appearances={{ episodeIds: [], refCount: 0 }}
        {...noop}
      />,
    )
    expect(screen.getByText('未使用')).toBeInTheDocument()
    expect(screen.getByText('説明はまだありません。')).toBeInTheDocument()
  })

  it('本文の [[用語]] を「この話に登場」チップに出し、解決済みは選択・未登録はクイック作成', () => {
    const onSelect = vi.fn()
    const onQuickCreate = vi.fn()
    render(
      <GlossaryPeek
        entries={[entry]}
        draft="[[アリス]]と[[謎の人物]]が[[アリス]]と歩く"
        entry={null}
        appearances={null}
        {...noop}
        onSelect={onSelect}
        onQuickCreate={onQuickCreate}
      />,
    )
    // 重複は 1 つに畳む
    expect(screen.getAllByRole('button', { name: 'アリス' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'アリス' }))
    expect(onSelect).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: '謎の人物（未登録）' }))
    expect(onQuickCreate).toHaveBeenCalledWith('謎の人物')
  })

  it('用語が無ければ案内文を出す', () => {
    render(<GlossaryPeek entries={[]} draft="" entry={null} appearances={null} {...noop} />)
    expect(screen.getByText(/本文に \[\[用語\]\] を書くと/)).toBeInTheDocument()
  })

  it('閉じる・編集・新しく登録でコールバックを発火', () => {
    const onClose = vi.fn()
    const onEdit = vi.fn()
    const onNewEntry = vi.fn()
    render(
      <GlossaryPeek
        entries={[entry]}
        draft=""
        entry={entry}
        appearances={appearances}
        {...noop}
        onClose={onClose}
        onEdit={onEdit}
        onNewEntry={onNewEntry}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '図鑑パネルを閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    expect(onNewEntry).toHaveBeenCalledTimes(1)
  })
})
