import {
  beatsOfSection,
  type Foreshadow,
  foreshadowStatus,
  type Plot,
  type PlotBeat,
  pickPrimaryPlot,
  type Secret,
  secretStatus,
  sectionTargetTotal,
  WORLD_SLOTS,
  type WorldNote,
  worldNoteLabel,
  worldNotesInOrder,
  worldNotesOf,
} from '../plot'
import type { GlossaryEntry, Work } from '../schema'

/**
 * プロット（幕×ビート）→ AI が読めるプレーンテキスト。リモート MCP の `get_plot` ペイロード。
 * 各要素に [beat_id: …] 等を添え、upsert/delete 系ツールの対象を AI が指定できるようにする。
 * 用語集参照は名前へ、話参照はタイトルへ解決する。純ロジック。
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

const SECRET_LABEL = {
  revealed: '開示予定',
  unrevealed: '開示未定',
  kept: '明かさない',
} as const

function secretText(s: Secret, plot: Plot): string {
  const status = SECRET_LABEL[secretStatus(s, plot)]
  const reveal =
    s.revealBeatId !== undefined
      ? (plot.beats.find((b) => b.id === s.revealBeatId)?.title ?? '（削除済みビート）')
      : '未定'
  const truth = s.truth ? ` ／ 真相: ${s.truth}` : ''
  return `- [${status}] ${s.title} [secret_id: ${s.id}]（読者に明かす: ${reveal}）${truth}`
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
 * 世界観設定 → AI が読める1ドキュメント。リモート MCP の `get_world` ペイロード。
 *
 * この作品を触る前に読ませたい「作品の決め事」。用語集と違って公開経路に載らないので、
 * まだ伏せている真相もそのまま書かれている前提で扱う。定型枠は WORLD_SLOTS の順、
 * 自由枠はその後ろ。中身のある枠だけが並ぶ（空の器は保存されない）。
 */
export function worldToPlainText(
  plot: Plot | undefined,
  filter: { noteId?: string; slots?: string[] } = {},
): string {
  const notes = worldNotesOf(plot, filter)
  if (notes.length === 0) return ''
  const body = notes.map(worldNoteToPlainText)
  return [
    '# 世界観設定（作者専用・読者には公開されません）',
    'この作品の決め事です。用語集・プロット・本文を書き換える前に、必ずここに従ってください。',
    ...body,
  ].join('\n\n')
}

/** 世界観設定 1 枠。全量出力に出るブロックと 1 文字も違わない（索引経由でも欄が落ちない）。 */
export function worldNoteToPlainText(note: WorldNote): string {
  const slot = WORLD_SLOTS.find((s) => s.key === note.slot)
  const head = `## ${worldNoteLabel(note)} [slot: ${slot ? slot.key : note.slot}, note_id: ${note.id}]`
  return `${head}\n${note.body}`
}

/** 索引 1 行。冒頭 60 字だけ載せる＝「どの枠を開くか」を本文なしで選べる。 */
export function worldIndexLine(note: WorldNote, opts: { preview?: boolean } = {}): string {
  const slot = WORLD_SLOTS.find((s) => s.key === note.slot)
  const head = `- ${worldNoteLabel(note)} [slot: ${slot ? slot.key : note.slot}, note_id: ${note.id}]（${note.body.length}字）`
  if (opts.preview === false) return head
  const preview = note.body.replace(/\s+/g, ' ').trim().slice(0, 60)
  return preview === '' ? head : `${head}\n    ${preview}${note.body.length > 60 ? '…' : ''}`
}

/**
 * 世界観設定の索引（見出し・slot・note_id・字数・冒頭 60 字。**本文は含まない**）。
 * `withEmptySlots` を立てると、まだ書かれていない定型枠も 1 行出す
 * ＝ `set_world_note` で何が書けるかが読み側の索引に出て、読み書きで枠の語彙が揃う。
 */
