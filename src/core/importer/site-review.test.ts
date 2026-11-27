// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blocksToNotation } from '../exporter/blocksToNotation'
import { buildEpubFiles } from '../exporter/toEpub'
import { toPostingSite } from '../exporter/toPostingSite'
import { parseEpisodeBody } from '../parser/parseNotation'
import { illustrationFileTag } from '../sites/illustrations'
import type { PostingSiteId } from '../sites/portability'
import { zipStore } from '../zip'
import { readArchive } from '../zip/read'
import {
  manuscriptBytes,
  readLooseManuscripts,
  readManuscriptArchive,
  readManuscriptFiles,
} from './manuscript'
import { makePostingWork } from './posting-work'
import { kakuyomuEpisode, type ManuscriptSource } from './site-formats'
import { parseExternalNotation } from './site-notation'

const standardNcx =
  '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN"\n "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">'
const encoder = new TextEncoder()
const png = new Uint8Array([0x89, 80, 78, 71, 13, 10, 26, 10])
const decomposed = 'か\u3099'
const composed = decomposed.normalize('NFC')

function epub(ncxDeclaration = standardNcx) {
  const xhtml =
    '<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:body>' +
    '<x:p><x:span/>前<x:br/>後<x:em>強調</x:em><x:em><x:ruby>雪<x:rt>ゆき</x:rt></x:ruby>残る</x:em></x:p>' +
    '<x:p><x:img src="img/' +
    composed +
    '.png"/><x:img src="https://example.invalid/hidden.png" alt="外部"/></x:p>' +
    '<x:script>取得しない</x:script></x:body></x:html>'
  const item =
    '<item id="a" href="話/' +
    encodeURIComponent(decomposed) +
    '.xhtml" media-type="application/xhtml+xml"/>'
  const ncx =
    '<?xml version="1.0"?>\n<!-- fixture -->\n' +
    ncxDeclaration +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>' +
    '<navPoint><navLabel><text>HTML題</text></navLabel><content src="b.html"/></navPoint>' +
    '<navPoint><navLabel><text>XML題</text></navLabel><content src="話/' +
    composed +
    '.xhtml#anchor"/></navPoint>' +
    '</navMap></ncx>'
  return zipStore([
    { path: 'mimetype', data: 'application/epub+zip\r\n' },
    {
      path: 'META-INF/container.xml',
      data:
        '<container><rootfiles><rootfile full-path="' +
        composed +
        '/book.opf"/></rootfiles></container>',
    },
    {
      path: decomposed + '/book.opf',
      data:
        '<package version="2.0"><metadata><title>EPUB 2</title></metadata>' +
        '<manifest><item id="nx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
        '<item id="b" href="b.html" media-type="text/html"/>' +
        item +
        '</manifest>' +
        '<spine toc="nx"><itemref idref="a"/><itemref idref="b"/></spine></package>',
    },
    { path: composed + '/toc.ncx', data: ncx },
    { path: composed + '/b.html', data: '<body><p>HTML<br>次の行<script>実行しない</script>' },
    { path: composed + '/話/' + composed + '.xhtml', data: xhtml },
    { path: composed + '/話/img/' + decomposed + '.png', data: png },
  ])
}

afterEach(() => vi.unstubAllGlobals())

