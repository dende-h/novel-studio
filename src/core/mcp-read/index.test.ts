import { describe, expect, it } from 'vitest'
import {
  budgetNotice,
  clampInt,
  clipLinesToBytes,
  fitItemsToBytes,
  fitToBudget,
  MAX_MAX_BYTES,
  MIN_MAX_BYTES,
  pageNotice,
  paginate,
  resolveMaxBytes,
  toInt,
  utf8Bytes,
} from './index'

describe('utf8Bytes', () => {
  it('日本語は 1 文字 3 バイトで数える（String.length では 1/3 に見える）', () => {
    expect(utf8Bytes('あ')).toBe(3)
    expect('あいう'.length).toBe(3)
    expect(utf8Bytes('あいう')).toBe(9)
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('😀')).toBe(4)
  })
})

describe('toInt / clampInt', () => {
  it('数値・数値文字列を整数へ、判別できなければ undefined', () => {
    expect(toInt(5)).toBe(5)
    expect(toInt(2.7)).toBe(2)
    expect(toInt('50')).toBe(50)
    expect(toInt('abc')).toBeUndefined()
    expect(toInt('')).toBeUndefined()
    expect(toInt(Number.NaN)).toBeUndefined()
    expect(toInt(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(toInt(null)).toBeUndefined()
    expect(toInt(undefined)).toBeUndefined()
  })

  it('範囲外は丸め、判別できない値は既定へ倒す', () => {
    const opts = { min: 1, max: 100, fallback: 10 }
    expect(clampInt(-1, opts)).toBe(1)
    expect(clampInt(1e9, opts)).toBe(100)
    expect(clampInt('abc', opts)).toBe(10)
    expect(clampInt(undefined, opts)).toBe(10)
  })
})

describe('resolveMaxBytes', () => {
  it('未指定は既定、0 は無制限（利用者が改修前の挙動へ戻す唯一の手段）', () => {
    expect(resolveMaxBytes(undefined, 100_000)).toBe(100_000)
    expect(resolveMaxBytes(null, 100_000)).toBe(100_000)
    expect(resolveMaxBytes(0, 100_000)).toBe(0)
    expect(resolveMaxBytes('0', 100_000)).toBe(0)
  })

  it('小さすぎ・大きすぎは丸め、負値と不正値は既定（軽い側）へ倒す', () => {
    expect(resolveMaxBytes(10, 100_000)).toBe(MIN_MAX_BYTES)
    expect(resolveMaxBytes(9_999_999, 100_000)).toBe(MAX_MAX_BYTES)
    expect(resolveMaxBytes(-5, 100_000)).toBe(100_000)
    expect(resolveMaxBytes('たくさん', 100_000)).toBe(100_000)
  })
})

describe('paginate', () => {
  it('既定の窓を返し、続きがあれば next_offset を出す', () => {
    expect(paginate(10, undefined, undefined, 4)).toEqual({
      start: 0,
      end: 4,
      total: 10,
      nextOffset: 4,
    })
    expect(paginate(10, 8, 4, 4)).toEqual({ start: 8, end: 10, total: 10, nextOffset: null })
  })

  it('offset が総件数を超えても行き止まりにしない（最後の窓へ寄せる）', () => {
    expect(paginate(3, 999, 2, 200)).toEqual({ start: 2, end: 3, total: 3, nextOffset: null })
  })

  it('0 件でも壊れない', () => {
    expect(paginate(0, 5, 10, 200)).toEqual({ start: 0, end: 0, total: 0, nextOffset: null })
  })
})

describe('clipLinesToBytes', () => {
  it('行の途中では切らない', () => {
    const lines = ['あああ', 'いいい', 'ううう'] // 各 9 バイト＋改行 1
    const res = clipLinesToBytes(lines, 21)
    expect(res.lines).toEqual(['あああ', 'いいい'])
    expect(res.dropped).toBe(1)
  })

  it('0（無制限）ならそのまま返す', () => {
    const lines = ['あ'.repeat(1000)]
    expect(clipLinesToBytes(lines, 0)).toEqual({ lines, dropped: 0 })
  })
})

describe('fitToBudget', () => {
  it('予算に収まればそのまま（1 バイトも変えない）', () => {
    const full = 'あ'.repeat(10)
    expect(fitToBudget(full, () => '索引', 1000)).toBe(full)
  })

  it('予算を超えたら索引へ切り替え、実バイト数を渡す', () => {
    const full = 'あ'.repeat(100) // 300 バイト
    expect(fitToBudget(full, (bytes) => `索引 ${bytes}`, 100)).toBe('索引 300')
  })

  it('無制限（0）なら超えていても全量を返す', () => {
    const full = 'あ'.repeat(100)
    expect(fitToBudget(full, () => '索引', 0)).toBe(full)
  })

  it('索引のほうが大きくなるなら縮退しない（縮退したのに増える、を防ぐ）', () => {
    const full = 'あ'.repeat(50) // 150 バイト
    expect(fitToBudget(full, () => 'い'.repeat(200), 100)).toBe(full)
  })

  it('索引は超えたときにしか組み立てない（遅延評価）', () => {
    let built = 0
    fitToBudget(
      'short',
      () => {
        built += 1
        return '索引'
      },
      1000,
    )
    expect(built).toBe(0)
  })
})

describe('budgetNotice', () => {
  it('1 行目は機械可読、以降は次の一手（復旧線を必ず含む）', () => {
    const notice = budgetNotice({
      truncated: true,
      mode: 'index',
      maxBytes: 100_000,
      fullBytes: 214_300,
      page: { start: 0, end: 120, total: 214, nextOffset: 120 },
      recovery: ['従来どおり全量: get_glossary(work_id="w1", max_bytes=0)'],
    })
    const [head, ...rest] = notice.split('\n')
    expect(head).toContain('truncated=true')
    expect(head).toContain('mode=index')
    expect(head).toContain('total=214')
    expect(head).toContain('shown=1-120')
    expect(head).toContain('next_offset=120')
    expect(rest.join('\n')).toContain('max_bytes=0')
  })
})

describe('fitItemsToBytes', () => {
  it('項目単位で予算に収める（行数と項目数が 1 対 1 でなくてもよい）', () => {
    // 2 行になる項目（世界観索引の冒頭プレビュー）を混ぜる。
    const items = ['あいう', 'かきく\n    えお', 'さしす']
    expect(fitItemsToBytes(items, 0, 1_000)).toEqual({ count: 3, dropped: 0 })
    // 1 件目（9 バイト＋改行）だけが入る予算。
    expect(fitItemsToBytes(items, 0, 10)).toEqual({ count: 1, dropped: 2 })
    // 見出し・案内ぶんの overhead を引いてから数える。
    expect(fitItemsToBytes(items, 8, 100)).toEqual({ count: 3, dropped: 0 })
    // 1 件も入らない予算でも 0 件にはしない（行き止まりを作らない）。
    expect(fitItemsToBytes(items, 8, 10)).toEqual({ count: 1, dropped: 2 })
    // 0 は無制限。項目が無ければ 0 件。
    expect(fitItemsToBytes(items, 0, 0)).toEqual({ count: 3, dropped: 0 })
    expect(fitItemsToBytes([], 0, 10)).toEqual({ count: 0, dropped: 0 })
  })
})

describe('pageNotice', () => {
  it('窓を返したときは truncated=false と総件数・次の offset を書く', () => {
    const notice = pageNotice({
      label: '用語集の項目',
      page: { start: 0, end: 200, total: 400, nextOffset: 200 },
      recovery: ['続き: get_glossary(work_id="w1", offset=200)'],
    })
    const [head, ...rest] = notice.split('\n')
    // 1 行目は機械可読。縮退（索引）と窓を取り違えさせない。
    expect(head).toContain('truncated=false')
    expect(head).toContain('paged=true')
    expect(head).toContain('total=400')
    expect(head).toContain('shown=1-200')
    expect(head).toContain('next_offset=200')
    expect(rest.join('\n')).toContain('全件ではありません')
    expect(rest.join('\n')).toContain('offset=200')
  })

  it('窓に全件が収まったら「すべて返した」と書く（続きがあると誤解させない）', () => {
    const notice = pageNotice({
      label: '用語集の項目',
      page: { start: 0, end: 3, total: 3, nextOffset: null },
      recovery: [],
    })
    expect(notice).toContain('next_offset=null')
    expect(notice).toContain('すべて返しました')
    expect(notice).not.toContain('全件ではありません')
  })
})