export function worldIndexToPlainText(
  notes: WorldNote[],
  opts: { total?: number; withEmptySlots?: boolean; preview?: boolean } = {},
): string {
  const head = `# 世界観設定の索引（作者専用・全 ${opts.total ?? notes.length} 項目・本文は含みません）`
  const lines = notes.map((n) => worldIndexLine(n, { preview: opts.preview }))
  if (opts.withEmptySlots) {
    const filled = new Set(notes.map((n) => n.slot))
    const empty = WORLD_SLOTS.filter((s) => !filled.has(s.key)).map(
      (s) => `- ${s.label} [slot: ${s.key}]（未記入）`,
    )
    if (empty.length > 0)
      lines.push('', 'まだ書かれていない枠（set_world_note で書けます）:', ...empty)
  }
  if (lines.length === 0) {
    return `${head}\n（この作品にはまだ世界観設定がありません。set_world_note で書けます）`
  }
  return [head, ...lines].join('\n')
}

/**
 * `get_plot` / `get_glossary` の先頭に添える 1 行。世界観設定があることと、
 * それを読む手段（get_world）を必ず目に入れる＝毎回の精度をここで底上げする。
 * 何も書かれていなければ「まずここを埋めよう」と促す。
 */
export function worldPointerLine(plot: Plot | undefined): string {
  const count = plot ? worldNotesInOrder(plot).length : 0
  return count > 0
    ? `※ この作品には世界観設定（作者専用の決め事）が ${count} 項目あります。編集の前に get_world で必ず確認してください。`
    : '※ この作品にはまだ世界観設定がありません。決め事・設定・執筆ルールは用語集ではなく set_world_note へ書いてください（用語集は読者に公開されます）。'
}

/**
 * 指定作品の主プロットを1ドキュメントにまとめる。plots は全作品ぶんでよい（内部で絞る）。
 * 無ければ作成方法の案内文を返す。
 */
