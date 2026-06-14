import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkSummary } from '@/core/storage/workRepository'
import { ProjectCard } from './project-card'

const summary: WorkSummary = {
  id: 'w1',
  title: 'テスト作',
  episodeCount: 3,
  charCount: 1234,
}

describe('ProjectCard（ライブラリの作品カード）', () => {
  it('タイトル・話数・文字数を表示する', () => {
    render(
      <ProjectCard
        summary={summary}
        now={0}
        onWrite={() => {}}
        onExport={() => {}}
        onEditMeta={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByText('テスト作')).toBeInTheDocument()
    expect(screen.getByText('3話')).toBeInTheDocument()
    expect(screen.getByText(/1,234/)).toBeInTheDocument()
  })

  it('執筆・書き出し・情報を編集・削除の各操作を発火する', () => {
    const onWrite = vi.fn()
    const onExport = vi.fn()
    const onEditMeta = vi.fn()
    const onDelete = vi.fn()
    render(
      <ProjectCard
        summary={summary}
        now={0}
        onWrite={onWrite}
        onExport={onExport}
        onEditMeta={onEditMeta}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '執筆' }))
    fireEvent.click(screen.getByRole('button', { name: '書き出し' }))
    fireEvent.click(screen.getByRole('button', { name: '情報を編集' }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onEditMeta).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
