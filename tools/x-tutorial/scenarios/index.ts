import type { Scenario } from '../lib/stage.ts'
import { rubyDots } from './ruby-dots.ts'

/**
 * 投稿の順番。1 日 1 本、この並びを頭から回す（pickForDate）。
 * 機能を足すときは scenarios/<id>.ts を書いてここへ加える。
 */
export const SCENARIOS: Scenario[] = [rubyDots]

export const findScenario = (id: string) => SCENARIOS.find((s) => s.id === id)

/**
 * その日（日本時間）に流す台本。基準日からの経過日数で並びを回すだけの無状態な選び方なので、
 * 失敗した日の機能は次の周回まで飛ぶ。並びの途中に足すと以降の順番がずれる（末尾に足す）。
 */
export function pickForDate(date: Date): Scenario {
  const JST = 9 * 60 * 60 * 1000
  const day = Math.floor((date.getTime() + JST) / 86_400_000)
  const base = Math.floor((Date.UTC(2026, 0, 1) + JST) / 86_400_000)
  const n = SCENARIOS.length
  return SCENARIOS[(((day - base) % n) + n) % n]
}
