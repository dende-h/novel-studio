import { describe, expect, it } from 'vitest'
import { collapseUnchanged, type DiffLine, diffLines } from './index'

const kinds = (lines: DiffLine[]) => lines.map((l) => l.kind).join(',')

describe('diffLines', () => {
  it('同一テキストは全行 same', () => {
    const d = diffLines('一行目\n二行目', '一行目\n二行目')
    expect(kinds(d)).toBe('same,same')
  })

  it('行の追加を add として返す', () => {
    const d = diffLines('一行目\n三行目', '一行目\n二行目\n三行目')
    expect(d).toEqual([
      { kind: 'same', text: '一行目' },
      { kind: 'add', text: '二行目' },
      { kind: 'same', text: '三行目' },
    ])
  })

  it('行の削除を del として返す', () => {
    const d = diffLines('一行目\n二行目\n三行目', '一行目\n三行目')
    expect(d).toEqual([
      { kind: 'same', text: '一行目' },
      { kind: 'del', text: '二行目' },
      { kind: 'same', text: '三行目' },
    ])
  })

  it('行の書き換えは del + add の対で返す', () => {
    const d = diffLines('冒頭\n旧しい本文\n結び', '冒頭\n新しい本文\n結び')
    expect(kinds(d)).toBe('same,del,add,same')
  })

  it('空文字どうしは 1 本の空 same 行（split の仕様どおり）', () => {
    expect(diffLines('', '')).toEqual([{ kind: 'same', text: '' }])
  })

  it('空 → 本文は全行 add（先頭の空行対応を除く）', () => {
    const d = diffLines('', '一行目\n二行目')
    expect(d.filter((l) => l.kind === 'add').length).toBeGreaterThanOrEqual(1)
    expect(d.some((l) => l.kind === 'del' && l.text !== '')).toBe(false)
  })

  it('巨大入力でも落ちない（フォールバック経路）', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `旧${i}`).join('\n')
    const b = Array.from({ length: 3000 }, (_, i) => `新${i}`).join('\n')
    const d = diffLines(a, b)
    expect(d.filter((l) => l.kind === 'del')).toHaveLength(3000)
    expect(d.filter((l) => l.kind === 'add')).toHaveLength(3000)
  })
})

describe('collapseUnchanged', () => {
  it('変更行の前後 context 行を残し、離れた共通行を skip に畳む', () => {
    const lines = diffLines(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n'),
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'X'].join('\n'),
    )
    const rows = collapseUnchanged(lines, 2)
    expect(rows[0]).toEqual({ kind: 'skip', count: 6 })
    expect(rows.slice(1).map((r) => r.kind)).toEqual(['same', 'same', 'del', 'add'])
  })

  it('変更が無ければ全体が 1 つの skip になる', () => {
    const rows = collapseUnchanged(diffLines('a\nb\nc', 'a\nb\nc'), 2)
    expect(rows).toEqual([{ kind: 'skip', count: 3 }])
  })
})
