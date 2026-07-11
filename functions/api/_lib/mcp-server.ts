/**
 * read-only リモート MCP のプロトコル核（Streamable HTTP の JSON-RPC 2.0 部分）。
 *
 * R2/暗号化/認証から切り離した純ロジック。作品配列を返す `loadWorks` を注入するだけで
 * `initialize` / `tools/list` / `tools/call` を処理する（テスト可能・stateless）。
 * 公開するのは読み取り 3 ツールのみ（list_works / get_work / get_glossary）。書き込みは無い。
 */

import { glossaryToPlainText, workToPlainText } from '../../../src/core/exporter/toPlainText'
import type { Work } from '../../../src/core/schema'

/** クライアントが未指定のときに名乗る MCP プロトコル版（十分に新しい安定版）。 */
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'novel-studio', version: '1.0.0' } as const

/** 公開ツール定義（read-only）。inputSchema はクライアントの引数検証に使われる。 */
export const MCP_TOOLS = [
  {
    name: 'list_works',
    description:
      '作品の一覧（id・タイトル・著者・話数）を返す。get_work / get_glossary に渡す work_id を得るため最初に呼ぶ。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_work',
    description: '1 作品の本文全体をプレーンテキスト（タイトル・各話見出し付き）で返す。',
    inputSchema: {
      type: 'object',
      properties: { work_id: { type: 'string', description: 'list_works が返す作品 id' } },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_glossary',
    description: '1 作品の図鑑（設定資料・オブジェクト辞書）をプレーンテキストで返す。',
    inputSchema: {
      type: 'object',
      properties: { work_id: { type: 'string', description: 'list_works が返す作品 id' } },
      required: ['work_id'],
      additionalProperties: false,
    },
  },
] as const

/** 注入 I/O：復号済みライブスナップショットから作品配列を取り出して返す。 */
export interface McpDeps {
  loadWorks(): Promise<Work[]>
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

function listWorksText(works: Work[]): string {
  if (works.length === 0) return '作品はまだありません。'
  const lines = works.map((w) => {
    const author = w.author ? `（著者: ${w.author}）` : ''
    return `- ${w.title}${author} — ${w.episodes.length}話 [id: ${w.id}]`
  })
  return `作品が ${works.length} 件あります。\n${lines.join('\n')}`
}

/** tools/call の 1 ツールを実行する。ツール側のエラー（未検出等）は isError 結果で返す。 */
async function callTool(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
  deps: McpDeps,
): Promise<ReturnType<typeof text>> {
  const works = await deps.loadWorks()
  if (name === 'list_works') return text(listWorksText(works))

  const workId = typeof args?.work_id === 'string' ? args.work_id : ''
  const work = works.find((w) => w.id === workId)
  if (name === 'get_work' || name === 'get_glossary') {
    if (!work) return text(`work_id "${workId}" の作品が見つかりません。`, true)
    if (name === 'get_work') return text(workToPlainText(work))
    const glossary = glossaryToPlainText(work.glossary ?? [])
    return text(glossary || '（この作品の図鑑は空です）')
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
