import { describe, expect, it } from 'vitest'
import {
  applyEdits,
  DEFAULT_SPLIT_OPTIONS,
  EMPTY_EDITS,
  episodeKey,
  isHeadingLine,
  isSeparatorLine,
  type SplitOptions,
  sortSourcesNatural,
  splitEpisodes,
} from './split'

const opts = (o: Partial<SplitOptions> = {}): SplitOptions => ({ ...DEFAULT_SPLIT_OPTIONS, ...o })
const file = (name: string, text: string) => ({ name, text })
const paste = (text: string) => ({ name: '', text })

describe('isHeadingLine', () => {
  it.each([
    '第1話',
    '第１話　出会い',
    '第一話：出会い',
    '第十二章',
    '第3節 ',
    '　第2部　',
    'プロローグ',
    'エピローグ　夜明け',
    '1. 出会い',
    '１　出会い',
    '12',
    '# 見出し',
    '### 見出し',
    '【第一幕】',
    '■はじまり',
  ])('見出しになる: %s', (line) => {
    expect(isHeadingLine(line)).toBe(true)
  })
  it.each([
    '吾輩は第1話を読んだ。',
    '第1話目を読んだ気がする',
    '',
    '　',
    '1人の男が歩いていた',
    '#ハッシュタグ',
    '【注】この物語はフィクションです',
    '＊＊＊',
    `第1話　${'あ'.repeat(40)}`,
  ])('見出しにならない: %s', (line) => {
    expect(isHeadingLine(line)).toBe(false)
  })
})

describe('isSeparatorLine', () => {
  it.each(['---', '＊　＊　＊', '======', '―――', '***', '※※※'])('区切り: %s', (line) => {
    expect(isSeparatorLine(line)).toBe(true)
  })
  it.each(['--', '＊', '- - a', '本文'])('区切りでない: %s', (line) => {
    expect(isSeparatorLine(line)).toBe(false)
  })
})

describe('splitEpisodes: 見出し行で分ける', () => {
  it('見出し行がタイトルになり本文から除かれ、末尾の空行は落ちる', () => {
    const r = splitEpisodes([paste('第1話　出会い\n本文A\n\n第2話\n本文B\n\n')], opts(), '作品')
    expect(r.headingFound).toBe(true)
    expect(r.episodes.map((e) => [e.title, e.body, e.reason])).toEqual([
      ['第1話　出会い', '本文A', 'heading'],
      ['第2話', '本文B', 'heading'],
    ])
  })
  it('見出し行を本文にも残せる', () => {
    const r = splitEpisodes([paste('第1話\n本文')], opts({ keepHeadingInBody: true }), '作品')
    expect(r.episodes[0]?.body).toBe('第1話\n本文')
  })
  it('先頭の見出しより前の本文は捨てず 1 話にする（貼り付けは「序」）', () => {
    const r = splitEpisodes([paste('前書き\n\n第1話\n本文')], opts(), '作品')
    expect(r.episodes.map((e) => [e.title, e.body, e.reason])).toEqual([
      ['序', '前書き', 'preamble'],
      ['第1話', '本文', 'heading'],
    ])
  })
  it('前文のタイトルはファイルならファイル名（拡張子なし）', () => {
    const r = splitEpisodes([file('01_雨の町.txt', '前書き\n第1話\n本文')], opts(), '作品')
    expect(r.episodes[0]?.title).toBe('01_雨の町')
  })
  it('見出しの無い貼り付けは「第1話」1 話で headingFound=false', () => {
    const r = splitEpisodes([paste('ただの本文\n二行目')], opts(), '作品')
    expect(r.headingFound).toBe(false)
    expect(r.episodes).toEqual([
      { title: '第1話', body: 'ただの本文\n二行目', reason: 'file', sourceName: '', sourceLine: 0 },
    ])
  })
  it('見出しの無いファイルはファイル名が 1 話のタイトル', () => {
    const r = splitEpisodes([file('a.txt', '本文')], opts(), '作品')
    expect(r.episodes[0]?.title).toBe('a')
  })
  it('全角数字・漢数字の見出しも分かれる', () => {
    const r = splitEpisodes([paste('第１話\nA\n第二話\nB')], opts(), '作品')
    expect(r.episodes.map((e) => e.title)).toEqual(['第１話', '第二話'])
  })
  it('行の途中の「第1話」では分けない', () => {
    const r = splitEpisodes([paste('第1話\n吾輩は第1話を読んだ。\n続き')], opts(), '作品')
    expect(r.episodes).toHaveLength(1)
    expect(r.episodes[0]?.body).toBe('吾輩は第1話を読んだ。\n続き')
  })
  it('場面転換の「＊＊＊」は既定では分けず、separators をオンにすると分かれて通し番号が付く', () => {
    const text = '第1話\nA\n＊＊＊\nB'
    expect(splitEpisodes([paste(text)], opts(), '作品').episodes).toHaveLength(1)
    const r = splitEpisodes([paste(text)], opts({ separators: true }), '作品')
    expect(r.episodes.map((e) => [e.title, e.body, e.reason])).toEqual([
      ['第1話', 'A', 'heading'],
      ['第2話', 'B', 'separator'],
    ])
  })
  it('区切り行だけで見出しが無いファイルも separators オンなら分かれる', () => {
    const r = splitEpisodes([file('x.txt', 'A\n---\nB\n---\n')], opts({ separators: true }), '作品')
    expect(r.episodes.map((e) => [e.title, e.body])).toEqual([
      ['x', 'A'],
      ['第2話', 'B'],
    ])
    expect(r.headingFound).toBe(false)
  })
  it('複数ファイルはファイルごとの分割結果が順に連なる', () => {
    const r = splitEpisodes(
      [file('1.txt', '第1話\nA\n第2話\nB'), file('2.txt', '第3話\nC')],
      opts(),
      '作品',
    )
    expect(r.episodes.map((e) => [e.title, e.sourceName, e.sourceLine])).toEqual([
      ['第1話', '1.txt', 0],
      ['第2話', '1.txt', 2],
      ['第3話', '2.txt', 0],
    ])
  })
  it('空タイトルの見出し話（タイトルだけの話）も残る', () => {
    const r = splitEpisodes([paste('第1話\n第2話\nB')], opts(), '作品')
    expect(r.episodes.map((e) => [e.title, e.body])).toEqual([
      ['第1話', ''],
      ['第2話', 'B'],
    ])
  })
})

