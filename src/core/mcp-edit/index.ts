import {
  type Cue,
  classifyBlock,
  emptyStaging,
  MASKED_SPEAKER,
  patchCue,
  removeCue,
  type Staging,
} from '../game'
import { type SpriteSource, spriteExpressionsOf, userAssetKey } from '../game/assets'
import { presetBackground } from '../game/presets'
import { presetSe, SE_STOP } from '../game/sePresets'
import { type FlatNote, MAX_NOTE_DEPTH, rebuildEpisodeNotes } from '../outline'
import { parseEpisodeBody } from '../parser/parseNotation'
import { reconcileBlockIds } from '../parser/reconcileBlockIds'
import {
  addBeat,
  addLine,
  addSection,
  emptyPlot,
  moveBeat,
  type Plot,
  type PlotBeat,
  PlotBeatStatusSchema,
  pickPrimaryPlot,
  removeBeat,
  removeForeshadow,
  removeLine,
  removeSecret,
  removeSection,
  removeWorldNote,
  setWorldNote,
  singletonPlotId,
  updateBeat,
  updateLine,
  updateSection,
  upsertForeshadow,
  upsertSecret,
  WORLD_CUSTOM_SLOT,
  WORLD_SLOTS,
} from '../plot'
import type { Episode, GlossaryEntry, Work } from '../schema'
import {
  emptyStructure,
  pickPrimaryStructure,
  type Structure,
  StructureSchema,
  singletonStructureId,
} from '../structure'

/**
 * MCP 書き込みの純ロジック。作品配列・構造配列に対する編集をイミュータブルに行う。
 * 見つからない等のドメインエラーは McpEditError（ツール側が isError で返す）。R2/暗号化に非依存。
 */

export class McpEditError extends Error {}

/** 空文字は未設定(undefined)へ畳む（スキーマの任意項目を綺麗に保つ）。 */
const emptyToUndef = (s: string | undefined): string | undefined =>
  s === undefined || s.trim() === '' ? undefined : s

function updateWork(works: Work[], workId: string, fn: (w: Work) => Work): Work[] {
  let found = false
  const next = works.map((w) => {
    if (w.id !== workId) return w
    found = true
    return fn(w)
  })
  if (!found) throw new McpEditError(`work_id "${workId}" の作品が見つかりません`)
  return next
}

/** 作品のメタ（タイトル・著者・あらすじ）を更新する。 */
export function setWorkMeta(
  works: Work[],
  workId: string,
  patch: { title?: string; author?: string; description?: string },
  now: number,
): Work[] {
  return updateWork(works, workId, (w) => ({
    ...w,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.author !== undefined ? { author: emptyToUndef(patch.author) } : {}),
    ...(patch.description !== undefined ? { description: emptyToUndef(patch.description) } : {}),
    updatedAt: now,
  }))
}

/** 話のタイトル・本文（プレーンテキスト→記法解析）を更新する。 */
export function setEpisode(
  works: Work[],
  workId: string,
  episodeId: string,
  patch: { title?: string; body?: string },
  now: number,
): Work[] {
  return updateWork(works, workId, (w) => {
    let found = false
    const episodes = w.episodes.map((ep) => {
      if (ep.id !== episodeId) return ep
      found = true
      return {
        ...ep,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        // 再パースの id は旧 blocks から引き継ぐ（AI が本文を直しても演出譜のアンカーが生きる）
        ...(patch.body !== undefined
          ? { blocks: reconcileBlockIds(ep.blocks, parseEpisodeBody(patch.body)) }
          : {}),
      }
    })
    if (!found) throw new McpEditError(`episode_id "${episodeId}" の話が見つかりません`)
    return { ...w, episodes, updatedAt: now }
  })
}

/** 話を新規追加する。作成した episodeId も返す。 */
export function addEpisode(
  works: Work[],
  workId: string,
  input: { title: string; body?: string },
  episodeId: string,
  now: number,
): Work[] {
  const episode: Episode = {
    id: episodeId,
    title: input.title,
    blocks: input.body ? parseEpisodeBody(input.body) : [],
  }
  return updateWork(works, workId, (w) => ({
    ...w,
    episodes: [...w.episodes, episode],
    updatedAt: now,
  }))
}

/** 新しい作品を追加する（空の作品）。話は add_episode で足す。 */
export function createWork(
  works: Work[],
  input: { title: string; author?: string; description?: string },
  workId: string,
  now: number,
): Work[] {
  const title = input.title.trim()
  if (title === '') throw new McpEditError('title が空です')
  const work: Work = {
    id: workId,
    title,
    episodes: [],
    ...(emptyToUndef(input.author) ? { author: input.author } : {}),
    ...(emptyToUndef(input.description) ? { description: input.description } : {}),
    updatedAt: now,
  }
  return [...works, work]
}

/**
 * インデント付きテキスト（1 行 1 メモ）を構成メモのフラット列に変換する。
 * 行頭のタブ 1 個・半角スペース 2 個・全角スペース 1 個をそれぞれ 1 段と数え、
 * 「- 」「・」「* 」の箇条書き記号は無視する。空行は読み飛ばす。
 */
