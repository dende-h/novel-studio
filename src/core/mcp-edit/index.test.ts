import { describe, expect, it } from 'vitest'
import type { Work } from '../schema'
import { emptyStructure } from '../structure'
import {
  addEpisode,
  deleteGlossaryEntry,
  McpEditError,
  parseStructure,
  setEpisode,
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

  it('deleteGlossaryEntry は削除、存在しなければ McpEditError', () => {
    const [w] = deleteGlossaryEntry([work()], 'w1', 'g1', 100)
    expect(w?.glossary).toHaveLength(0)
    expect(() => deleteGlossaryEntry([work()], 'w1', 'zzz', 1)).toThrow(McpEditError)
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
