import { describe, expect, it } from 'vitest'
import { blocksToNotation } from '../exporter/blocksToNotation'
import { WorkSchema } from '../schema'
import { buildImportedWork } from './build'

let n = 0
const genId = () => `id-${++n}`
const now = () => 1_700_000_000_000

describe('buildImportedWork', () => {
  it('WorkSchema を通り、id がすべて異なり、format は付かない', () => {
    const w = buildImportedWork(
      {
        title: '作品',
        author: 'ペン',
        episodes: [
          { title: '一', body: 'A' },
          { title: '二', body: 'B' },
        ],
      },
      genId,
      now,
    )
    expect(() => WorkSchema.parse(w)).not.toThrow()
    const ids = [w.id, ...w.episodes.map((e) => e.id)]
    expect(new Set(ids).size).toBe(ids.length)
    expect(w.format).toBeUndefined()
    expect(w.author).toBe('ペン')
    expect(w.updatedAt).toBe(now())
  })
  it('著者が空ならキーを付けない', () => {
    const w = buildImportedWork({ title: 't', author: '  ', episodes: [] }, genId, now)
    expect('author' in w).toBe(false)
  })
  it('空タイトルは「第N話」で補う', () => {
    const w = buildImportedWork(
      {
        title: 't',
        episodes: [
          { title: '', body: '' },
          { title: ' ', body: '' },
        ],
      },
      genId,
      now,
    )
    expect(w.episodes.map((e) => e.title)).toEqual(['第1話', '第2話'])
  })
  it('ルビ・傍点・字下げは記法のまま往復する', () => {
    const body = '　｜ひらがな《るび》は猫である。\n漢字《かんじ》\n《《強調》》\n\n次の段落'
    const w = buildImportedWork({ title: 't', episodes: [{ title: '一', body }] }, genId, now)
    expect(blocksToNotation(w.episodes[0]?.blocks ?? [])).toBe(body)
  })
  it('漢字だけの親文字に付けた ｜ は正本の記法（パイプ省略）に正規化される＝同じルビ', () => {
    const w = buildImportedWork(
      { title: 't', episodes: [{ title: '一', body: '｜吾輩《わがはい》' }] },
      genId,
      now,
    )
    expect(w.episodes[0]?.blocks[0]?.inlines[0]).toEqual({
      type: 'ruby',
      base: '吾輩',
      reading: 'わがはい',
    })
    expect(blocksToNotation(w.episodes[0]?.blocks ?? [])).toBe('吾輩《わがはい》')
  })
  it('なろう式の傍点 ｜字《・》 はルビのまま（変換しない）', () => {
    const w = buildImportedWork(
      { title: 't', episodes: [{ title: '一', body: '｜字《・》' }] },
      genId,
      now,
    )
    expect(w.episodes[0]?.blocks[0]?.inlines[0]).toEqual({
      type: 'ruby',
      base: '字',
      reading: '・',
    })
  })
  it('末尾の空行は落とす', () => {
    const w = buildImportedWork(
      { title: 't', episodes: [{ title: '一', body: 'A\n\n\n' }] },
      genId,
      now,
    )
    expect(w.episodes[0]?.blocks).toHaveLength(1)
  })
})
