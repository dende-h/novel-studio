import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SideNav } from './side-nav'

// 作品を開いている（エディタ）状態の基本 props。
// この状態でのみ 戻るリンク／作品カード／本文を書く・図鑑／草稿の話リスト が現れる。
const baseProps = {
  active: 'episodes' as const,
  onNavigateCollection: () => {},
  cta: { label: '新しいエピソード', onClick: () => {} },
  workTitle: '作品タイトル',
  workMeta: '2話 ・ 1,200字',
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

  it('作品オープン中は「本文を書く」行が active かつ非 disabled', () => {
    render(<SideNav {...baseProps} active="episodes" />)
    const ep = screen.getByRole('button', { name: '本文を書く' })
    expect(ep).toHaveAttribute('aria-current', 'page')
    expect(ep).not.toBeDisabled()
  })

  it('作品オープン中の「マイライブラリ」は戻るリンクとして onNavigateCollection を発火する', () => {
    const onNavigateCollection = vi.fn()
    render(<SideNav {...baseProps} onNavigateCollection={onNavigateCollection} />)
    const col = screen.getByRole('button', { name: 'マイライブラリ' })
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

  it('作品カードに作品名とメタ情報を表示する', () => {
    render(<SideNav {...baseProps} workTitle="月と剣の物語" workMeta="3話 ・ 9,000字" />)
    expect(screen.getByText('月と剣の物語')).toBeInTheDocument()
    expect(screen.getByText('3話 ・ 9,000字')).toBeInTheDocument()
  })

  it('ライブラリ状態（workTitle 未指定）は本文を書く/図鑑を出さず、マイライブラリが active', () => {
    render(
      <SideNav
        active="collection"
        onNavigateCollection={() => {}}
        cta={{ label: '新しい作品', onClick: () => {} }}
      />,
    )
    expect(screen.queryByRole('button', { name: '本文を書く' })).toBeNull()
    expect(screen.queryByRole('button', { name: '図鑑' })).toBeNull()
    expect(screen.getByRole('button', { name: 'マイライブラリ' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('プロフィール（ライブラリ状態）はペンネームを表示し、押下で onEditProfile を呼ぶ', () => {
    const onEditProfile = vi.fn()
    render(
      <SideNav
        active="collection"
        onNavigateCollection={() => {}}
        profile={{ penName: 'ぺんた' }}
        onEditProfile={onEditProfile}
      />,
    )
    const card = screen.getByRole('button', { name: 'プロフィールを編集' })
    expect(card).toHaveTextContent('ぺんた')
    fireEvent.click(card)
    expect(onEditProfile).toHaveBeenCalledTimes(1)
  })

  it('アバター設定時：アバターは拡大表示、編集は別ボタン（両者が独立して動く）', () => {
    const onEditProfile = vi.fn()
    render(
      <SideNav
        active="collection"
        onNavigateCollection={() => {}}
        profile={{ penName: 'ぺんた', avatar: 'data:image/jpeg;base64,SGk=' }}
        onEditProfile={onEditProfile}
      />,
    )
    // 編集ボタンは残る（押下で編集）
    fireEvent.click(screen.getByRole('button', { name: 'プロフィールを編集' }))
    expect(onEditProfile).toHaveBeenCalledTimes(1)
    // アバターは拡大表示トリガ（クリックで編集は発火しない）
    fireEvent.click(screen.getByRole('button', { name: 'ぺんたのアバターを拡大表示' }))
    expect(onEditProfile).toHaveBeenCalledTimes(1)
  })

  it('設定・ヘルプは disabled で押せない', () => {
    render(<SideNav active="collection" onNavigateCollection={() => {}} />)
    expect(screen.getByRole('button', { name: '設定' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ヘルプ' })).toBeDisabled()
  })

  it('platformHref 指定時は grove への外部リンクを新しいタブで出す（両モード共通のフッター）', () => {
    render(<SideNav {...baseProps} platformHref="https://grove.example" />)
    const link = screen.getByRole('link', { name: 'コトノハ-grove-' })
    expect(link).toHaveAttribute('href', 'https://grove.example')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('投稿先未設定のビルド（platformHref なし）では grove リンクを出さない', () => {
    render(<SideNav active="collection" onNavigateCollection={() => {}} />)
    expect(screen.queryByRole('link', { name: 'コトノハ-grove-' })).toBeNull()
  })
})
