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

const noop = { onWrite: () => {}, onExport: () => {}, onEditMeta: () => {}, onDelete: () => {} }

describe('ProjectCard（ライブラリの作品カード）', () => {
  it('タイトル・話数・文字数を表示する', () => {
    render(<ProjectCard summary={summary} now={0} {...noop} />)
    // タイトルは表紙（縦書き）とメタ行の 2 箇所に出る
    expect(screen.getAllByText('テスト作').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('3話')).toBeInTheDocument()
    expect(screen.getByText(/1,234/)).toBeInTheDocument()
  })

  it('カード全体のクリックで執筆へ入る', () => {
    const onWrite = vi.fn()
    render(<ProjectCard summary={summary} now={0} {...noop} onWrite={onWrite} />)
    fireEvent.click(screen.getByRole('button', { name: '「テスト作」を執筆' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  it('ケバブメニューから書き出し・情報を編集・ゴミ箱へ移動を発火する', () => {
    const onExport = vi.fn()
    const onEditMeta = vi.fn()
    const onDelete = vi.fn()
    render(
      <ProjectCard
        summary={summary}
        now={0}
        onWrite={() => {}}
        onExport={onExport}
        onEditMeta={onEditMeta}
        onDelete={onDelete}
      />,
    )
    const openMenu = () =>
      fireEvent.click(screen.getByRole('button', { name: '「テスト作」のメニュー' }))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: '書き出し' }))
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: '情報を編集' }))
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'ゴミ箱へ移動' }))

    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onEditMeta).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('メニュー項目クリック後はメニューが閉じる', () => {
    render(<ProjectCard summary={summary} now={0} {...noop} />)
    fireEvent.click(screen.getByRole('button', { name: '「テスト作」のメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '書き出し' }))
    expect(screen.queryByRole('menuitem', { name: '書き出し' })).toBeNull()
  })
})
