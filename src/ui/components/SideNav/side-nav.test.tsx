import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SideNav } from './side-nav'

// 作品を開いている（エディタ）状態の基本 props。
// この状態でのみ「現在の作品」スコープカード内に エピソード/図鑑/話リスト が現れる。
const baseProps = {
  projectTitle: 'novel-studio',
  projectSubtitle: 'ライブラリ',
  active: 'episodes' as const,
  onNavigateCollection: () => {},
  cta: { label: '新しいエピソードを追加', onClick: () => {} },
  workTitle: '作品タイトル',
  onNavigateEpisodes: () => {},
  onNavigateGlossary: () => {},
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

  it('話のタイトル変更ボタンで onRenameEpisode を呼ぶ', () => {
    const onRenameEpisode = vi.fn()
    render(
      <SideNav
        {...baseProps}
        episodes={[{ id: 'e1', title: '第一話' }]}
        currentEpisodeId="e1"
        onSelectEpisode={() => {}}
        onRenameEpisode={onRenameEpisode}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '「第一話」のタイトルを変更' }))
    expect(onRenameEpisode).toHaveBeenCalledWith('e1')
  })

  it('onRenameEpisode 未指定なら変更ボタンを出さない', () => {
    render(
      <SideNav
        {...baseProps}
        episodes={[{ id: 'e1', title: '第一話' }]}
        currentEpisodeId="e1"
        onSelectEpisode={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '「第一話」のタイトルを変更' })).toBeNull()
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

  it('作品オープン中はエピソード行が active かつ非 disabled（グレーアウトしない）', () => {
    render(<SideNav {...baseProps} active="episodes" />)
    const ep = screen.getByRole('button', { name: 'エピソード' })
    expect(ep).toHaveAttribute('aria-current', 'page')
    expect(ep).not.toBeDisabled()
  })

  it('リサーチ・アーカイブは「準備中」表示で無効（押せそうに見えない）', () => {
    render(<SideNav {...baseProps} />)
    expect(screen.getByRole('button', { name: /リサーチ/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /アーカイブ/ })).toBeDisabled()
    expect(screen.getAllByText('準備中').length).toBeGreaterThanOrEqual(2)
  })

  it('コレクションは押下可能で onNavigateCollection を発火する', () => {
    const onNavigateCollection = vi.fn()
    render(<SideNav {...baseProps} onNavigateCollection={onNavigateCollection} />)
    const col = screen.getByRole('button', { name: 'コレクション' })
    expect(col).not.toBeDisabled()
    fireEvent.click(col)
    expect(onNavigateCollection).toHaveBeenCalledTimes(1)
  })

  it('図鑑行: active=glossary で aria-current・押下で onNavigateGlossary を発火する', () => {
    const onNavigateGlossary = vi.fn()
    render(<SideNav {...baseProps} active="glossary" onNavigateGlossary={onNavigateGlossary} />)
    const g = screen.getByRole('button', { name: '図鑑' })
    expect(g).toHaveAttribute('aria-current', 'page')
    expect(g).not.toBeDisabled()
    fireEvent.click(g)
    expect(onNavigateGlossary).toHaveBeenCalledTimes(1)
  })

  it('作品スコープカードに「現在の作品」見出しと作品名を表示する', () => {
    render(<SideNav {...baseProps} workTitle="月と剣の物語" />)
    const card = screen.getByRole('group', { name: '現在の作品' })
    expect(card).toBeInTheDocument()
    expect(screen.getByText('月と剣の物語')).toBeInTheDocument()
  })

  it('ライブラリ状態（workTitle 未指定）はエピソード/図鑑ボタンを出さず、空状態の案内を表示する', () => {
    render(
      <SideNav
        projectTitle="novel-studio"
        projectSubtitle="ライブラリ"
        active="collection"
        onNavigateCollection={() => {}}
        cta={{ label: '新しいプロジェクト', onClick: () => {} }}
      />,
    )
    // グレーアウトした兄弟ではなく、そもそも操作可能な行を出さない。
    expect(screen.queryByRole('button', { name: 'エピソード' })).toBeNull()
    expect(screen.queryByRole('button', { name: '図鑑' })).toBeNull()
    // 作品を開けば使えることを案内する空状態。
    expect(screen.getByText(/作品を開くと/)).toBeInTheDocument()
    // コレクション（ホーム）はこの状態で active。
    expect(screen.getByRole('button', { name: 'コレクション' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
