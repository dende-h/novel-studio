import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { GlossaryEntry, Inline, Work } from '../schema'
import {
  categoriesOf,
  findAppearances,
  matchesQuery,
  renameEntry,
  resolvedNameSet,
  resolveRef,
  shouldTriggerSuggest,
  sortEntries,
  suggestEntries,
} from './index'

/** epIdx 話・blockIdx 段落の inlines を取り出す（paragraph 前提）。 */
function inlinesOf(w: Work, epIdx: number, blockIdx: number): Inline[] {
  const block = w.episodes[epIdx]?.blocks[blockIdx]
  if (!block || block.type !== 'paragraph') throw new Error('paragraph block を期待')
  return block.inlines
}

function entry(partial: Partial<GlossaryEntry> & { name: string }): GlossaryEntry {
  return {
    id: partial.id ?? 'g1',
    name: partial.name,
    aliases: partial.aliases ?? [],
    category: partial.category,
    reading: partial.reading,
    summary: partial.summary,
    body: partial.body,
    createdAt: partial.createdAt ?? 0,
    updatedAt: partial.updatedAt ?? 0,
  }
}

function work(episodes: { id: string; body: string }[], glossary: GlossaryEntry[] = []): Work {
  return {
    id: 'w1',
    title: '作品',
    episodes: episodes.map((e) => ({
      id: e.id,
      title: e.id,
      blocks: parseEpisodeBody(e.body),
    })),
    glossary,
  }
}

describe('resolveRef（name + aliases trim 完全一致）', () => {
  const entries = [entry({ id: 'g1', name: 'アリス', aliases: ['アリ'], reading: 'ありす' })]

  it('GR1: name 完全一致で解決', () => {
    expect(resolveRef('アリス', entries)?.id).toBe('g1')
  })

  it('GR2: alias 完全一致で解決', () => {
    expect(resolveRef('アリ', entries)?.id).toBe('g1')
  })

  it('GR3: trim 後一致（前後の半角/全角空白を無視）', () => {
    expect(resolveRef(' アリス ', entries)?.id).toBe('g1')
    expect(resolveRef('　アリス　', entries)?.id).toBe('g1')
  })

  it('GR4: 不一致 → undefined', () => {
    expect(resolveRef('ボブ', entries)).toBeUndefined()
  })

  it('GR5: 大小区別あり', () => {
    const en = [entry({ name: 'Alice' })]
    expect(resolveRef('alice', en)).toBeUndefined()
    expect(resolveRef('Alice', en)?.name).toBe('Alice')
  })

  it('GR6: name=空（trim 後）は常に未解決', () => {
    expect(resolveRef('', entries)).toBeUndefined()
    expect(resolveRef('　', entries)).toBeUndefined()
  })

  it('GR7: reading のみ一致は解決対象外', () => {
    expect(resolveRef('ありす', entries)).toBeUndefined()
  })

  it('GR8: entry name の前後空白は trim 対称・内部空白は別物', () => {
    const en = [entry({ name: '　アリス　' })]
    expect(resolveRef('アリス', en)?.name).toBe('　アリス　')
    const en2 = [entry({ name: 'アリス スミス' })]
    expect(resolveRef('アリススミス', en2)).toBeUndefined()
  })
})

describe('findAppearances（登場話・参照数）', () => {
  const al = entry({ id: 'g1', name: 'アリス', aliases: ['アリ'] })

  it('GA1/GA2: episodeIds は話順・同話内重複なし／refCount は ref 総数', () => {
    const w = work([
      { id: 'ep1', body: '[[アリス]]と[[アリス]]' },
      { id: 'ep2', body: '[[アリス]]' },
    ])
    expect(findAppearances(w, al)).toEqual({ episodeIds: ['ep1', 'ep2'], refCount: 3 })
  })

  it('GA3: alias 経由 ref も登場話/refCount に算入', () => {
    const w = work([{ id: 'ep1', body: '[[アリス]]と[[アリ]]' }])
    expect(findAppearances(w, al)).toEqual({ episodeIds: ['ep1'], refCount: 2 })
  })

  it('GA4: 未参照 entry は空', () => {
    const w = work([{ id: 'ep1', body: '誰も居ない' }])
    expect(findAppearances(w, al)).toEqual({ episodeIds: [], refCount: 0 })
  })
})