export function parseOutlineNotes(notesText: string, genId: () => string): FlatNote[] {
  const flat: FlatNote[] = []
  for (const line of notesText.split('\n')) {
    if (line.trim() === '') continue
    let depth = 0
    let i = 0
    while (i < line.length) {
      const ch = line[i]
      if (ch === '\t' || ch === '　') {
        depth++
        i++
      } else if (ch === ' ' && line[i + 1] === ' ') {
        depth++
        i += 2
      } else if (ch === ' ') {
        i++ // 奇数個の余り半角スペースは段に数えない
      } else {
        break
      }
    }
    const label = line
      .slice(i)
      .replace(/^(?:[-*・]\s*)/, '')
      .trim()
    if (label === '') continue
    flat.push({ id: genId(), label, depth: Math.min(depth, MAX_NOTE_DEPTH) })
  }
  return flat
}

/**
 * 1 つの話の構成メモを丸ごと書き換える（アウトライン構造へ反映）。
 * アウトライン構造は作品×種別の主インスタンスを選び、無ければ決定的 id で新規作成する
 * （ビュー側の singleton 方式と同じ＝端末間で同じレコードに収束する）。
 */
export function setOutlineNotes(
  structures: Structure[],
  works: Work[],
  workId: string,
  episodeId: string,
  notesText: string,
  genId: () => string,
  now: number,
): Structure[] {
  const work = works.find((w) => w.id === workId)
  if (!work) throw new McpEditError(`work_id "${workId}" の作品が見つかりません`)
  if (!work.episodes.some((e) => e.id === episodeId)) {
    throw new McpEditError(`episode_id "${episodeId}" の話が見つかりません`)
  }
  const mine = structures.filter((s) => s.workId === workId)
  const outline =
    pickPrimaryStructure(mine, 'outline') ??
    emptyStructure(singletonStructureId(workId, 'outline'), workId, 'outline', now, 'アウトライン')
  const next = {
    ...rebuildEpisodeNotes(outline, episodeId, parseOutlineNotes(notesText, genId)),
    updatedAt: now,
  }
  return upsertStructure(structures, next)
}

/**
 * 用語集の項目を追加/更新（id 指定で更新、無ければ新規）。
 *
 * 更新は**渡した項目だけ書き換える**（省略＝据え置き・空文字＝削除）。set_episode /
 * set_work_meta と同じパッチ方式。以前は入力だけから項目を組み直す全置換で、AI が
 * 「読みだけ直す」つもりの更新で公開情報や作者メモが黙って消えていた。
 *
 * 改名（更新で name が変わる）は UI の renameEntry と同じ規則：旧名を別名へ自動退避する
 * ＝本文の [[旧名]] は解決され続ける。name／別名が他項目と完全一致する書き込みは拒否
 * （D-GLOS-UNIQUE。resolveRef を 0/1 件で決定的に保つ）。
 */
export function upsertGlossaryEntry(
  works: Work[],
  workId: string,
  input: {
    id?: string
    name: string
    aliases?: string[]
    category?: string
    reading?: string
    summary?: string
    body?: string
    authorNote?: string
  },
  newId: string,
  now: number,
): Work[] {
  const entryId = input.id ?? newId
  // 省略＝据え置き・空文字＝削除・非空＝設定（更新のパッチ規則。新規では prevVal が無いだけ）。
  const patched = (next: string | undefined, prevVal: string | undefined) =>
    next === undefined ? prevVal : emptyToUndef(next)
  return updateWork(works, workId, (w) => {
    const glossary = w.glossary ?? []
    const prev = glossary.find((g) => g.id === entryId)
    const name = emptyToUndef(input.name) ?? prev?.name
    if (name === undefined) throw new McpEditError('name は必須です')

    // D-GLOS-UNIQUE: name と（渡された）別名は、他項目の name/別名との完全一致を拒否する。
    // 据え置きの別名は再検査しない（登録時に検査済み。旧データを後追いで弾かない）。
    const others = glossary.filter((g) => g.id !== entryId)
    const collides = (key: string) => {
      const k = key.trim()
      return (
        k !== '' && others.some((o) => o.name.trim() === k || o.aliases.some((a) => a.trim() === k))
      )
    }
    if (collides(name)) throw new McpEditError(`「${name}」は既存の項目と重複しています`)
    if (input.aliases !== undefined) {
      for (const a of input.aliases) {
        if (collides(a)) throw new McpEditError(`「${a}」は既存の項目と重複しています`)
      }
    }

    // 改名は旧名を別名へ退避する（UI の renameEntry と同じ）。旧名で書かれた本文の
    // [[参照]] が未解決に落ちない。新名が自分の別名に居た場合は昇格＝重複を残さない。
    let aliases = input.aliases ?? prev?.aliases ?? []
    if (prev !== undefined && name.trim() !== prev.name.trim()) {
      const withoutNew = aliases.filter((a) => a.trim() !== name.trim())
      aliases = withoutNew.some((a) => a.trim() === prev.name.trim())
        ? withoutNew
        : [...withoutNew, prev.name]
    }

    // 公開情報は 1 欄（D-GLOS-PUBLIC-ONE）。summary（または旧・body）を渡したときだけ
    // 書き換え、summary へ一本化して body は畳む。触らない更新では旧 2 欄をそのまま保つ。
    const touchPublic = input.summary !== undefined || input.body !== undefined
    const mergedPublic = [emptyToUndef(input.summary), emptyToUndef(input.body)]
      .filter((s): s is string => s !== undefined)
      .join('\n\n')

    const category = patched(input.category, prev?.category)
    const reading = patched(input.reading, prev?.reading)
    const authorNote = patched(input.authorNote, prev?.authorNote)
    const entry: GlossaryEntry = {
      id: entryId,
      name,
      aliases,
      ...(category !== undefined ? { category } : {}),
      ...(reading !== undefined ? { reading } : {}),
      ...(touchPublic
        ? mergedPublic !== ''
          ? { summary: mergedPublic }
          : {}
        : {
            ...(prev?.summary !== undefined ? { summary: prev.summary } : {}),
            ...(prev?.body !== undefined ? { body: prev.body } : {}),
          }),
      ...(authorNote !== undefined ? { authorNote } : {}),
      // サムネは MCP から操作できない＝更新で既存の画像を落とさない。
      ...(prev?.thumbnail ? { thumbnail: prev.thumbnail } : {}),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    }
    const nextGlossary = prev
      ? glossary.map((g) => (g.id === entryId ? entry : g))
      : [...glossary, entry]
    return { ...w, glossary: nextGlossary, updatedAt: now }
  })
}

