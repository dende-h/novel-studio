import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import {
  buildContainerXml,
  buildEpubFiles,
  buildNavXhtml,
  buildPackageOpf,
  buildStyleCss,
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
        { id: 'b3', type: 'sceneBreak' },
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
    expect(x).toContain('<ruby>漢字<rt>かんじ</rt></ruby>')
    expect(x).toContain('<em class="dots">重要</em>')
    expect(x).toContain('<hr class="scene-break" />')
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

  it('buildEpubFiles は EPUB に必要な全ファイルを束ねる', () => {
    const files = buildEpubFiles(work)
    const paths = files.map((f) => f.path)
    expect(paths).toContain('mimetype')
    expect(paths).toContain('META-INF/container.xml')
    expect(paths).toContain('OEBPS/content.opf')
    expect(paths).toContain('OEBPS/nav.xhtml')
    expect(paths).toContain('OEBPS/style.css')
    expect(paths).toContain('OEBPS/text/ep-e1.xhtml')
    expect(paths).toContain('OEBPS/text/ep-e2.xhtml')
    expect(files.find((f) => f.path === 'mimetype')?.content).toBe('application/epub+zip')
  })
})
