import { describe, expect, it } from 'vitest'
import { resolveRef } from '../glossary'
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

  it('setEpisode で本文を直しても、変わらない行の block id は引き継がれる', () => {
    const [w1] = setEpisode([work()], 'w1', 'e1', { body: '一行目。\n「二行目」' }, 100)
    const before = w1?.episodes[0]?.blocks.map((b) => b.id)
    const [w2] = setEpisode(
      w1 ? [w1] : [],
      'w1',
      'e1',
      { body: '前置き。\n一行目。\n「二行目」' },
      200,
    )
    const after = w2?.episodes[0]?.blocks.map((b) => b.id)
    expect(after?.slice(1)).toEqual(before)
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

  it('upsertGlossaryEntry の更新は渡した項目だけ書き換える（省略で公開情報・作者メモは消えない）', () => {
    const base = work()
    const rich: typeof base = {
      ...base,
      glossary: [
        {
          id: 'g1',
          name: 'アカリ',
          aliases: ['灯守の娘'],
          category: '人物',
          reading: 'あかり',
          summary: '灯台守の見習い。',
          authorNote: '正体は管理AI',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }
    // 読みだけ直すつもりの更新。以前は全置換で、他のフィールドが黙って消えていた。
    const [w] = upsertGlossaryEntry(
      [rich],
      'w1',
      { id: 'g1', name: 'アカリ', reading: 'あかり（燈）' },
      'x',
      100,
    )
    const g = w?.glossary?.find((e) => e.id === 'g1')
    expect(g).toMatchObject({
      reading: 'あかり（燈）',
      aliases: ['灯守の娘'],
      category: '人物',
      summary: '灯台守の見習い。',
      authorNote: '正体は管理AI',
    })
  })

  it('upsertGlossaryEntry は空文字で項目を削除できる（明示削除だけが消す）', () => {
    const base = work()
    const rich: typeof base = {
      ...base,
      glossary: [
        {
          id: 'g1',
          name: 'アカリ',
          aliases: [],
          summary: '灯台守の見習い。',
          authorNote: '正体は管理AI',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }
    const [w] = upsertGlossaryEntry(
      [rich],
      'w1',
      { id: 'g1', name: 'アカリ', authorNote: '' },
      'x',
      100,
    )
    const g = w?.glossary?.find((e) => e.id === 'g1')
    expect(g?.authorNote).toBeUndefined()
    expect(g?.summary).toBe('灯台守の見習い。') // 触っていない欄は残る
  })

  it('upsertGlossaryEntry は summary を触らない更新では旧 2 欄（summary+body）を保つ', () => {
    const base = work()
    const legacy: typeof base = {
      ...base,
      glossary: [
        {
          id: 'g1',
          name: 'アカリ',
          aliases: [],
          summary: '概要',
          body: '旧・詳細',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }
    const [w] = upsertGlossaryEntry(
      [legacy],
      'w1',
      { id: 'g1', name: 'アカリ', reading: 'あかり' },
      'x',
      100,
    )
    const g = w?.glossary?.find((e) => e.id === 'g1')
    expect(g?.summary).toBe('概要')
    expect(g?.body).toBe('旧・詳細')
    // summary を渡したときだけ一本化される（D-GLOS-PUBLIC-ONE）
    const [w2] = upsertGlossaryEntry(
      [legacy],
      'w1',
      { id: 'g1', name: 'アカリ', summary: '新しい公開情報' },
      'x',
      100,
    )
    const g2 = w2?.glossary?.find((e) => e.id === 'g1')
    expect(g2?.summary).toBe('新しい公開情報')
    expect(g2?.body).toBeUndefined()
  })

  it('upsertGlossaryEntry の改名は旧名を別名へ退避し、参照が解決され続ける', () => {
    const [w] = upsertGlossaryEntry([work()], 'w1', { id: 'g1', name: 'アカリ・ホシノ' }, 'x', 100)
    const g = w?.glossary?.find((e) => e.id === 'g1')
    expect(g?.name).toBe('アカリ・ホシノ')
    expect(g?.aliases).toContain('アカリ')
    // 本文の [[アカリ]]（旧名）は別名経由で解決し続ける
    expect(resolveRef('アカリ', w?.glossary ?? [])?.id).toBe('g1')
  })

  it('upsertGlossaryEntry の改名で新名が自分の別名に居れば昇格して重複を残さない', () => {
    const base = work()
    const withAlias: typeof base = {
      ...base,
      glossary: [{ id: 'g1', name: 'アカリ', aliases: ['燈'], createdAt: 1, updatedAt: 1 }],
    }
    const [w] = upsertGlossaryEntry([withAlias], 'w1', { id: 'g1', name: '燈' }, 'x', 100)
    const g = w?.glossary?.find((e) => e.id === 'g1')
    expect(g?.name).toBe('燈')
    expect(g?.aliases).toEqual(['アカリ']) // 新名は別名から昇格・旧名が退避
  })

  it('upsertGlossaryEntry は他項目と同名の作成・改名・別名を拒否する（D-GLOS-UNIQUE）', () => {
    // 新規作成の同名
    expect(() => upsertGlossaryEntry([work()], 'w1', { name: 'アカリ' }, 'g9', 100)).toThrow(
      McpEditError,
    )
    // 別項目への改名衝突
    const base = work()
    const two: typeof base = {
      ...base,
      glossary: [
        ...(base.glossary ?? []),
        { id: 'g2', name: 'カイ', aliases: [], createdAt: 1, updatedAt: 1 },
      ],
    }
    expect(() => upsertGlossaryEntry([two], 'w1', { id: 'g2', name: 'アカリ' }, 'x', 100)).toThrow(
      McpEditError,
    )
    // 別名の衝突
    expect(() =>
      upsertGlossaryEntry([two], 'w1', { id: 'g2', name: 'カイ', aliases: ['アカリ'] }, 'x', 100),
    ).toThrow(McpEditError)
    // 自分自身の現名と同じ name を送り直すのは衝突ではない（据え置き更新の常道）
    const [w] = upsertGlossaryEntry([two], 'w1', { id: 'g1', name: 'アカリ' }, 'x', 100)
    expect(w?.glossary?.find((e) => e.id === 'g1')?.name).toBe('アカリ')
  })

  it('upsertGlossaryEntry は新規作成で name が空なら McpEditError', () => {
    expect(() => upsertGlossaryEntry([work()], 'w1', { name: ' ' }, 'g9', 100)).toThrow(
      McpEditError,
    )
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
