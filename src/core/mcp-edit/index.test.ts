import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { emptyStructure } from '../structure'
import {
  addEpisode,
  createWork,
  deleteGlossaryEntry,
  McpEditError,
  parseOutlineNotes,
  parseStructure,
  setEpisode,
  setOutlineNotes,
  setWorkMeta,
  upsertGlossaryEntry,
  upsertStructure,
} from './index'

const work = (): Work => ({
  id: 'w1',
  title: '作品',
  author: '著者',
  episodes: [{ id: 'e1', title: '第一話', blocks: [] }],
  glossary: [{ id: 'g1', name: 'アカリ', aliases: [], createdAt: 1, updatedAt: 1 }],
  updatedAt: 0,
})

describe('mcp-edit（MCP 書き込みの純ロジック）', () => {
  it('setWorkMeta はメタを更新し updatedAt を進める', () => {
    const [w] = setWorkMeta([work()], 'w1', { title: '新題', description: 'あらすじ' }, 100)
    expect(w).toMatchObject({ title: '新題', description: 'あらすじ', updatedAt: 100 })
  })

  it('setWorkMeta は空文字の著者を未設定へ畳む', () => {
    const [w] = setWorkMeta([work()], 'w1', { author: '  ' }, 100)
    expect(w?.author).toBeUndefined()
  })

  it('存在しない作品は McpEditError', () => {
    expect(() => setWorkMeta([work()], 'zzz', { title: 'x' }, 1)).toThrow(McpEditError)
  })

  it('setEpisode はタイトルと本文（記法解析）を更新', () => {
    const [w] = setEpisode([work()], 'w1', 'e1', { title: '改', body: '本文です' }, 100)
    expect(w?.episodes[0]).toMatchObject({ title: '改' })
    expect(w?.episodes[0]?.blocks.length).toBeGreaterThan(0)
  })

  it('addEpisode は末尾に話を追加', () => {
    const [w] = addEpisode([work()], 'w1', { title: '第二話', body: 'あ' }, 'e2', 100)
    expect(w?.episodes.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('upsertGlossaryEntry は新規追加（id 未指定）', () => {
    const [w] = upsertGlossaryEntry([work()], 'w1', { name: '師匠' }, 'g2', 100)
    expect(w?.glossary?.map((g) => g.name)).toEqual(['アカリ', '師匠'])
  })

  it('upsertGlossaryEntry は既存を更新し createdAt を保つ', () => {
    const [w] = upsertGlossaryEntry([work()], 'w1', { id: 'g1', name: 'アカリ改' }, 'x', 100)
    const g = w?.glossary?.find((e) => e.id === 'g1')
    expect(g).toMatchObject({ name: 'アカリ改', createdAt: 1, updatedAt: 100 })
  })

  it('upsertGlossaryEntry は body（旧・詳細）を summary へ一本化し、body キーを書かない', () => {
    const [w] = upsertGlossaryEntry(
      [work()],
      'w1',
      { name: '師匠', summary: '主人公の師。', body: '若い頃は灯台守だった。' },
      'g2',
      100,
    )
    const g = w?.glossary?.find((e) => e.id === 'g2')
    expect(g?.summary).toBe('主人公の師。\n\n若い頃は灯台守だった。')
    expect(g?.body).toBeUndefined()
  })

  it('upsertGlossaryEntry は更新時に既存サムネイルを保つ（MCP から画像は触れない）', () => {
    const base = work()
    const withThumb: typeof base = {
      ...base,
      glossary: base.glossary?.map((g) => ({ ...g, thumbnail: 'data:image/jpeg;base64,x' })),
    }
    const [w] = upsertGlossaryEntry([withThumb], 'w1', { id: 'g1', name: 'アカリ' }, 'x', 100)
    expect(w?.glossary?.find((e) => e.id === 'g1')?.thumbnail).toBe('data:image/jpeg;base64,x')
  })

  it('deleteGlossaryEntry は削除、存在しなければ McpEditError', () => {
    const [w] = deleteGlossaryEntry([work()], 'w1', 'g1', 100)
    expect(w?.glossary).toHaveLength(0)
    expect(() => deleteGlossaryEntry([work()], 'w1', 'zzz', 1)).toThrow(McpEditError)
  })

  it('createWork は空の作品を追加し、空タイトルは McpEditError', () => {
    const works = createWork(
      [work()],
      { title: ' 新作 ', author: '星野', description: '' },
      'w2',
      100,
    )
    expect(works).toHaveLength(2)
    expect(works[1]).toMatchObject({ id: 'w2', title: '新作', author: '星野', updatedAt: 100 })
    expect(works[1]?.description).toBeUndefined() // 空文字は未設定へ畳む
    expect(works[1]?.episodes).toEqual([])
    expect(() => createWork([], { title: '   ' }, 'w3', 1)).toThrow(McpEditError)
  })

  it('parseOutlineNotes はインデント（タブ・半角2個・全角1個）と箇条書き記号を解釈する', () => {
    let n = 0
    const flat = parseOutlineNotes(
      '起\n  - 展開\n\t・伏線\n　結末候補\n\n        深すぎ',
      () => `n${n++}`,
    )
    expect(flat.map((f) => [f.label, f.depth])).toEqual([
      ['起', 0],
      ['展開', 1],
      ['伏線', 1],
      ['結末候補', 1],
      ['深すぎ', 2], // 上限（MAX_NOTE_DEPTH=2）で頭打ち
    ])
  })

  it('setOutlineNotes は主アウトラインへ書き込み、無ければ決定的 id で作る', () => {
    let n = 0
    const genId = () => `n${n++}`
    const structures = setOutlineNotes([], [work()], 'w1', 'e1', 'A\n  B', genId, 100)
    expect(structures).toHaveLength(1)
    expect(structures[0]?.id).toBe('w1:outline') // singleton id ＝端末間で収束する
    expect(structures[0]?.updatedAt).toBe(100)
    const notes = structures[0]?.nodes.filter((x) => x.episodeRef === 'e1') ?? []
    expect(notes.map((x) => [x.label, x.parentId ?? null])).toEqual([
      ['A', null],
      ['B', 'n0'], // B は A の子
    ])
    // 2 回目は既存の主アウトラインを置換し、空文字で全消去できる
    const cleared = setOutlineNotes(structures, [work()], 'w1', 'e1', '', genId, 200)
    expect(cleared).toHaveLength(1)
    expect(cleared[0]?.nodes.filter((x) => x.episodeRef === 'e1')).toEqual([])
  })

  it('setOutlineNotes は未知の作品・話を McpEditError で弾く', () => {
    expect(() => setOutlineNotes([], [work()], 'zzz', 'e1', 'a', () => 'x', 1)).toThrow(
      McpEditError,
    )
    expect(() => setOutlineNotes([], [work()], 'w1', 'zzz', 'a', () => 'x', 1)).toThrow(
      McpEditError,
    )
  })

  it('parseStructure は妥当な JSON を Structure に、不正は McpEditError', () => {
    const s = emptyStructure('s1', 'w1', 'chart', 0)
    expect(parseStructure(JSON.stringify(s)).id).toBe('s1')
    expect(() => parseStructure('{ not json')).toThrow(McpEditError)
    expect(() => parseStructure('{"id":"x"}')).toThrow(McpEditError)
  })

  it('upsertStructure は id 一致で置換・無ければ追加', () => {
    const a = emptyStructure('s1', 'w1', 'chart', 0)
    const b = { ...emptyStructure('s1', 'w1', 'chart', 9), title: '改' }
    expect(upsertStructure([], a).map((s) => s.id)).toEqual(['s1'])
    expect(upsertStructure([a], b)[0]?.title).toBe('改')
    expect(upsertStructure([a], emptyStructure('s2', 'w1', 'mindmap', 0))).toHaveLength(2)
  })
})
