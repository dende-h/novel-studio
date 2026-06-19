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
  body: '詳細な設定メモ。',
  createdAt: 0,
  updatedAt: 0,
}

const appearances: Appearances = { episodeIds: ['e1', 'e2'], refCount: 5 }

describe('GlossaryPeek（用語のチラ見）', () => {
  it('名前・読み・カテゴリ・別名・概要・本文・登場数を表示', () => {
    render(
      <GlossaryPeek entry={entry} appearances={appearances} onClose={() => {}} onEdit={() => {}} />,
    )
    expect(screen.getByRole('heading', { name: 'アリス' })).toBeInTheDocument()
    expect(screen.getByText('ありす')).toBeInTheDocument()
    expect(screen.getByText('人物')).toBeInTheDocument()
    expect(screen.getByText(/Alice、姫君/)).toBeInTheDocument()
    expect(screen.getByText('物語の主人公。')).toBeInTheDocument()
    expect(screen.getByText('詳細な設定メモ。')).toBeInTheDocument()
    expect(screen.getByText('2話・5回 登場')).toBeInTheDocument()
  })

  it('未使用 entry は「未使用」と表示', () => {
    render(
      <GlossaryPeek
        entry={{ ...entry, summary: undefined, body: undefined }}
        appearances={{ episodeIds: [], refCount: 0 }}
        onClose={() => {}}
        onEdit={() => {}}
      />,
    )
    expect(screen.getByText('未使用')).toBeInTheDocument()
    expect(screen.getByText('説明はまだありません。')).toBeInTheDocument()
  })

  it('閉じる・編集ボタンでコールバックを発火', () => {
    const onClose = vi.fn()
    const onEdit = vi.fn()
    render(
      <GlossaryPeek entry={entry} appearances={appearances} onClose={onClose} onEdit={onEdit} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ピークを閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '図鑑で編集' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
