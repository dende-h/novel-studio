/**
 * リモート MCP のプロトコル核（Streamable HTTP の JSON-RPC 2.0 部分）。
 *
 * R2/暗号化/認証から切り離した純ロジック。ライブスナップショットの読み書き I/O を注入するだけで
 * `initialize` / `tools/list` / `tools/call` を処理する（テスト可能・stateless）。
 * 読み取り（list/get 系）に加え、書き込み（set/add/upsert/delete）とクラウドバックアップ操作を公開する。
 * 書き込みはライブスナップショットを更新するだけで、ブラウザ側で「AIの変更を取り込む」で反映される。
 */

import type { CloudBackup } from '../../../src/core/backup'
import { plotToPlainText } from '../../../src/core/exporter/plotToPlainText'
import { structuresToPlainText } from '../../../src/core/exporter/structureToPlainText'
import { glossaryToPlainText, workToPlainText } from '../../../src/core/exporter/toPlainText'
import {
  addEpisode,
  createWork,
  deleteGlossaryEntry,
  deletePlotBeat,
  deletePlotItem,
  McpEditError,
  parseStructure,
  setEpisode,
  setOutlineNotes,
  setPlotMeta,
  setWorkMeta,
  upsertGlossaryEntry,
  upsertPlotBeat,
  upsertPlotForeshadow,
  upsertPlotLine,
  upsertPlotSection,
  upsertStructure,
} from '../../../src/core/mcp-edit'

/** クライアントが未指定のときに名乗る MCP プロトコル版（十分に新しい安定版）。 */
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'novel-studio', version: '1.2.0' } as const

/** 書き込み系の結果に添える案内（ブラウザで取り込むまでローカルには反映されない）。 */
const PULL_HINT = 'アプリの「AIの変更を取り込む」でこの変更をローカルに反映してください。'

const workIdProp = { work_id: { type: 'string', description: 'list_works が返す作品 id' } }