/** 用語集エントリを削除する。 */
export function deleteGlossaryEntry(
  works: Work[],
  workId: string,
  entryId: string,
  now: number,
): Work[] {
  return updateWork(works, workId, (w) => {
    const glossary = w.glossary ?? []
    if (!glossary.some((g) => g.id === entryId)) {
      throw new McpEditError(`entry_id "${entryId}" の用語集項目が見つかりません`)
    }
    return { ...w, glossary: glossary.filter((g) => g.id !== entryId), updatedAt: now }
  })
}

/** 構造データ（JSON）を検証して Structure にする。不正なら McpEditError。 */
export function parseStructure(json: string): Structure {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new McpEditError('structure_json が JSON として解析できません')
  }
  const result = StructureSchema.safeParse(raw)
  if (!result.success) throw new McpEditError('structure_json が構造データの形式に合いません')
  return result.data
}

/** 構造データを追加/更新（id 一致で置換、無ければ追加）。 */
export function upsertStructure(structures: Structure[], structure: Structure): Structure[] {
  return structures.some((s) => s.id === structure.id)
    ? structures.map((s) => (s.id === structure.id ? structure : s))
    : [...structures, structure]
}

// ---- プロット（幕×ビート）の編集 ----------------------------------------------------
// MCP は「作品の主プロット」だけを対象にする（複数プロットの切替は UI 専用）。
// 全ツールがビート/項目単位＝丸ごと置換をさせない（長編で AI の一手ミスが全損になるため）。

/** 対象作品の主プロット。無ければ McpEditError（set_plot_meta が作成の入口）。 */
function requirePlot(plots: Plot[], workId: string): Plot {
  const mine = plots.filter((p) => p.workId === workId)
  const primary = pickPrimaryPlot(mine)
  if (!primary) {
    throw new McpEditError(
      `work_id "${workId}" のプロットがまだありません。先に set_plot_meta で作成してください`,
    )
  }
  return primary
}

/** id 一致で置換（無ければ追加）し、updatedAt を刻む。 */
function putPlot(plots: Plot[], next: Plot, now: number): Plot[] {
  const stamped = { ...next, updatedAt: now }
  return plots.some((p) => p.id === stamped.id)
    ? plots.map((p) => (p.id === stamped.id ? stamped : p))
    : [...plots, stamped]
}

/**
 * プロットのメタ（タイトル・ログライン・テーマ）を更新する。渡した項目だけ書き換える。
 * プロットが無い作品では空のプロットを作成して適用する（幕は upsert_plot_section で作る）。
 */
export function setPlotMeta(
  plots: Plot[],
  works: Work[],
  workId: string,
  patch: { title?: string; premise?: string; theme?: string },
  now: number,
): Plot[] {
  if (!works.some((w) => w.id === workId)) {
    throw new McpEditError(`work_id "${workId}" の作品が見つかりません`)
  }
  const mine = plots.filter((p) => p.workId === workId)
  // 決定的 id＝どの端末・AI が作っても同じレコードへ収束（UI の singleton 方式と同じ）。
  const base = pickPrimaryPlot(mine) ?? emptyPlot(singletonPlotId(workId), workId, now)
  const next: Plot = {
    ...base,
    ...(emptyToUndef(patch.title) ? { title: patch.title as string } : {}),
    ...(patch.premise !== undefined ? { premise: emptyToUndef(patch.premise) } : {}),
    ...(patch.theme !== undefined ? { theme: emptyToUndef(patch.theme) } : {}),
  }
  return putPlot(plots, next, now)
}