export function plotToPlainText(
  plots: Plot[],
  work: Work,
  opts: { includeWorld?: boolean; sectionId?: string; beatIds?: string[] } = {},
): string {
  const mine = plots.filter((p) => p.workId === work.id)
  const plot = pickPrimaryPlot(mine)
  if (!plot) {
    // プロットが無い作品ほど「設定をどこへ書くか」の案内が要る（用語集へ流れ込むのはここ）。
    return [
      worldPointerLine(undefined),
      '（この作品のプロットはまだありません。set_plot_meta で作成できます）',
    ].join('\n\n')
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

  // 幕・ビートの絞り込み（引数が無ければ全量＝従来どおり）。
  const wantBeats = opts.beatIds && opts.beatIds.length > 0 ? new Set(opts.beatIds) : undefined
  const targetSections =
    opts.sectionId === undefined
      ? plot.sections
      : plot.sections.filter((s) => s.id === opts.sectionId)

  const sections =
    plot.sections.length === 0
      ? ['（幕がまだありません。upsert_plot_section で幕を作成してください）']
      : targetSections
          .map((section) => {
            const all = beatsOfSection(plot, section.id)
            const beats = wantBeats ? all.filter((b) => wantBeats.has(b.id)) : all
            if (wantBeats && beats.length === 0) return ''
            const target = sectionTargetTotal(plot, section.id)
            const meta = `（${all.length}ビート${target > 0 ? `・予定 ${fmt(target)}字` : ''}）`
            const headLine = `## ${section.title} [section_id: ${section.id}]${meta}`
            const note = section.note ? `${section.note}` : ''
            // 番号は幕の中の通し番号（絞り込んでも「何番目のビートか」が変わらない）。
            const body = beats
              .map((b) => beatText(b, all.findIndex((x) => x.id === b.id) + 1, plot, work))
              .join('\n')
            return [headLine, note, body].filter((s) => s !== '').join('\n')
          })
          .filter((s) => s !== '')

  const foreshadows =
    plot.foreshadows.length > 0
      ? [`伏線:\n${plot.foreshadows.map((f) => foreshadowText(f, plot)).join('\n')}`]
      : []

  // 秘密＝読者に伏せている情報（真相は作者用メモ・本文には出さない）。
  const secrets =
    plot.secrets.length > 0
      ? [`秘密（読者に伏せる情報）:\n${plot.secrets.map((s) => secretText(s, plot)).join('\n')}`]
      : []

  // 世界観設定はプロットと同じ器（Plot）にあり、プロットを触る AI が最初に読むべきもの。
  // get_world を待たずにここへ丸ごと載せる＝「まず決め事を読む」を取りこぼさない。
  // include_world: false でも導線（worldPointerLine）は必ず残す＝存在ごと消さない。
  const world = opts.includeWorld === false ? '' : worldToPlainText(plot)
  const preamble = world !== '' ? [world] : [worldPointerLine(plot)]

  return [...preamble, head.join('\n'), ...sections, ...foreshadows, ...secrets].join('\n\n')
}

/** ビート 1 件の索引行（要約・メモの本文は含まず、字数だけ載せる）。 */
export function beatIndexLine(beat: PlotBeat, order: number): string {
  const meta: string[] = []
  if (beat.summary) meta.push(`要約 ${beat.summary.length}字`)
  if (beat.note) meta.push(`メモ ${beat.note.length}字`)
  if (beat.episodeRef) meta.push(`対応話 [episode_id: ${beat.episodeRef}]`)
  const tail = meta.length > 0 ? `（${meta.join(' ／ ')}）` : ''
  return `${order}. [${STATUS_LABEL[beat.status]}] ${beat.title} [beat_id: ${beat.id}]${tail}`
}

/**
 * プロットの索引（幕とビートの見出しだけ。要約・メモ・世界観の本文は含まない）。
 * 全量が応答の上限に収まらないときの受け皿であり、`list_plot_beats` の本体でもある。
 *
 * 世界観設定は**索引の形で必ず先頭に残す**（見出し・slot・note_id・件数）。
 * ここが消えると「決め事があること」自体が AI から見えなくなり、
 * 用語集へ設定を書き込む事故（この器の分け方を作った理由そのもの）に戻ってしまう。
 */
export function plotIndexToPlainText(
  plots: Plot[],
  work: Work,
  opts: { sectionId?: string } = {},
): string {
  const mine = plots.filter((p) => p.workId === work.id)
  const plot = pickPrimaryPlot(mine)
  if (!plot) {
    return [
      worldPointerLine(undefined),
      '（この作品のプロットはまだありません。set_plot_meta で作成できます）',
    ].join('\n\n')
  }

  const head = [`【プロット】${plot.title} [plot_id: ${plot.id}]（索引・本文は含みません）`]
  if (plot.premise) head.push(`ログライン: ${plot.premise}`)
  if (plot.lines.length > 0) {
    head.push(
      `プロットライン: ${plot.lines.map((l) => `${l.title} [line_id: ${l.id}]`).join('、')}`,
    )
  }

  const targetSections =
    opts.sectionId === undefined
      ? plot.sections
      : plot.sections.filter((s) => s.id === opts.sectionId)
  const sections =
    targetSections.length === 0
      ? ['（幕がまだありません。upsert_plot_section で幕を作成してください）']
      : targetSections.map((section) => {
          const beats = beatsOfSection(plot, section.id)
          const target = sectionTargetTotal(plot, section.id)
          const meta = `（${beats.length}ビート${target > 0 ? `・予定 ${fmt(target)}字` : ''}）`
          const lines = beats.map((b, i) => beatIndexLine(b, i + 1))
          return [`## ${section.title} [section_id: ${section.id}]${meta}`, ...lines].join('\n')
        })

  const counts = `伏線 ${plot.foreshadows.length}件 ／ 秘密 ${plot.secrets.length}件（中身は get_plot で読めます）`

  return [
    worldIndexToPlainText(worldNotesInOrder(plot), { preview: false }),
    head.join('\n'),
    ...sections,
    counts,
  ].join('\n\n')
}
