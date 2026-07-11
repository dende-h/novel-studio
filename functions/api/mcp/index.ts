/// <reference types="@cloudflare/workers-types" />
/**
 * /api/mcp — read-only リモート MCP エンドポイント（Streamable HTTP）。
 *
 * 認証は MCP トークン（`Authorization: Bearer mcp_...`）のみ。Clerk JWT ではなく、
 * `mcp_tokens` から user_id を解決する（AI クライアント設定に貼れる長期トークン）。
 * データ源は会員のライブスナップショット `${userId}/live`（backup.ts の PUT が上書き）。
 * 復号して作品配列を取り出し、JSON-RPC を純ロジック（mcp-server.ts）で処理する。書き込みは無い。
 */

import type { CloudBackup } from '../../../src/core/backup'
import type { Work } from '../../../src/core/schema'
import { decryptPart, importKey } from '../_lib/crypto'
import { handleMcpMessage } from '../_lib/mcp-server'
import { resolveMcpUser } from '../_lib/mcp-token'

interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
}

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

const bearerOf = (request: Request): string => {
  const h = request.headers.get('Authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

/** ライブスナップショットを復号して作品配列を返す。未保存/壊れていれば空配列（読み取りは失敗させない）。 */
async function loadWorks(env: Env, userId: string): Promise<Work[]> {
  const obj = await env.MEDIA.get(`${userId}/live`)
  if (!obj) return []
  try {
    const key = await importKey(env.ENCRYPTION_KEY)
    const blob = new Uint8Array(await obj.arrayBuffer())
    const plaintext = await decryptPart(blob, key, `${userId}:live`)
    const backup = JSON.parse(plaintext) as CloudBackup
    return Array.isArray(backup.works) ? backup.works : []
  } catch {
    return []
  }
}

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS })

// SSE ストリームは提供しない（stateless・サーバ発通知なし）。
export const onRequestGet: PagesFunction<Env> = async () =>
  jsonResponse({ error: 'method_not_allowed' }, 405)

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const token = bearerOf(context.request)
  const userId = token ? await resolveMcpUser(context.env.DB, token) : null
  if (!userId) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return jsonResponse(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      400,
    )
  }

  const deps = { loadWorks: () => loadWorks(context.env, userId) }

  // JSON-RPC バッチ（配列）にも一応対応。応答不要（通知のみ）なら 202。
  if (Array.isArray(body)) {
    const results = (await Promise.all(body.map((m) => handleMcpMessage(m, deps)))).filter(Boolean)
    return results.length === 0
      ? new Response(null, { status: 202, headers: CORS })
      : jsonResponse(results)
  }

  const result = await handleMcpMessage(body as Parameters<typeof handleMcpMessage>[0], deps)
  return result ? jsonResponse(result) : new Response(null, { status: 202, headers: CORS })
}