/** 幕を追加/更新する（id 指定で更新、無ければ新規）。index で並び位置も動かせる。 */
export function upsertPlotSection(
  plots: Plot[],
  workId: string,
  input: { id?: string; title?: string; note?: string; index?: number },
  newId: string,
  now: number,
): { plots: Plot[]; sectionId: string } {
  const plot = requirePlot(plots, workId)
  let next: Plot
  let sectionId: string
  if (input.id !== undefined) {
    sectionId = input.id
    if (!plot.sections.some((s) => s.id === sectionId)) {
      throw new McpEditError(`section_id "${sectionId}" の幕が見つかりません`)
    }
    next = updateSection(plot, sectionId, {
      ...(emptyToUndef(input.title) ? { title: input.title as string } : {}),
      ...(input.note !== undefined ? { note: emptyToUndef(input.note) } : {}),
    })
    if (input.index !== undefined) {
      const rest = next.sections.filter((s) => s.id !== sectionId)
      const at = Math.max(0, Math.min(input.index, rest.length))
      const moved = next.sections.find((s) => s.id === sectionId)
      if (moved) next = { ...next, sections: [...rest.slice(0, at), moved, ...rest.slice(at)] }
    }
  } else {
    const title = emptyToUndef(input.title)
    if (!title) throw new McpEditError('新しい幕には title が必要です')
    sectionId = newId
    next = addSection(
      plot,
      {
        id: sectionId,
        title,
        ...(emptyToUndef(input.note) ? { note: input.note } : {}),
        beatIds: [],
      },
      input.index,
    )
  }
  return { plots: putPlot(plots, next, now), sectionId }
}

/** upsert_plot_beat の入力（渡した項目だけ書き換える。空文字は「未設定へ戻す」）。 */
export interface PlotBeatInput {
  id?: string
  sectionId?: string
  index?: number
  title?: string
  summary?: string
  note?: string
  timeLabel?: string
  povRef?: string
  castRefs?: string[]
  placeRefs?: string[]
  lineRefs?: string[]
  episodeRef?: string
  status?: string
  targetLength?: number
}

