import { describe, expect, it } from 'vitest'
import type { Episode } from '../schema'
import { addNode, emptyStructure } from '../structure'
import {
  appendNote,
  buildOutlineRows,
  type FlatNote,
  flattenNotes,
  indentNote,
  moveNote,
  outdentNote,
  progressOf,
  rebuildEpisodeNotes,
  removeNoteAt,
  setNoteLabel,
  totalChars,
  writtenCount,
} from './index'

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

  it('flattenNotes/rebuildEpisodeNotes は parentId と深さを相互変換し、往復で保存内容が安定する', () => {
    let s = emptyStructure('o1', 'w1', 'outline', 0)
    s = addNode(s, { id: 'a', kind: 'note', label: 'A', episodeRef: 'e1' })
    s = addNode(s, { id: 'b', kind: 'note', label: 'B', episodeRef: 'e1', parentId: 'a' })
    s = addNode(s, { id: 'c', kind: 'note', label: 'C', episodeRef: 'e1', parentId: 'b' })
    s = addNode(s, { id: 'd', kind: 'note', label: 'D', episodeRef: 'e1' })
    s = addNode(s, { id: 'z', kind: 'note', label: '他話', episodeRef: 'e2' })
    const flat = flattenNotes(s, 'e1')
    expect(flat).toEqual([
      { id: 'a', label: 'A', depth: 0 },
      { id: 'b', label: 'B', depth: 1 },
      { id: 'c', label: 'C', depth: 2 },
      { id: 'd', label: 'D', depth: 0 },
    ])
    const rebuilt = rebuildEpisodeNotes(s, 'e1', flat)
    expect(flattenNotes(rebuilt, 'e1')).toEqual(flat)
    expect(rebuilt.nodes.find((n) => n.id === 'c')?.parentId).toBe('b')
    expect(rebuilt.nodes.find((n) => n.id === 'z')?.label).toBe('他話') // 他の話は無傷
  })

  it('flattenNotes は壊れた parentId（存在しない・循環）を最上位へ救済する', () => {
    let s = emptyStructure('o1', 'w1', 'outline', 0)
    s = addNode(s, { id: 'a', kind: 'note', label: 'A', episodeRef: 'e1', parentId: 'ghost' })
    s = addNode(s, { id: 'b', kind: 'note', label: 'B', episodeRef: 'e1', parentId: 'b' })
    expect(flattenNotes(s, 'e1').map((f) => [f.id, f.depth])).toEqual([
      ['a', 0],
      ['b', 0],
    ])
  })

  const F = (id: string, depth: number): FlatNote => ({ id, label: id, depth })

  it('indentNote は直前の兄弟の子になる（先頭・深さ上限では no-op）', () => {
    const flat = [F('a', 0), F('b', 0), F('c', 1)]
    expect(indentNote(flat, 'a')).toBeNull() // ぶら下がる先が無い
    expect(indentNote(flat, 'b')?.map((f) => f.depth)).toEqual([0, 1, 2]) // 子(c)も一緒に沈む
    const deep = [F('a', 0), F('b', 1), F('c', 2), F('d', 2)]
    expect(indentNote(deep, 'd')).toBeNull() // 上限（3段）超過
    expect(indentNote(deep, 'b')).toBeNull() // 直前に兄弟（深さ1）がいない
    const wide = [F('x', 0), F('a', 0), F('a1', 1), F('a2', 2)]
    expect(indentNote(wide, 'a')).toBeNull() // サブツリー最深(a2)が上限を超える
  })

  it('outdentNote は 1 段上がり、最上位では no-op', () => {
    const flat = [F('a', 0), F('b', 1), F('c', 2)]
    expect(outdentNote(flat, 'a')).toBeNull()
    expect(outdentNote(flat, 'b')?.map((f) => f.depth)).toEqual([0, 0, 1]) // 子(c)も一緒に上がる
  })

  it('moveNote は兄弟間でサブツリーごと入れ替え、端では no-op', () => {
    const flat = [F('a', 0), F('a1', 1), F('b', 0), F('c', 0)]
    expect(moveNote(flat, 'a', -1)).toBeNull()
    expect(moveNote(flat, 'b', -1)?.map((f) => f.id)).toEqual(['b', 'a', 'a1', 'c'])
    expect(moveNote(flat, 'a', 1)?.map((f) => f.id)).toEqual(['b', 'a', 'a1', 'c'])
    expect(moveNote(flat, 'c', 1)).toBeNull()
    expect(moveNote(flat, 'a1', 1)).toBeNull() // 兄弟がいない
  })

  it('removeNoteAt は子を消さず 1 段昇格させる', () => {
    const flat = [F('a', 0), F('b', 1), F('c', 2), F('d', 0)]
    expect(removeNoteAt(flat, 'a')).toEqual([F('b', 0), F('c', 1), F('d', 0)])
  })

  it('setNoteLabel / appendNote（深さは最後のメモ+1 と上限に収める）', () => {
    const flat = [F('a', 0)]
    expect(setNoteLabel(flat, 'a', '改')[0]?.label).toBe('改')
    expect(appendNote(flat, 'b', 'B', 5).at(-1)).toEqual({ id: 'b', label: 'B', depth: 1 })
    expect(appendNote([], 'b', 'B', 3).at(-1)).toEqual({ id: 'b', label: 'B', depth: 0 })
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
