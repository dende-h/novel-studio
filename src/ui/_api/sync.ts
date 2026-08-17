/**
 * Work 単位同期の API クライアント（`/api/sync/*`）。
 * 認証は Clerk JWT（Bearer）のみ。失敗（オフライン・未ログイン・4xx/5xx）は例外を投げず
 * null / false で返し、呼び出し側（reconcile）が次の機会に自然に再試行する。
 * push の CAS 409 だけは「競合」として区別して返す（黙った上書きの構造的排除）。
 */

import type { ActivityDay } from '@/core/sync/activityMerge'
import type { RemoteWorkMeta } from '@/core/sync/types'

type GetToken = () => Promise<string | null>

async function authHeader(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : null
}

/** 同期メタの一覧（サーバ側の真実）。未ログイン/失敗は null（＝今回の同期を見送る）。 */
export async function getSyncManifest(getToken: GetToken): Promise<RemoteWorkMeta[] | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch('/api/sync/manifest', { headers })
    if (!res.ok) return null
    return ((await res.json()) as { works: RemoteWorkMeta[] }).works
  } catch {
    return null
  }
}

/** pull 用：1 作品の平文 JSON とメタ。無い/失敗は null。 */
export async function getSyncWork(
  getToken: GetToken,
  workId: string,
): Promise<{ json: string; updatedAt: number; trashedAt: number; docHash: string } | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch(`/api/sync/work?id=${encodeURIComponent(workId)}`, { headers })
    if (!res.ok) return null
    return {
      json: await res.text(),
      updatedAt: Number(res.headers.get('x-updated-at')) || 0,
      trashedAt: Number(res.headers.get('x-trashed-at')) || 0,
      docHash: res.headers.get('x-doc-hash') ?? '',
    }
  } catch {
    return null
  }
}

/** push の結果。conflict はサーバ側が進んでいた（CAS 不成立）ことを表す。 */
export type PutSyncResult =
  | { ok: true; docHash: string; syncedAt: number }
  | { ok: false; conflict: RemoteWorkMeta }

/**
 * CAS 付き push。`baseHash` が最後に同期した時点のサーバ docHash（新規は ''）。
 * 一致しなければサーバは受理せず 409 を返す＝他端末の変更を黙って上書きしない。
 */
export async function putSyncWork(
  getToken: GetToken,
  workId: string,
  plaintext: string,
  opts: { baseHash: string; updatedAt: number; trashedAt: number },
): Promise<PutSyncResult | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch(`/api/sync/work?id=${encodeURIComponent(workId)}`, {
      method: 'PUT',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-base-hash': opts.baseHash,
        'x-updated-at': String(opts.updatedAt),
        'x-trashed-at': String(opts.trashedAt),
      },
      body: plaintext,
    })
    if (res.status === 409) {
      const body = (await res.json()) as { meta: RemoteWorkMeta }
      return { ok: false, conflict: body.meta }
    }
    if (!res.ok) return null
    const body = (await res.json()) as { docHash: string; syncedAt: number }
    return { ok: true, ...body }
  } catch {
    return null
  }
}

/** ゴミ箱状態の伝播（blob 不変）。古い patch はサーバが 409 で棄却する（LWW）。 */
export async function patchSyncWork(
  getToken: GetToken,
  workId: string,
  body: { trashedAt: number; updatedAt: number },
): Promise<{ ok: true } | { ok: false; conflict: RemoteWorkMeta } | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch(`/api/sync/work?id=${encodeURIComponent(workId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 409) {
      const data = (await res.json()) as { meta: RemoteWorkMeta }
      return { ok: false, conflict: data.meta }
    }
    return res.ok ? { ok: true } : null
  } catch {
    return null
  }
}

/**
 * 執筆の記録（日別活動）の同期。ローカル全日分を送り、サーバが日付ごと max マージした
 * 全量を受け取る（加算的データ＝衝突なし・CAS 不要）。未ログイン/失敗は null。
 */
export async function postSyncActivity(
  getToken: GetToken,
  days: ActivityDay[],
): Promise<ActivityDay[] | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch('/api/sync/activity', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ days }),
    })
    if (!res.ok) return null
    return ((await res.json()) as { days: ActivityDay[] }).days
  } catch {
    return null
  }
}

/** purge の伝播（トゥームストーン化・R2 blob 削除）。冪等。 */
export async function deleteSyncWork(
  getToken: GetToken,
  workId: string,
  at: number,
): Promise<boolean> {
  const headers = await authHeader(getToken)
  if (!headers) return false
  try {
    const res = await fetch(
      `/api/sync/work?id=${encodeURIComponent(workId)}&at=${encodeURIComponent(String(at))}`,
      { method: 'DELETE', headers },
    )
    return res.ok
  } catch {
    return false
  }
}
