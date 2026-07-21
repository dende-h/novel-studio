/**
 * クラウド全体バックアップの API クライアント（`/api/backup`）。
 * 認証は Clerk JWT（Bearer）のみ＝**X-Session-Token に依存しない**（単一セッション撤去方針）。
 */

type GetToken = () => Promise<string | null>

export interface BackupSummary {
  id: string
  /** バックアップを取った時刻（epoch ms）。 */
  createdAt: number
  /** 暗号化ブロブのバイト数。 */
  size: number
}

async function authHeader(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : null
}

/** 平文バンドル JSON を保存する。成功で { id, createdAt }、失敗/未ログインで null。 */
export async function createBackup(
  getToken: GetToken,
  plaintext: string,
): Promise<{ id: string; createdAt: number } | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch('/api/backup', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: plaintext,
    })
    if (!res.ok) return null
    return (await res.json()) as { id: string; createdAt: number }
  } catch {
    return null
  }
}

/** MCP 用ライブスナップショットを上書き保存（版は作らない）。成功で true。 */
export async function putLiveBackup(getToken: GetToken, plaintext: string): Promise<boolean> {
  const headers = await authHeader(getToken)
  if (!headers) return false
  try {
    const res = await fetch('/api/backup', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: plaintext,
    })
    return res.ok
  } catch {
    return false
  }
}

/** バックアップ一覧（新しい順）。未ログイン/失敗は空配列。 */
export async function listBackups(getToken: GetToken): Promise<BackupSummary[]> {
  const headers = await authHeader(getToken)
  if (!headers) return []
  try {
    const res = await fetch('/api/backup', { headers })
    if (!res.ok) return []
    return ((await res.json()) as { backups: BackupSummary[] }).backups
  } catch {
    return []
  }
}

/** 1 件を復号ダウンロードし平文バンドル JSON を返す。失敗は null。 */
export async function getBackup(getToken: GetToken, id: string): Promise<string | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch(`/api/backup?id=${encodeURIComponent(id)}`, { headers })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** MCP 用ライブスナップショット（AI の書き込み反映先）を平文で取得。無ければ/失敗は null。 */
export async function getLiveBackup(getToken: GetToken): Promise<string | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch('/api/backup?live=1', { headers })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** 1 件削除。 */
export async function deleteBackup(getToken: GetToken, id: string): Promise<boolean> {
  const headers = await authHeader(getToken)
  if (!headers) return false
  try {
    const res = await fetch(`/api/backup?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    })
    return res.ok
  } catch {
    return false
  }
}