describe('renameEntry（①自動エイリアス ＋ ②本文一括書換）', () => {
  it('GRN1: ① name 更新＋旧名を aliases へ（rewriteBody=false で ref は旧名で解決継続）', () => {
    const w = work([{ id: 'ep1', body: '[[アリス]]' }], [entry({ id: 'g1', name: 'アリス' })])
    const next = renameEntry(w, 'g1', 'アリサ', { rewriteBody: false })
    const e = next.glossary?.[0]
    expect(e?.name).toBe('アリサ')
    expect(e?.aliases).toContain('アリス')
    // 本文 ref は旧名のまま・alias 経由で解決継続
    expect(inlinesOf(next, 0, 0)[0]).toEqual({ type: 'ref', name: 'アリス' })
    expect(resolveRef('アリス', next.glossary ?? [])?.id).toBe('g1')
  })

  it('GRN2: ① 旧名が既に aliases にあれば重複追加しない', () => {
    const w = work([], [entry({ id: 'g1', name: 'アリス', aliases: ['アリス'] })])
    const next = renameEntry(w, 'g1', 'アリサ')
    expect(next.glossary?.[0]?.aliases.filter((a) => a === 'アリス')).toHaveLength(1)
  })

  it('GRN3: ② 全話の ref(旧名) を新名へ書換（他話不変）', () => {
    const w = work(
      [
        { id: 'ep1', body: '[[旧]]と[[旧]]' },
        { id: 'ep2', body: 'なにもなし' },
        { id: 'ep3', body: '[[旧]]' },
      ],
      [entry({ id: 'g1', name: '旧' })],
    )
    const next = renameEntry(w, 'g1', '新', { rewriteBody: true })
    expect(findAppearances(next, next.glossary?.[0] as GlossaryEntry)).toEqual({
      episodeIds: ['ep1', 'ep3'],
      refCount: 3,
    })
    expect(next.episodes[1]).toEqual(w.episodes[1]!) // ep2 不変
  })

  it('GRN4: ② プレーン同名 text は不変（ref のみ書換）', () => {
    const w = work([{ id: 'ep1', body: '旧は[[旧]]' }], [entry({ id: 'g1', name: '旧' })])
    const next = renameEntry(w, 'g1', '新', { rewriteBody: true })
    expect(inlinesOf(next, 0, 0)).toEqual([
      { type: 'text', text: '旧は' },
      { type: 'ref', name: '新' },
    ])
  })

  it('GRN5: ② rewriteBody=false なら本文 ref.name は旧名のまま', () => {
    const w = work([{ id: 'ep1', body: '[[旧]]' }], [entry({ id: 'g1', name: '旧' })])
    const next = renameEntry(w, 'g1', '新', { rewriteBody: false })
    expect(inlinesOf(next, 0, 0)[0]).toEqual({ type: 'ref', name: '旧' })
    expect(next.glossary?.[0]?.name).toBe('新')
    expect(next.glossary?.[0]?.aliases).toContain('旧')
  })

  it('GRN6: ② 旧名一致 ref のみ書換・別 entry の ref は不変', () => {
    const w = work(
      [{ id: 'ep1', body: '[[旧]]と[[他]]' }],
      [entry({ id: 'g1', name: '旧' }), entry({ id: 'g2', name: '他' })],
    )
    const next = renameEntry(w, 'g1', '新', { rewriteBody: true })
    expect(inlinesOf(next, 0, 0)).toEqual([
      { type: 'ref', name: '新' },
      { type: 'text', text: 'と' },
      { type: 'ref', name: '他' },
    ])
  })

  it('GRN7: newName===現 name は no-op（aliases も本文も不変）', () => {
    const w = work([{ id: 'ep1', body: '[[アリス]]' }], [entry({ id: 'g1', name: 'アリス' })])
    const next = renameEntry(w, 'g1', 'アリス')
    expect(next).toBe(w)
    expect(next.glossary?.[0]?.aliases).toHaveLength(0)
  })

  it('GRN8: newName が現 aliases にあれば昇格し循環を作らない', () => {
    const w = work([], [entry({ id: 'g1', name: 'A', aliases: ['B'] })])
    const next = renameEntry(w, 'g1', 'B')
    expect(next.glossary?.[0]?.name).toBe('B')
    expect(next.glossary?.[0]?.aliases).toEqual(['A']) // B 除去・A 退避
  })

  it('GRN9: newName が他 entry の name/alias と衝突は拒否（D-GLOS-UNIQUE=reject）', () => {
    const w = work(
      [],
      [entry({ id: 'g1', name: 'アリス' }), entry({ id: 'g2', name: 'ボブ', aliases: ['B'] })],
    )
    expect(() => renameEntry(w, 'g1', 'ボブ')).toThrow()
    expect(() => renameEntry(w, 'g1', 'B')).toThrow() // alias とも衝突
  })
})

