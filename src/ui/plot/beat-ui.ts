import { blocksToPlainText } from '@/core/exporter/toPlainText'
import { stripMarkdown } from '@/core/markdown'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Plot, PlotBeat, PlotBeatStatus } from '@/core/plot'

/**
 * ビートの見せ方（プロット画面と、本文エディタの「この話のプロット」パネルの共有部分）。
 * 状態チップの表記・ライン色・要約の平文化を 1 か所に置く＝同じビートが画面ごとに
 * 違う色・違う言い回しで出ることを防ぐ。React に依存しない純粋な表示ヘルパだけを置く。
 */

// 用語集カテゴリの絞り込みは core（glossary）へ移動した（ノベルゲームの話者候補と共有）。
// 既存の import 先を保つための再輸出。
export { PERSON_CATEGORY, PLACE_CATEGORY } from '@/core/glossary'

/** 状態チップ（画面設計の「✓ 済／✎ 執筆中／？ 検討中／確定」表記）。 */
export const STATUS_UI: Record<PlotBeatStatus, { label: string; className: string }> = {
  idea: { label: '？ 検討中', className: 'bg-surface-container-high text-on-surface-variant' },
  fixed: { label: '確定', className: 'bg-secondary-container text-on-secondary-container' },
  writing: { label: '✎ 執筆中', className: 'bg-primary/12 text-primary' },
  done: { label: '✓ 済', className: 'bg-primary text-primary-foreground' },
}

/** プロットラインの色パレット（作成順に循環割当。stripe とグリッドの行ラベルで使う）。 */
export const LINE_PALETTE = [
  'var(--forest-400)',
  'var(--wheat-500)',
  'var(--forest-700)',
  'var(--wheat-700)',
  'var(--forest-900)',
]

/** ラインの表示色。保存された color が無い旧データはパレットを index で引く。 */
export function lineColorOf(plot: Plot, lineId: string): string {
  const index = plot.lines.findIndex((l) => l.id === lineId)
  const line = index >= 0 ? plot.lines[index] : undefined
  return (
    line?.color ?? LINE_PALETTE[Math.max(0, index) % LINE_PALETTE.length] ?? 'var(--forest-400)'
  )
}

/** ビートの左端ストライプ色＝先頭のプロットライン色（未割当は控えめなグレー）。 */
export function beatStripeColor(plot: Plot, beat: PlotBeat): string {
  const first = beat.lineRefs[0]
  return first !== undefined ? lineColorOf(plot, first) : 'var(--outline-variant)'
}

/**
 * 記法（[[用語]]・ルビ・傍点）とマークダウンの記号を剥がした表示用テキスト。
 * カードの要約 1 行など「読むだけ」の場所で、記号がそのまま出るのを防ぐ。
 */
export function plainOf(text: string | undefined): string {
  if (!text) return ''
  return blocksToPlainText(parseEpisodeBody(stripMarkdown(text))).trim()
}

/** 字数の桁区切り。 */
export const fmtCount = (n: number) => n.toLocaleString('ja-JP')
