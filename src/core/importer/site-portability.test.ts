// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blocksToNotation } from '../exporter/blocksToNotation'
import {
  DEFAULT_POSTING_TEXT_FORMAT,
  encodePostingText,
  importedIllustrationsZip,
  kakuyomuWorkZip,
  postingEpisodesZip,
} from '../exporter/posting-files'
import { toPostingSite } from '../exporter/toPostingSite'
import { folderToWork, workToFolder } from '../folder'
import { parseEpisodeBody } from '../parser/parseNotation'
import { illustrationFileTag } from '../sites/illustrations'
import { POSTING_PROFILES, type PostingSiteId } from '../sites/portability'
import { zipStore } from '../zip'
import { readArchive } from '../zip/read'
import {
  readLooseManuscripts,
  readManuscriptArchive,
  readPastedManuscript,
  readSingleManuscript,
} from './manuscript'
import { makePostingWork } from './posting-work'
import { parseExternalNotation } from './site-notation'
import { decodeTextFile, MAX_IMPORT_BYTES } from './text'

const fixtureRoot = new URL('../../../docs/specs/posting-import-fixtures/', import.meta.url)
const data = (path: string) => readFileSync(new URL(path, fixtureRoot))
const text = (path: string) => data(path).toString('utf8').replace(/\n$/, '')
const titles = ['灯り　第一夜', '灯り 第二夜', '灯り 第三夜']
const paths = ['01.txt', '02.txt', '03.txt']
const bodies = paths.map((path) => text(`manuscript/${path}`))
const open = (path: string) => readManuscriptArchive({ path, data: data(path) })
const workName = '青い灯りの観測日誌'