/** ビートを追加/更新する（id 指定で更新、無ければ新規）。作成/更新したビート id を返す。 */
export function upsertPlotBeat(
  plots: Plot[],
  workId: string,
  input: PlotBeatInput,
  newId: string,
  now: number,
): { plots: Plot[]; beatId: string } {
  const plot = requirePlot(plots, workId)

  let status: PlotBeat['status'] | undefined
  if (input.status !== undefined) {
    const parsed = PlotBeatStatusSchema.safeParse(input.status)
    if (!parsed.success) {
      throw new McpEditError('status は idea / fixed / writing / done のいずれかです')
    }
    status = parsed.data
  }
  if (input.lineRefs) {
    for (const lineId of input.lineRefs) {
      if (!plot.lines.some((l) => l.id === lineId)) {
        throw new McpEditError(`line_id "${lineId}" のプロットラインが見つかりません`)
      }
    }
  }

  const patch: Partial<Omit<PlotBeat, 'id'>> = {
    ...(emptyToUndef(input.title) ? { title: input.title as string } : {}),
    ...(input.summary !== undefined ? { summary: emptyToUndef(input.summary) } : {}),
    ...(input.note !== undefined ? { note: emptyToUndef(input.note) } : {}),
    ...(input.timeLabel !== undefined ? { timeLabel: emptyToUndef(input.timeLabel) } : {}),
    ...(input.povRef !== undefined ? { povRef: emptyToUndef(input.povRef) } : {}),
    ...(input.castRefs !== undefined ? { castRefs: input.castRefs } : {}),
    ...(input.placeRefs !== undefined ? { placeRefs: input.placeRefs } : {}),
    ...(input.lineRefs !== undefined ? { lineRefs: input.lineRefs } : {}),
    ...(input.episodeRef !== undefined ? { episodeRef: emptyToUndef(input.episodeRef) } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(input.targetLength !== undefined
      ? { targetLength: input.targetLength > 0 ? input.targetLength : undefined }
      : {}),
  }

  let next: Plot
  let beatId: string
  if (input.id !== undefined) {
    beatId = input.id
    if (!plot.beats.some((b) => b.id === beatId)) {
      throw new McpEditError(`beat_id "${beatId}" のビートが見つかりません`)
    }
    next = updateBeat(plot, beatId, patch)
    // 位置指定があれば移動（section_id 省略時は現在の幕内で並べ替え）。
    if (input.sectionId !== undefined || input.index !== undefined) {
      const current = next.sections.find((s) => s.beatIds.includes(beatId))
      const toSection = input.sectionId ?? current?.id
      if (!toSection || !next.sections.some((s) => s.id === toSection)) {
        throw new McpEditError(`section_id "${input.sectionId ?? ''}" の幕が見つかりません`)
      }
      const target = next.sections.find((s) => s.id === toSection)
      next = moveBeat(next, beatId, toSection, input.index ?? target?.beatIds.length ?? 0)
    }
  } else {
    const title = emptyToUndef(input.title)
    if (!title) throw new McpEditError('新しいビートには title が必要です')
    // 幕が 1 つだけなら section_id を省略できる（テンプレ未使用の最短経路）。
    const sectionId =
      input.sectionId ?? (plot.sections.length === 1 ? plot.sections[0]?.id : undefined)
    if (!sectionId || !plot.sections.some((s) => s.id === sectionId)) {
      throw new McpEditError(
        'section_id が必要です（get_plot の [section_id: …] を渡す。幕が無ければ upsert_plot_section で作成）',
      )
    }
    beatId = newId
    next = addBeat(
      plot,
      sectionId,
      {
        id: beatId,
        title,
        castRefs: input.castRefs ?? [],
        placeRefs: input.placeRefs ?? [],
        lineRefs: input.lineRefs ?? [],
        status: status ?? 'idea',
        ...(emptyToUndef(input.summary) ? { summary: input.summary } : {}),
        ...(emptyToUndef(input.note) ? { note: input.note } : {}),
        ...(emptyToUndef(input.timeLabel) ? { timeLabel: input.timeLabel } : {}),
        ...(emptyToUndef(input.povRef) ? { povRef: input.povRef } : {}),
        ...(emptyToUndef(input.episodeRef) ? { episodeRef: input.episodeRef } : {}),
        ...(input.targetLength !== undefined && input.targetLength > 0
          ? { targetLength: input.targetLength }
          : {}),
      },
      input.index,
    )
  }
  return { plots: putPlot(plots, next, now), beatId }
}

/** ビートを削除する。伏線の参照は残し「根なし」警告に落ちる（黙って辻褄を合わせない）。 */
export function deletePlotBeat(plots: Plot[], workId: string, beatId: string, now: number): Plot[] {
  const plot = requirePlot(plots, workId)
  if (!plot.beats.some((b) => b.id === beatId)) {
    throw new McpEditError(`beat_id "${beatId}" のビートが見つかりません`)
  }
  return putPlot(plots, removeBeat(plot, beatId), now)
}

/** プロットライン（サブプロット）を追加/更新する（id 指定で更新、無ければ新規）。 */
export function upsertPlotLine(
  plots: Plot[],
  workId: string,
  input: { id?: string; title?: string; note?: string },
  newId: string,
  now: number,
): { plots: Plot[]; lineId: string } {
  const plot = requirePlot(plots, workId)
  let next: Plot
  let lineId: string
  if (input.id !== undefined) {
    lineId = input.id
    if (!plot.lines.some((l) => l.id === lineId)) {
      throw new McpEditError(`line_id "${lineId}" のプロットラインが見つかりません`)
    }
    next = updateLine(plot, lineId, {
      ...(emptyToUndef(input.title) ? { title: input.title as string } : {}),
      ...(input.note !== undefined ? { note: emptyToUndef(input.note) } : {}),
    })
  } else {
    const title = emptyToUndef(input.title)
    if (!title) throw new McpEditError('新しいプロットラインには title が必要です')
    lineId = newId
    next = addLine(plot, {
      id: lineId,
      title,
      ...(emptyToUndef(input.note) ? { note: input.note } : {}),
    })
  }
  return { plots: putPlot(plots, next, now), lineId }
}

/**
 * 伏線を追加/更新する（id 指定で更新、無ければ新規）。
 * plant/payoff の beat_id は実在チェックする（空文字で解除）。
 */
export function upsertPlotForeshadow(
  plots: Plot[],
  workId: string,
  input: {
    id?: string
    title?: string
    note?: string
    plantBeatId?: string
    payoffBeatId?: string
  },
  newId: string,
  now: number,
): { plots: Plot[]; foreshadowId: string } {
  const plot = requirePlot(plots, workId)
  const checkBeat = (beatId: string | undefined, label: string) => {
    if (beatId !== undefined && beatId !== '' && !plot.beats.some((b) => b.id === beatId)) {
      throw new McpEditError(`${label} "${beatId}" のビートが見つかりません`)
    }
  }
  checkBeat(input.plantBeatId, 'plant_beat_id')
  checkBeat(input.payoffBeatId, 'payoff_beat_id')

  const prev = input.id !== undefined ? plot.foreshadows.find((f) => f.id === input.id) : undefined
  if (input.id !== undefined && !prev) {
    throw new McpEditError(`foreshadow_id "${input.id}" の伏線が見つかりません`)
  }
  const title = emptyToUndef(input.title) ?? prev?.title
  if (!title) throw new McpEditError('新しい伏線には title が必要です')
  const foreshadowId = input.id ?? newId
  const next = upsertForeshadow(plot, {
    id: foreshadowId,
    title,
    note: input.note !== undefined ? emptyToUndef(input.note) : prev?.note,
    plantBeatId:
      input.plantBeatId !== undefined ? emptyToUndef(input.plantBeatId) : prev?.plantBeatId,
    payoffBeatId:
      input.payoffBeatId !== undefined ? emptyToUndef(input.payoffBeatId) : prev?.payoffBeatId,
  })
  return { plots: putPlot(plots, next, now), foreshadowId }
}

/**
 * 秘密（読者に伏せる情報）を追加/更新する（id 指定で更新、無ければ新規）。
 * reveal_beat_id は実在チェックする（空文字で解除）。
 */
export function upsertPlotSecret(
  plots: Plot[],
  workId: string,
  input: {
    id?: string
    title?: string
    truth?: string
    revealBeatId?: string
    keepHidden?: boolean
  },
  newId: string,
  now: number,
): { plots: Plot[]; secretId: string } {
  const plot = requirePlot(plots, workId)
  if (
    input.revealBeatId !== undefined &&
    input.revealBeatId !== '' &&
    !plot.beats.some((b) => b.id === input.revealBeatId)
  ) {
    throw new McpEditError(`reveal_beat_id "${input.revealBeatId}" のビートが見つかりません`)
  }

  const prev = input.id !== undefined ? plot.secrets.find((s) => s.id === input.id) : undefined
  if (input.id !== undefined && !prev) {
    throw new McpEditError(`secret_id "${input.id}" の秘密が見つかりません`)
  }
  const title = emptyToUndef(input.title) ?? prev?.title
  if (!title) throw new McpEditError('新しい秘密には title が必要です')
  const secretId = input.id ?? newId
  const revealBeatId =
    input.revealBeatId !== undefined ? emptyToUndef(input.revealBeatId) : prev?.revealBeatId
  const next = upsertSecret(plot, {
    id: secretId,
    title,
    truth: input.truth !== undefined ? emptyToUndef(input.truth) : prev?.truth,
    revealBeatId,
    // 明かすビートが決まっているなら「明かさない」印は立てない（矛盾を残さない）。
    keepHidden: revealBeatId ? undefined : (input.keepHidden ?? prev?.keepHidden),
  })
  return { plots: putPlot(plots, next, now), secretId }
}

/** 世界観設定で指定できる枠の一覧（ツール説明とエラー文言で使う）。 */
export const WORLD_SLOT_CHOICES = [...WORLD_SLOTS.map((s) => s.key), WORLD_CUSTOM_SLOT]

/**
 * 世界観設定のノートを書き込む。
 *
 * プロットがまだ無い作品でも書けるようにする（決め事はプロットより先に決まることが多く、
 * 「幕を作らないと設定が書けない」は順序が逆）。定型枠は slot 一致で 1 枠に収束し、
 * 自由枠（custom）は title 必須・id 指定で更新する。body を空にすると枠ごと消える。
 */
export function setPlotWorldNote(
  plots: Plot[],
  works: Work[],
  workId: string,
  input: { id?: string; slot: string; title?: string; body: string },
  newId: string,
  now: number,
): { plots: Plot[]; noteId: string | null } {
  if (!works.some((w) => w.id === workId)) {
    throw new McpEditError(`work_id "${workId}" の作品が見つかりません`)
  }
  const slot = input.slot.trim()
  if (!WORLD_SLOT_CHOICES.includes(slot)) {
    throw new McpEditError(`slot は ${WORLD_SLOT_CHOICES.join(' / ')} のいずれかです`)
  }
  const isCustom = slot === WORLD_CUSTOM_SLOT

  const mine = plots.filter((p) => p.workId === workId)
  // 決定的 id＝どの端末・AI が作っても同じレコードへ収束（setPlotMeta と同じ流儀）。
  const base = pickPrimaryPlot(mine) ?? emptyPlot(singletonPlotId(workId), workId, now)

  if (input.id !== undefined && !base.world.some((n) => n.id === input.id)) {
    throw new McpEditError(`note_id "${input.id}" の世界観設定が見つかりません`)
  }
  const prevTitle = input.id ? base.world.find((n) => n.id === input.id)?.title : undefined
  const title = emptyToUndef(input.title) ?? prevTitle
  if (isCustom && !title) {
    throw new McpEditError('自由枠（slot: custom）には title が必要です')
  }

  const next = setWorldNote(base, { id: input.id, slot, title, body: input.body }, newId, now)
  // body を空にした呼び出しは削除なので、返す note_id は無い。
  // 定型枠は既存ノートの id を引き継ぐので、書き込み後の枠から引き直す。
  const noteId =
    input.body.trim() === ''
      ? null
      : (input.id ?? (isCustom ? newId : (next.world.find((n) => n.slot === slot)?.id ?? newId)))
  return { plots: putPlot(plots, next, now), noteId }
}

/** 世界観設定のノートを削除する。 */
export function deletePlotWorldNote(
  plots: Plot[],
  workId: string,
  noteId: string,
  now: number,
): Plot[] {
  const plot = requirePlot(plots, workId)
  if (!plot.world.some((n) => n.id === noteId)) {
    throw new McpEditError(`note_id "${noteId}" の世界観設定が見つかりません`)
  }
  return putPlot(plots, removeWorldNote(plot, noteId), now)
}

/** 幕・プロットライン・伏線・秘密を削除する（ビートは delete_plot_beat 専用＝誤爆防止）。 */
export function deletePlotItem(
  plots: Plot[],
  workId: string,
  kind: 'section' | 'line' | 'foreshadow' | 'secret',
  itemId: string,
  now: number,
): Plot[] {
  const plot = requirePlot(plots, workId)
  if (kind === 'section') {
    if (!plot.sections.some((s) => s.id === itemId)) {
      throw new McpEditError(`section_id "${itemId}" の幕が見つかりません`)
    }
    if (plot.sections.length <= 1) {
      throw new McpEditError('最後の幕は削除できません（ビートの行き場が無くなるため）')
    }
    return putPlot(plots, removeSection(plot, itemId), now)
  }
  if (kind === 'line') {
    if (!plot.lines.some((l) => l.id === itemId)) {
      throw new McpEditError(`line_id "${itemId}" のプロットラインが見つかりません`)
    }
    return putPlot(plots, removeLine(plot, itemId), now)
  }
  if (kind === 'secret') {
    if (!plot.secrets.some((s) => s.id === itemId)) {
      throw new McpEditError(`secret_id "${itemId}" の秘密が見つかりません`)
    }
    return putPlot(plots, removeSecret(plot, itemId), now)
  }
  if (!plot.foreshadows.some((f) => f.id === itemId)) {
    throw new McpEditError(`foreshadow_id "${itemId}" の伏線が見つかりません`)
  }
  return putPlot(plots, removeForeshadow(plot, itemId), now)
}

// ---- 演出譜（サウンドノベルの Staging）の編集 ----------------------------------------
// 対象は work×episode の 1 レコード。行（block_id）単位のパッチで、一括置換はさせない
// （プロットと同じ理由＝AI の一手ミスで全演出が消えないように）。

/** set_staging の cues 1 件ぶん（キーは JSON 入力の snake_case から変換済み）。 */
export interface StagingCueInput {
  blockId: string
  speaker?: string
  expression?: string
  appear?: string
  hideSprite?: boolean
  sceneBreak?: boolean
  bg?: string
  se?: string
  seRepeat?: string
  transition?: string
  clear?: boolean
}

/** set_staging の cues 配列（JSON 由来の unknown）を検証して型付ける。 */
export function parseStagingCueInputs(raw: unknown): StagingCueInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new McpEditError('cues には 1 件以上の配列を渡してください')
  }
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new McpEditError(`cues[${i}] がオブジェクトではありません`)
    }
    const o = item as Record<string, unknown>
    const field = (key: string): string | undefined => {
      const v = o[key]
      if (v === undefined) return undefined
      if (typeof v !== 'string')
        throw new McpEditError(`cues[${i}].${key} は文字列で渡してください`)
      return v
    }
    const flag = (key: string): boolean | undefined => {
      const v = o[key]
      if (v === undefined) return undefined
      if (typeof v !== 'boolean') {
        throw new McpEditError(`cues[${i}].${key} は true / false で渡してください`)
      }
      return v
    }
    const blockId = field('block_id')
    if (!blockId) {
      throw new McpEditError(`cues[${i}] に block_id がありません（get_staging の [block_id: …]）`)
    }
    return {
      blockId,
      speaker: field('speaker'),
      expression: field('expression'),
      appear: field('appear'),
      hideSprite: flag('hide_sprite'),
      sceneBreak: flag('scene_break'),
      bg: field('bg'),
      se: field('se'),
      seRepeat: field('se_repeat'),
      transition: field('transition'),
      clear: flag('clear'),
    }
  })
}

