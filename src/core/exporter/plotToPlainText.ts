import {
  beatsOfSection,
  type Foreshadow,
  foreshadowStatus,
  type Plot,
  type PlotBeat,
  pickPrimaryPlot,
  sectionTargetTotal,
} from '../plot'
import type { GlossaryEntry, Work } from '../schema'

/**
 * プロット（幕×ビート）→ AI が読めるプレーンテキスト。リモート MCP の `get_plot` ペイロード。
 * 各要素に [beat_id: …] 等を添え、upsert/delete 系ツールの対象を AI が指定できるようにする。
 * 図鑑参照は名前へ、話参照はタイトルへ解決する。純ロジック。
 */

const STATUS_LABEL: Record<PlotBeat['status'], string> = {
  idea: '検討中',
  fixed: '確定',
  writing: '執筆中',
  done: '済',
}

const FORESHADOW_LABEL = {
  planted: '未回収',
  resolved: '回収済',
  orphan: '根なし',
  unplaced: '未配置',
} as const

const fmt = (n: number) => n.toLocaleString('ja-JP')

function glossaryNames(ids: string[], glossary: GlossaryEntry[]): string {
  return ids
    .map((id) => glossary.find((g) => g.id === id)?.name)
    .filter((name): name is string => name !== undefined)
    .join('、')
}

function beatText(beat: PlotBeat, order: number, plot: Plot, work: Work): string {
  const lines: string[] = []
  lines.push(`${order}. [${STATUS_LABEL[beat.status]}] ${beat.title} [beat_id: ${beat.id}]`)
  if (beat.summary) {
    lines.push(`   要約: ${beat.summary.split('\n').join('\n   ')}`)
  } else if (beat.guide) {
    lines.push(`   （ガイド: ${beat.guide}）`)
  }

  const glossary = work.glossary ?? []
  const refs: string[] = []
  const pov = beat.povRef ? glossary.find((g) => g.id === beat.povRef) : undefined
  if (pov) refs.push(`視点: ${pov.name}`)
  const cast = glossaryNames(beat.castRefs, glossary)
  if (cast) refs.push(`登場: ${cast}`)
  const place = glossaryNames(beat.placeRefs, glossary)
  if (place) refs.push(`舞台: ${place}`)
  if (beat.timeLabel) refs.push(`作中時間: ${beat.timeLabel}`)
  if (refs.length > 0) lines.push(`   ${refs.join(' ／ ')}`)

  const meta: string[] = []
  const lineNames = beat.lineRefs
    .map((id) => plot.lines.find((l) => l.id === id)?.title)
    .filter((t): t is string => t !== undefined)
  if (lineNames.length > 0) meta.push(`ライン: ${lineNames.join('、')}`)
  if (beat.targetLength) meta.push(`予定: ${fmt(beat.targetLength)}字`)
  const episode = beat.episodeRef ? work.episodes.find((e) => e.id === beat.episodeRef) : undefined
  if (episode) meta.push(`対応話: ${episode.title || '無題の話'} [episode_id: ${episode.id}]`)
  if (meta.length > 0) lines.push(`   ${meta.join(' ／ ')}`)

  if (beat.note) lines.push(`   メモ: ${beat.note.split('\n').join('\n   ')}`)
  return lines.join('\n')
}

function foreshadowText(f: Foreshadow, plot: Plot): string {
  const status = FORESHADOW_LABEL[foreshadowStatus(f, plot)]
  const titleOf = (beatId: string | undefined) =>
    beatId !== undefined
      ? (plot.beats.find((b) => b.id === beatId)?.title ?? '（削除済みビート）')
      : '未定'
  const note = f.note ? ` ／ メモ: ${f.note}` : ''
  return `- [${status}] ${f.title} [foreshadow_id: ${f.id}]（張る: ${titleOf(f.plantBeatId)} → 回収: ${titleOf(f.payoffBeatId)}）${note}`
}

/**
 * 指定作品の主プロットを1ドキュメントにまとめる。plots は全作品ぶんでよい（内部で絞る）。
 * 無ければ作成方法の案内文を返す。
 */
export function plotToPlainText(plots: Plot[], work: Work): string {
  const mine = plots.filter((p) => p.workId === work.id)
  const plot = pickPrimaryPlot(mine)
  if (!plot) {
    return '（この作品のプロットはまだありません。set_plot_meta で作成できます）'
  }

  const head: string[] = [`【プロット】${plot.title} [plot_id: ${plot.id}]`]
  if (plot.premise) head.push(`ログライン: ${plot.premise}`)
  if (plot.theme) head.push(`テーマ: ${plot.theme}`)
  if (plot.lines.length > 0) {
    head.push(
      `プロットライン: ${plot.lines.map((l) => `${l.title} [line_id: ${l.id}]`).join('、')}`,
    )
  }
  if (mine.length > 1) {
    head.push(`※ 他に ${mine.length - 1} 件のプロット案があります（MCP の対象は主プロットのみ）`)
  }

  const sections =
    plot.sections.length === 0
      ? ['（幕がまだありません。upsert_plot_section で幕を作成してください）']
      : plot.sections.map((section) => {
          const beats = beatsOfSection(plot, section.id)
          const target = sectionTargetTotal(plot, section.id)
          const meta = `（${beats.length}ビート${target > 0 ? `・予定 ${fmt(target)}字` : ''}）`
          const headLine = `## ${section.title} [section_id: ${section.id}]${meta}`
          const note = section.note ? `${section.note}` : ''
          const body = beats.map((b, i) => beatText(b, i + 1, plot, work)).join('\n')
          return [headLine, note, body].filter((s) => s !== '').join('\n')
        })

  const foreshadows =
    plot.foreshadows.length > 0
      ? [`伏線:\n${plot.foreshadows.map((f) => foreshadowText(f, plot)).join('\n')}`]
      : []

  return [head.join('\n'), ...sections, ...foreshadows].join('\n\n')
}