describe('公開資料で確認できた構造の合成原稿', () => {
  it.each([
    'observed/kakuyomu.zip',
    'observed/kakuyomu-compatible.zip',
    'observed/narou-legacy-n0000zz.zip',
    'observed/narou-recent-n0000zz.zip',
    'observed/akatsuki-txt.zip',
  ])('%s の作品名、話名、順序、全本文', async (path) => {
    const manuscript = await open(path)
    expect(manuscript.title).toBe(workName)
    expect(manuscript.episodes.map((episode) => episode.title)).toEqual(titles)
    expect(manuscript.episodes.map((episode) => episode.body)).toEqual(bodies)
  })

  it('複数ファイル、相対パス付きフォルダ、ZIPは同じ本文を同じ順番で返す', async () => {
    const loose = paths.map((path) => ({ path, data: data(`manuscript/${path}`) }))
    const folders = [10, 2, 20].map((n) => {
      const path = `章${n}/01_原稿.txt`
      return { path, data: data(`observed/folder/${path}`) }
    })
    const sorted = (files: typeof loose) =>
      readLooseManuscripts(files)
        .filter((item) => 'source' in item)
        .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
        .flatMap((item) => item.source.episodes.map((episode) => episode.body.trimEnd()))
    expect(sorted(loose.reverse())).toEqual(bodies)
    expect(sorted(folders)).toEqual(bodies)
    const zip = zipStore(folders.map(({ path, data }) => ({ path, data })))
    const fromZip = await readManuscriptArchive({ path: '原稿.zip', data: zip })
    expect(fromZip.episodes.map((episode) => episode.body)).toEqual(bodies)
    expect(fromZip.episodes.map((episode) => episode.path)).toEqual(
      [2, 10, 20].map((n) => `章${n}/01_原稿.txt`),
    )
  })

  it('公式互換未確定の合成書式を表示し、作品名・順序・本文を見せる', async () => {
    for (const path of ['mock/novelup.zip', 'mock/tales.zip']) {
      const manuscript = await open(path)
      expect(manuscript.title).toBe(workName)
      expect(manuscript.warnings.join()).toContain('未確認')
      expect(manuscript.episodes.map((episode) => episode.title)).toEqual(titles)
      expect(manuscript.episodes.map((episode) => episode.body)).toEqual(bodies)
    }
    const alpha = await open('mock/alphapolis.zip')
    expect(alpha.structured).toBe(false)
    expect(alpha.episodes[0]?.body).toContain('第3話 灯り 第三夜')
    expect(readSingleManuscript('solispia.txt', data('mock/solispia.txt')).structured).toBe(false)
  })

  it('標準EPUBは格納順よりspineを優先し、XHTMLルビ・空段落を維持する', async () => {
    const manuscript = await open('mock/hameln-standard.epub')
    expect(manuscript.title).toBe(workName)
    expect(manuscript.episodes.map((episode) => episode.title)).toEqual(titles)
    expect(manuscript.episodes.map((episode) => episode.body)).toEqual(bodies)
  })

  it('EUC-JP、ISO-2022-JP、UTF-8の原稿を区別して復号する', () => {
    for (const name of ['euc-jp', 'iso-2022-jp'] as const) {
      expect(decodeTextFile(data(`fallback/encoding-${name}.txt`))).toEqual({
        encoding: name,
        text: bodies[0],
      })
    }
    for (const name of ['novel-days-body', 'teller-novel', 'novema', 'noichigo', 'berrys-cafe']) {
      expect(
        readSingleManuscript(`${name}.txt`, data(`fallback/${name}.txt`)).episodes[0]?.body,
      ).toBe(bodies[0])
    }
    expect(
      toPostingSite(parseExternalNotation(text('fallback/pixiv.txt')), 'pixiv').text,
    ).toContain('[newpage]')
  })

  it.each([
    'broken.zip',
    'missing-body.zip',
    'invalid-member.zip',
    'unsupported-only.zip',
  ])('%s を拒否する', async (path) => {
    await expect(open(`rejected/${path}`)).rejects.toThrow()
  })

  it('不一致の拡張子、重複パス、展開上限、CRC破損を拒否する', async () => {
    expect(() => readSingleManuscript('text.txt', data('rejected/image-renamed.txt'))).toThrow()
    expect(() => readSingleManuscript('text.txt', data('mock/estar-vertical.pdf'))).toThrow(
      /TXT形式/,
    )
    expect(() => readSingleManuscript('text.txt', new Uint8Array([0x81]))).toThrow()
    await expect(
      readArchive(
        zipStore([
          { path: 'A.txt', data: 'a' },
          { path: 'A.txt', data: 'b' },
        ]),
        MAX_IMPORT_BYTES,
      ),
    ).rejects.toThrow(/同じパス/)
    await expect(
      readManuscriptArchive({ path: 'fake.epub', data: data('observed/kakuyomu.zip') }),
    ).rejects.toThrow()
    const overflow = zipStore([
      { path: 'A.txt', data: 'a'.repeat(1500) },
      { path: 'B.txt', data: 'b'.repeat(1500) },
    ])
    const view = new DataView(overflow.buffer)
    const directory = view.getUint32(overflow.length - 6, true)
    view.setUint32(directory + 24, MAX_IMPORT_BYTES + 1, true)
    await expect(readArchive(overflow, MAX_IMPORT_BYTES)).rejects.toThrow(/展開後/)
    const corrupted = zipStore([{ path: 'a.txt', data: 'value' }])
    corrupted[35] = 0
    await expect(readArchive(corrupted, MAX_IMPORT_BYTES)).rejects.toThrow(/a\.txt/)
  })
})

