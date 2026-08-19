import { describe, expect, it } from 'vitest'
import {
  addBeat,
  addSection,
  beatsOfSection,
  countOpenForeshadows,
  createPlotFromTemplate,
  emptyPlot,
  foreshadowStatus,
  isTrivialPlot,
  moveBeat,
  nextBeatStatus,
  type PlotBeat,
  PlotSchema,
  removeBeat,
  removeLine,
  removeSection,
  sectionTargetTotal,
  singletonPlotId,
  updateBeat,
  upsertForeshadow,
} from './index'

const beat = (id: string, extra: Partial<PlotBeat> = {}): PlotBeat => ({
  id,
  title: id,
  castRefs: [],
  placeRefs: [],
  lineRefs: [],
  status: 'idea',
  ...extra,
})

/** 幕1つ＋ビート2つの最小プロット。 */
function fixture() {
  let p = emptyPlot('p1', 'w1', 100)
  p = addSection(p, { id: 'sec1', title: '第一幕', beatIds: [] })
  p = addBeat(p, 'sec1', beat('b1'))
  p = addBeat(p, 'sec1', beat('b2'))
  return p
}

describe('plot（スキーマと純関数）', () => {
  it('emptyPlot は空の器を作り、schema 検証を通る', () => {
    const p = emptyPlot('p1', 'w1', 100)
    expect(PlotSchema.parse(p)).toEqual(p)
    expect(isTrivialPlot(p)).toBe(true)
    expect(singletonPlotId('w1')).toBe('w1:plot')
  })

  it('createPlotFromTemplate はテンプレの幕とガイド付きビートを生成する', () => {
    let n = 0
    const p = createPlotFromTemplate('p1', 'w1', 100, 'kishotenketsu', () => `id${++n}`)
    expect(PlotSchema.parse(p)).toEqual(p)
    expect(p.sections.map((s) => s.title)).toEqual(['起', '承', '転', '結'])
    expect(p.beats).toHaveLength(4)
    expect(p.beats[0]?.guide).toBeTruthy()
    // 幕の beatIds とビート実体が一致している
    for (const s of p.sections) expect(beatsOfSection(p, s.id)).toHaveLength(s.beatIds.length)
    // ビートがあるのでもう trivial ではない
    expect(isTrivialPlot(p)).toBe(false)
  })

  it('custom テンプレは空の幕を1つだけ持つ', () => {
    const p = createPlotFromTemplate('p1', 'w1', 100, 'custom', () => 'sec')
    expect(p.sections).toHaveLength(1)
    expect(p.beats).toHaveLength(0)
    expect(isTrivialPlot(p)).toBe(true) // 幕だけなら自動生成と区別しない
  })

  it('addBeat は index 指定で挿入位置を選べる', () => {
    let p = fixture()
    p = addBeat(p, 'sec1', beat('b0'), 0)
    expect(p.sections[0]?.beatIds).toEqual(['b0', 'b1', 'b2'])
    // 存在しない幕へは no-op
    expect(addBeat(p, 'nope', beat('bx'))).toBe(p)
  })

  it('updateBeat / removeBeat（削除で幕の beatIds からも外れる）', () => {
    let p = fixture()
    p = updateBeat(p, 'b1', { summary: '手紙が届く', status: 'fixed' })
    expect(p.beats.find((b) => b.id === 'b1')).toMatchObject({
      summary: '手紙が届く',
      status: 'fixed',
    })
    p = removeBeat(p, 'b1')
    expect(p.beats.map((b) => b.id)).toEqual(['b2'])
    expect(p.sections[0]?.beatIds).toEqual(['b2'])
  })

  it('moveBeat は幕またぎの移動と同一幕内の並べ替えに使える', () => {
    let p = fixture()
    p = addSection(p, { id: 'sec2', title: '第二幕', beatIds: [] })
    p = moveBeat(p, 'b1', 'sec2', 0)
    expect(p.sections[0]?.beatIds).toEqual(['b2'])
    expect(p.sections[1]?.beatIds).toEqual(['b1'])
    // 同一幕内の並べ替え
    p = moveBeat(p, 'b2', 'sec1', 0)
    expect(p.sections[0]?.beatIds).toEqual(['b2'])
    // 存在しない幕へは no-op
    expect(moveBeat(p, 'b1', 'nope', 0)).toBe(p)
  })

  it('removeSection はビートを隣の幕へ逃がし、最後の1幕は消さない', () => {
    let p = fixture()
    p = addSection(p, { id: 'sec2', title: '第二幕', beatIds: [] })
    p = moveBeat(p, 'b2', 'sec2', 0)
    p = removeSection(p, 'sec2') // 先頭でない幕→前の幕の末尾へ
    expect(p.sections.map((s) => s.id)).toEqual(['sec1'])
    expect(p.sections[0]?.beatIds).toEqual(['b1', 'b2'])
    expect(removeSection(p, 'sec1')).toBe(p) // 最後の1幕は no-op
  })

  it('removeLine はビート側の lineRefs も外す', () => {
    let p = fixture()
    p = { ...p, lines: [{ id: 'l1', title: 'メイン' }] }
    p = updateBeat(p, 'b1', { lineRefs: ['l1'] })
    p = removeLine(p, 'l1')
    expect(p.lines).toHaveLength(0)
    expect(p.beats.find((b) => b.id === 'b1')?.lineRefs).toEqual([])
  })

  it('伏線の状態は導出され、ビート削除で orphan に落ちる', () => {
    let p = fixture()
    const resolved = { id: 'f1', title: '手紙の署名', plantBeatId: 'b1', payoffBeatId: 'b2' }
    p = upsertForeshadow(p, resolved)
    expect(foreshadowStatus(resolved, p)).toBe('resolved')
    expect(countOpenForeshadows(p)).toBe(0)
    p = removeBeat(p, 'b1') // 張ったビートを削除→回収だけ残る＝根なし
    expect(foreshadowStatus(resolved, p)).toBe('orphan')
    expect(countOpenForeshadows(p)).toBe(1)
    const replanted = { id: 'f1', title: '手紙の署名', plantBeatId: 'b2' }
    p = upsertForeshadow(p, replanted)
    expect(foreshadowStatus(replanted, p)).toBe('planted')
  })

  it('sectionTargetTotal は幕の予定文字数を合算する', () => {
    let p = fixture()
    p = updateBeat(p, 'b1', { targetLength: 8000 })
    p = updateBeat(p, 'b2', { targetLength: 4000 })
    expect(sectionTargetTotal(p, 'sec1')).toBe(12000)
  })

  it('nextBeatStatus は 検討中→確定→執筆中→済→検討中 と循環する', () => {
    expect(nextBeatStatus('idea')).toBe('fixed')
    expect(nextBeatStatus('fixed')).toBe('writing')
    expect(nextBeatStatus('writing')).toBe('done')
    expect(nextBeatStatus('done')).toBe('idea')
  })
})
