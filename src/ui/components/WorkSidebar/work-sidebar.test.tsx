import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkSidebar } from './work-sidebar'

const baseProps = {
  workList: [
    { id: 'w1', title: '作品A' },
    { id: 'w2', title: '作品B' },
  ],
  currentWorkId: 'w1',
  episodes: [
    { id: 'e1', title: '第一話' },
    { id: 'e2', title: '第二話' },
  ],
  currentEpisodeId: 'e1',
  onSelectWork: vi.fn(),
  onSelectEpisode: vi.fn(),
  onNewWork: vi.fn(),
  onNewEpisode: vi.fn(),
}

describe('WorkSidebar（Presentational）', () => {
  it('作品一覧と話一覧を表示', () => {
    render(<WorkSidebar {...baseProps} />)
    expect(screen.getByText('作品A')).toBeInTheDocument()
    expect(screen.getByText('作品B')).toBeInTheDocument()
    expect(screen.getByText('第一話')).toBeInTheDocument()
    expect(screen.getByText('第二話')).toBeInTheDocument()
  })

  it('作品クリックで onSelectWork(id)', () => {
    const onSelectWork = vi.fn()
    render(<WorkSidebar {...baseProps} onSelectWork={onSelectWork} />)
    fireEvent.click(screen.getByText('作品B'))
    expect(onSelectWork).toHaveBeenCalledWith('w2')
  })

  it('話クリックで onSelectEpisode(id)', () => {
    const onSelectEpisode = vi.fn()
    render(<WorkSidebar {...baseProps} onSelectEpisode={onSelectEpisode} />)
    fireEvent.click(screen.getByText('第二話'))
    expect(onSelectEpisode).toHaveBeenCalledWith('e2')
  })

  it('新規作品・新規話ボタンでハンドラ発火', () => {
    const onNewWork = vi.fn()
    const onNewEpisode = vi.fn()
    render(<WorkSidebar {...baseProps} onNewWork={onNewWork} onNewEpisode={onNewEpisode} />)
    fireEvent.click(screen.getByRole('button', { name: '新規作品' }))
    fireEvent.click(screen.getByRole('button', { name: '新規話' }))
    expect(onNewWork).toHaveBeenCalledOnce()
    expect(onNewEpisode).toHaveBeenCalledOnce()
  })
})