describe('作者用原本を照合できない書式と互換ZIPの差異', () => {
  const zip = (files: Record<string, string>) =>
    readManuscriptArchive({
      path: '灯り.zip',
      data: zipStore(Object.entries(files).map(([path, data]) => ({ path, data }))),
    })
  const kakuyomu = (title: string, body: string, lines = 1) =>
    ['〖タイトル〗', title, '〖本文（' + lines + '行）〗', body].join('\n')

  it.each([
    ['ノベルアップ＋', 'episode_00010.txt', 'episode_00002.txt', 'mock-work-info.txt', '灯り'],
    [
      'TALESの話ファイル名',
      'episode_0010.txt',
      'episode_0002.txt',
      'about.txt',
      '# タイトル\n灯り',
    ],
    ['TALESの任意の話ファイル名', '第10話.txt', '第2話.txt', 'about.txt', '# タイトル\n灯り'],
  ])('%s の未確認見出しを残し、TXT単位で取り込む', async (_, later, earlier, metadata, value) => {
    const source = await zip({
      [metadata]: value,
      'toc.txt': '目次',
      [later]: '【独自の見出し】\n十話の本文',
      [earlier]: '【独自の見出し】\n二話の本文',
    })
    expect(source.title).toBe('灯り')
    expect(source.warnings.join()).toContain('ファイル単位で取り込みました')
    expect(source.episodes.map(({ path, body }) => [path, body])).toEqual([
      [earlier, '【独自の見出し】\n二話の本文'],
      [later, '【独自の見出し】\n十話の本文'],
    ])
  })

  it('認識できる仮書式と未知の本文が同じZIPにあっても片方を失わない', async () => {
    const source = await zip({
      'about.txt': '# タイトル\n灯り',
      'episode_0002.txt': '未知の見出し\n本文',
      'episode_0001.txt': '# エピソードタイトル\n第一話\n# 本文\n本文',
    })
    expect(source.episodes.map(({ title, body }) => [title, body])).toEqual([
      ['第一話', '本文'],
      ['episode_0002', '未知の見出し\n本文'],
    ])
    expect(source.warnings.join()).toContain('ファイル単位')
  })

  it('カクヨムの本文行数の差を警告し、独立した目次の順序を保つ', async () => {
    const files = {
      'toc.txt': '§第一部\n2. 二話\n1. 一話',
      'episode_0001.txt': kakuyomu('一話', '一行目\n二行目', 1),
      'episode_0002.txt': kakuyomu('二話', '二話の本文'),
    }
    const source = await zip({ 'about.txt': '〖タイトル〗\n灯り', ...files })
    expect(source.title).toBe('灯り')
    expect(source.episodes.map(({ title, body, chapter }) => [title, body, chapter])).toEqual([
      ['二話', '二話の本文', '第一部'],
      ['一話', '一行目\n二行目', '第一部'],
    ])
    expect(source.warnings).toEqual([expect.stringMatching(/episode_0001\.txt.*行数/)])

    const loose = readLooseManuscripts(
      Object.entries(files).map(([path, body]) => ({ path, data: new TextEncoder().encode(body) })),
    )
    expect(loose).toHaveLength(1)
    expect(loose[0]).toMatchObject({
      source: {
        episodes: [
          { title: '二話', body: '二話の本文', chapter: '第一部' },
          { title: '一話', body: '一行目\n二行目', chapter: '第一部' },
        ],
        warnings: source.warnings,
      },
    })
  })

  it('目次の不足・欠番・重複があっても存在するカクヨムの話を連番順で取り込む', async () => {
    const source = await zip({
      'about.txt': '〖タイトル〗\n灯り\n〖目次〗\n3. 三話\n9. 未収録\n3. 重複',
      'episode_0003.txt': kakuyomu('三話', '三話の本文'),
      'episode_0002.txt': kakuyomu('下書き', '未掲載の本文'),
      'episode_0001.txt': kakuyomu('一話', '一話の本文'),
    })
    expect(source.episodes.map(({ title }) => title)).toEqual(['一話', '下書き', '三話'])
    expect(source.warnings.join()).toContain('連番順')
    await expect(zip({ 'about.txt': '〖タイトル〗\n灯り\n〖目次〗\n1. 一話' })).rejects.toThrow(
      /話ファイルがありません/,
    )
  })

  it.each([
    '',
    '〖前書き〗\n',
    '〖前書き〗\n\n',
  ])('なろうの短編と下書きで空・省略された前後書きを本文と分ける（%j）', async (before) => {
    const after = before ? '\n\n〖後書き〗' + (before.endsWith('\n\n') ? '\n\n' : '') : ''
    const source = await zip({
      'n0123ab.txt':
        '〖タイトル〗\n短編\n' + before + '〖公開状態〗\n公開\n〖本文〗\n短編の本文' + after,
      'short_draftepisode.txt':
        '〖エピソードタイトル〗\n下書きの題\n' + before + '〖本文〗\n下書きの本文' + after,
    })
    expect(source.title).toBe('短編')
    expect(source.episodes).toMatchObject([
      { title: '短編', body: '短編の本文', before: undefined, after: undefined, details: '公開' },
      {
        title: '下書きの題',
        body: '下書きの本文',
        before: undefined,
        after: undefined,
        details: '下書き',
      },
    ])
  })
})

