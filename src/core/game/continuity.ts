import { MASKED_SPEAKER, type StagedPage } from './index'
import { DEFAULT_BG_KEY } from './presets'
import { SE_STOP } from './sePresets'

/**
 * 「この行では何が効いているか」を行ごとに解く（演出エディタの表示用）。
 *
 * 背景・立ち絵・環境音は**設定した行から先へ続く**。設定した行にしか印が出ないと、
 * 途中の行を見ている作者には「いま何が出ているのか」「どこまで続くのか」が分からない。
 * ここで解いた結果を、一覧の続きレーンと選択行の「効いているもの」に出す。
 *
 * 規則は書き出し（toNovelGame.ts）とプレイヤー（novelGamePlayer.ts の loopSeAt）に合わせる。
 * ずれると画面の説明が嘘になるので、書き出し結果と突き合わせる回帰テストを置いてある。
 */

export interface PageContinuity {
  /** この行で映っている背景キー（最初の行は既定背景） */
  bg: string
  /** この行で舞台に立っている人物（立ち絵を持つ人だけ・入った順） */
  standing: string[]
  /** 立ち絵を出さない区間か（hideSprite から次の場面の切れ目まで） */
  hidden: boolean
  /** 鳴り続けている環境音のキー */
  loopSe?: string
  /** この行で変わったもの（線の起点に印を出す） */
  changed: { bg: boolean; standing: boolean; loopSe: boolean }
}

/** 舞台に立てる人数（exporter の席と同じ）。 */
const STAGE_SEATS = 2

export function resolveContinuity(
  pages: StagedPage[],
  opts: {
    /** その人物の立ち絵があるか（無い人は舞台に立たない＝exporter と同じ） */
    hasSprite?: (character: string) => boolean
    defaultBg?: string
  } = {},
): PageContinuity[] {
  const hasSprite = opts.hasSprite ?? (() => true)
  let bg = opts.defaultBg ?? DEFAULT_BG_KEY
  let standing: { char: string; at: number }[] = []
  let hidden = false
  let loopSe: string | undefined

  /** 舞台へ入れる（既にいる人は据え置き・満席なら一番長く話していない人と交代）。 */
  const enter = (char: string, at: number) => {
    if (!hasSprite(char)) return
    const already = standing.find((s) => s.char === char)
    if (already) {
      already.at = at
      return
    }
    if (standing.length < STAGE_SEATS) {
      standing.push({ char, at })
      return
    }
    const out = standing.reduce((a, b) => (a.at <= b.at ? a : b))
    out.char = char
    out.at = at
  }

  return pages.map((page, i): PageContinuity => {
    const beforeBg = bg
    const beforeStanding = standing.map((s) => s.char).join(' ')
    const beforeLoop = loopSe

    if (page.bg) bg = page.bg
    if (page.sceneBreak) {
      standing = []
      hidden = false
      loopSe = undefined
    }
    if (page.hideSprite) {
      standing = []
      hidden = true
    }
    if (page.se === SE_STOP) loopSe = undefined
    else if (page.se && page.seRepeat === 'loop') loopSe = page.se
    // 登場は明示の指定なので、出さない区間もここで終わる（exporter と同じ）
    if (page.appear && page.appear !== MASKED_SPEAKER) {
      hidden = false
      enter(page.appear, i)
    }
    if (page.kind === 'dialogue' && page.speaker && page.speaker !== MASKED_SPEAKER && !hidden) {
      enter(page.speaker, i)
    }

    const chars = standing.map((s) => s.char)
    return {
      bg,
      standing: [...chars],
      hidden,
      ...(loopSe ? { loopSe } : {}),
      changed: {
        bg: bg !== beforeBg || i === 0,
        standing: chars.join(' ') !== beforeStanding,
        loopSe: loopSe !== beforeLoop,
      },
    }
  })
}