/** 公開ツール定義。inputSchema はクライアントの引数検証に使われる。 */
export const MCP_TOOLS = [
  {
    name: 'list_works',
    description:
      '作品の一覧（id・タイトル・著者・話数）を返す。他ツールに渡す work_id / episode_id を得るため最初に呼ぶ。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_work',
    description: '1 作品の本文全体をプレーンテキスト（タイトル・各話見出し付き）で返す。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_glossary',
    description:
      '1 作品の図鑑（設定資料・オブジェクト辞書）を各エントリの [entry_id: …] 付きで返す。この entry_id を upsert_glossary_entry の id / delete_glossary_entry の entry_id に渡す。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_structures',
    description:
      '1 作品の構造データ（アウトライン・相関図・マインドマップ）をプレーンテキストで返す。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_work_meta',
    description:
      '作品のメタ情報（タイトル・著者名・あらすじ）を更新する。渡した項目だけ書き換える。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        title: { type: 'string', description: '作品タイトル' },
        author: { type: 'string', description: '作者名（空文字で未設定）' },
        description: { type: 'string', description: 'あらすじ（空文字で未設定）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_episode',
    description:
      '既存の話のタイトル・本文を更新する。body はプレーンテキスト（改行で段落・行頭「＊」でシーン区切り・｜漢字《かんじ》でルビ）。渡した項目だけ書き換える。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        episode_id: { type: 'string', description: 'list_works の各話 id' },
        title: { type: 'string', description: '話のタイトル' },
        body: { type: 'string', description: '本文（プレーンテキスト）' },
      },
      required: ['work_id', 'episode_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_episode',
    description: '作品に新しい話を末尾に追加する。作成した episode_id を返す。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        title: { type: 'string', description: '話のタイトル' },
        body: { type: 'string', description: '本文（プレーンテキスト・任意）' },
      },
      required: ['work_id', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_work',
    description:
      '新しい作品（空の作品）を作成する。作成した work_id を返す。話は add_episode で追加する。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '作品タイトル（必須）' },
        author: { type: 'string', description: '著者名（任意）' },
        description: { type: 'string', description: 'あらすじ（任意）' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_outline',
    description:
      '1 つの話の構成メモ（アウトライン）を丸ごと書き換える。notes は 1 行 1 メモのプレーンテキストで、行頭のインデント（タブ 1 個または半角スペース 2 個で 1 段・最大 3 段）が階層になる。行頭の「- 」は無視される。空文字でその話のメモを全消去。現状は get_structures で確認できる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        episode_id: { type: 'string', description: 'list_works の各話 id' },
        notes: {
          type: 'string',
          description: '構成メモ（1 行 1 メモ・行頭インデントで階層）',
        },
      },
      required: ['work_id', 'episode_id', 'notes'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_glossary_entry',
    description:
      '図鑑エントリ（キャラ・用語・場所など）を追加または更新する。id を渡すと更新、無ければ新規作成。既存を更新するときは先に get_glossary で [entry_id: …] を確認して id に渡す。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: {
          type: 'string',
          description: '更新する既存エントリの id（get_glossary の [entry_id: …]。新規なら省略）',
        },
        name: { type: 'string', description: '名称（必須）' },
        aliases: { type: 'array', items: { type: 'string' }, description: '別名' },
        category: { type: 'string', description: '分類（キャラ/用語/場所 等）' },
        reading: { type: 'string', description: 'よみ' },
        summary: { type: 'string', description: '一行要約' },
        body: { type: 'string', description: '詳細な本文' },
      },
      required: ['work_id', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_glossary_entry',
    description: '図鑑エントリを削除する。先に get_glossary で対象の [entry_id: …] を確認する。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        entry_id: {
          type: 'string',
          description: '図鑑エントリの id（get_glossary の [entry_id: …]）',
        },
      },
      required: ['work_id', 'entry_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_structure',
    description:
      '構造データ（アウトライン/相関図/マインドマップ）を JSON で追加・更新する。get_structures で現状を把握し、Structure の JSON（id・workId・kind・nodes・edges）を渡す。id 一致で置換。',
    inputSchema: {
      type: 'object',
      properties: {
        structure_json: { type: 'string', description: 'Structure 1 件の JSON 文字列' },
      },
      required: ['structure_json'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_plot',
    description:
      '1 作品のプロット（幕×ビート・プロットライン・伏線）を各要素の id 付きプレーンテキストで返す。upsert/delete 系プロットツールの対象 id はここで確認する。伏線は回収状態（未回収/回収済/根なし）付き。',
    inputSchema: {
      type: 'object',
      properties: workIdProp,
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_plot_meta',
    description:
      'プロットのメタ（タイトル・ログライン・テーマ）を更新する。渡した項目だけ書き換える（空文字で未設定に戻す）。プロットが無い作品では新規作成を兼ねる（幕は upsert_plot_section で作る）。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        title: { type: 'string', description: 'プロットのタイトル（例：本編プロット）' },
        premise: { type: 'string', description: 'ログライン（一行で言うと何の話か）' },
        theme: { type: 'string', description: 'テーマ' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_plot_section',
    description:
      '幕（プロットの大きな区切り）を追加または更新する。id を渡すと更新、無ければ新規作成して section_id を返す。index（0 始まり）で並び位置を指定できる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新する幕の id（get_plot の [section_id: …]）' },
        title: { type: 'string', description: '幕のタイトル（例：第一幕）。新規では必須' },
        note: { type: 'string', description: '幕のメモ（空文字で削除）' },
        index: { type: 'number', description: '並び位置（0 始まり）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_plot_beat',
    description:
      'ビート（出来事カード）を追加または更新する。id を渡すと更新（渡した項目だけ書き換え・空文字で未設定に戻す）、無ければ新規作成して beat_id を返す。新規は title 必須、section_id は幕が 1 つだけなら省略可。section_id / index を渡すと移動・並べ替えになる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新するビートの id（get_plot の [beat_id: …]）' },
        section_id: { type: 'string', description: '所属させる幕の id' },
        index: { type: 'number', description: '幕内の位置（0 始まり）' },
        title: { type: 'string', description: 'ビートのタイトル（新規では必須）' },
        summary: { type: 'string', description: '何が起きるか（数行の要約）' },
        note: { type: 'string', description: '狙い・代案などの自由メモ' },
        time_label: { type: 'string', description: '作中時間の自由記述（例：三日後の夜）' },
        pov: { type: 'string', description: '視点キャラ（get_glossary の entry_id）' },
        cast: {
          type: 'array',
          items: { type: 'string' },
          description: '登場キャラ（entry_id の配列・丸ごと置換）',
        },
        place: {
          type: 'array',
          items: { type: 'string' },
          description: '舞台（entry_id の配列・丸ごと置換）',
        },
        line_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '属するプロットライン（get_plot の [line_id: …] の配列・丸ごと置換）',
        },
        episode_id: { type: 'string', description: '対応する本文の話 id（list_works の各話 id）' },
        status: {
          type: 'string',
          description: '進行状態：idea（検討中）/ fixed（確定）/ writing（執筆中）/ done（済）',
        },
        target_length: { type: 'number', description: '予定文字数（0 で未設定に戻す）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_plot_beat',
    description:
      'ビートを削除する。伏線が参照していた場合、その伏線は get_plot で [根なし] 警告として残る。先に get_plot で [beat_id: …] を確認する。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        beat_id: { type: 'string', description: 'ビートの id（get_plot の [beat_id: …]）' },
      },
      required: ['work_id', 'beat_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_plot_line',
    description:
      'プロットライン（メイン・サブプロット・キャラアークなどの筋）を追加または更新する。id を渡すと更新、無ければ新規作成して line_id を返す。ビートへの割り当ては upsert_plot_beat の line_ids で行う。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新するラインの id（get_plot の [line_id: …]）' },
        title: { type: 'string', description: 'ラインの名前（例：ユキの正体）。新規では必須' },
        note: { type: 'string', description: 'ラインのメモ（空文字で削除）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_foreshadow',
    description:
      '伏線を追加または更新する。plant_beat_id＝張るビート、payoff_beat_id＝回収するビート（空文字で解除）。回収漏れは get_plot の伏線一覧に [未回収]/[根なし] として出る。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        id: { type: 'string', description: '更新する伏線の id（get_plot の [foreshadow_id: …]）' },
        title: { type: 'string', description: '伏線の名前（新規では必須）' },
        note: { type: 'string', description: 'メモ（空文字で削除）' },
        plant_beat_id: { type: 'string', description: '張るビートの id（空文字で解除）' },
        payoff_beat_id: { type: 'string', description: '回収するビートの id（空文字で解除）' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_plot_item',
    description:
      '幕・プロットライン・伏線を削除する。kind に section / line / foreshadow、item_id にその id を渡す。幕の削除では中のビートが隣の幕へ移動する（最後の 1 幕は削除不可）。ビートの削除は delete_plot_beat を使う。',
    inputSchema: {
      type: 'object',
      properties: {
        ...workIdProp,
        kind: { type: 'string', description: '削除する種別：section / line / foreshadow' },
        item_id: { type: 'string', description: '対象の id（get_plot で確認）' },
      },
      required: ['work_id', 'kind', 'item_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_backup',
    description:
      '現在の全状態をクラウドに手動バックアップ（版を作る）。有料（cloud 会員）機能。作成した backup_id を返す。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_backups',
    description: 'クラウドバックアップの一覧（id・作成日時、新しい順）を返す。有料機能。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'restore_backup',
    description:
      '指定バックアップの内容をライブスナップショットに戻す（有料機能）。反映にはアプリで「AIの変更を取り込む」が必要。',
    inputSchema: {
      type: 'object',
      properties: { backup_id: { type: 'string', description: 'list_backups が返す id' } },
      required: ['backup_id'],
      additionalProperties: false,
    },
  },
] as const

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
const text = (body: string, isError = false) => ({
  content: [{ type: 'text', text: body }],
  ...(isError ? { isError: true } : {}),
})

const str = (args: Record<string, unknown> | undefined, key: string): string | undefined =>
  typeof args?.[key] === 'string' ? (args[key] as string) : undefined

const strArray = (args: Record<string, unknown> | undefined, key: string): string[] | undefined =>
  Array.isArray(args?.[key])
    ? (args[key] as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined

const num = (args: Record<string, unknown> | undefined, key: string): number | undefined =>
  typeof args?.[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined

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

/** tools/call の 1 ツールを実行する。ツール側のエラー（未検出等）は isError 結果で返す。 */
async function callTool(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
  deps: McpDeps,
): Promise<ReturnType<typeof text>> {
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
    'delete_plot_item',
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
            },
            deps.genId(),
            now,
          ),
        }
        message = '図鑑エントリを保存しました。'
      } else if (name === 'delete_glossary_entry') {
        next = {
          ...snap,
          works: deleteGlossaryEntry(works, workId, str(args, 'entry_id') ?? '', now),
        }
        message = '図鑑エントリを削除しました。'
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
      } else if (name === 'delete_plot_item') {
        const kind = str(args, 'kind') ?? ''
        if (kind !== 'section' && kind !== 'line' && kind !== 'foreshadow') {
          throw new McpEditError('kind は section / line / foreshadow のいずれかです')
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

  // 読み取り（work 指定）
  const workId = str(args, 'work_id') ?? ''
  const work = works.find((w) => w.id === workId)
  if (
    name === 'get_work' ||
    name === 'get_glossary' ||
    name === 'get_structures' ||
    name === 'get_plot'
  ) {
    if (!work) return text(`work_id "${workId}" の作品が見つかりません。`, true)
    if (name === 'get_work') return text(workToPlainText(work))
    if (name === 'get_glossary') {
      // 各エントリに entry_id を添える＝ upsert（更新）/ delete の対象を AI が指定できる。
      return text(
        glossaryToPlainText(work.glossary ?? [], { withIds: true }) || '（この作品の図鑑は空です）',
      )
    }
    if (name === 'get_plot') return text(plotToPlainText(snap?.plots ?? [], work))
    return text(structuresToPlainText(snap?.structures ?? [], work))
  }
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
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
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
