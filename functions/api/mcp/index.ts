/// <reference types="@cloudflare/workers-types" />
/**
 * /api/mcp — リモート MCP エンドポイント（Streamable HTTP）。
 *
 * 認証は Clerk OAuth アクセストークン（Bearer）優先、従来 `mcp_` トークンにフォールバック。
 * OAuth 経路は cloud 会員のみ許可。データ源は会員のライブスナップショット `${userId}/live`。
 * 読み取りに加え、書き込み（スナップショット更新）とクラウドバックアップ操作を公開する。
 * 書き込みはライブを更新するだけで、ブラウザ側の「AIの変更を取り込む」で反映される。
 */

import type { CloudBackup } from '../../../src/core/backup'
import { decryptPart, encryptPart, importKey } from '../_lib/crypto'
import { resolveMcpAuth } from '../_lib/mcp-auth'
import { handleMcpMessage, type McpDeps } from '../_lib/mcp-server'
import { PRM_WELL_KNOWN_PATH, wwwAuthenticateBearer } from '../_lib/oauth-metadata'
import { readTemplateManifest } from '../_lib/templates-store'

interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  ENCRYPTION_KEY: string
  MCP_OAUTH_ISSUER?: string
  MCP_OAUTH_AUDIENCE?: string
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
}

/** バックアップ世代の保持数（超過分は古いものから間引く。backup.ts と揃える）。 */
const KEEP = 20
const backupsPrefix = (userId: string) => `${userId}/backups/`
const backupKey = (userId: string, id: string) => `${backupsPrefix(userId)}${id}`
const backupAad = (userId: string, id: string) => `${userId}:backup:${id}`
const liveAad = (userId: string) => `${userId}:live`
const createdAtOf = (id: string) => Number(id.split('-')[0]) || 0

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
}

const jsonResponse = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extraHeaders },
  })

const unauthorized = (request: Request): Response => {
  // RFC 9728 の標準パスを案内する（旧 /api/mcp/oauth-protected-resource も同じ内容で残してある）。
  const prm = `${new URL(request.url).origin}${PRM_WELL_KNOWN_PATH}`
  return jsonResponse({ error: 'unauthorized' }, 401, {
    'WWW-Authenticate': wwwAuthenticateBearer(prm, 'invalid_token'),
  })
}

/** ライブスナップショットの平文（復号）を返す。未保存/壊れていれば null。 */
async function readLivePlaintext(env: Env, userId: string): Promise<string | null> {
  const obj = await env.MEDIA.get(`${userId}/live`)
  if (!obj) return null
  try {
    const key = await importKey(env.ENCRYPTION_KEY)
    const blob = new Uint8Array(await obj.arrayBuffer())
    return await decryptPart(blob, key, liveAad(userId))
  } catch {
    return null
  }
}

/** ライブスナップショットを CloudBackup として返す。 */
async function loadSnapshot(env: Env, userId: string): Promise<CloudBackup | null> {
  const plaintext = await readLivePlaintext(env, userId)
  if (plaintext === null) return null
  try {
    return JSON.parse(plaintext) as CloudBackup
  } catch {
    return null
  }
}

/**
 * ライブスナップショットを上書き保存（暗号化して PUT）。
 * AI 書き込みの目印として customMetadata.aiEditedAt に現在時刻を刻む
 * （ブラウザの pushLive は目印を付けずに上書き＝取り込み前に上書きされたら目印も消える）。
 */
async function saveSnapshot(env: Env, userId: string, backup: CloudBackup): Promise<boolean> {
  try {
    const key = await importKey(env.ENCRYPTION_KEY)
    const blob = await encryptPart(JSON.stringify(backup), key, liveAad(userId))
    await env.MEDIA.put(`${userId}/live`, blob as unknown as ArrayBuffer, {
      customMetadata: { aiEditedAt: String(Date.now()) },
    })
    return true
  } catch {
    return false
  }
}

/** 現在のライブを版付きバックアップとして保存。ライブが無ければ null。 */
async function createBackup(
  env: Env,
  userId: string,
): Promise<{ id: string; createdAt: number } | null> {
  const plaintext = await readLivePlaintext(env, userId)
  if (plaintext === null) return null
  try {
    const createdAt = Date.now()
    const id = `${createdAt}-${crypto.randomUUID().slice(0, 8)}`
    const key = await importKey(env.ENCRYPTION_KEY)
    const blob = await encryptPart(plaintext, key, backupAad(userId, id))
    await env.MEDIA.put(backupKey(userId, id), blob as unknown as ArrayBuffer)
    // 保持世代を超えた古い版を間引く。
    const backups = await listBackups(env, userId)
    const stale = backups.slice(KEEP).map((b) => backupKey(userId, b.id))
    if (stale.length > 0) await env.MEDIA.delete(stale)
    return { id, createdAt }
  } catch {
    return null
  }
}

/** バックアップ一覧（新しい順）。 */
async function listBackups(
  env: Env,
  userId: string,
): Promise<Array<{ id: string; createdAt: number }>> {
  const out: Array<{ id: string; createdAt: number }> = []
  let cursor: string | undefined
  do {
    const listed = await env.MEDIA.list({ prefix: backupsPrefix(userId), cursor })
    for (const o of listed.objects) {
      const id = o.key.slice(backupsPrefix(userId).length)
      out.push({ id, createdAt: createdAtOf(id) })
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** 指定バックアップの内容をライブに戻す。見つからなければ false。 */
async function restoreBackup(env: Env, userId: string, id: string): Promise<boolean> {
  const obj = await env.MEDIA.get(backupKey(userId, id))
  if (!obj) return false
  try {
    const key = await importKey(env.ENCRYPTION_KEY)
    const blob = new Uint8Array(await obj.arrayBuffer())
    const plaintext = await decryptPart(blob, key, backupAad(userId, id))
    const liveBlob = await encryptPart(plaintext, key, liveAad(userId))
    // AI 起点でライブを書き換えたので、取り込み対象として目印を刻む。
    await env.MEDIA.put(`${userId}/live`, liveBlob as unknown as ArrayBuffer, {
      customMetadata: { aiEditedAt: String(Date.now()) },
    })
    return true
  } catch {
    return false
  }
}

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS })

// SSE ストリームは提供しない（stateless・サーバ発通知なし）。
export const onRequestGet: PagesFunction<Env> = async () =>
  jsonResponse({ error: 'method_not_allowed' }, 405)

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const principal = await resolveMcpAuth(context.request, context.env, context.env.DB)
  if (!principal) return unauthorized(context.request)
  // 会員（有効なサブスク）のみ許可（fail-closed）。OAuth・mcp_ トークン両経路とも D1 で都度判定。
  if (!principal.isMember) {
    return jsonResponse({ error: 'forbidden', reason: 'cloud plan required' }, 403)
  }
  const userId = principal.userId

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return jsonResponse(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      400,
    )
  }

  const { env } = context
  const deps: McpDeps = {
    loadSnapshot: () => loadSnapshot(env, userId),
    saveSnapshot: (backup) => saveSnapshot(env, userId, backup),
    createBackup: () => createBackup(env, userId),
    listBackups: () => listBackups(env, userId),
    restoreBackup: (id) => restoreBackup(env, userId, id),
    loadTemplateManifest: () => readTemplateManifest(env.MEDIA),
    now: () => Date.now(),
    genId: () => crypto.randomUUID(),
  }

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
