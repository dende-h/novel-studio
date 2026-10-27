import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { POSTING_SITES } from '@/core/sites'
import { PostingSitesPage } from './posting-sites-page'

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

  it('サイト名・ドメイン・紹介文を出し、相手の画像は読み込まない', () => {
    const { container } = render(<PostingSitesPage />)
    for (const site of POSTING_SITES) {
      const link = screen.getByRole('link', { name: new RegExp(site.name) })
      expect(link).toHaveTextContent(new URL(site.url).host)
      expect(link).toHaveTextContent(site.intro)
    }
    expect(container.querySelector('img')).toBeNull()
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