describe('shouldTriggerSuggest（@ サジェスト発火）', () => {
  it('GTR1: 行頭/空白直後（半角・全角）・改行直後の @ はトリガ', () => {
    expect(shouldTriggerSuggest('@')).toBe(true)
    expect(shouldTriggerSuggest('本文 @')).toBe(true) // 半角空白直後
    expect(shouldTriggerSuggest('本文　@')).toBe(true) // 全角空白直後
    expect(shouldTriggerSuggest('前文\n@')).toBe(true) // 改行直後＝行頭
  })

  it('GTR2: 直前が文字/数字なら抑制（メール等の逃げ道）', () => {
    expect(shouldTriggerSuggest('foo@')).toBe(false)
    expect(shouldTriggerSuggest('123@')).toBe(false)
    expect(shouldTriggerSuggest('名前@')).toBe(false)
    expect(shouldTriggerSuggest('全角１２３@')).toBe(false) // 全角数字も数字
  })

  it('GTR3: 句読点・記号直後の @ はトリガ（D-GLOS-SUGGEST-TRIGGER=有効化）', () => {
    expect(shouldTriggerSuggest('だ。@')).toBe(true)
    expect(shouldTriggerSuggest('「@')).toBe(true)
    expect(shouldTriggerSuggest('ね、@')).toBe(true)
  })

  it('GTR4: 全角＠(U+FF20) でもトリガ（半角と同じ境界判定）', () => {
    expect(shouldTriggerSuggest('＠')).toBe(true)
    expect(shouldTriggerSuggest('本文 ＠')).toBe(true)
    expect(shouldTriggerSuggest('だ。＠')).toBe(true)
    expect(shouldTriggerSuggest('foo＠')).toBe(false) // 全角でも文字直後は抑制
  })
})

describe('sortEntries（五十音ソート・name 文字コードフォールバック）', () => {
  it('GSORT1: reading 順に並ぶ', () => {
    const es = [
      entry({ id: '1', name: '佐藤', reading: 'さとう' }),
      entry({ id: '2', name: '安藤', reading: 'あんどう' }),
      entry({ id: '3', name: '加藤', reading: 'かとう' }),
    ]
    expect(sortEntries(es).map((e) => e.id)).toEqual(['2', '3', '1'])
  })

  it('GSORT2: reading 欠落は name の文字コードで配置（端に固めない）', () => {
    const es = [
      entry({ id: 'r', name: 'わ', reading: 'わ' }),
      entry({ id: 'n', name: 'あ' }), // reading 無し → name 'あ' で配置
    ]
    // 'あ'(name) < 'わ'(reading) なので name-only が先
    expect(sortEntries(es).map((e) => e.id)).toEqual(['n', 'r'])
  })

  it('GSORT3: 元配列を変更しない（純関数）', () => {
    const es = [entry({ id: '2', name: 'い' }), entry({ id: '1', name: 'あ' })]
    const sorted = sortEntries(es)
    expect(es.map((e) => e.id)).toEqual(['2', '1']) // 元は不変
    expect(sorted.map((e) => e.id)).toEqual(['1', '2'])
  })
})

