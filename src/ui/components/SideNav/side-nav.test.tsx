import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SideNav } from './side-nav'

const baseProps = {
  projectTitle: '作品タイトル',
  active: 'episodes' as const,
  onNavigateCollection: () => {},
  cta: { label: '新しいエピソードを追加', onClick: () => {} },
}

describe('SideNav（サイドバー）', () => {
  it('話サブリストを表示し、選択を発火する', () => {
    const onSelectEpisode = vi.fn()
    render(
      <SideNav
        {...baseProps}
        episodes={[{ id: 'e1', title: '第一話' }]}
        currentEpisodeId="e1"
        onSelectEpisode={onSelectEpisode}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '第一話' }))
    expect(onSelectEpisode).toHaveBeenCalledWith('e1')
  })

  it('話の削除ボタンで onDeleteEpisode を呼ぶ', () => {
    const onDeleteEpisode = vi.fn()
    render(
      <SideNav
        {...baseProps}
        episodes={[{ id: 'e1', title: '第一話' }]}
        currentEpisodeId="e1"
        onSelectEpisode={() => {}}
        onDeleteEpisode={onDeleteEpisode}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '「第一話」を削除' }))
    expect(onDeleteEpisode).toHaveBeenCalledWith('e1')
  })

  it('onDeleteEpisode 未指定なら削除ボタンを出さない', () => {
    render(
      <SideNav
        {...baseProps}
        episodes={[{ id: 'e1', title: '第一話' }]}
        currentEpisodeId="e1"
        onSelectEpisode={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '「第一話」を削除' })).toBeNull()
  })
})
