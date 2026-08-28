// @vitest-environment node
import {
  canFetchUrl,
  extractUrls,
  isAllowedImageHost,
  normalizeUrl,
  OGP_IMAGE_HOSTS,
  parseOgp,
  resolveImageUrl,
  urlKeyOf,
} from './link'

/**
 * 掲示板の外部リンク判定の契約テスト（設計書 09-board §7 の不変条件 8・9）。
 * ここが緩むと SSRF と「後出しの画像差し替え」が通るので、拒否側を厚く固定する。
 * crypto.subtle を素の実装で使うため node 環境で走らせる。
 */

describe('extractUrls', () => {
  it('出現順に抜き、重複は除く', () => {
    const body = 'a https://example.com/1 b https://example.com/2 c https://example.com/1'
    expect(extractUrls(body)).toEqual(['https://example.com/1', 'https://example.com/2'])
  })

  it('日本語の句読点を巻き込まない', () => {
    expect(extractUrls('詳しくは https://example.com/a。つづき')).toEqual(['https://example.com/a'])
    expect(extractUrls('これ→https://example.com/b、ここまで')).toEqual(['https://example.com/b'])
  })

  it('全角括弧を巻き込まない', () => {
    expect(extractUrls('（https://example.com/a）を見て')).toEqual(['https://example.com/a'])
    expect(extractUrls('「https://example.com/c」')).toEqual(['https://example.com/c'])
  })

  it('半角の閉じ括弧は開きが無いときだけ落とす', () => {
    expect(extractUrls('(https://example.com/a)')).toEqual(['https://example.com/a'])
    expect(extractUrls('https://ja.wikipedia.org/wiki/A_(B)')).toEqual([
      'https://ja.wikipedia.org/wiki/A_(B)',
    ])
  })

  it('文末のピリオドやカンマを落とす', () => {
    expect(extractUrls('see https://example.com/a.')).toEqual(['https://example.com/a'])
    expect(extractUrls('see https://example.com/a, and')).toEqual(['https://example.com/a'])
  })

  it('http も抜く（自動リンクの対象・取得可否は別判断）', () => {
    expect(extractUrls('http://example.com/x')).toEqual(['http://example.com/x'])
  })

  it('URL が無ければ空', () => {
    expect(extractUrls('リンクのない本文です。')).toEqual([])
  })
})

