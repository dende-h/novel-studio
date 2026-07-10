/// <reference types="@cloudflare/workers-types" />
/**
 * /api/mcp/token — MCP アクセストークンの管理（会員のみ・Clerk JWT 認証）。
 *   POST   = 新規発行（既存があれば置き換え）。**平文トークンを一度だけ返す**（保存はハッシュのみ）。
 *   GET    = 状態（発行済みか・発行時刻）。平文は返さない（保存していないため）。
 *   DELETE = 失効（AI からのアクセスを止める）。
 */

import { type ClerkEnv, json, verifyMember } from '../_lib/auth'
import { generateMcpToken, hashMcpToken } from '../_lib/mcp-token'

interface Env extends ClerkEnv {
  DB: D1Database
}

type Ctx = Parameters<PagesFunction<Env>>[0]

async function requireMember(context: Ctx): Promise<{ userId: string } | { error: Response }> {
  const m = await verifyMember(context.request, context.env)
  if (!m) return { error: json({ error: 'unauthorized' }, 401) }
  if (!m.isMember) return { error: json({ error: 'subscription_required' }, 402) }
  return { userId: m.userId }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const token = generateMcpToken()
  const tokenHash = await hashMcpToken(token)
  await context.env.DB.prepare(
    `INSERT INTO mcp_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`,
  )
    .bind(userId, tokenHash, Date.now())
    .run()

  // 平文はここでしか返らない（保存はハッシュのみ）。
  return json({ token })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  const row = await context.env.DB.prepare('SELECT created_at FROM mcp_tokens WHERE user_id = ?')
    .bind(userId)
    .first<{ created_at: number }>()
  return json({ hasToken: !!row, createdAt: row?.created_at ?? null })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const m = await requireMember(context)
  if ('error' in m) return m.error
  const { userId } = m

  await context.env.DB.prepare('DELETE FROM mcp_tokens WHERE user_id = ?').bind(userId).run()
  return json({ ok: true })
}