describe('splitEpisodes: ファイルごと・分けない', () => {
  it('file: ファイル名がタイトル・見出しは本文に残る', () => {
    const r = splitEpisodes(
      [file('a.txt', '第1話\nA'), file('b.txt', 'B')],
      opts({ mode: 'file' }),
      '作品',
    )
    expect(r.episodes.map((e) => [e.title, e.body, e.reason])).toEqual([
      ['a', '第1話\nA', 'file'],
      ['b', 'B', 'file'],
    ])
  })
  it('none: 全部を連結して 1 話・タイトルは作品タイトル', () => {
    const r = splitEpisodes(
      [file('a.txt', 'A\n'), file('b.txt', 'B')],
      opts({ mode: 'none' }),
      '作品',
    )
    expect(r.episodes).toEqual([
      { title: '作品', body: 'A\n\nB', reason: 'whole', sourceName: 'a.txt', sourceLine: 0 },
    ])
  })
  it('ソースが無ければ空', () => {
    expect(splitEpisodes([], opts(), '作品')).toEqual({ episodes: [], headingFound: false })
  })
})

describe('sortSourcesNatural', () => {
  it('数字を数値として比較する（2 < 10）', () => {
    expect(
      sortSourcesNatural([file('10.txt', ''), file('2.txt', ''), file('1.txt', '')]).map(
        (s) => s.name,
      ),
    ).toEqual(['1.txt', '2.txt', '10.txt'])
  })
})

describe('applyEdits', () => {
  const base = splitEpisodes([paste('第1話\nA\n第2話\nB\n第3話\nC')], opts(), '作品').episodes

  it('タイトルの手直しが反映される', () => {
    const k = episodeKey(base[1] as (typeof base)[number])
    const r = applyEdits(base, { titles: { [k]: '新しい題' }, mergedInto: [] }, opts())
    expect(r.map((e) => e.title)).toEqual(['第1話', '新しい題', '第3話'])
  })
  it('2 話目をつなげても 3 話目のタイトル手直しは残り、本文は前の末尾に付く', () => {
    const k2 = episodeKey(base[1] as (typeof base)[number])
    const k3 = episodeKey(base[2] as (typeof base)[number])
    const r = applyEdits(base, { titles: { [k3]: '三' }, mergedInto: [k2] }, opts())
    expect(r.map((e) => [e.title, e.body])).toEqual([
      ['第1話', 'A\n\nB'],
      ['三', 'C'],
    ])
  })
  it('先頭の話はつなげる先が無いので無視する', () => {
    const k1 = episodeKey(base[0] as (typeof base)[number])
    expect(applyEdits(base, { titles: {}, mergedInto: [k1] }, opts())).toHaveLength(3)
  })
  it('手直しが無ければそのまま', () => {
    expect(applyEdits(base, EMPTY_EDITS, opts())).toEqual(base)
  })
  it('同名ソースはキーが衝突する（UI 側で同名の追加を拒否する前提）', () => {
    const eps = splitEpisodes(
      [file('a.txt', '第1話\nA'), file('a.txt', '第1話\nB')],
      opts(),
      '作品',
    ).episodes
    expect(episodeKey(eps[0] as (typeof eps)[number])).toBe(
      episodeKey(eps[1] as (typeof eps)[number]),
    )
  })
})
