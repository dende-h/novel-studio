import { describe, expect, it } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import { resolveContinuity } from './continuity'
import { applyCues, type Cue, type Staging, toPages } from './index'

/**
 * 「何がどこまで続くか」の解決。ここがずれると、画面が嘘の説明を出すことになる。
 * 書き出しとの一致は toNovelGame.test.ts 側の回帰テストで固定している。
 */

const body =
  '　街灯の下で、灯が振り返った。\n' + // b1 地の文
  '「——まだ、書いてるんだね」\n' + // b2 セリフ
  '「うん」\n' + // b3 セリフ
  '　雨が強くなった。\n' + // b4 地の文
  '「行こうか」' // b5 セリフ

function pagesOf(cues: Cue[]) {
  const blocks = parseEpisodeBody(body)
  const staging: Staging = { workId: 'w1', episodeId: 'e1', cues, updatedAt: 1 }
  return applyCues(toPages(blocks), staging)
}

describe('resolveContinuity（この行で効いているもの）', () => {
  it('背景は設定した行から先へ続く（最初の行は既定背景）', () => {
    const c = resolveContinuity(pagesOf([{ blockId: 'b2', bg: 'preset:bg/town-night' }]))

    expect(c[0]?.bg).toBe('preset:bg/abstract-night') // 既定
    expect(c[0]?.changed.bg).toBe(true) // 最初の行は起点として印を出す
    expect(c[1]?.bg).toBe('preset:bg/town-night')
    expect(c[1]?.changed.bg).toBe(true)
    expect(c[4]?.bg).toBe('preset:bg/town-night') // 変えるまで続く
    expect(c[4]?.changed.bg).toBe(false)
  })

  it('背景は場面の切れ目では戻らない（切れ目で消えるのは立ち絵）', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', bg: 'preset:bg/town-night' },
        { blockId: 'b4', sceneBreak: true },
      ]),
    )
    expect(c[3]?.bg).toBe('preset:bg/town-night')
  })

  it('立ち絵は話者・登場で立ち、場面の切れ目で下りる', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', appear: '灯' },
        { blockId: 'b3', speaker: '結' },
        { blockId: 'b4', sceneBreak: true },
      ]),
    )
    expect(c[0]?.standing).toEqual(['灯'])
    expect(c[1]?.standing).toEqual(['灯']) // 続いている
    expect(c[1]?.changed.standing).toBe(false)
    expect(c[2]?.standing).toEqual(['灯', '結'])
    expect(c[3]?.standing).toEqual([])
    expect(c[3]?.changed.standing).toBe(true)
  })

  it('立ち絵の無い人物は舞台に立たない（書き出しと同じ）', () => {
    const c = resolveContinuity(pagesOf([{ blockId: 'b2', speaker: 'モブ' }]), {
      hasSprite: (name) => name === '灯',
    })
    expect(c[1]?.standing).toEqual([])
  })

  it('「立ち絵を出さない」は次の場面の切れ目まで続き、登場で戻る', () => {
    const hidden = resolveContinuity(
      pagesOf([
        { blockId: 'b1', appear: '灯' },
        { blockId: 'b2', hideSprite: true, speaker: '灯' },
        { blockId: 'b3', speaker: '灯' },
        { blockId: 'b4', sceneBreak: true },
        { blockId: 'b5', speaker: '灯' },
      ]),
    )
    expect(hidden[1]?.standing).toEqual([])
    expect(hidden[1]?.hidden).toBe(true)
    expect(hidden[2]?.standing).toEqual([]) // 話しても出ない
    expect(hidden[3]?.hidden).toBe(false) // 場面が変われば戻る
    expect(hidden[4]?.standing).toEqual(['灯'])

    const back = resolveContinuity(
      pagesOf([
        { blockId: 'b2', hideSprite: true },
        { blockId: 'b4', appear: '灯' }, // 同じ場面のまま出し直す
      ]),
    )
    expect(back[3]?.hidden).toBe(false)
    expect(back[3]?.standing).toEqual(['灯'])
  })

  it('環境音は場面の切れ目か「止める」まで鳴り続ける（1回ものは影響しない）', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' },
        { blockId: 'b2', se: 'preset:se/knock' }, // 1回ものは重なるだけ
        { blockId: 'b4', se: 'stop' },
      ]),
    )
    expect(c[0]?.loopSe).toBe('preset:se/rain')
    expect(c[1]?.loopSe).toBe('preset:se/rain')
    expect(c[1]?.changed.loopSe).toBe(false)
    expect(c[3]?.loopSe).toBeUndefined()
    expect(c[3]?.changed.loopSe).toBe(true)
  })

  it('3人目は、いちばん長く話していない人と交代する（席は2つ）', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', appear: '灯' },
        { blockId: 'b2', speaker: '結' },
        { blockId: 'b3', speaker: '結' },
        { blockId: 'b5', speaker: '澪' },
      ]),
    )
    expect(c[4]?.standing).toEqual(['澪', '結'])
  })
})
