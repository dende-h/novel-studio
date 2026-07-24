import { describe, expect, it } from 'vitest'
import type { Episode } from '../schema'
import { addNode, emptyStructure } from '../structure'
import { buildOutlineRows, progressOf, totalChars, writtenCount } from './index'

const ep = (id: string, title: string, text: string): Episode => ({
  id,
  title,
  blocks:
    text === '' ? [] : [{ id: `${id}-b`, type: 'paragraph', inlines: [{ type: 'text', text }] }],
})

describe('outline（アウトラインの派生ロジック）', () => {
  it('progressOf は 0字=未着手・それ以上=執筆中', () => {
    expect(progressOf(0)).toBe('empty')
    expect(progressOf(1)).toBe('writing')
  })

  it('buildOutlineRows は本文の話順で行を組み、字数・進捗を出す', () => {
    const episodes = [ep('e1', '一話', 'あいう'), ep('e2', '二話', '')]
    const rows = buildOutlineRows(episodes, null)
    expect(rows.map((r) => r.title)).toEqual(['一話', '二話'])
    expect(rows[0]).toMatchObject({ chars: 3, progress: 'writing' })
    expect(rows[1]).toMatchObject({ chars: 0, progress: 'empty' })
  })

  it('buildOutlineRows は構成メモを episodeRef で各話へ振り分ける', () => {
    let s = emptyStructure('o1', 'w1', 'outline', 0)
    s = addNode(s, { id: 'n1', kind: 'note', label: '導入で伏線', episodeRef: 'e1' })
    s = addNode(s, { id: 'n2', kind: 'note', label: 'どの話でもない', episodeRef: 'zzz' })
    const rows = buildOutlineRows([ep('e1', '一話', 'x')], s)
    expect(rows[0]?.notes.map((n) => n.label)).toEqual(['導入で伏線'])
  })

  it('totalChars / writtenCount', () => {
    const rows = buildOutlineRows(
      [ep('e1', 'a', 'あい'), ep('e2', 'b', ''), ep('e3', 'c', 'う')],
      null,
    )
    expect(totalChars(rows)).toBe(3)
    expect(writtenCount(rows)).toBe(2)
  })
})
