/**
 * リモート MCP のプロトコル核（Streamable HTTP の JSON-RPC 2.0 部分）。
 *
 * R2/暗号化/認証から切り離した純ロジック。ライブスナップショットの読み書き I/O を注入するだけで
 * `initialize` / `tools/list` / `tools/call` を処理する（テスト可能・stateless）。
 * 読み取り（list/get 系）に加え、書き込み（set/add/upsert/delete）とクラウドバックアップ操作を公開する。
 * 書き込みはライブスナップショットを更新するだけで、ブラウザ側で「AIの変更を取り込む」で反映される。
 */

import type { CloudBackup } from '../../../src/core/backup'
import {
  plotIndexToPlainText,
  plotToPlainText,
  worldIndexToPlainText,
  worldPointerLine,
  worldToPlainText,
} from '../../../src/core/exporter/plotToPlainText'
import {
  structureIndexToPlainText,
  structuresToPlainText,
} from '../../../src/core/exporter/structureToPlainText'
import {
  episodeIndexToPlainText,
  glossaryIndexToPlainText,
  glossaryToPlainText,
  workToPlainText,
} from '../../../src/core/exporter/toPlainText'
import { filterEntries, publicTextOf } from '../../../src/core/glossary'
import {
  addEpisode,
  createWork,
  deleteGlossaryEntry,
  deletePlotBeat,
  deletePlotItem,
  deletePlotWorldNote,
  McpEditError,
  parseStructure,
  setEpisode,
  setOutlineNotes,
  setPlotMeta,
  setPlotWorldNote,
  setWorkMeta,
  upsertGlossaryEntry,
  upsertPlotBeat,
  upsertPlotForeshadow,
  upsertPlotLine,
  upsertPlotSecret,
  upsertPlotSection,
  upsertStructure,
} from '../../../src/core/mcp-edit'
import {
  budgetNotice,
  clipLinesToBytes,
  DEFAULT_FULL_BYTES,
  DEFAULT_INDEX_BYTES,
  fitToBudget,
  paginate,
  resolveMaxBytes,
  utf8Bytes,
  WORK_MAP_BYTES,
} from '../../../src/core/mcp-read'
import {
  beatsOfSection,
  pickPrimaryPlot,
  sectionById,
  worldNotesInOrder,
  worldNotesOf,
} from '../../../src/core/plot'
import { countEpisodeChars } from '../../../src/core/stats'
import { MCP_TOOLS } from './mcp-tools'

export { MCP_TOOLS }

/** クライアントが未指定のときに名乗る MCP プロトコル版（十分に新しい安定版）。 */
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
/**
 * こちらが実際に話せるプロトコル版。**要求された版がここに無ければ既定版を名乗る**
 * （知らない版をそのままオウム返しすると、その版に無い機能を使っているように見えてしまう）。
 */
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
])
const SERVER_INFO = { name: 'novel-studio', version: '1.5.0' } as const

/** 索引ツールの既定件数。 */
const DEFAULT_LIST_LIMIT = 200

/**
 * クライアント（AI）へ最初に渡す使い方。MCP の `initialize` が返す標準の instructions。
 *
 * ここの主眼は**器の住み分けを毎回思い出させること**。用語集は読者へ公開される器で、
 * 世界観設定は作者だけの器。これを知らないと、AI は設定やネタバレを用語集へ書いてしまう
 * （実際にそうなった）。加えて「書く前に決め事を読む」を促し、毎回の精度を底上げする。
 */