describe('normalizeUrl', () => {
  it('ホストを小文字化し、既定ポートとフラグメントを落とす', () => {
    expect(normalizeUrl('https://EXAMPLE.com:443/a#top')).toBe('https://example.com/a')
  })

  it('末尾スラッシュの扱いを一定にする（ルートだけ残す）', () => {
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a')
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/')
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('トラッキングパラメータを落とし、残らなければ ? ごと落とす', () => {
    expect(normalizeUrl('https://example.com/a?utm_source=x&utm_medium=y')).toBe(
      'https://example.com/a',
    )
    expect(normalizeUrl('https://example.com/a?gclid=1&fbclid=2&id=7')).toBe(
      'https://example.com/a?id=7',
    )
  })

  it('意味のあるパラメータは残す', () => {
    expect(normalizeUrl('https://example.com/watch?v=abc')).toBe('https://example.com/watch?v=abc')
  })

  it('ユーザー情報は残す（落とすと canFetchUrl の検査をすり抜ける）', () => {
    expect(normalizeUrl('https://user@evil.example/')).toBe('https://user@evil.example/')
  })

  it('読めない URL と http(s) 以外は null', () => {
    expect(normalizeUrl('あいうえお')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,<b>x</b>')).toBeNull()
  })
})

describe('urlKeyOf', () => {
  it('32 桁の hex で、同じ URL なら同じキー', async () => {
    const a = await urlKeyOf('https://example.com/a')
    const b = await urlKeyOf('https://example.com/a')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toBe(a)
  })

  it('URL が違えばキーも違う', async () => {
    expect(await urlKeyOf('https://example.com/a')).not.toBe(
      await urlKeyOf('https://example.com/b'),
    )
  })
})

describe('canFetchUrl（不変条件 8）', () => {
  it('ふつうの https は通り、正規化済み URL を返す', () => {
    expect(canFetchUrl('https://example.com/a/?utm_source=x#top')).toEqual({
      ok: true,
      url: 'https://example.com/a',
    })
  })

  it('https 以外を拒否する', () => {
    expect(canFetchUrl('http://example.com/')).toEqual({ ok: false, reason: 'scheme' })
    expect(canFetchUrl('ftp://example.com/')).toEqual({ ok: false, reason: 'scheme' })
    expect(canFetchUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'scheme' })
    expect(canFetchUrl('data:text/html,x')).toEqual({ ok: false, reason: 'scheme' })
    expect(canFetchUrl('とても URL ではない')).toEqual({ ok: false, reason: 'invalid-url' })
  })

  it('IP リテラルを拒否する（8 進・16 進・整数表記の偽装も）', () => {
    for (const url of [
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://2130706433/',
      'https://0x7f.0.0.1/',
      'https://0177.0.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/',
      'https://[fd00::1]/',
    ]) {
      expect(canFetchUrl(url), url).toEqual({ ok: false, reason: 'ip-literal' })
    }
  })

  it('443 以外の明示ポートを拒否する', () => {
    expect(canFetchUrl('https://example.com:8080/')).toEqual({ ok: false, reason: 'port' })
    expect(canFetchUrl('https://example.com:443/')).toEqual({
      ok: true,
      url: 'https://example.com/',
    })
  })

  it('自オリジンを拒否する（サブドメインも）', () => {
    expect(canFetchUrl('https://cotonoha-leaf.org/api/board')).toEqual({
      ok: false,
      reason: 'self-origin',
    })
    expect(canFetchUrl('https://grove.cotonoha-leaf.org/works/1')).toEqual({
      ok: false,
      reason: 'self-origin',
    })
    expect(canFetchUrl('https://stg.novel-studio-b2m.pages.dev/')).toEqual({
      ok: false,
      reason: 'self-origin',
    })
  })

  it('自オリジンは opts で足せる', () => {
    expect(canFetchUrl('https://internal.example/', { selfHosts: ['internal.example'] })).toEqual({
      ok: false,
      reason: 'self-origin',
    })
    // 既定の表を差し替えたら、既定に入っていたホストは通る
    expect(canFetchUrl('https://cotonoha-leaf.org/', { selfHosts: ['other.example'] })).toEqual({
      ok: true,
      url: 'https://cotonoha-leaf.org/',
    })
  })

  it('自オリジン似のホストは拒否しない（ドット境界で照合する）', () => {
    expect(canFetchUrl('https://cotonoha-leaf.org.evil.example/')).toEqual({
      ok: true,
      url: 'https://cotonoha-leaf.org.evil.example/',
    })
    expect(canFetchUrl('https://evil-pages.dev/')).toEqual({
      ok: true,
      url: 'https://evil-pages.dev/',
    })
  })

  it('内部 TLD・ドット無しホスト・末尾ドットを拒否する', () => {
    for (const url of [
      'https://printer.local/',
      'https://api.internal/',
      'https://foo.localhost/',
      'https://intranet/',
      'https://example.com./',
    ]) {
      expect(canFetchUrl(url), url).toEqual({ ok: false, reason: 'internal-host' })
    }
  })

  it('ユーザー情報つきを拒否する', () => {
    expect(canFetchUrl('https://user@evil.example/')).toEqual({ ok: false, reason: 'userinfo' })
    expect(canFetchUrl('https://user:pass@evil.example/')).toEqual({
      ok: false,
      reason: 'userinfo',
    })
  })
})

describe('isAllowedImageHost（不変条件 9）', () => {
  it('接尾辞一致はドット境界でのみ成立する', () => {
    expect(isAllowedImageHost('pbs.twimg.com', ['twimg.com'])).toBe(true)
    expect(isAllowedImageHost('evil-twimg.com', ['twimg.com'])).toBe(false)
    expect(isAllowedImageHost('twimg.com.evil.example', ['twimg.com'])).toBe(false)
    expect(isAllowedImageHost('twimg.com', ['twimg.com'])).toBe(true)
  })

  it('大文字と末尾ドットを正規化してから比べる', () => {
    expect(isAllowedImageHost('PBS.TWIMG.COM.', ['twimg.com'])).toBe(true)
  })

  it('既定の表（OGP_IMAGE_HOSTS）を使う', () => {
    expect(isAllowedImageHost('pbs.twimg.com')).toBe(true)
    expect(isAllowedImageHost('example.com')).toBe(false)
    expect(isAllowedImageHost('')).toBe(false)
    expect(OGP_IMAGE_HOSTS.length).toBeGreaterThan(0)
  })
})

describe('resolveImageUrl', () => {
  it('相対 URL をページ URL で絶対化する', () => {
    expect(resolveImageUrl('/cover.png', 'https://img.example/works/1', ['img.example'])).toBe(
      'https://img.example/cover.png',
    )
  })

  it('許可表の外のホストは空文字（テキストカードに落とす）', () => {
    expect(
      resolveImageUrl('https://evil.example/x.png', 'https://evil.example/', ['img.example']),
    ).toBe('')
    expect(
      resolveImageUrl('https://evil-twimg.com/x.png', 'https://evil-twimg.com/', ['twimg.com']),
    ).toBe('')
  })

  it('https 以外は空文字', () => {
    expect(
      resolveImageUrl('http://img.example/x.png', 'https://img.example/', ['img.example']),
    ).toBe('')
    expect(
      resolveImageUrl('data:image/png;base64,AAA', 'https://img.example/', ['img.example']),
    ).toBe('')
  })

  it('空・壊れた値は空文字', () => {
    expect(resolveImageUrl('', 'https://img.example/', ['img.example'])).toBe('')
    expect(resolveImageUrl('/x.png', 'not a url', ['img.example'])).toBe('')
  })
})

describe('parseOgp', () => {
  it('属性順が逆・単引用符・大文字混じりでも取れる', () => {
    const html = `<html><head>
      <META CONTENT='コトノハ' PROPERTY='OG:TITLE'>
      <meta content="縦書きの小説エディタ" property="og:description" />
      <meta Name="OG:IMAGE" Content="https://img.example/a.png">
      <meta content='コトノハ-leaf-' property=og:site_name>
    </head><body><meta property="og:title" content="本文の偽物"></body></html>`
    expect(parseOgp(html)).toEqual({
      title: 'コトノハ',
      description: '縦書きの小説エディタ',
      image: 'https://img.example/a.png',
      siteName: 'コトノハ-leaf-',
    })
  })

  it('og が無ければ title / meta description に落ちる', () => {
    const html = `<head><title>
      ページの題
    </title><meta name="Description" content="説明"></head>`
    expect(parseOgp(html)).toMatchObject({
      title: 'ページの題',
      description: '説明',
      image: '',
      siteName: '',
    })
  })

  it('HTML エンティティをデコードする', () => {
    const html =
      '<head><meta property="og:title" content="A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#x27; &#12354;"></head>'
    expect(parseOgp(html).title).toBe(`A & B <C> "D" 'E' あ`)
  })

  it('属性値の中の > で切れない', () => {
    const html = '<head><meta property="og:description" content="a > b > c"><title>T</title></head>'
    expect(parseOgp(html).description).toBe('a > b > c')
  })

  it('長さで切り詰める（title 120 / description 300）', () => {
    const html = `<head><meta property="og:title" content="${'あ'.repeat(200)}"><meta property="og:description" content="${'い'.repeat(400)}"></head>`
    const meta = parseOgp(html)
    expect(Array.from(meta.title)).toHaveLength(120)
    expect(Array.from(meta.description)).toHaveLength(300)
  })

  it('メタが無ければ全部空文字', () => {
    expect(parseOgp('<html><body>なにもない</body></html>')).toEqual({
      title: '',
      description: '',
      image: '',
      siteName: '',
    })
  })

  it('og:image は resolveImageUrl と組み合わせて許可表で絞る', () => {
    const html = '<head><meta property="og:image" content="/a.png"></head>'
    const meta = parseOgp(html)
    expect(resolveImageUrl(meta.image, 'https://evil.example/p', ['img.example'])).toBe('')
    expect(resolveImageUrl(meta.image, 'https://img.example/p', ['img.example'])).toBe(
      'https://img.example/a.png',
    )
  })
})
