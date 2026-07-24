/// <reference types="@cloudflare/workers-types" />
/**
 * MCP アクセストークンの生成・照合（AI・MCP アクセス）。
 * 平文は保存せず SHA-256 ハッシュのみ D1 に持つ。MCP エンドポイントは受け取ったトークンを
 * ハッシュ化し token_hash から user_id を解決する（`mcp_tokens` テーブル・migration 0004）。
 */

import { sha256Hex } from './crypto'

/** ユーザーに配る MCP トークンを新規生成する。`mcp_` 接頭辞＋base64url 32byte。 */
export function generateMcpToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `mcp_${b64url}`
}

/** トークンのハッシュ（保存・照合の単一実装）。 */
export function hashMcpToken(token: string): Promise<string> {
  return sha256Hex(token)
}

/** トークンから user_id を解決する。未知/失効なら null。 */
export async function resolveMcpUser(db: D1Database, token: string): Promise<string | null> {
  if (!token) return null
  const row = await db
    .prepare('SELECT user_id FROM mcp_tokens WHERE token_hash = ?')
    .bind(await hashMcpToken(token))
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}
