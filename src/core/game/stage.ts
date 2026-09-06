import {
  MASKED_SPEAKER,
  SPRITE_POSITIONS,
  type SpritePosition,
  type StagedPage,
  spriteCuesOf,
} from './index'

/**
 * 立ち絵の舞台を行ごとに解く（D-GAME-SPRITE-FREE）。
 *
 * 書き出し（toNovelGame.ts）と演出エディタの続きレーン（continuity.ts）が**同じ関数**で
 * 「この行で誰がどの席に立っているか」を決める＝画面の説明と書き出しがずれない。
 *
 * 規則：
 * - 話者は立ち絵を呼ばない。立ち絵は `Cue.sprites`（席ごとの指示）だけで動く。
 * - 席は 3 つ（左・中央・右）。指示のあった席だけ変わり、ほかは据え置き。
 * - 場面の切れ目・「出さない」（hideSprite）で全員下がる。「出さない」は次の切れ目まで続くが、
 *   `sprites` で明示すればその場で戻る（明示は自動より強い）。
 * - 話者が舞台に立っていれば、その人物が `active`（明るく出す）。明るさは**話者の付いたセリフの行で
 *   だけ**変わる（地の文・話者の無いセリフでは据え置き＝ちらつかせない）。話者が舞台にいない
 *   （？？？・立ち絵の無い人）行では誰も明るくしない＝全員ふつうの明るさ。明るい人物が席を離れれば解ける。
 */

export interface StageSeat {
  pos: SpritePosition
  character: string
  /** 表情名（省略＝「通常」→ 無ければ最初の 1 枚） */
  expression?: string
  /** 立った（最後に指示のあった）行。満席のときに交代する相手を決める */
  since: number
}

export interface StageStep {
  /** 席順（左・中央・右）に並べた、この行で立っている人物 */
  seats: StageSeat[]
  /** 「出さない」区間か（hideSprite から次の場面の切れ目・明示の指示まで） */
  hidden: boolean
  /** いま話していて舞台にも立っている人物（明るく出す） */
  active?: string
}

/** 席を省略したときの割り当て順（1 人目は中央、2 人目は左、3 人目は右）。 */
const AUTO_ORDER: readonly SpritePosition[] = ['c', 'l', 'r']

const byPosition = (a: StageSeat, b: StageSeat) =>
  SPRITE_POSITIONS.indexOf(a.pos) - SPRITE_POSITIONS.indexOf(b.pos)

export function resolveStages(
  pages: readonly StagedPage[],
  /** その人物の立ち絵があるか（無い人は舞台に立たない＝指示を無視して壊さない） */
  hasSprite: (character: string) => boolean,
): StageStep[] {
  let seats: StageSeat[] = []
  let hidden = false
  let active: string | undefined
  return pages.map((page, i): StageStep => {
    if (page.sceneBreak) {
      seats = []
      hidden = false
    }
    if (page.hideSprite) {
      seats = []
      hidden = true
    }
    for (const cue of spriteCuesOf(page)) {
      const character = cue.character?.trim()
      if (!character) {
        // 席を下げる（席の指定が無ければ何もしない）
        if (cue.pos) seats = seats.filter((s) => s.pos !== cue.pos)
        continue
      }
      if (character === MASKED_SPEAKER || !hasSprite(character)) continue
      hidden = false
      const existing = seats.find((s) => s.character === character)
      const expression = cue.expression?.trim() || existing?.expression
      let pos = cue.pos
      if (!pos) {
        if (existing) {
          // 席の指定なしで既に立っている＝表情の差し替えだけ（席は動かさない）
          existing.expression = expression
          existing.since = i
          continue
        }
        pos =
          AUTO_ORDER.find((p) => !seats.some((s) => s.pos === p)) ??
          seats.reduce((a, b) => (a.since <= b.since ? a : b)).pos
      }
      seats = seats.filter((s) => s.pos !== pos && s.character !== character)
      seats.push({ pos, character, ...(expression ? { expression } : {}), since: i })
      seats.sort(byPosition)
    }
    // 旧式：話者の付いた行の `expression` は、その話者が立っていれば表情の差し替え（席はそのまま）
    if (page.expression && page.speaker && !page.sprites && !page.appear) {
      const seat = seats.find((s) => s.character === page.speaker)
      if (seat) seat.expression = page.expression
    }
    if (page.kind === 'dialogue' && page.speaker) {
      active = seats.some((s) => s.character === page.speaker) ? page.speaker : undefined
    }
    if (active && !seats.some((s) => s.character === active)) active = undefined
    return {
      seats: seats.map((s) => ({ ...s })),
      hidden,
      ...(active ? { active } : {}),
    }
  })
}

/** 席の表示名（画面・MCP の要約で使う）。 */
export const SPRITE_POSITION_LABELS: Record<SpritePosition, string> = {
  l: '左',
  c: '中央',
  r: '右',
}
