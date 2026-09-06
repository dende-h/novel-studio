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

    expect(c[0]?.bg).toBe('preset:bg/sky-night') // 既定
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

  it('立ち絵は席の指示で立ち、話者では動かない。場面の切れ目で下りる', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', sprites: [{ pos: 'l', character: '灯' }] },
        { blockId: 'b2', speaker: '結' }, // 話者は立ち絵を呼ばない
        { blockId: 'b3', sprites: [{ pos: 'r', character: '結', expression: '笑顔' }] },
        { blockId: 'b4', sceneBreak: true },
      ]),
    )
    expect(c[0]?.seats).toEqual([{ pos: 'l', character: '灯' }])
    expect(c[1]?.standing).toEqual(['灯']) // 続いている（結は立たない）
    expect(c[1]?.changed.standing).toBe(false)
    expect(c[2]?.seats).toEqual([
      { pos: 'l', character: '灯' },
      { pos: 'r', character: '結', expression: '笑顔' },
    ])
    expect(c[3]?.standing).toEqual([])
    expect(c[3]?.changed.standing).toBe(true)
  })

  it('席を省略すると空いている席（中央→左→右）へ。「下げる」はその席だけ', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', sprites: [{ character: '灯' }, { character: '結' }, { character: '澪' }] },
        { blockId: 'b2', sprites: [{ pos: 'c' }] }, // 中央（灯）だけ下げる
        { blockId: 'b3', sprites: [{ pos: 'c', character: '結' }] }, // 左の結を中央へ移す
      ]),
    )
    expect(c[0]?.seats.map((s) => `${s.pos}:${s.character}`)).toEqual(['l:結', 'c:灯', 'r:澪'])
    expect(c[1]?.seats.map((s) => `${s.pos}:${s.character}`)).toEqual(['l:結', 'r:澪'])
    expect(c[2]?.seats.map((s) => `${s.pos}:${s.character}`)).toEqual(['c:結', 'r:澪'])
  })

  it('旧式の登場（appear）は空いている席への指示として読む', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', appear: '灯' },
        { blockId: 'b3', speaker: '結' },
        { blockId: 'b4', sceneBreak: true },
      ]),
    )
    expect(c[0]?.seats).toEqual([{ pos: 'c', character: '灯' }])
    expect(c[2]?.standing).toEqual(['灯'])
    expect(c[3]?.standing).toEqual([])
  })

  it('立ち絵の無い人物は舞台に立たない（書き出しと同じ）', () => {
    const c = resolveContinuity(pagesOf([{ blockId: 'b2', sprites: [{ character: 'モブ' }] }]), {
      hasSprite: (name) => name === '灯',
    })
    expect(c[1]?.standing).toEqual([])
  })

  it('「立ち絵を出さない」は次の場面の切れ目まで続き、席の指示で戻る', () => {
    const hidden = resolveContinuity(
      pagesOf([
        { blockId: 'b1', sprites: [{ pos: 'c', character: '灯' }] },
        { blockId: 'b2', hideSprite: true, speaker: '灯' },
        { blockId: 'b3', speaker: '灯' },
        { blockId: 'b4', sceneBreak: true },
        { blockId: 'b5', sprites: [{ pos: 'c', character: '灯' }] },
      ]),
    )
    expect(hidden[1]?.standing).toEqual([])
    expect(hidden[1]?.hidden).toBe(true)
    expect(hidden[2]?.standing).toEqual([]) // 話しても出ない
    expect(hidden[3]?.hidden).toBe(false) // 場面が変われば区間は終わる
    expect(hidden[4]?.standing).toEqual(['灯'])

    const back = resolveContinuity(
      pagesOf([
        { blockId: 'b2', hideSprite: true },
        { blockId: 'b4', sprites: [{ character: '灯' }] }, // 同じ場面のまま出し直す
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

  it('BGM は次の曲か「止める」まで鳴り続け、場面の切れ目では止まらない', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', bgm: 'preset:bgm/bgm-calm-morning' },
        { blockId: 'b2', sceneBreak: true },
        { blockId: 'b3', bgm: 'preset:bgm/bgm-tense-chase' },
        { blockId: 'b5', bgm: 'stop' },
      ]),
    )
    expect(c[0]?.bgm).toBe('preset:bgm/bgm-calm-morning')
    expect(c[0]?.changed.bgm).toBe(true)
    expect(c[1]?.bgm).toBe('preset:bgm/bgm-calm-morning') // 切れ目をまたぐ
    expect(c[1]?.changed.bgm).toBe(false)
    expect(c[2]?.bgm).toBe('preset:bgm/bgm-tense-chase')
    expect(c[2]?.changed.bgm).toBe(true)
    expect(c[3]?.bgm).toBe('preset:bgm/bgm-tense-chase')
    expect(c[4]?.bgm).toBeUndefined()
    expect(c[4]?.changed.bgm).toBe(true)
  })

  it('席を省略した 4 人目は、いちばん前から立っている人と交代する（席は 3 つ）', () => {
    const c = resolveContinuity(
      pagesOf([
        { blockId: 'b1', sprites: [{ character: '灯' }] },
        { blockId: 'b2', sprites: [{ character: '結' }] },
        { blockId: 'b3', sprites: [{ character: '澪' }] },
        { blockId: 'b5', sprites: [{ character: '朔' }] },
      ]),
    )
    expect(c[2]?.seats.map((s) => `${s.pos}:${s.character}`)).toEqual(['l:結', 'c:灯', 'r:澪'])
    expect(c[4]?.seats.map((s) => `${s.pos}:${s.character}`)).toEqual(['l:結', 'c:朔', 'r:澪'])
  })
})
