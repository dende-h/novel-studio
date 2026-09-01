import { describe, expect, it } from 'vitest'
import {
  budgetNotice,
  clampInt,
  clipLinesToBytes,
  fitToBudget,
  MAX_MAX_BYTES,
  MIN_MAX_BYTES,
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
