import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { zipStore } from '../zip'
import {
  buildContainerXml,
  buildEpubFiles,
  buildNavXhtml,
  buildPackageOpf,
  buildStyleCss,
  buildTocNcx,
  episodeToXhtml,
} from './toEpub'

const work: Work = {
  id: 'w1',
  title: '夜の物語',
  episodes: [
    {
      id: 'e1',
      title: '第一話 出会い',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [{ type: 'ruby', base: '漢字', reading: 'かんじ' }],
        },
        { id: 'b2', type: 'paragraph', inlines: [{ type: 'emphasisDots', text: '重要' }] },
        { id: 'b4', type: 'paragraph', inlines: [{ type: 'text', text: 'a<b>&c' }] },
      ],
    },
    {
      id: 'e2',
      title: '第二話',
      blocks: [{ id: 'b5', type: 'paragraph', inlines: [{ type: 'text', text: '終わり' }] }],
    },
  ],
}

describe('toEpub（EPUB3 縦書き・純生成）', () => {
  it('episodeToXhtml は本文を XHTML に包み、タイトルと本文描画を含む', () => {
    const x = episodeToXhtml(work.episodes[0]!)
    expect(x).toContain('<?xml')
    expect(x).toContain('xmlns="http://www.w3.org/1999/xhtml"')
    expect(x).toContain('<title>第一話 出会い</title>')
    expect(x).toContain('<ruby>漢字<rp>（</rp><rt>かんじ</rt><rp>）</rp></ruby>')
    expect(x).toContain('<em class="dots">重要</em>')
    expect(x).toContain('a&lt;b&gt;&amp;c')
  })

  it('buildContainerxml は content.opf を指す', () => {
    const c = buildContainerXml()
    expect(c).toContain('OEBPS/content.opf')
    expect(c).toContain('urn:oasis:names:tc:opendocument:xmlns:container')
  })

  it('buildPackageOpf は作品名と全話を manifest/spine に列挙', () => {
    const opf = buildPackageOpf(work)
    expect(opf).toContain('<dc:title>夜の物語</dc:title>')
    expect(opf).toContain('text/ep-e1.xhtml')
    expect(opf).toContain('text/ep-e2.xhtml')
    expect(opf.indexOf('idref="ep-e1"')).toBeLessThan(opf.indexOf('idref="ep-e2"'))
    expect(opf).toContain('nav.xhtml')
  })

  it('buildPackageOpf はメタ情報（著者・概要）を dc:creator / dc:description に出力しエスケープする', () => {
    const opf = buildPackageOpf({
      ...work,
      author: '山田 <太郎>',
      description: 'あらすじ & 概要',
    })
    expect(opf).toContain('<dc:creator>山田 &lt;太郎&gt;</dc:creator>')
    expect(opf).toContain('<dc:description>あらすじ &amp; 概要</dc:description>')
  })

  it('buildPackageOpf は著者・概要が無ければ dc:creator / dc:description を出さない', () => {
    const opf = buildPackageOpf(work)
    expect(opf).not.toContain('<dc:creator>')
    expect(opf).not.toContain('<dc:description>')
  })

  it('buildPackageOpf は空白のみの著者・概要を出力しない', () => {
    const opf = buildPackageOpf({ ...work, author: '   ', description: '\n  \n' })
    expect(opf).not.toContain('<dc:creator>')
    expect(opf).not.toContain('<dc:description>')
  })

  it('buildPackageOpf は EPUB3 必須の dcterms:modified を updatedAt から秒精度UTCで出力', () => {
    const updatedAt = Date.UTC(2026, 5, 14, 5, 30, 0)
    const opf = buildPackageOpf({ ...work, updatedAt })
    expect(opf).toContain('<meta property="dcterms:modified">2026-06-14T05:30:00Z</meta>')
  })

  it('buildNavXhtml は話タイトルを目次リンクに列挙', () => {
    const nav = buildNavXhtml(work)
    expect(nav).toContain('epub:type="toc"')
    expect(nav).toContain('第一話 出会い')
    expect(nav).toContain('href="text/ep-e1.xhtml"')
    expect(nav).toContain('href="text/ep-e2.xhtml"')
  })

  it('buildStyleCss は縦書き指定を含む', () => {
    expect(buildStyleCss()).toContain('writing-mode: vertical-rl')
  })

  it('buildStyleCss は縦中横（text-combine-upright）を含む', () => {
    expect(buildStyleCss()).toContain('text-combine-upright: all')
  })

  it('episodeToXhtml はタイトル h1 内の半角数字を縦中横 span で包む', () => {
    const x = episodeToXhtml({
      id: 'e9',
      title: '第12話',
      blocks: [{ id: 'b9', type: 'paragraph', inlines: [{ type: 'text', text: '5年後' }] }],
    })
    expect(x).toContain('<h1>第<span class="tcy">12</span>話</h1>')
    expect(x).toContain('<span class="tcy">5</span>年後')
  })

  it('GE-E1: @参照は EPUB ではプレーン名へ degrade（リンク化しない＝辞書非依存）', () => {
    const x = episodeToXhtml({
      id: 'e9',
      title: '第九話',
      blocks: [{ id: 'b9', type: 'paragraph', inlines: [{ type: 'ref', name: 'アリス' }] }],
    })
    expect(x).toContain('<p>アリス</p>')
    expect(x).not.toContain('class="ref"')
    expect(x).not.toContain('data-ref-name')
  })

  it('buildEpubFiles は EPUB に必要な全ファイルを束ねる', () => {
    const files = buildEpubFiles(work)
    const paths = files.map((f) => f.path)
    expect(paths[0]).toBe('mimetype') // OCF: mimetype はアーカイブ先頭
    expect(paths).toContain('mimetype')
    expect(paths).toContain('OEBPS/toc.ncx')
    expect(paths).toContain('META-INF/container.xml')
    expect(paths).toContain('OEBPS/content.opf')
    expect(paths).toContain('OEBPS/nav.xhtml')
    expect(paths).toContain('OEBPS/style.css')
    expect(paths).toContain('OEBPS/text/ep-e1.xhtml')
    expect(paths).toContain('OEBPS/text/ep-e2.xhtml')
    expect(files.find((f) => f.path === 'mimetype')?.content).toBe('application/epub+zip')
  })

  // 表紙画像（coverImage）。"Hi" の JPEG ではないがバイト化の検証には十分。
  const COVER = 'data:image/jpeg;base64,SGk='
  const withCover: Work = { ...work, coverImage: COVER }

  it('buildPackageOpf は hasCover で cover-image item と <meta name="cover"> を出す', () => {
    const opf = buildPackageOpf(withCover, true)
    expect(opf).toContain('<meta name="cover" content="cover-image" />')
    expect(opf).toContain(
      '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image" />',
    )
  })

  it('buildPackageOpf は hasCover=false で表紙宣言を出さない', () => {
    const opf = buildPackageOpf(work)
    expect(opf).not.toContain('cover-image')
    expect(opf).not.toContain('name="cover"')
  })

  it('buildEpubFiles は coverImage があれば cover.jpg バイトと OPF 宣言を揃えて出す', () => {
    const files = buildEpubFiles(withCover)
    const cover = files.find((f) => f.path === 'OEBPS/images/cover.jpg')
    expect(cover?.content).toBeInstanceOf(Uint8Array)
    expect(Array.from(cover?.content as Uint8Array)).toEqual([72, 105])
    const opf = files.find((f) => f.path === 'OEBPS/content.opf')?.content as string
    expect(opf).toContain('properties="cover-image"')
  })

  it('buildEpubFiles は coverImage が無ければ cover.jpg も宣言も出さない', () => {
    const files = buildEpubFiles(work)
    expect(files.find((f) => f.path === 'OEBPS/images/cover.jpg')).toBeUndefined()
    const opf = files.find((f) => f.path === 'OEBPS/content.opf')?.content as string
    expect(opf).not.toContain('cover-image')
  })

  it('buildEpubFiles は不正な data URL を表紙なしへフォールバック（宣言とファイルを揃える）', () => {
    const files = buildEpubFiles({ ...work, coverImage: 'data:image/jpeg;base64,@@notbase64@@' })
    expect(files.find((f) => f.path === 'OEBPS/images/cover.jpg')).toBeUndefined()
    const opf = files.find((f) => f.path === 'OEBPS/content.opf')?.content as string
    expect(opf).not.toContain('cover-image')
  })
})

