/**
 * AI・MCP アクセスの API クライアント（`/api/mcp/token`）。認証は Clerk JWT（Bearer）。
 */

type GetToken = () => Promise<string | null>

export interface McpTokenStatus {
  hasToken: boolean
  createdAt: number | null
}

async function authHeader(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : null
}

/** MCP トークンを新規発行（既存は置換）。平文を返す（表示は一度きり）。失敗/未ログインは null。 */
export async function generateMcpToken(getToken: GetToken): Promise<string | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch('/api/mcp/token', { method: 'POST', headers })
    if (!res.ok) return null
    return ((await res.json()) as { token: string }).token
  } catch {
    return null
  }
}

/** 発行済みか（平文は返らない）。 */
export async function getMcpTokenStatus(getToken: GetToken): Promise<McpTokenStatus> {
  const headers = await authHeader(getToken)
  if (!headers) return { hasToken: false, createdAt: null }
  try {
    const res = await fetch('/api/mcp/token', { headers })
    if (!res.ok) return { hasToken: false, createdAt: null }
    return (await res.json()) as McpTokenStatus
  } catch {
    return { hasToken: false, createdAt: null }
  }
}

/** MCP トークンを失効（AI からのアクセスを止める）。 */
export async function revokeMcpToken(getToken: GetToken): Promise<boolean> {
  const headers = await authHeader(getToken)
  if (!headers) return false
  try {
    const res = await fetch('/api/mcp/token', { method: 'DELETE', headers })
    return res.ok
  } catch {
    return false
  }
}
