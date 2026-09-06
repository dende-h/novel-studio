import { BGM_STOP, type SpritePosition, type StagedPage } from './index'
import { DEFAULT_BG_KEY } from './presets'
import { SE_STOP } from './sePresets'
import { resolveStages } from './stage'

/**
 * 「この行では何が効いているか」を行ごとに解く（演出エディタの表示用）。
 *
 * 背景・立ち絵・BGM・環境音は**設定した行から先へ続く**。設定した行にしか印が出ないと、
 * 途中の行を見ている作者には「いま何が出ているのか」「どこまで続くのか」が分からない。
 * ここで解いた結果を、一覧の続きレーンと選択行の「効いているもの」に出す。
 *
 * 立ち絵の席は書き出し（toNovelGame.ts）と同じ `resolveStages` で解く＝画面の説明が嘘にならない。
 * 背景・BGM・環境音の規則もプレイヤー（novelGamePlayer.ts の bgAt / bgmAt / loopSeAt）に合わせる。
 */

export interface PageContinuity {
  /** この行で映っている背景キー（最初の行は既定背景） */
  bg: string
  /** この行で舞台に立っている人物（席順＝左・中央・右） */
  standing: string[]
  /** 席ごとの人物（席順） */
  seats: Array<{ pos: SpritePosition; character: string; expression?: string }>
  /** 立ち絵を出さない区間か（hideSprite から次の場面の切れ目・明示の指示まで） */
  hidden: boolean
  /** 鳴り続けている環境音のキー */
  loopSe?: string
  /** 鳴っている BGM のキー（次の曲か「止める」まで。場面の切れ目では止まらない） */
  bgm?: string
  /** この行で変わったもの（線の起点に印を出す） */
  changed: { bg: boolean; standing: boolean; loopSe: boolean; bgm: boolean }
}

export function resolveContinuity(
  pages: StagedPage[],
  opts: {
    /** その人物の立ち絵があるか（無い人は舞台に立たない＝exporter と同じ） */
    hasSprite?: (character: string) => boolean
    defaultBg?: string
  } = {},
): PageContinuity[] {
  const stages = resolveStages(pages, opts.hasSprite ?? (() => true))
  let bg = opts.defaultBg ?? DEFAULT_BG_KEY
  let loopSe: string | undefined
  let bgm: string | undefined
  let beforeStanding = ''

  return pages.map((page, i): PageContinuity => {
    const beforeBg = bg
    const beforeLoop = loopSe
    const beforeBgm = bgm

    if (page.bg) bg = page.bg
    if (page.bgm === BGM_STOP) bgm = undefined
    else if (page.bgm) bgm = page.bgm
    if (page.sceneBreak) loopSe = undefined
    if (page.se === SE_STOP) loopSe = undefined
    else if (page.se && page.seRepeat === 'loop') loopSe = page.se

    const step = stages[i] ?? { seats: [], hidden: false }
    const seats = step.seats.map(({ pos, character, expression }) => ({
      pos,
      character,
      ...(expression ? { expression } : {}),
    }))
    const standingKey = seats.map((s) => `${s.pos}:${s.character}:${s.expression ?? ''}`).join(' ')
    const changedStanding = standingKey !== beforeStanding
    beforeStanding = standingKey
    return {
      bg,
      standing: seats.map((s) => s.character),
      seats,
      hidden: step.hidden,
      ...(loopSe ? { loopSe } : {}),
      ...(bgm ? { bgm } : {}),
      changed: {
        bg: bg !== beforeBg || i === 0,
        standing: changedStanding,
        loopSe: loopSe !== beforeLoop,
        bgm: bgm !== beforeBgm,
      },
    }
  })
}