/**
 * Kindle 縦書き・KDP 互換の回帰テスト（後の変更で壊れやすい要点を固定する）。
 * 参照: primary-writing-mode / page-progression-direction / nav+ncx 併載 / ruby / mimetype 先頭・無圧縮。
 */
describe('Kindle縦書き・KDP互換の回帰（P0+P1）', () => {
  const opf = () => buildPackageOpf(work)

  it('OPF spine に page-progression-direction="rtl" がある', () => {
    expect(opf()).toContain('page-progression-direction="rtl"')
  })

  it('OPF に Amazon 用 primary-writing-mode（EPUB2形式 name/content）がある', () => {
    expect(opf()).toContain('<meta name="primary-writing-mode" content="vertical-rl" />')
  })

  it('OPF に dc:language ja がある', () => {
    expect(opf()).toContain('<dc:language>ja</dc:language>')
  })

  it('OPF spine が NCX を参照し、manifest に NCX 項目がある', () => {
    expect(opf()).toContain('toc="ncx"')
    expect(opf()).toContain(
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />',
    )
  })

  it('nav.xhtml と toc.ncx の両方を生成する', () => {
    const paths = buildEpubFiles(work).map((f) => f.path)
    expect(paths).toContain('OEBPS/nav.xhtml')
    expect(paths).toContain('OEBPS/toc.ncx')
  })

  it('toc.ncx は dtb:uid を OPF の識別子と一致させ、全話を navPoint に持つ', () => {
    const ncx = buildTocNcx(work)
    expect(ncx).toContain(`<meta name="dtb:uid" content="urn:uuid:${work.id}" />`)
    const navPoints = ncx.match(/<navPoint /g) ?? []
    expect(navPoints.length).toBe(work.episodes.length)
    expect(ncx).toContain('playOrder="1"')
    for (const ep of work.episodes) expect(ncx).toContain(ep.title)
  })

  it('CSS に縦書き（vendor prefix 併記）と禁則 line-break: strict がある', () => {
    const css = buildStyleCss()
    expect(css).toContain('writing-mode: vertical-rl;')
    expect(css).toContain('-epub-writing-mode: vertical-rl;')
    expect(css).toContain('-webkit-writing-mode: vertical-rl;')
    expect(css).toContain('line-break: strict;')
  })

  it('CSS に日本語フォントを埋め込まない（@font-face を持たない）', () => {
    expect(buildStyleCss()).not.toContain('@font-face')
  })

  it('本文の ruby は rp フォールバック括弧つきで出力される', () => {
    const xhtml = episodeToXhtml(work.episodes[0]!)
    expect(xhtml).toMatch(/<ruby>[^<]*<rp>（<\/rp><rt>[^<]*<\/rt><rp>）<\/rp><\/ruby>/)
  })

  it('zipStore は mimetype を先頭・無圧縮(STORED)・extra無しで格納する', () => {
    const bytes = zipStore(buildEpubFiles(work).map((f) => ({ path: f.path, data: f.content })))
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(dv.getUint32(0, true)).toBe(0x04034b50) // local file header signature
    expect(dv.getUint16(8, true)).toBe(0) // compression method = STORED
    const nameLen = dv.getUint16(26, true)
    const extraLen = dv.getUint16(28, true)
    expect(extraLen).toBe(0)
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLen))
    expect(name).toBe('mimetype')
    const body = new TextDecoder().decode(bytes.slice(30 + nameLen, 30 + nameLen + 20))
    expect(body).toBe('application/epub+zip')
  })
})
