import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { POSTING_SITES, type PostingSite } from '@/core/sites'
import { PostingSitesPage } from './posting-sites-page'

const withBanner: PostingSite = {
  name: 'バナーのあるサイト',
  url: 'https://a.example/',
  intro: '紹介文その1。',
  banner: 'https://a.example/og.jpg',
}
const withoutBanner: PostingSite = {
  name: 'バナーのないサイト',
  url: 'https://b.example/',
  intro: '紹介文その2。',
}

describe('PostingSitesPage（小説投稿サイトの紹介）', () => {
  it('載せたサイトをすべて、新しいタブで開くリンクとして出す', () => {
    render(<PostingSitesPage />)
    expect(POSTING_SITES.length).toBeGreaterThan(0)
    for (const site of POSTING_SITES) {
      const link = screen.getByRole('link', { name: new RegExp(site.name) })
      expect(link).toHaveAttribute('href', site.url)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener')
    }
  })

  it('サイト名・ドメイン・紹介文を出す', () => {
    render(<PostingSitesPage sites={[withBanner]} />)
    const link = screen.getByRole('link', { name: /バナーのあるサイト/ })
    expect(link).toHaveTextContent('a.example')
    expect(link).toHaveTextContent('紹介文その1。')
  })

  it('バナーは相手のサーバから読み、切り抜かずに全体を出す', () => {
    const { container } = render(<PostingSitesPage sites={[withBanner]} />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://a.example/og.jpg')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(img).toHaveClass('object-contain')
  })

  it('バナーが読み込めなければ、サイト名の札に倒す', () => {
    const { container } = render(<PostingSitesPage sites={[withBanner]} />)
    const img = container.querySelector('img')
    if (!img) throw new Error('img がない')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    const link = screen.getByRole('link', { name: /バナーのあるサイト/ })
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent('バナーのあるサイト')
  })

  it('バナーの無いサイトは、はじめからサイト名の札を出す', () => {
    const { container } = render(<PostingSitesPage sites={[withoutBanner]} />)
    expect(container.querySelector('img')).toBeNull()
    const link = screen.getByRole('link', { name: /バナーのないサイト/ })
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent('バナーのないサイト')
  })

  it('運営の方への連絡先として、ヘルプのお問い合わせフォームへ案内する', () => {
    render(<PostingSitesPage />)
    expect(screen.getByRole('heading', { name: '掲載しているサイトの運営の方へ' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'ヘルプのお問い合わせフォーム' })).toHaveAttribute(
      'href',
      '#/help',
    )
  })
})
