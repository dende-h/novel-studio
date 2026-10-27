import { describe, expect, it } from 'vitest'
import { POSTING_SITE_INTRO_MAX, POSTING_SITES, siteHost } from './index'

describe('POSTING_SITES（小説投稿サイトの紹介）', () => {
  it('どのサイトも https のトップを指す', () => {
    for (const site of POSTING_SITES) {
      expect(new URL(site.url).protocol, site.name).toBe('https:')
    }
  })

  it('URL が重ならない（並びの key に使う）', () => {
    const urls = POSTING_SITES.map((s) => s.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('紹介文は1段落で、2行ほどに収まる長さ', () => {
    for (const site of POSTING_SITES) {
      expect(site.intro.trim(), site.name).not.toBe('')
      expect(site.intro, site.name).not.toMatch(/\n/)
      expect([...site.intro].length, site.name).toBeLessThanOrEqual(POSTING_SITE_INTRO_MAX)
    }
  })

  it('サイト名が空でない', () => {
    for (const site of POSTING_SITES) expect(site.name.trim()).not.toBe('')
  })
})

describe('siteHost', () => {
  it('URL からドメインだけを取り出す', () => {
    expect(siteHost('https://kakippa.com/')).toBe('kakippa.com')
    expect(siteHost('https://www.example.jp/novel?x=1')).toBe('www.example.jp')
  })
})