describe('matchesQuery（name+aliases+reading 部分一致・body 除外）', () => {
  const e = entry({
    name: 'アリス',
    aliases: ['アリ'],
    reading: 'ありす',
    summary: '主人公',
    body: '長い説明',
  })
  it('name/alias/reading の部分一致で true', () => {
    expect(matchesQuery(e, 'アリ')).toBe(true)
    expect(matchesQuery(e, 'りす')).toBe(true) // reading 部分一致
    expect(matchesQuery(e, 'リ')).toBe(true) // alias 部分一致
  })
  it('body・summary は対象外', () => {
    expect(matchesQuery(e, '主人公')).toBe(false)
    expect(matchesQuery(e, '長い')).toBe(false)
  })
  it('空 query は常に true・大文字小文字を無視', () => {
    expect(matchesQuery(entry({ name: 'Alice' }), '')).toBe(true)
    expect(matchesQuery(entry({ name: 'Alice' }), 'alice')).toBe(true)
  })
})

describe('suggestEntries（一致度順・前方一致優先＋上限）', () => {
  it('GSG1: 前方一致を部分一致より先に', () => {
    const es = [
      entry({ id: 'sub', name: 'マリア', reading: 'まりあ' }), // 'り' は部分一致
      entry({ id: 'pre', name: 'リサ', reading: 'りさ' }), // 'り' で前方一致
    ]
    expect(suggestEntries('り', es).map((e) => e.id)).toEqual(['pre', 'sub'])
  })

  it('GSG2: 同ランクは五十音でタイブレーク', () => {
    const es = [
      entry({ id: 'b', name: 'リク', reading: 'りく' }),
      entry({ id: 'a', name: 'リア', reading: 'りあ' }),
    ]
    expect(suggestEntries('り', es).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('GSG3: 空 query は五十音順に limit 件', () => {
    const es = [
      entry({ id: '1', name: 'う', reading: 'う' }),
      entry({ id: '2', name: 'あ', reading: 'あ' }),
      entry({ id: '3', name: 'い', reading: 'い' }),
    ]
    expect(suggestEntries('', es, 2).map((e) => e.id)).toEqual(['2', '3'])
  })

  it('GSG4: 既定上限は 8 件', () => {
    const es = Array.from({ length: 12 }, (_, i) =>
      entry({ id: `e${i}`, name: `名${i}`, reading: `な${i}` }),
    )
    expect(suggestEntries('な', es)).toHaveLength(8)
  })
})

describe('categoriesOf（カテゴリ絞り込み用の一覧）', () => {
  it('出現順・重複なし・空白のみは除外', () => {
    const es = [
      entry({ id: '1', name: 'a', category: '人物' }),
      entry({ id: '2', name: 'b', category: '地名' }),
      entry({ id: '3', name: 'c', category: '人物' }),
      entry({ id: '4', name: 'd', category: '  ' }),
      entry({ id: '5', name: 'e' }),
    ]
    expect(categoriesOf(es)).toEqual(['人物', '地名'])
  })
})

describe('resolvedNameSet（プレビュー解決判定用の名前集合）', () => {
  it('name と aliases を trim して非空のみ収める', () => {
    const set = resolvedNameSet([
      entry({ id: '1', name: ' アリス ', aliases: ['Alice', '  '] }),
      entry({ id: '2', name: 'ボブ' }),
    ])
    expect(set.has('アリス')).toBe(true) // trim 済み
    expect(set.has('Alice')).toBe(true)
    expect(set.has('ボブ')).toBe(true)
    expect(set.has('')).toBe(false) // 空白のみ alias は除外
    expect(set.size).toBe(3)
  })

  it('空配列は空集合', () => {
    expect(resolvedNameSet([]).size).toBe(0)
  })
})
