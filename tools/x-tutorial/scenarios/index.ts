import type { Scenario } from '../lib/stage.ts'
import { activity } from './activity.ts'
import { chart } from './chart.ts'
import { exportFormats } from './export.ts'
import { glossary } from './glossary.ts'
import { history } from './history.ts'
import { mindmap } from './mindmap.ts'
import { outline } from './outline.ts'
import { plot } from './plot.ts'
import { rubyDots } from './ruby-dots.ts'

/**
 * 投稿の順番。1 日 1 本、この並びを頭から回す（pickForDate）。
 * 機能を足すときは scenarios/<id>.ts を書いてここの末尾へ加える。
 * 最初の 9 本は LP の機能紹介の順を土台に、ゲストで使える機能と無料登録の機能（as: 'free'）が
 * 交互になるように並べた。
 */
export const SCENARIOS: Scenario[] = [
  rubyDots, // ルビと傍点（ゲスト）
  glossary, // 用語集（ゲスト）
  plot, // プロット（無料登録）
  activity, // 執筆の記録（ゲスト）
  chart, // 相関図（無料登録）
  exportFormats, // 書き出し（ゲスト）
  outline, // アウトライン（無料登録）
  history, // 自動保存と版の履歴（ゲスト）
  mindmap, // マインドマップ（無料登録）
]

export const findScenario = (id: string) => SCENARIOS.find((s) => s.id === id)

/**
 * その日（日本時間）に流す台本。周回の初日（環境変数 X_ROTATION_START＝YYYY-MM-DD・既定 2026-01-01）
 * からの経過日数で並びを回すだけの無状態な選び方なので、失敗した日の機能は次の周回まで飛ぶ。
 * 初日に並びの先頭が出る。並びの途中に足すと以降の順番がずれる（末尾に足す）。
 */
export function pickForDate(date: Date, start = process.env.X_ROTATION_START ?? '2026-01-01'): Scenario {
  const JST = 9 * 60 * 60 * 1000
  const dayOf = (ms: number) => Math.floor((ms + JST) / 86_400_000)
  const [y, m, d] = start.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`X_ROTATION_START は YYYY-MM-DD で（今は ${start}）`)
  const n = SCENARIOS.length
  // 初日の日本時間 0 時＝UTC 前日 15 時。
  const i = dayOf(date.getTime()) - dayOf(Date.UTC(y, m - 1, d) - JST)
  return SCENARIOS[((i % n) + n) % n]
}