describe('EPUB 2の構造と安全な本文の読み取り', () => {
  it('NCX、NFC、末尾改行付きmimetype、XHTML/HTMLを一つのEPUBで読み分ける', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const source = await readManuscriptArchive({ path: 'sample.epub', data: epub() })
    expect(source.title).toBe('EPUB 2')
    expect(source.episodes.map((entry) => entry.title)).toEqual(['XML題', 'HTML題'])
    expect(source.episodes.map((entry) => entry.path)).toEqual([
      composed + '/話/' + composed + '.xhtml',
      composed + '/b.html',
    ])
    const body = source.episodes[0]?.body ?? ''
    expect(body).toContain('前\n後《《強調》》｜雪《ゆき》残る\n')
    expect(body).not.toContain('取得しない')
    expect(source.episodes[1]?.body).toBe('HTML\n次の行')
    expect(source.assets?.[0]?.path).toMatch(/話\/img\/が\.png$/)
    expect(source.assets).toHaveLength(1)
    expect(body).toContain(illustrationFileTag('外部'))
    const inlines = parseExternalNotation(body)
    expect(parseEpisodeBody(blocksToNotation(inlines))).toEqual(inlines)
    expect(inlines[1]?.inlines).toEqual([
      { type: 'text', text: '後' },
      { type: 'emphasisDots', text: '強調' },
      { type: 'ruby', base: '雪', reading: 'ゆき' },
      { type: 'text', text: '残る' },
    ])
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd" []>',
    '<!DOCTYPE ncx [<!ENTITY sample "local">]>',
    '<!DOCTYPE ncx SYSTEM "urn:fixture">',
    '<!ENTITY sample "local">',
  ])('許可していない宣言を拒否する (%s)', async (declaration) => {
    await expect(
      readManuscriptArchive({ path: 'sample.epub', data: epub(declaration) }),
    ).rejects.toThrow(/外部定義/)
  })

  it('Leaf自身が出力するXHTMLの単純なDOCTYPEを読み戻せる', async () => {
    const work = {
      id: 'work',
      title: '作品',
      episodes: [
        {
          id: 'episode',
          title: '本文',
          blocks: parseEpisodeBody('地の文。｜雪《ゆき》の《《足跡》》。'),
        },
      ],
    }
    const entries = buildEpubFiles(work).map(({ path, content }) => ({ path, data: content }))
    const output = await readManuscriptArchive({ path: 'leaf.epub', data: zipStore(entries) })
    expect(output.episodes[0]?.title).toBe('本文')
    expect(output.episodes[0]?.body).toContain('地の文。｜雪《ゆき》の《《足跡》》。')
  })

  it('mimetypeの改行を無視してZIPに偽装したEPUBも拒否する', async () => {
    const data = zipStore([
      { path: 'mimetype', data: 'application/epub+zip\n' },
      { path: '本文.txt', data: '本文' },
    ])
    await expect(readManuscriptArchive({ path: 'sample.zip', data })).rejects.toThrow(
      /中身がEPUB形式/,
    )
  })

  it('ZIPのキーをNFC化し、正規化後の重複と実際の上限を検査する', async () => {
    const data = zipStore([{ path: decomposed + '.txt', data: '本文' }])
    expect([...(await readArchive(data, 1024).then((entries) => entries.keys()))]).toEqual([
      composed + '.txt',
    ])
    await expect(readArchive(data, 11)).rejects.toThrow(/11 B/)
    const central = new DataView(data.buffer).getUint32(data.length - 6, true)
    new DataView(data.buffer).setUint32(central + 24, 2048, true)
    await expect(readArchive(data, 1024)).rejects.toThrow(/展開後1024 B/)
    const duplicate = zipStore([
      { path: composed + '.txt', data: 'A' },
      { path: decomposed + '.txt', data: 'B' },
    ])
    await expect(readArchive(duplicate, 1024)).rejects.toThrow(/同じパス/)
  })
})

describe('入稿の地の文と実際の装飾', () => {
  it.each([
    [
      'kakuyomu',
      '直前の漢字《地の文》、縦線｜《、傍点に見える《《引用》》、括弧(注)',
      '漢字｜《地の文》',
    ],
    [
      'estar',
      '直前の漢字《地の文》、縦線|《、傍点に見える《《引用》》、括弧(注)',
      '漢字｜《地の文》',
    ],
    ['novelup', '港A1《地の文》、縦線｜（かい）、漢字（かい）と漢字(注)', '港A1｜《地の文》'],
    ['narou', '漢字(かんじ)、漢字（かんじ）、縦線｜(注)、漢字(注)', '漢字｜(かんじ)'],
    ['hameln', '漢字《地の文》、縦線｜《、傍点に見える《《引用》》', '《！《引用》》'],
  ] as const)('%s は公式の方法で出力し、明示取込で元の地の文を復元する', (site, text, escaped) => {
    const blocks = parseExternalNotation(text + '、｜雪《ゆき》', 'literal')
    blocks[0]?.inlines.splice(
      0,
      1,
      { type: 'text', text: text + '、' },
      { type: 'ruby', base: '雪', reading: 'ゆき' },
    )
    if (site === 'kakuyomu' || site === 'estar' || site === 'hameln') {
      blocks[0]?.inlines.push({ type: 'emphasisDots', text: '本物' })
    }
    const output = toPostingSite(blocks, site)
    expect(output.text).toContain(escaped)
    expect(output.warnings).toEqual([])
    expect(parseExternalNotation(output.text, site)).toEqual(blocks)
  })

  it.each([
    ['tales', '漢字(かんじ)《《地の文》》'],
    ['akatsuki', '漢字((かんじ))、漢字（かんじ）《《地の文》》'],
    ['solispia', '｜文字《読み》と《《地の文》》'],
    ['narou', '漢字《かんじ》'],
  ] as const)('%s の未確認記号は原文のまま確認を促す', (site: PostingSiteId, text) => {
    const result = toPostingSite(parseExternalNotation(text, 'literal'), site)
    expect(result.text).toBe(text)
    expect(result.warnings.some((warning) => warning.needsReview)).toBe(true)
  })

  it('明示取込で未確認の縦線を消さず、用語参照内の親文字の範囲を保つ', () => {
    expect(parseExternalNotation('｜《普通》　｜(普通)', 'tales')).toEqual(
      parseExternalNotation('｜《普通》　｜(普通)', 'literal'),
    )
    const blocks = parseEpisodeBody('[[白｜雪《ゆき》]]')
    expect(blocksToNotation(blocks)).toBe('[[白｜雪《ゆき》]]')
    expect(parseEpisodeBody(blocksToNotation(blocks))).toEqual(blocks)
  })
})