describe('投稿用の記法と正本の往復', () => {
  it('未知・未閉鎖・曖昧な記号を編集とフォルダ用記法の往復で維持する', () => {
    const source =
      '漢字（かんじ） [[unknown:漢字《かんじ》]] [[rb:海 > うみ]]\n[[未閉鎖\n地の文《\n｜次の未閉鎖《\n'
    const blocks = parseExternalNotation(source)
    const notation = blocksToNotation(blocks)
    expect(parseEpisodeBody(notation)).toEqual(blocks)
    expect(blocks[0]?.inlines).toEqual([
      { type: 'text', text: '漢字（かんじ） [[unknown:漢字《かんじ》]] ' },
      { type: 'ruby', base: '海', reading: 'うみ' },
    ])
    expect(blocks[1]?.inlines[0]).toEqual({ type: 'text', text: '[[未閉鎖' })
    expect(parseExternalNotation('漢字（かんじ）', 'narou')[0]?.inlines[0]).toEqual({
      type: 'ruby',
      base: '漢字',
      reading: 'かんじ',
    })
    expect(parseExternalNotation('漢字（かんじ）', 'literal')[0]?.inlines[0]).toEqual({
      type: 'text',
      text: '漢字（かんじ）',
    })
  })

  it('前の漢字と親文字が連結する箇所、なろうの非かな読み、カクヨム開き括弧、ルビ上限', () => {
    const blocks = parseExternalNotation(
      '前｜灯台《とうだい》の《括弧》。｜剣《sword》。｜長長長長長長長長長長長《ちょう》',
    )
    const kaku = toPostingSite(blocks, 'kakuyomu')
    expect(kaku.text).toContain('前｜灯台《とうだい》の｜《括弧》')
    const narou = toPostingSite(blocks, 'narou')
    expect(narou.text).toContain('｜剣《sword》')
    expect(narou.warnings).toMatchObject([
      { line: 1, value: '｜長長長長長長長長長長長《ちょう》', needsReview: true },
    ])
    const tooLong = toPostingSite(parseExternalNotation(`｜灯台《${'あ'.repeat(51)}》`), 'kakuyomu')
    expect(tooLong.warnings[0]?.needsReview).toBe(true)
  })

  it('すべての投稿先に本文を変換し、同じpixiv作品のアップロード挿絵だけ保持する', () => {
    const source = '｜灯台《とうだい》《《遠く》》\n[pixivimage:12][uploadedimage:9]　<i3724|23>'
    const blocks = parseExternalNotation(source)
    expect(parseEpisodeBody(blocksToNotation(blocks))).toEqual(blocks)
    for (const site of Object.keys(POSTING_PROFILES) as PostingSiteId[])
      expect(toPostingSite(blocks, site).text).toContain('とうだい')
    expect(toPostingSite(blocks, 'narou').text).not.toContain('<i3724|23>')
    expect(toPostingSite(blocks, 'narou', { registeredImageIds: true }).text).toContain(
      '<i3724|23>',
    )
    const known = parseExternalNotation('<i3724|23>', 'akatsuki')
    expect(toPostingSite(known, 'akatsuki').text).toBe('<i3724|23>')
    expect(toPostingSite(known, 'narou').text).toBe('')
    expect(toPostingSite(blocks, 'pixiv').text).toContain('[pixivimage:12]')
    expect(toPostingSite(blocks, 'pixiv').text).not.toContain('[uploadedimage:9]')
    expect(toPostingSite(blocks, 'pixiv', { pixivOriginalWork: true }).text).toContain(
      '[uploadedimage:9]',
    )
    expect(toPostingSite(blocks, 'estar', { illustrations: 'markers' }).text).toContain(
      '【挿絵：[pixivimage:12]】',
    )
  })

  it('ハーメルンのタグをルビに誤変換せず、括弧のエスケープを投稿先に合わせる', () => {
    const raw = '前《b》太字《/b》｜灯台《とうだい》'
    const parsed = parseExternalNotation(raw)
    expect(parsed[0]?.inlines[0]).toEqual({ type: 'text', text: '前《b》太字《/b》' })
    expect(toPostingSite(parsed, 'hameln').text).toBe(raw)
    expect(toPostingSite(parsed, 'pixiv').text).toBe('前太字[[rb:灯台 > とうだい]]')
    expect(toPostingSite(parseExternalNotation('[b:太字]'), 'hameln').text).toBe('《b》太字《/b》')
    expect(toPostingSite(parseExternalNotation('漢字（かんじ）'), 'narou').text).toBe(
      '漢字｜（かんじ）',
    )
    expect(toPostingSite(parseExternalNotation('漢字｜（かんじ）', 'narou'), 'kakuyomu').text).toBe(
      '漢字（かんじ）',
    )
    expect(parseExternalNotation('港A1《みなと》', 'novelup')[0]?.inlines).toEqual([
      { type: 'ruby', base: '港A1', reading: 'みなと' },
    ])
  })

  it('ZIP内の対応する挿絵を正本とフォルダ往復で保ち、画像と位置一覧を取り出せる', async () => {
    const png = new Uint8Array([0x89, 80, 78, 71, 13, 10, 26, 10])
    const input = zipStore([
      { path: '原稿.txt', data: `前\n${illustrationFileTag('画像.png')}\n後` },
      { path: '画像.png', data: png },
      { path: '対応なし.png', data: png },
    ])
    const source = await readManuscriptArchive({ path: '原稿.zip', data: input })
    expect(source.assets).toHaveLength(1)
    let id = 0
    const work = makePostingWork(
      {
        title: source.title,
        episodes: source.episodes,
        sources: [source],
        notation: 'auto',
        supplements: false,
      },
      () => String(++id),
      () => 0,
    )
    const restored = folderToWork(workToFolder(work))
    expect(restored.manuscriptImport).toEqual(work.manuscriptImport)
    expect(restored.episodes).toEqual(work.episodes)
    const illustrationZip = await readArchive(importedIllustrationsZip(restored), MAX_IMPORT_BYTES)
    expect(illustrationZip.get('挿絵/0001_画像.png')).toEqual(png)
    expect(new TextDecoder().decode(illustrationZip.get('挿絵の位置.txt'))).toContain(
      '2行目　画像.png',
    )
  })

  it('ZIPの目次順と書き出しを往復し、末尾改行と長い話タイトルを維持する', async () => {
    const source = readPastedManuscript('前｜灯台《とうだい》。\n\n')
    const title = '遠くで見えた灯り'.repeat(12)
    const episodes = [{ ...source.episodes[0]!, title }]
    let id = 0
    const work = makePostingWork(
      { title: workName, episodes, sources: [source], notation: 'auto', supplements: false },
      () => String(++id),
      () => 0,
    )
    const zip = kakuyomuWorkZip(work)
    const archive = await readArchive(zip, MAX_IMPORT_BYTES)
    expect([...archive.keys()]).toEqual(['about.txt', 'episode_0001.txt'])
    const restored = await readManuscriptArchive({ path: 'Leaf.zip', data: zip })
    expect(restored.episodes[0]).toMatchObject({ title, body: episodes[0]!.body })
    const posting = postingEpisodesZip(work.episodes, 'solispia', DEFAULT_POSTING_TEXT_FORMAT, {})
    expect(
      [...(await readArchive(posting, MAX_IMPORT_BYTES).then((members) => members.keys()))][0],
    ).toMatch(/^0001_.*\.txt$/)
  })

  it('投稿用ファイルの文字コード、BOM、改行を実際のバイト列で検査する', () => {
    const input = '灯台\n海'
    for (const selected of ['shift_jis', 'euc-jp', 'iso-2022-jp'] as const) {
      const bytes = encodePostingText(input, { encoding: selected, newline: 'crlf', bom: false })
      expect(new TextDecoder(selected).decode(bytes)).toBe('灯台\r\n海')
    }
    expect(
      encodePostingText(input, { encoding: 'utf-8', newline: 'lf', bom: true }).slice(0, 3),
    ).toEqual(new Uint8Array([239, 187, 191]))
    expect(() =>
      encodePostingText('⚓', { encoding: 'shift_jis', newline: 'lf', bom: false }),
    ).toThrow()
  })
})