const TRANSITION_CHOICES: readonly string[] = ['fade', 'cut', 'flash']
/** 効果音の鳴らし方（once は「指定なし」と同じ）。 */
const SE_REPEAT_CHOICES: readonly string[] = ['once', 'twice', 'loop']

/**
 * 演出譜へ行単位のパッチをまとめて当てる。渡した項目だけ書き換える
 * （省略＝据え置き・空文字＝削除・clear で行の演出を丸ごと外す）。
 * どれか 1 件でも不正なら McpEditError で全体を保存しない（部分適用を残さない）。
 */
export function setStagingCues(
  stagings: Staging[],
  works: Work[],
  workId: string,
  episodeId: string,
  items: StagingCueInput[],
  gameAssets: readonly SpriteSource[],
  now: number,
  /** 運営テンプレの目録が知っている背景キー（組み込み 24 枚の外にある絵）。省略＝組み込みだけ */
  templateBgKeys: ReadonlySet<string> = new Set(),
  /** 同じく効果音キー（組み込みの合成 8 種の外にある音）。省略＝組み込みだけ */
  templateSeKeys: ReadonlySet<string> = new Set(),
): { stagings: Staging[]; applied: number; cleared: number } {
  const work = works.find((w) => w.id === workId)
  if (!work) throw new McpEditError(`work_id "${workId}" の作品が見つかりません`)
  const episode = work.episodes.find((e) => e.id === episodeId)
  if (!episode) throw new McpEditError(`episode_id "${episodeId}" の話が見つかりません`)
  const blocks = new Map(episode.blocks.map((b) => [b.id, b]))
  // 背景キーは持ち込み背景（kind 'bg'）だけ。立ち絵は bg には指せない
  const userKeys = new Set(
    gameAssets.filter((a) => (a.kind ?? 'bg') === 'bg').map((a) => userAssetKey(a.id)),
  )

  let staging =
    stagings.find((s) => s.workId === workId && s.episodeId === episodeId) ??
    emptyStaging(workId, episodeId, now)
  let applied = 0
  let cleared = 0

  for (const item of items) {
    if (item.clear === true) {
      // 丸ごと外す（orphan の掃除も兼ねるので、行が消えていても cue があれば通す）。
      if (
        item.speaker !== undefined ||
        item.expression !== undefined ||
        item.appear !== undefined ||
        item.hideSprite !== undefined ||
        item.sceneBreak !== undefined ||
        item.bg !== undefined ||
        item.se !== undefined ||
        item.seRepeat !== undefined ||
        item.transition !== undefined
      ) {
        throw new McpEditError(`block_id "${item.blockId}": clear: true と他の項目は併用できません`)
      }
      const exists =
        blocks.has(item.blockId) || staging.cues.some((c) => c.blockId === item.blockId)
      if (!exists) {
        throw new McpEditError(
          `block_id "${item.blockId}" の行も演出も見つかりません（get_staging で確認）`,
        )
      }
      staging = removeCue(staging, item.blockId, now)
      cleared++
      continue
    }

    const block = blocks.get(item.blockId)
    if (!block) {
      throw new McpEditError(
        `block_id "${item.blockId}" の行が見つかりません（get_staging で確認）`,
      )
    }
    if (classifyBlock(block) === 'gap') {
      throw new McpEditError(
        `block_id "${item.blockId}" は空行（間）です。演出は本文のある行に付けてください`,
      )
    }

    const patch: Partial<Omit<Cue, 'blockId'>> = {}
    if (item.speaker !== undefined) {
      const speaker = emptyToUndef(item.speaker)
      if (speaker !== undefined && classifyBlock(block) !== 'dialogue') {
        throw new McpEditError(
          `block_id "${item.blockId}" は地の文です。話者はセリフの行にだけ付けられます`,
        )
      }
      patch.speaker = speaker
    }
    if (item.expression !== undefined) {
      const expression = emptyToUndef(item.expression)
      if (expression !== undefined && classifyBlock(block) !== 'dialogue') {
        throw new McpEditError(
          `block_id "${item.blockId}" は地の文です。表情はセリフの行にだけ付けられます`,
        )
      }
      patch.expression = expression
    }
    if (item.appear !== undefined) {
      patch.appear = emptyToUndef(item.appear)
    }
    if (item.hideSprite !== undefined) patch.hideSprite = item.hideSprite ? true : undefined
    if (item.sceneBreak !== undefined) patch.sceneBreak = item.sceneBreak ? true : undefined
    if (item.bg !== undefined) {
      const bg = emptyToUndef(item.bg)
      if (
        bg !== undefined &&
        !presetBackground(bg) &&
        !userKeys.has(bg) &&
        !templateBgKeys.has(bg)
      ) {
        throw new McpEditError(
          `bg "${bg}" は使えません。使える背景キーは get_staging の一覧で確認してください`,
        )
      }
      patch.bg = bg
    }
    if (item.se !== undefined) {
      const se = emptyToUndef(item.se)
      // SE_STOP は実体を持たない予約キー（鳴っているループを止める合図）
      if (se !== undefined && se !== SE_STOP && !presetSe(se) && !templateSeKeys.has(se)) {
        throw new McpEditError(
          `se "${se}" は使えません。使える効果音キーは get_staging の一覧で確認してください`,
        )
      }
      patch.se = se
    }
    if (item.seRepeat !== undefined) {
      const raw = emptyToUndef(item.seRepeat)
      if (raw !== undefined && !SE_REPEAT_CHOICES.includes(raw)) {
        throw new McpEditError(`se_repeat は ${SE_REPEAT_CHOICES.join(' / ')} のいずれかです`)
      }
      // once は「指定なし」と同じ＝欄を空にする（同じ意味の書き方を2つ残さない）
      patch.seRepeat = raw === 'twice' ? 2 : raw === 'loop' ? 'loop' : undefined
    }
    if (item.transition !== undefined) {
      const transition = emptyToUndef(item.transition)
      if (transition !== undefined && !TRANSITION_CHOICES.includes(transition)) {
        throw new McpEditError(`transition は ${TRANSITION_CHOICES.join(' / ')} のいずれかです`)
      }
      patch.transition = transition as Cue['transition']
    }
    if (Object.keys(patch).length === 0) {
      throw new McpEditError(
        `block_id "${item.blockId}": 変更する項目がありません（speaker / expression / appear / scene_break / bg / se / transition / clear のいずれかを渡す）`,
      )
    }
    staging = patchCue(staging, item.blockId, patch, now)
    // 背景の切り替え方は背景と一緒でだけ効く（G0 プレイヤーの契約。07 §14）。
    const merged = staging.cues.find((c) => c.blockId === item.blockId)
    if (merged?.transition && !merged.bg) {
      throw new McpEditError(
        `block_id "${item.blockId}": 切り替え方（transition）は背景（bg）と同じ行に付けてください`,
      )
    }
    // 表情は「立ち絵の出る話者」にだけ意味を持つ（無意味な指定を保存しない）。
    if (merged?.expression) {
      const speaker = merged.speaker
      if (!speaker) {
        throw new McpEditError(
          `block_id "${item.blockId}": 表情（expression）は話者（speaker）の付いた行にだけ付けてください`,
        )
      }
      if (speaker === MASKED_SPEAKER) {
        throw new McpEditError(
          `block_id "${item.blockId}": ${MASKED_SPEAKER}（名前を伏せた話者）には立ち絵が出ないため、表情は付けられません`,
        )
      }
      const choices = spriteExpressionsOf(gameAssets, speaker)
      if (choices.length === 0) {
        throw new McpEditError(
          `話者「${speaker}」の立ち絵がまだありません（アプリの「演出」画面で追加できます）`,
        )
      }
      if (!choices.includes(merged.expression)) {
        throw new McpEditError(
          `表情 "${merged.expression}" は「${speaker}」の立ち絵にありません（使える表情: ${choices.join('・')}）`,
        )
      }
    }
    // 登場（appear）は立ち絵のある人物にだけ意味を持つ（無意味な指定を保存しない）。
    if (merged?.appear) {
      if (merged.appear === MASKED_SPEAKER) {
        throw new McpEditError(
          `block_id "${item.blockId}": ${MASKED_SPEAKER} は登場（appear）に使えません（正体を伏せた声には立ち絵を出さない）`,
        )
      }
      if (spriteExpressionsOf(gameAssets, merged.appear).length === 0) {
        throw new McpEditError(
          `「${merged.appear}」の立ち絵がまだありません（アプリの「演出」画面で追加できます）`,
        )
      }
    }
    applied++
  }

  const next = stagings.some((s) => s.workId === workId && s.episodeId === episodeId)
    ? stagings.map((s) => (s.workId === workId && s.episodeId === episodeId ? staging : s))
    : [...stagings, staging]
  return { stagings: next, applied, cleared }
}
