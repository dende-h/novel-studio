import { describe, expect, it } from 'vitest'
import {
  classifySplit,
  parseSudachiRow,
  passesFilter,
  type SplitKind,
  type SudachiNoun,
  selectSupplement,
  toIpadicRow,
} from './dict-supplement'

const noun = (surface: string, over: Partial<SudachiNoun> = {}): SudachiNoun => ({
  surface,
  sub: '一般',
  reading: surface,
  source: 'small',
  cost: 5000,
  ...over,
})

/** Sudachi の v0 形式の1行（必要な列だけ埋める）。 */
const row = (surface: string, pos: string[], reading: string, cost = 5000) => [
  surface,
  '5139',
  '5139',
  String(cost),
  surface,
  ...pos,
  reading,
  surface,
  '*',
]

describe('parseSudachiRow（Sudachi の行から普通名詞を取り出す）', () => {
  it('普通名詞の一般・サ変可能・形状詞可能だけを取り出す', () => {
    expect(
      parseSudachiRow(row('スマホ', ['名詞', '普通名詞', '一般', '*', '*', '*'], 'スマホ'), 'core'),
    ).toEqual({ surface: 'スマホ', sub: '一般', reading: 'スマホ', source: 'core', cost: 5000 })
    expect(
      parseSudachiRow(
        row('転生', ['名詞', '普通名詞', 'サ変可能', '*', '*', '*'], 'テンセイ'),
        'small',
      )?.sub,
    ).toBe('サ変可能')
    expect(
      parseSudachiRow(
        row('チート', ['名詞', '普通名詞', '形状詞可能', '*', '*', '*'], 'チート'),
        'small',
      )?.sub,
    ).toBe('形状詞可能')
  })

  it('固有名詞・動詞・助数詞可能・記号まじり・1字の語は取り出さない', () => {
    expect(
      parseSudachiRow(
        row('インスタ', ['名詞', '固有名詞', '一般', '*', '*', '*'], 'インスタ'),
        'core',
      ),
    ).toBeNull()
    expect(
      parseSudachiRow(
        row('ググる', ['動詞', '一般', '*', '*', '五段-ラ行', '終止形-一般'], 'ググル'),
        'small',
      ),
    ).toBeNull()
    expect(
      parseSudachiRow(
        row('人前', ['名詞', '普通名詞', '助数詞可能', '*', '*', '*'], 'ニンマエ'),
        'small',
      ),
    ).toBeNull()
    expect(
      parseSudachiRow(
        row('Ｔシャツ', ['名詞', '普通名詞', '一般', '*', '*', '*'], 'ティーシャツ'),
        'small',
      ),
    ).toBeNull()
    expect(
      parseSudachiRow(row('鍵', ['名詞', '普通名詞', '一般', '*', '*', '*'], 'カギ'), 'small'),
    ).toBeNull()
  })
})

describe('classifySplit（IPADIC での区切られ方）', () => {
  const t = (surface: string, unknown = false, pos1 = '一般') => ({ surface, unknown, pos1 })

  it('1語で辞書にあれば known', () => {
    expect(classifySplit([t('コーヒー')])).toBe('known')
  })
  it('辞書に無い語を含めば unknown（1語でも）', () => {
    expect(classifySplit([t('サブスク', true)])).toBe('unknown')
    expect(classifySplit([t('既'), t('読', true), t('スルー')])).toBe('unknown')
  })
  it('固有名詞を含めば proper', () => {
    expect(classifySplit([t('スマート', false, '固有名詞'), t('フォン')])).toBe('proper')
  })
  it('1字の漢字が2〜3個なら split-kanji、4個以上や2字の語を含めば other', () => {
    expect(classifySplit([t('王'), t('都')])).toBe('split-kanji')
    expect(classifySplit([t('黒'), t('鉄'), t('城')])).toBe('split-kanji')
    expect(classifySplit([t('一'), t('二'), t('三'), t('四')])).toBe('other')
    expect(classifySplit([t('先駆'), t('者')])).toBe('other')
  })
})

describe('passesFilter（足さない語）', () => {
  it('ひらがなだけの語は足さない', () => {
    expect(passesFilter(noun('あいじょう'))).toBe(false)
  })
  it('重み0の行は足さない', () => {
    expect(passesFilter(noun('シェリス', { cost: 0 }))).toBe(false)
  })
  it('3字以下のカタカナ語は足さない。ただし core の3字は足す', () => {
    expect(passesFilter(noun('シェ'))).toBe(false)
    expect(passesFilter(noun('リス'))).toBe(false)
    expect(passesFilter(noun('アオジ'))).toBe(false)
    expect(passesFilter(noun('スマホ', { source: 'core' }))).toBe(true)
    expect(passesFilter(noun('シェ', { source: 'core' }))).toBe(false)
    expect(passesFilter(noun('サブスク'))).toBe(true)
  })
  it('漢字の2字は足す', () => {
    expect(passesFilter(noun('王都'))).toBe(true)
  })
})

describe('toIpadicRow（IPADIC の CSV 行）', () => {
  it('品詞と連接 ID とコストを IPADIC にそろえる', () => {
    expect(toIpadicRow(noun('スマートフォン', { source: 'core' }))).toBe(
      'スマートフォン,1285,1285,3657,名詞,一般,*,*,*,*,スマートフォン,スマートフォン,スマートフォン',
    )
    expect(toIpadicRow(noun('転生', { sub: 'サ変可能', reading: 'テンセイ' }))).toBe(
      '転生,1283,1283,5622,名詞,サ変接続,*,*,*,*,転生,テンセイ,テンセイ',
    )
    expect(
      toIpadicRow(noun('チート', { sub: '形状詞可能' }))
        .split(',')
        .slice(1, 6),
    ).toEqual(['1287', '1287', '3657', '名詞', '形容動詞語幹'])
  })
  it('読みがカタカナだけでなければ * にする（13列のまま）', () => {
    const cols = toIpadicRow(noun('リモートワーク', { reading: 'remote work' })).split(',')
    expect(cols).toHaveLength(13)
    expect(cols.slice(10)).toEqual(['リモートワーク', '*', '*'])
  })
})

describe('selectSupplement（足す語を選ぶ）', () => {
  const splits: Record<string, SplitKind> = {
    サブスク: 'unknown',
    スマートフォン: 'proper',
    王都: 'split-kanji',
    先駆者: 'other',
    コーヒー: 'known',
  }
  const splitOf = (s: string) => splits[s] ?? 'other'

  it('辞書に無い語・固有名詞を含む・割れた漢字だけを足す', () => {
    const rows = selectSupplement(
      [noun('サブスク'), noun('スマートフォン'), noun('王都'), noun('先駆者'), noun('コーヒー')],
      splitOf,
    )
    expect(rows.map((r) => r.split(',')[0])).toEqual(['サブスク', 'スマートフォン', '王都'])
  })

  it('同じ表層形は最初の1件だけを見る（small を先に渡す）', () => {
    const rows = selectSupplement(
      [noun('サブスク', { sub: 'サ変可能' }), noun('サブスク', { source: 'core' })],
      splitOf,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('名詞,サ変接続')
  })

  it('最初の1件が線で落ちたら、後の同じ表層形も足さない', () => {
    expect(
      selectSupplement(
        [noun('サブスク', { cost: 0 }), noun('サブスク', { source: 'core' })],
        splitOf,
      ),
    ).toEqual([])
  })
})
