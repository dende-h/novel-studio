import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LinkCard } from '@/core/board/types'
import { BoardLinkCard } from './link-card'

const cardOf = (over: Partial<LinkCard> = {}): LinkCard => ({
  url: 'https://example.com/articles/1',
  host: 'example.com',
  kind: 'ogp',
  title: '記事のタイトル',
  description: '記事の説明',
  imageUrl: '',
  siteName: '',
  ...over,
})

describe('BoardLinkCard — 飛び先の明示', () => {
  it('外部リンクは target と rel を付ける', () => {
    const { container } = render(<BoardLinkCard card={cardOf()} />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://example.com/articles/1')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toBe('nofollow ugc noopener noreferrer')
  })

  it('ドメインは必ず描く', () => {
    render(<BoardLinkCard card={cardOf()} />)
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('タイトルも説明も取れなかった URL でも、ドメインと URL は出る', () => {
    render(<BoardLinkCard card={cardOf({ kind: 'none', title: '', description: '' })} />)
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/articles/1')).toBeInTheDocument()
  })

  it('サイト名があってもドメインは省かない', () => {
    render(<BoardLinkCard card={cardOf({ siteName: 'サンプル出版' })} />)
    expect(screen.getByText('サンプル出版')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })
})

describe('BoardLinkCard — 画像（D-BOARD-OGPIMG）', () => {
  it('imageUrl が空ならテキストカードに落ちる（img を出さない）', () => {
    const { container } = render(<BoardLinkCard card={cardOf({ imageUrl: '' })} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('記事のタイトル')).toBeInTheDocument()
  })

  it('imageUrl があれば lazy・no-referrer・固定の縦横比枠で出す', () => {
    const { container } = render(
      <BoardLinkCard card={cardOf({ imageUrl: 'https://img.example.com/a.png' })} />,
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://img.example.com/a.png')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
    // 読み込み前から高さが決まっている（あとから届いた画像で行が飛ばない）
    expect(img?.parentElement?.className).toContain('aspect-')
  })

  it('画像の読み込みに失敗したら枠ごと畳む', () => {
    const { container } = render(
      <BoardLinkCard card={cardOf({ imageUrl: 'https://img.example.com/broken.png' })} />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    if (img) fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    // 画像が落ちてもリンクとして読める
    expect(screen.getByText('記事のタイトル')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })
})

describe('BoardLinkCard — 作品カード（D-BOARD-WORKCARD）', () => {
  it('kind が work なら「作品」だと分かる印を出す', () => {
    render(
      <BoardLinkCard
        card={cardOf({ kind: 'work', title: '銀の街の物語', description: 'あらすじ' })}
      />,
    )
    expect(screen.getByText('作品')).toBeInTheDocument()
    expect(screen.getByText('銀の街の物語')).toBeInTheDocument()
  })

  it('作品カードは普通のリンクカードと見た目を変える', () => {
    const work = render(<BoardLinkCard card={cardOf({ kind: 'work' })} />)
    const ogp = render(<BoardLinkCard card={cardOf({ kind: 'ogp' })} />)
    const cls = (r: ReturnType<typeof render>) =>
      r.container.querySelector('[data-slot="card"]')?.className ?? ''
    expect(cls(work)).not.toBe(cls(ogp))
  })

  it('作品カードでも imageUrl が空なら img を出さない', () => {
    const { container } = render(<BoardLinkCard card={cardOf({ kind: 'work', imageUrl: '' })} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