describe('入力元と保存する本文', () => {
  const file = (path: string, data: string | Uint8Array) => ({
    path,
    data: typeof data === 'string' ? encoder.encode(data) : data,
  })
  it('ルート直下・フォルダ・展開原稿に実際の選択パスとバイト数を付ける', async () => {
    const about = '〖タイトル〗\n作品\n\n〖目次〗\n1. 話'
    const body = '〖タイトル〗\n話\n〖本文（1行）〗\n原稿'
    const direct = [file('about.txt', about), file('episode_0001.txt', body)]
    const folder = direct.map((input) => ({ ...input, path: '原稿/' + input.path }))
    const compressed = zipStore([{ path: 'file.txt', data: 'ZIPの本文' }])
    const input = [...direct, ...folder, file('まとめ.zip', compressed)]
    const results = await readManuscriptFiles(input)
    const lookup = (group: (typeof results)[number] | undefined) => group?.inputs
    const metadata = (items: typeof input) =>
      items.map((entry) => ({ path: entry.path, bytes: entry.data.length }))
    expect(lookup(results.find((item) => item.name === 'about.txt'))).toEqual(metadata(direct))
    expect(lookup(results.find((item) => item.name === '原稿'))).toEqual(metadata(folder))
    expect(lookup(results.find((item) => item.name === 'まとめ.zip'))).toEqual(
      metadata(input.slice(-1)),
    )
    const bytes = input.reduce((sum, item) => sum + item.data.length, 0)
    expect(manuscriptBytes(results)).toBe(bytes)
    const fakeExpanded = {
      name: '大きなZIP',
      inputs: [{ path: '圧縮.zip', bytes: 10 }],
      source: {
        name: 'zip',
        title: '',
        warnings: [],
        episodes: [],
        structured: false,
        expandedBytes: 100,
      },
    }
    expect(manuscriptBytes([...results, fakeExpanded])).toBe(bytes + 100)
  })

  it('共用画像を一度だけ計上し、未使用ファイルと失敗行の入力を追跡する', () => {
    const tag = illustrationFileTag('画像.png')
    const inputs = [
      file('一.txt', tag),
      file('二.txt', tag),
      file('画像.png', png),
      file('未使用.png', png),
      file('別/添付.css', 'ignored'),
      file('失敗.txt', new Uint8Array([0])),
    ]
    const results = readLooseManuscripts(inputs)
    const used = results.filter((row) => 'source' in row)
    expect(used).toHaveLength(2)
    expect(used.every((row) => row.inputs.some((entry) => entry.path === '画像.png'))).toBe(true)
    const skipped = results.find((row) => 'skipped' in row)
    expect(skipped?.inputs.map((entry) => entry.path)).toEqual(['未使用.png', '別/添付.css'])
    const bad = results.find((row) => 'error' in row)
    expect(bad?.inputs).toEqual([{ path: '失敗.txt', bytes: 1 }])
    expect(manuscriptBytes(results)).toBe(inputs.reduce((sum, entry) => sum + entry.data.length, 0))
    expect(manuscriptBytes(results.filter((row) => row !== bad))).toBe(manuscriptBytes(results) - 1)
  })

  it('使用する挿絵だけを保存し、同一画像は一件、衝突画像は未割り当てにする', () => {
    const content = {
      source: {
        name: '原稿',
        title: '作品',
        warnings: [],
        structured: false,
        episodes: [
          {
            title: '話',
            path: '本文.txt',
            body: illustrationFileTag('画像.png', 'abcd-8'),
            before: illustrationFileTag('前.png', 'a-8'),
          },
        ],
      },
    }
    const asset = { path: 'abcd-8/画像.png', data: png }
    const other = { path: 'a-8/前.png', data: png }
    const create = (sources: ManuscriptSource[]) =>
      makePostingWork(
        {
          title: '作品',
          episodes: content.source.episodes,
          sources,
          notation: 'auto',
          supplements: false,
        },
        () => '1',
        () => 0,
      )
    expect(
      create([{ ...content.source, assets: [asset, asset, other] }]).manuscriptImport?.assets.map(
        (item) => item.path,
      ),
    ).toEqual([asset.path])
    const conflicting = { ...asset, data: new Uint8Array([1, ...png.slice(1)]) }
    expect(
      create([
        { ...content.source, assets: [asset] },
        { ...content.source, assets: [conflicting, asset] },
      ]).manuscriptImport?.assets ?? [],
    ).toEqual([])
  })

  it('カクヨムの値のない項目を通過し、見出しに見える本文をそのまま残す', () => {
    const body = '本文が続く。\n〖本文（5行）〗\n〖公開状態〗\n最後の行'
    const episode = kakuyomuEpisode(
      'episode_0001.txt',
      '〖タイトル〗\n〖公開状態〗\n〖本文（4行）〗\n' + body,
    )
    expect(episode.title).toBe('episode_0001')
    expect(episode.body).toBe(body)
    expect(episode.details).toBe('〖公開状態〗')
    expect(
      kakuyomuEpisode('episode_0002.txt', '〖タイトル〗\n題\n〖公開状態〗\n〖本文（1行）〗\n原稿')
        .title,
    ).toBe('題')
  })
})