const SERVER_INSTRUCTIONS = [
  'コトノハは小説の執筆アプリです。作品ごとに次の器があります。',
  '',
  '- 本文（get_work / set_episode）… 読者が読む小説そのもの。',
  '- 用語集（get_glossary / upsert_glossary_entry）… 人物・場所・組織・用語・アイテム・生物の事典。',
  '  **公開サイトへ投稿され、読者にも見えます**（その用語が出てくる話まで読んだ読者に開きます）。',
  '  各項目の「作者メモ」欄だけは公開されません。',
  '- 世界観設定（get_world / set_world_note）… 作品の決め事・設定ルール・執筆方針を置く',
  '  **作者だけの場所。公開されません。**',
  '- プロット（get_plot / upsert_plot_beat 等）… 幕とビート、プロットライン、伏線、秘密。公開されません。',
  '',
  '守ってほしい手順：',
  '1. 用語集・プロット・本文のいずれかを書き換える前に、まず get_world でこの作品の決め事を読む。',
  '   世界観設定は作品ごとの前提であり、そこに書かれたルールに従って書く。',
  '2. 設定のルール・執筆の決め事・世界の仕組み・読者への開示方針は、',
  '   **用語集ではなく set_world_note へ書く**。用語集は読者に見える器なので、',
  '   そこへ書くとネタバレが公開されます。',
  '3. 特定の項目にだけ紐づく内緒の情報（この人物の正体など）は、',
  '   upsert_glossary_entry の author_note に書く（この欄は公開時に取り除かれます）。',
  '4. 読者にいつ何を明かすかの管理は upsert_secret（秘密）を使う。',
  '5. 項目の多い作品は「索引 → 中身」の順で読む。get_work_map で各器の件数を見てから、',
  '   list_world_notes / list_glossary_entries / list_plot_beats で id を得て、',
  '   get_world(slots) / get_glossary(entry_ids) / get_plot(section_id) で必要なぶんだけ取る。',
  '   応答の先頭に truncated=true とある場合、それは全量ではなく索引です。',
  '',
  'ツール名の読み方：list_ ＝索引（本文を含まない）／get_ ＝中身／',
  'set_・add_・upsert_・delete_ ＝書き込み。',
].join('\n')

/** 書き込み系の結果に添える案内（ブラウザで取り込むまでローカルには反映されない）。 */
const PULL_HINT = 'アプリの「AIの変更を取り込む」でこの変更をローカルに反映してください。'

/** 注入 I/O：ライブスナップショットの読み書きとクラウドバックアップ操作。 */
export interface McpDeps {
  /** ライブスナップショット（会員の最新全状態）。未保存なら null。 */
  loadSnapshot(): Promise<CloudBackup | null>
  /** ライブスナップショットを上書き保存。 */
  saveSnapshot(backup: CloudBackup): Promise<boolean>
  /** 現在のライブを版付きバックアップとして保存。 */
  createBackup(): Promise<{ id: string; createdAt: number } | null>
  listBackups(): Promise<Array<{ id: string; createdAt: number }>>
  /** 指定バックアップの内容をライブに戻す。 */
  restoreBackup(id: string): Promise<boolean>
  now(): number
  genId(): string
  /**
   * 応答サイズの上限（バイト）。テストから小さい値を注入して縮退を検査するための口で、
   * 本番は既定値のまま。環境変数では持たない（同じコードで環境ごとに戻り値が変わると、
   * 「いつ壊れたか」を観測できなくなる）。
   */
  limits?: { maxBytes?: number; indexMaxBytes?: number }
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
}

const ok = (id: JsonRpcMessage['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const err = (id: JsonRpcMessage['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
})
/**
 * tools/call の結果。`structuredContent` は MCP 2025-06-18 の構造化出力で、**索引ツールにだけ**
 * 添える（全量返却に添えると text と JSON でペイロードが二重になり、今回直したい
 * 「大きすぎて読めない」を悪化させる）。`outputSchema` は宣言しない — 宣言すると
 * 「schema あり・structured なし」の組み合わせで厳格なクライアントが落ちる経路を自分で作ることになる。
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const text = (body: string, isError = false): ToolResult => ({
  content: [{ type: 'text', text: body }],
  ...(isError ? { isError: true } : {}),
})

/** text ＋ 構造化データ。合計が予算を超えるなら構造化データを落とす（text は必ず残す）。 */
const textWith = (
  body: string,
  structured: Record<string, unknown>,
  maxBytes: number,
): ToolResult => {
  if (maxBytes > 0 && utf8Bytes(body) + utf8Bytes(JSON.stringify(structured)) > maxBytes) {
    return text(body)
  }
  return { content: [{ type: 'text', text: body }], structuredContent: structured }
}

const str = (args: Record<string, unknown> | undefined, key: string): string | undefined =>
  typeof args?.[key] === 'string' ? (args[key] as string) : undefined

