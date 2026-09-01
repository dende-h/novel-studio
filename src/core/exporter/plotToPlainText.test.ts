import { describe, expect, it } from 'vitest'
import type { Plot } from '../plot'
import type { Work } from '../schema'
import {
  beatIndexLine,
  plotIndexToPlainText,
  plotToPlainText,
  worldIndexToPlainText,
  worldNoteToPlainText,
  worldToPlainText,
} from './plotToPlainText'

/**
 * プロット・世界観設定の整形。MCP 経由の間接カバーしか無かったので、
 * **オプションの既定値が従来の出力と一致すること**をここで直に固定する。
 */

const work = (): Work => ({
  id: 'w1',
  title: '星のない空',
  episodes: [{ id: 'e1', title: '第一話', blocks: [] }],
  glossary: [{ id: 'g1', name: 'アカリ', aliases: [], createdAt: 1, updatedAt: 1 }],
})

const worldNotes = (): Plot['world'] => [
  { id: 'wn1', slot: 'stage', body: '海辺の町。', updatedAt: 1 },
  { id: 'wn2', slot: 'custom', title: '色', body: '青は喪失。', updatedAt: 1 },
]

const beats = (): Plot['beats'] => [
  {
    id: 'bt1',
    title: '出発',
    summary: '旅に出る。',
    castRefs: [],
    placeRefs: [],
    lineRefs: [],
    status: 'fixed',
  },
  { id: 'bt2', title: '到着', castRefs: [], placeRefs: [], lineRefs: [], status: 'idea' },
]

const plot = (over: Partial<Plot> = {}): Plot => ({
  id: 'p1',
  workId: 'w1',
  title: 'プロット',
  sections: [{ id: 's1', title: '第一幕', beatIds: ['bt1', 'bt2'] }],
  beats: beats(),
  lines: [],
  foreshadows: [],
  secrets: [],
  world: worldNotes(),
  updatedAt: 1,
  ...over,
})

describe('worldToPlainText の絞り込み', () => {
  it('引数なしは全枠（従来どおり）', () => {
    const text = worldToPlainText(plot())
    expect(text).toContain('[slot: stage, note_id: wn1]')
    expect(text).toContain('[slot: custom, note_id: wn2]')
  })

  it('note_id / slots でその枠だけ。見出しの形は全量と同じ', () => {
    const one = worldToPlainText(plot(), { noteId: 'wn2' })
    expect(one).toContain(
      worldNoteToPlainText(worldNotes()[1] as NonNullable<Plot['world']>[number]),
    )
    expect(one).not.toContain('海辺の町。')
    expect(worldToPlainText(plot(), { slots: ['stage'] })).toContain('海辺の町。')
  })

  it('該当が無ければ空文字（呼び出し側が案内文に差し替える）', () => {
    expect(worldToPlainText(plot(), { noteId: 'nope' })).toBe('')
    expect(worldToPlainText(undefined)).toBe('')
  })
})

describe('索引の整形', () => {
  it('世界観の索引は本文を持たず、字数と冒頭だけ載せる', () => {
    const text = worldIndexToPlainText(worldNotes())
    expect(text).toContain('[slot: stage, note_id: wn1]（5字）')
    expect(text).toContain('海辺の町。') // 冒頭 60 字のプレビュー
    expect(worldIndexToPlainText(worldNotes(), { preview: false })).not.toContain('海辺の町。')
  })

  it('withEmptySlots で未記入の定型枠も出る（書ける枠が読み側から見える）', () => {
    const text = worldIndexToPlainText(worldNotes(), { withEmptySlots: true })
    expect(text).toContain('[slot: rules]（未記入）')
  })

  it('空でも空文字は返さない', () => {
    expect(worldIndexToPlainText([])).toContain('まだ世界観設定がありません')
  })

  it('ビートの索引行は要約の本文を含まず字数だけ', () => {
    const line = beatIndexLine(beats()[0] as Plot['beats'][number], 1)
    expect(line).toBe('1. [確定] 出発 [beat_id: bt1]（要約 5字）')
  })

  it('プロットの索引は世界観の枠を先頭に置き、本文は落とす', () => {
    const text = plotIndexToPlainText([plot()], work())
    expect(text.indexOf('note_id: wn1')).toBeLessThan(text.indexOf('【プロット】'))
    expect(text).not.toContain('海辺の町。')
    expect(text).not.toContain('旅に出る。')
    expect(text).toContain('[beat_id: bt1]')
    expect(text).toContain('伏線 0件 ／ 秘密 0件')
  })

  it('プロットが無い作品でも案内を返す', () => {
    expect(plotIndexToPlainText([], work())).toContain('プロットはまだありません')
  })
})

describe('plotToPlainText の絞り込み', () => {
  it('引数なしは世界観を丸ごと載せた従来の出力', () => {
    const text = plotToPlainText([plot()], work())
    expect(text).toContain('海辺の町。')
    expect(text).toContain('1. [確定] 出発 [beat_id: bt1]')
    expect(text).toContain('2. [検討中] 到着 [beat_id: bt2]')
  })

  it('include_world: false でも世界観への導線は消えない', () => {
    const text = plotToPlainText([plot()], work(), { includeWorld: false })
    expect(text).not.toContain('海辺の町。')
    expect(text).toContain('世界観設定（作者専用の決め事）が 2 項目あります')
  })

  it('section_id / beatIds で絞っても幕の通し番号は変わらない', () => {
    const text = plotToPlainText([plot()], work(), { beatIds: ['bt2'] })
    expect(text).toContain('2. [検討中] 到着 [beat_id: bt2]')
    expect(text).not.toContain('[beat_id: bt1]')
    // 幕の見出しに出る件数は絞り込み前の実数のまま（何件あるかを見失わない）。
    expect(text).toContain('[section_id: s1]（2ビート）')
  })

  it('該当ビートの無い幕は落とすが、幕そのものの指定なら見出しは残る', () => {
    const two = plot({
      sections: [
        { id: 's1', title: '第一幕', beatIds: ['bt1'] },
        { id: 's2', title: '第二幕', beatIds: ['bt2'] },
      ],
    })
    const text = plotToPlainText([two], work(), { beatIds: ['bt2'] })
    expect(text).toContain('[section_id: s2]')
    expect(text).not.toContain('[section_id: s1]')
    expect(plotToPlainText([two], work(), { sectionId: 's1' })).toContain('[section_id: s1]')
  })
})
