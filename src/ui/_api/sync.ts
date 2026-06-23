/**
 * Work 同期の API クライアント（Pages Functions `/api/sync/*` 用・Phase 2）。
 * JWT＋セッショントークンを付けて fetch する薄いラッパと、クライアント側ハッシュ。
 * 平文 part を TLS で送り、at-rest 暗号化はサーバが行う（E2E 暗号化ではない）。
 */

import type { PullResult, PushPayload, PushResult } from '@/core/sync/engine'
import type { ManifestEntry } from '@/core/sync/manifest'
import { canonicalize } from '@/core/sync/normalize'

// session.ts と同じ localStorage キー（端末ローカルのセッショントークン）。
const TOKEN_KEY = 'sync-session-token'

type GetToken = () => Promise<string | null>

async function authHeaders(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  if (!jwt) return null
  return {
    Authorization: `Bearer ${jwt}`,
    'X-Session-Token': localStorage.getItem(TOKEN_KEY) ?? '',
  }
}

/** SHA-256 の hex。サーバ（functions/api/_lib/crypto.ts）と同一実装であること。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** part（doc / media）の正規化ハッシュ。エンジンへ deps.hashPart として渡す。 */
export async function hashPart(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value))
}

/** GET /api/sync/manifest — 全 Work の同期メタ。失敗時は空配列。 */
export async function getManifest(getToken: GetToken): Promise<ManifestEntry[]> {
  const headers = await authHeaders(getToken)
  if (!headers) return []
  try {
    const res = await fetch('/api/sync/manifest', { headers })
    if (!res.ok) return []
    const data = (await res.json()) as { entries?: ManifestEntry[] }
    return data.entries ?? []
  } catch {
    return []
  }
}

/** GET /api/sync/work — 1 Work を pull。未存在・失敗時は null。 */
export async function pullWork(getToken: GetToken, workId: string): Promise<PullResult | null> {
  const headers = await authHeaders(getToken)
  if (!headers) return null
  try {
    const res = await fetch(`/api/sync/work?id=${encodeURIComponent(workId)}`, { headers })
    if (!res.ok) return null
    return (await res.json()) as PullResult
  } catch {
    return null
  }
}

/** push の結果。status は HTTP コード（409=superseded / 413=too large / 507=容量超過 を識別）。
 *  ネットワーク失敗・トークン無しは status=0。 */
export interface PushResponse {
  status: number
  result: PushResult | null
}

/** PUT /api/sync/work — 1 Work を push（変わった part のみ）。HTTP status を併せて返す。 */
export async function pushWork(
  getToken: GetToken,
  workId: string,
  payload: PushPayload,
): Promise<PushResponse> {
  const headers = await authHeaders(getToken)
  if (!headers) return { status: 0, result: null }
  try {
    const res = await fetch(`/api/sync/work?id=${encodeURIComponent(workId)}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { status: res.status, result: null }
    return { status: 200, result: (await res.json()) as PushResult }
  } catch {
    return { status: 0, result: null }
  }
}

/** DELETE /api/sync/work — purge（R2 削除＋トゥームストーン化）。 */
export async function deleteWork(getToken: GetToken, workId: string): Promise<boolean> {
  const headers = await authHeaders(getToken)
  if (!headers) return false
  try {
    const res = await fetch(`/api/sync/work?id=${encodeURIComponent(workId)}`, {
      method: 'DELETE',
      headers,
    })
    return res.ok
  } catch {
    return false
  }
}
