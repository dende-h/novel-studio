// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  deviceOf,
  hostOfOrigin,
  isBot,
  jstDate,
  normalizePath,
  refererHostOf,
  siteOf,
  uaFamily,
  visitorHash,
} from './visitor'

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

describe('siteOf', () => {
  it('本番の 2 サイトだけを通す', () => {
    expect(siteOf('cotonoha-leaf.org')).toBe('leaf')
    expect(siteOf('www.cotonoha-leaf.org')).toBe('leaf')
    expect(siteOf('grove.cotonoha-leaf.org')).toBe('grove')
    expect(siteOf('cotonoha-grove.org')).toBe('grove')
  })

  it('stg・プレビュー・ローカルは対象外（＝開発者自身が混ざらない）', () => {
    expect(siteOf('novel-studio-b2m.pages.dev')).toBeNull()
    expect(siteOf('stg.novel-studio-b2m.pages.dev')).toBeNull()
    expect(siteOf('localhost')).toBeNull()
    expect(siteOf('cotonoha-leaf.org.evil.example')).toBeNull()
  })
})

describe('hostOfOrigin', () => {
  it('Origin からホスト名を取り出す。壊れていれば空', () => {
    expect(hostOfOrigin('https://cotonoha-leaf.org')).toBe('cotonoha-leaf.org')
    expect(hostOfOrigin('')).toBe('')
    expect(hostOfOrigin('null')).toBe('')
  })
})

describe('jstDate', () => {
  it('日本時間で日付が変わる', () => {
    // 2026-08-19T14:59:59Z ＝ JST 23:59 → まだ 8/19
    expect(jstDate(Date.parse('2026-08-19T14:59:59Z'))).toBe('2026-08-19')
    // 2026-08-19T15:00:00Z ＝ JST 翌 00:00 → 8/20
    expect(jstDate(Date.parse('2026-08-19T15:00:00Z'))).toBe('2026-08-20')
  })
})

describe('isBot', () => {
  it('素朴なクローラ・ヘッドレスを落とす', () => {
    expect(isBot('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true)
    expect(isBot('Mozilla/5.0 HeadlessChrome/140.0.0.0')).toBe(true)
    expect(isBot('curl/8.4.0')).toBe(true)
    expect(isBot(CHROME_WIN)).toBe(false)
    expect(isBot(SAFARI_IOS)).toBe(false)
  })
})

describe('uaFamily', () => {
  it('ブラウザと OS の族に丸める', () => {
    expect(uaFamily(CHROME_WIN)).toBe('Chrome/Windows')
    expect(uaFamily(SAFARI_IOS)).toBe('Safari/iOS')
    expect(uaFamily('Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537.36 Edg/140.0.0.0')).toBe(
      'Edge/Windows',
    )
    expect(uaFamily('Mozilla/5.0 (Android 15; Mobile) Gecko/140.0 Firefox/140.0')).toBe(
      'Firefox/Android',
    )
    expect(uaFamily('')).toBe('Other/Other')
  })

  it('バージョン差は同じ族＝同一人物として数える', () => {
    const before = uaFamily(CHROME_WIN)
    const after = uaFamily(CHROME_WIN.replace('140.0.0.0', '141.0.0.0'))
    expect(after).toBe(before)
  })
})

describe('deviceOf', () => {
  it('端末種別を判定する', () => {
    expect(deviceOf(CHROME_WIN)).toBe('desktop')
    expect(deviceOf(SAFARI_IOS)).toBe('mobile')
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) Safari/604.1')).toBe('tablet')
    expect(
      deviceOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140 Mobile Safari/537.36'),
    ).toBe('mobile')
  })
})

describe('normalizePath', () => {
  it('クエリ・ハッシュを落とし、長さを切り詰める', () => {
    expect(normalizePath('/lp/?utm_source=x#top')).toBe('/lp/')
    expect(normalizePath('/works/abc')).toBe('/works/abc')
    expect(normalizePath(`/${'a'.repeat(200)}`)).toHaveLength(128)
  })

  it('パスでないものは / に倒す', () => {
    expect(normalizePath('https://evil.example/x')).toBe('/')
    expect(normalizePath(undefined)).toBe('/')
    expect(normalizePath(123)).toBe('/')
  })
})

describe('refererHostOf', () => {
  it('参照元のホストだけ残す。空・不正は直接アクセス扱い', () => {
    expect(refererHostOf('https://t.co/abcdef')).toBe('t.co')
    expect(refererHostOf('')).toBe('')
    expect(refererHostOf('not a url')).toBe('')
    expect(refererHostOf(null)).toBe('')
  })
})

describe('visitorHash', () => {
  const base = {
    salt: 's',
    date: '2026-08-20',
    ip: '203.0.113.9',
    family: 'Chrome/Windows',
  } as const

  it('同じ日・同じ相手なら同じ符号', async () => {
    const a = await visitorHash({ ...base, site: 'leaf' })
    const b = await visitorHash({ ...base, site: 'leaf' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('日付が変われば別の符号になる（日をまたいだ追跡ができない）', async () => {
    const a = await visitorHash({ ...base, site: 'leaf' })
    const b = await visitorHash({ ...base, date: '2026-08-21', site: 'leaf' })
    expect(a).not.toBe(b)
  })

  it('IP・UA 族・サイト・ソルトのいずれが変わっても別の符号', async () => {
    const a = await visitorHash({ ...base, site: 'leaf' })
    expect(await visitorHash({ ...base, ip: '203.0.113.10', site: 'leaf' })).not.toBe(a)
    expect(await visitorHash({ ...base, family: 'Safari/iOS', site: 'leaf' })).not.toBe(a)
    expect(await visitorHash({ ...base, site: 'grove' })).not.toBe(a)
    expect(await visitorHash({ ...base, salt: 's2', site: 'leaf' })).not.toBe(a)
  })
})