const strArray = (args: Record<string, unknown> | undefined, key: string): string[] | undefined =>
  Array.isArray(args?.[key])
    ? (args[key] as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined

const num = (args: Record<string, unknown> | undefined, key: string): number | undefined =>
  typeof args?.[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined

const bool = (args: Record<string, unknown> | undefined, key: string): boolean | undefined =>
  typeof args?.[key] === 'boolean' ? (args[key] as boolean) : undefined

function listWorksText(works: CloudBackup['works']): string {
  if (works.length === 0) return '作品はまだありません。'
  const lines = works.map((w) => {
    const author = w.author ? `（著者: ${w.author}）` : ''
    const eps = w.episodes.map((e) => `    - ${e.title} [episode_id: ${e.id}]`).join('\n')
    return `- ${w.title}${author} — ${w.episodes.length}話 [work_id: ${w.id}]${eps ? `\n${eps}` : ''}`
  })
  return `作品が ${works.length} 件あります。\n${lines.join('\n')}`
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * 索引の本文を予算に収める（行の途中では切らない）。落とした行があることは必ず書く
 * ＝ AI が「これで全部」と誤読しない。
 */
const clipIndex = (body: string, maxBytes: number): string => {
  if (maxBytes <= 0 || utf8Bytes(body) <= maxBytes) return body
  const reserve = 160 // 省略の案内 1 行ぶん
  const { lines, dropped } = clipLinesToBytes(body.split('\n'), Math.max(200, maxBytes - reserve))
  if (dropped === 0) return lines.join('\n')
  return [
    ...lines,
    `※ ${dropped} 行を省略しました。limit / offset で範囲を指定してください。`,
  ].join('\n')
}

/** ツール引数を JSON リテラルとして書き戻す（案内文に「そのまま呼べる実例」を載せるため）。 */
const callExample = (tool: string, args: Record<string, string | number | boolean>): string => {
  const inner = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    .join(', ')
  return `${tool}(${inner})`
}

/** tools/call の 1 ツールを実行する。ツール側のエラー（未検出等）は isError 結果で返す。 */
async function callTool(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
  deps: McpDeps,
): Promise<ToolResult> {
  // --- バックアップ操作（スナップショット読み込み不要） ---
  if (name === 'create_backup') {
    const res = await deps.createBackup()
    return res
      ? text(`バックアップを作成しました。backup_id: ${res.id}（${fmtDate(res.createdAt)}）`)
      : text('バックアップに失敗しました。まだ保存されたデータが無い可能性があります。', true)
  }
  if (name === 'list_backups') {
    const backups = await deps.listBackups()
    if (backups.length === 0) return text('クラウドバックアップはまだありません。')
    const lines = backups.map((b) => `- ${fmtDate(b.createdAt)} [backup_id: ${b.id}]`)
    return text(`バックアップが ${backups.length} 件あります。\n${lines.join('\n')}`)
  }
  if (name === 'restore_backup') {
    const backupId = str(args, 'backup_id') ?? ''
    const done = await deps.restoreBackup(backupId)
    return done
      ? text(`backup_id "${backupId}" をライブに復元しました。${PULL_HINT}`)
      : text(`backup_id "${backupId}" の復元に失敗しました（見つからない等）。`, true)
  }

  // --- スナップショットに基づく読み書き ---
  const snap = await deps.loadSnapshot()
  const works = snap?.works ?? []

  if (name === 'list_works') return text(listWorksText(works))

  // 書き込みツールはスナップショット必須。
  const writeTools = new Set([
    'set_work_meta',
    'set_episode',
    'add_episode',
    'create_work',
    'set_outline',
    'upsert_glossary_entry',
    'delete_glossary_entry',
    'set_structure',
    'set_plot_meta',
    'upsert_plot_section',
    'upsert_plot_beat',
    'delete_plot_beat',
    'upsert_plot_line',
    'upsert_foreshadow',
    'upsert_secret',
    'delete_plot_item',
    'set_world_note',
    'delete_world_note',
  ])
  if (writeTools.has(name ?? '')) {
    if (!snap) {
      return text('ライブスナップショットがありません。先にアプリを開いて保存してください。', true)
    }
    try {
      const now = deps.now()
      let next: CloudBackup = snap
      let message = ''
      const workId = str(args, 'work_id') ?? ''

      if (name === 'set_work_meta') {
        next = {
          ...snap,
          works: setWorkMeta(
            works,
            workId,
            {
              title: str(args, 'title'),
              author: str(args, 'author'),
              description: str(args, 'description'),
            },
            now,
          ),
        }
        message = '作品メタを更新しました。'
      } else if (name === 'set_episode') {
        next = {
          ...snap,
          works: setEpisode(
            works,
            workId,
            str(args, 'episode_id') ?? '',
            { title: str(args, 'title'), body: str(args, 'body') },
            now,
          ),
        }
        message = '話を更新しました。'
      } else if (name === 'add_episode') {
        const episodeId = deps.genId()
        next = {
          ...snap,
          works: addEpisode(
            works,
            workId,
            { title: str(args, 'title') ?? '', body: str(args, 'body') },
            episodeId,
            now,
          ),
        }
        message = `話を追加しました。episode_id: ${episodeId}`
      } else if (name === 'create_work') {
        const newWorkId = deps.genId()
        next = {
          ...snap,
          works: createWork(
            works,
            {
              title: str(args, 'title') ?? '',
              author: str(args, 'author'),
              description: str(args, 'description'),
            },
            newWorkId,
            now,
          ),
        }
        message = `作品を作成しました。work_id: ${newWorkId}`
      } else if (name === 'set_outline') {
        next = {
          ...snap,
          structures: setOutlineNotes(
            snap.structures ?? [],
            works,
            workId,
            str(args, 'episode_id') ?? '',
            str(args, 'notes') ?? '',
            deps.genId,
            now,
          ),
        }
        message = '構成メモを書き換えました。'
      } else if (name === 'upsert_glossary_entry') {
        next = {
          ...snap,
          works: upsertGlossaryEntry(
            works,
            workId,
            {
              id: str(args, 'id'),
              name: str(args, 'name') ?? '',
              aliases: strArray(args, 'aliases'),
              category: str(args, 'category'),
              reading: str(args, 'reading'),
              summary: str(args, 'summary'),
              body: str(args, 'body'),
              authorNote: str(args, 'author_note'),
            },
            deps.genId(),
            now,
          ),
        }
        message = '用語集の項目を保存しました。'
      } else if (name === 'delete_glossary_entry') {
        next = {
          ...snap,
          works: deleteGlossaryEntry(works, workId, str(args, 'entry_id') ?? '', now),
        }
        message = '用語集の項目を削除しました。'
      } else if (name === 'set_structure') {
        const structure = parseStructure(str(args, 'structure_json') ?? '')
        next = { ...snap, structures: upsertStructure(snap.structures, structure) }
        message = '構造データを保存しました。'
      } else if (name === 'set_plot_meta') {
        next = {
          ...snap,
          plots: setPlotMeta(
            snap.plots ?? [],
            works,
            workId,
            {
              title: str(args, 'title'),
              premise: str(args, 'premise'),
              theme: str(args, 'theme'),
            },
            now,
          ),
        }
        message = 'プロットのメタを保存しました。'
      } else if (name === 'upsert_plot_section') {
        const res = upsertPlotSection(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            title: str(args, 'title'),
            note: str(args, 'note'),
            index: num(args, 'index'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `幕を保存しました。section_id: ${res.sectionId}`
      } else if (name === 'upsert_plot_beat') {
        const res = upsertPlotBeat(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            sectionId: str(args, 'section_id'),
            index: num(args, 'index'),
            title: str(args, 'title'),
            summary: str(args, 'summary'),
            note: str(args, 'note'),
            timeLabel: str(args, 'time_label'),
            povRef: str(args, 'pov'),
            castRefs: strArray(args, 'cast'),
            placeRefs: strArray(args, 'place'),
            lineRefs: strArray(args, 'line_ids'),
            episodeRef: str(args, 'episode_id'),
            status: str(args, 'status'),
            targetLength: num(args, 'target_length'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `ビートを保存しました。beat_id: ${res.beatId}`
      } else if (name === 'delete_plot_beat') {
        next = {
          ...snap,
          plots: deletePlotBeat(snap.plots ?? [], workId, str(args, 'beat_id') ?? '', now),
        }
        message = 'ビートを削除しました。'
      } else if (name === 'upsert_plot_line') {
        const res = upsertPlotLine(
          snap.plots ?? [],
          workId,
          { id: str(args, 'id'), title: str(args, 'title'), note: str(args, 'note') },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `プロットラインを保存しました。line_id: ${res.lineId}`
      } else if (name === 'upsert_foreshadow') {
        const res = upsertPlotForeshadow(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            title: str(args, 'title'),
            note: str(args, 'note'),
            plantBeatId: str(args, 'plant_beat_id'),
            payoffBeatId: str(args, 'payoff_beat_id'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `伏線を保存しました。foreshadow_id: ${res.foreshadowId}`
      } else if (name === 'upsert_secret') {
        const res = upsertPlotSecret(
          snap.plots ?? [],
          workId,
          {
            id: str(args, 'id'),
            title: str(args, 'title'),
            truth: str(args, 'truth'),
            revealBeatId: str(args, 'reveal_beat_id'),
            keepHidden: bool(args, 'keep_hidden'),
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message = `秘密を保存しました。secret_id: ${res.secretId}`
      } else if (name === 'set_world_note') {
        const res = setPlotWorldNote(
          snap.plots ?? [],
          works,
          workId,
          {
            id: str(args, 'id'),
            slot: str(args, 'slot') ?? '',
            title: str(args, 'title'),
            body: str(args, 'body') ?? '',
          },
          deps.genId(),
          now,
        )
        next = { ...snap, plots: res.plots }
        message =
          res.noteId === null
            ? '世界観設定の枠を削除しました。'
            : `世界観設定を保存しました。note_id: ${res.noteId}`
      } else if (name === 'delete_world_note') {
        next = {
          ...snap,
          plots: deletePlotWorldNote(snap.plots ?? [], workId, str(args, 'note_id') ?? '', now),
        }
        message = '世界観設定の枠を削除しました。'
      } else if (name === 'delete_plot_item') {
        const kind = str(args, 'kind') ?? ''
        if (kind !== 'section' && kind !== 'line' && kind !== 'foreshadow' && kind !== 'secret') {
          throw new McpEditError('kind は section / line / foreshadow / secret のいずれかです')
        }
        next = {
          ...snap,
          plots: deletePlotItem(snap.plots ?? [], workId, kind, str(args, 'item_id') ?? '', now),
        }
        message = '削除しました。'
      }

      const saved = await deps.saveSnapshot(next)
      if (!saved) return text('保存に失敗しました。', true)
      return text(`${message} ${PULL_HINT}`)
    } catch (e) {
      if (e instanceof McpEditError) return text(e.message, true)
      throw e
    }
  }

  // --- 読み取り（work 指定） ---
  //
  // 全量返却は「予算に収まればこれまでどおり、収まらなければ同じ器の索引」の 2 通りだけ
  // （fitToBudget が唯一の関門）。引数を渡さなければ出力は改修前と 1 バイトも変わらない。
  const workId = str(args, 'work_id') ?? ''
  const work = works.find((w) => w.id === workId)
  const readTools = new Set([
    'get_work',
    'get_glossary',
    'get_structures',
    'get_plot',
    'get_world',
    'get_work_map',
    'list_glossary_entries',
    'list_world_notes',
    'list_plot_beats',
  ])
  if (readTools.has(name ?? '')) {
    if (!work) return text(`work_id "${workId}" の作品が見つかりません。`, true)
    const plots = snap?.plots ?? []
    // 本文・構造も「書き換える前に決め事を読む」の対象。1 行の導線を先頭に置く
    // （本体を載せると本文が長いので、取りに行かせる形にする）。
    const primaryPlot = () => pickPrimaryPlot(plots.filter((p) => p.workId === workId))
    const fullBudget = resolveMaxBytes(args?.max_bytes, deps.limits?.maxBytes ?? DEFAULT_FULL_BYTES)
    const indexBudget = resolveMaxBytes(
      args?.max_bytes,
      deps.limits?.indexMaxBytes ?? DEFAULT_INDEX_BYTES,
    )
    /** 縮退したときの案内。復旧線には**既存ツール名＋引数**を必ず入れる。 */
    const notice = (mode: string, fullBytes: number, recovery: string[]) =>
      budgetNotice({ truncated: true, mode, maxBytes: fullBudget, fullBytes, recovery })

    if (name === 'get_work_map') {
      const glossary = work.glossary ?? []
      const plot = primaryPlot()
      const notes = plot ? worldNotesInOrder(plot) : []
      const chars = work.episodes.reduce((sum, ep) => sum + countEpisodeChars(ep), 0)
      const glossaryChars = glossary.reduce(
        (sum, e) => sum + publicTextOf(e).length + (e.authorNote?.length ?? 0),
        0,
      )
      const worldChars = notes.reduce((sum, n) => sum + n.body.length, 0)
      const structures = (snap?.structures ?? []).filter((s) => s.workId === workId)
      const lines = [
        `# ${work.title} の全体像 [work_id: ${work.id}]`,
        ...(work.author ? [`著者: ${work.author}`] : []),
        '',
        `- 本文: ${work.episodes.length}話・${chars.toLocaleString('en-US')}字 → ${callExample('get_work', { work_id: work.id })}／1 話だけなら episode_id を渡す`,
        `- 用語集: ${glossary.length}項目・${glossaryChars.toLocaleString('en-US')}字 → ${callExample('list_glossary_entries', { work_id: work.id })} → ${callExample('get_glossary', { work_id: work.id, entry_id: glossary[0]?.id ?? '…' })}`,
        `- 世界観設定: ${notes.length}項目・${worldChars.toLocaleString('en-US')}字 → ${callExample('list_world_notes', { work_id: work.id })} → ${callExample('get_world', { work_id: work.id, note_id: notes[0]?.id ?? '…' })}`,
        plot
          ? `- プロット: ${plot.sections.length}幕・${plot.beats.length}ビート・伏線${plot.foreshadows.length}件・秘密${plot.secrets.length}件 → ${callExample('list_plot_beats', { work_id: work.id })} → ${callExample('get_plot', { work_id: work.id, section_id: plot.sections[0]?.id ?? '…' })}`
          : `- プロット: まだありません（set_plot_meta で作れます）`,
        `- 構造データ: ${structures.length}件${structures.length > 0 ? `（${structures.map((s) => s.kind).join('・')}）` : ''} → ${callExample('get_structures', { work_id: work.id })}`,
        '',
        '※ 字数は中身の目安です（応答のバイト数ではありません）。',
        '※ 全量が応答の上限を超えると索引に切り替わります。従来どおり全量を取るには max_bytes=0 を渡してください。',
      ]
      const body = clipLinesToBytes(lines, WORK_MAP_BYTES).lines.join('\n')
      return textWith(
        body,
        {
          work_id: work.id,
          title: work.title,
          episodes: work.episodes.length,
          episode_chars: chars,
          glossary_entries: glossary.length,
          world_notes: notes.length,
          plot_sections: plot?.sections.length ?? 0,
          plot_beats: plot?.beats.length ?? 0,
          foreshadows: plot?.foreshadows.length ?? 0,
          secrets: plot?.secrets.length ?? 0,
          structures: structures.map((s) => s.kind),
        },
        WORK_MAP_BYTES,
      )
    }

    if (name === 'get_work') {
      const episodeId = str(args, 'episode_id')
      if (episodeId !== undefined && !work.episodes.some((e) => e.id === episodeId)) {
        return text(`episode_id "${episodeId}" の話が見つかりません。`, true)
      }
      const full = `${worldPointerLine(primaryPlot())}\n\n${workToPlainText(work, { episodeId })}`
      return text(
        fitToBudget(
          full,
          (bytes) =>
            [
              // 本文は途中で切らない（切れた原稿を全文と誤認されると推敲そのものが壊れる）。
              notice('episodes', bytes, [
                `1 話ずつ読む: ${callExample('get_work', { work_id: work.id, episode_id: work.episodes[0]?.id ?? '…' })}`,
                `従来どおり全量: ${callExample('get_work', { work_id: work.id, max_bytes: 0 })}`,
              ]),
              worldPointerLine(primaryPlot()),
              episodeIndexToPlainText(work),
            ].join('\n\n'),
          fullBudget,
        ),
      )
    }

    if (name === 'get_world') {
      const plot = primaryPlot()
      const noteId = str(args, 'note_id')
      const slots = strArray(args, 'slots')
      const notes = worldNotesOf(plot, { noteId, slots })
      // id 指定の未検出はエラー（黙って空を返すと「その枠は空」と誤解される）。
      if (noteId !== undefined && notes.length === 0) {
        return text(`note_id "${noteId}" の世界観設定が見つかりません。`, true)
      }
      if (slots !== undefined && slots.length > 0 && notes.length === 0) {
        return text(
          `slot ${slots.join(' / ')} に書かれた世界観設定はありません。list_world_notes で枠の一覧を確認してください。`,
        )
      }
      const full =
        worldToPlainText(plot, { noteId, slots }) ||
        'この作品にはまだ世界観設定がありません。set_world_note で書けます（作者だけの場所で、公開はされません）。'
      return text(
        fitToBudget(
          full,
          (bytes) =>
            [
              notice('index', bytes, [
                `枠を選んで読む: ${callExample('get_world', { work_id: work.id, note_id: notes[0]?.id ?? '…' })}`,
                `従来どおり全量: ${callExample('get_world', { work_id: work.id, max_bytes: 0 })}`,
              ]),
              worldIndexToPlainText(notes),
            ].join('\n\n'),
          fullBudget,
        ),
      )
    }

    if (name === 'list_world_notes') {
      const plot = primaryPlot()
      const all = plot ? worldNotesInOrder(plot) : []
      const page = paginate(all.length, args?.offset, args?.limit, DEFAULT_LIST_LIMIT)
      const shown = all.slice(page.start, page.end)
      const hint = [
        `※ 中身は ${callExample('get_world', { work_id: work.id, note_id: shown[0]?.id ?? '…' })} または slots で取れます。`,
        ...(page.nextOffset !== null
          ? [
              `※ 続き: ${callExample('list_world_notes', { work_id: work.id, offset: page.nextOffset })}`,
            ]
          : []),
      ].join('\n')
      const body = clipIndex(
        `${hint}\n\n${worldIndexToPlainText(shown, { total: all.length, withEmptySlots: true })}`,
        indexBudget,
      )
      return textWith(
        body,
        {
          work_id: work.id,
          total: all.length,
          offset: page.start,
          next_offset: page.nextOffset,
          notes: shown.map((n) => ({
            note_id: n.id,
            slot: n.slot,
            title: n.title ?? null,
            chars: n.body.length,
          })),
        },
        indexBudget,
      )
    }

    if (name === 'get_glossary') {
      const entries = work.glossary ?? []
      const ids =
        strArray(args, 'entry_ids') ??
        (str(args, 'entry_id') ? [str(args, 'entry_id') as string] : undefined)
      let selected = ids
        ? entries.filter((e) => ids.includes(e.id))
        : filterEntries(entries, { query: str(args, 'query'), category: str(args, 'category') })
      if (ids !== undefined && selected.length === 0) {
        return text(`entry_id ${ids.join(' / ')} の用語集項目が見つかりません。`, true)
      }
      // limit / offset は明示されたときだけ効かせる（既定の呼び出しは従来どおり全件）。
      const paged = args?.limit !== undefined || args?.offset !== undefined
      const page = paginate(selected.length, args?.offset, args?.limit, DEFAULT_LIST_LIMIT)
      if (paged) selected = selected.slice(page.start, page.end)
      const body =
        glossaryToPlainText(selected, { withIds: true }) ||
        (entries.length === 0
          ? '（この作品の用語集は空です）'
          : '（条件に合う用語集の項目はありません。list_glossary_entries で索引を確認してください）')
      const full = `${worldPointerLine(primaryPlot())}\n\n${body}`
      return text(
        fitToBudget(
          full,
          (bytes) =>
            [
              notice('index', bytes, [
                `1 項目だけ: ${callExample('get_glossary', { work_id: work.id, entry_id: selected[0]?.id ?? '…' })}`,
                `分類で絞る: ${callExample('get_glossary', { work_id: work.id, category: '人物' })}`,
                `従来どおり全量: ${callExample('get_glossary', { work_id: work.id, max_bytes: 0 })}`,
              ]),
              worldPointerLine(primaryPlot()),
              glossaryIndexToPlainText(selected),
            ].join('\n\n'),
          fullBudget,
        ),
      )
    }

    if (name === 'list_glossary_entries') {
      const entries = filterEntries(work.glossary ?? [], {
        query: str(args, 'query'),
        category: str(args, 'category'),
      })
      const page = paginate(entries.length, args?.offset, args?.limit, DEFAULT_LIST_LIMIT)
      const shown = entries.slice(page.start, page.end)
      const hint = [
        `※ 中身は ${callExample('get_glossary', { work_id: work.id, entry_id: shown[0]?.id ?? '…' })}（複数なら entry_ids）で取れます。`,
        ...(page.nextOffset !== null
          ? [
              `※ 続き: ${callExample('list_glossary_entries', { work_id: work.id, offset: page.nextOffset })}`,
            ]
          : []),
      ].join('\n')
      const body = clipIndex(`${hint}\n\n${glossaryIndexToPlainText(shown)}`, indexBudget)
      return textWith(
        body,
        {
          work_id: work.id,
          total: entries.length,
          offset: page.start,
          next_offset: page.nextOffset,
          entries: shown.map((e) => ({
            entry_id: e.id,
            name: e.name,
            category: e.category ?? null,
            reading: e.reading ?? null,
            aliases: e.aliases,
            public_chars: publicTextOf(e).length,
            author_note_chars: e.authorNote?.length ?? 0,
          })),
        },
        indexBudget,
      )
    }

    if (name === 'get_plot') {
      const plot = primaryPlot()
      const sectionId = str(args, 'section_id')
      const beatIds = strArray(args, 'beat_ids')
      if (plot && sectionId !== undefined && sectionById(plot, sectionId) === undefined) {
        return text(`section_id "${sectionId}" の幕が見つかりません。`, true)
      }
      if (
        plot &&
        beatIds !== undefined &&
        !beatIds.some((id) => plot.beats.some((b) => b.id === id))
      ) {
        return text(`beat_id ${beatIds.join(' / ')} のビートが見つかりません。`, true)
      }
      const full = plotToPlainText(plots, work, {
        includeWorld: bool(args, 'include_world'),
        sectionId,
        beatIds,
      })
      return text(
        fitToBudget(
          full,
          (bytes) =>
            [
              notice('index', bytes, [
                `幕ごとに読む: ${callExample('get_plot', { work_id: work.id, section_id: plot?.sections[0]?.id ?? '…' })}`,
                `世界観を外す: ${callExample('get_plot', { work_id: work.id, include_world: false })}`,
                `従来どおり全量: ${callExample('get_plot', { work_id: work.id, max_bytes: 0 })}`,
              ]),
              plotIndexToPlainText(plots, work, { sectionId }),
            ].join('\n\n'),
          fullBudget,
        ),
      )
    }

    if (name === 'list_plot_beats') {
      const plot = primaryPlot()
      const sectionId = str(args, 'section_id')
      if (plot && sectionId !== undefined && sectionById(plot, sectionId) === undefined) {
        return text(`section_id "${sectionId}" の幕が見つかりません。`, true)
      }
      const hint = `※ 中身は ${callExample('get_plot', { work_id: work.id, section_id: plot?.sections[0]?.id ?? '…' })}（ビート単位なら beat_ids）で取れます。`
      const body = clipIndex(
        `${hint}\n\n${plotIndexToPlainText(plots, work, { sectionId })}`,
        indexBudget,
      )
      return textWith(
        body,
        {
          work_id: work.id,
          sections: (plot?.sections ?? [])
            .filter((s) => sectionId === undefined || s.id === sectionId)
            .map((s) => ({
              section_id: s.id,
              title: s.title,
              beats: beatsOfSection(plot as NonNullable<typeof plot>, s.id).map((b) => ({
                beat_id: b.id,
                title: b.title,
                status: b.status,
                summary_chars: b.summary?.length ?? 0,
                episode_id: b.episodeRef ?? null,
              })),
            })),
          foreshadows: plot?.foreshadows.length ?? 0,
          secrets: plot?.secrets.length ?? 0,
          world_notes: plot ? worldNotesInOrder(plot).length : 0,
        },
        indexBudget,
      )
    }

    if (name === 'get_structures') {
      const kindArg = str(args, 'kind')
      const kind =
        kindArg === 'outline' || kindArg === 'chart' || kindArg === 'mindmap' ? kindArg : undefined
      const structures = snap?.structures ?? []
      const full = `${worldPointerLine(primaryPlot())}\n\n${structuresToPlainText(structures, work, { kind })}`
      return text(
        fitToBudget(
          full,
          (bytes) =>
            [
              notice('index', bytes, [
                `種別ごとに読む: ${callExample('get_structures', { work_id: work.id, kind: 'outline' })}`,
                `従来どおり全量: ${callExample('get_structures', { work_id: work.id, max_bytes: 0 })}`,
              ]),
              worldPointerLine(primaryPlot()),
              structureIndexToPlainText(structures, work),
            ].join('\n\n'),
          fullBudget,
        ),
      )
    }
  }
  // 読み取りの分岐はすべて明示的に return する（取りこぼしが「別のツールの結果」に化けないよう、
  // ここは必ず未知ツール扱いで終わらせる）。
  return text(`未知のツール: ${name}`, true)
}

/**
 * JSON-RPC メッセージ 1 件を処理する。通知（id 無し）には応答しないので null を返す。
 * 対応: initialize / notifications/initialized / ping / tools/list / tools/call。
 */
export async function handleMcpMessage(msg: JsonRpcMessage, deps: McpDeps): Promise<object | null> {
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize':
      return ok(id, {
        // 要求された版がこちらの話せる版なら合わせ、そうでなければ既定版を名乗る。
        protocolVersion:
          params?.protocolVersion !== undefined &&
          SUPPORTED_PROTOCOL_VERSIONS.has(params.protocolVersion)
            ? params.protocolVersion
            : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null // 通知には応答しない
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: MCP_TOOLS })
    case 'tools/call':
      return ok(id, await callTool(params?.name, params?.arguments, deps))
    default:
      if (isNotification) return null
      return err(id, -32601, `Method not found: ${method}`)
  }
}
