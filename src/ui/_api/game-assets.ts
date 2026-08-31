import { type UserGameAsset, UserGameAssetSchema } from '@/core/game/assets'

/**
 * 持ち込みゲーム素材のクラウド保管 API クライアント（`/api/game-assets`・会員のみ）。
 * 認証はクラウドバックアップと同じ Clerk JWT（Bearer）。失敗は例外にせず戻り値で返す
 * （素材はローカル保存が正で、クラウドは「ほかの端末へ運ぶ」ための控え）。
 */

type GetToken = () => Promise<string | null>

export interface HostedAssetMeta {
  id: string
  /** 暗号化ブロブのバイト数。 */
  size: number
}

export type HostedPutResult = 'ok' | 'limit_reached' | 'too_large' | 'failed'

async function authHeader(getToken: GetToken): Promise<Record<string, string> | null> {
  const jwt = await getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : null
}

/** クラウドに保管中の素材一覧（id とサイズ）。未ログイン/失敗は null。 */
export async function listHostedAssets(getToken: GetToken): Promise<HostedAssetMeta[] | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch('/api/game-assets', { headers })
    if (!res.ok) return null
    return ((await res.json()) as { assets: HostedAssetMeta[] }).assets
  } catch {
    return null
  }
}

/** 1 件を復号ダウンロードして検証済みの素材を返す。無い/壊れている/失敗は null。 */
export async function getHostedAsset(
  getToken: GetToken,
  id: string,
): Promise<UserGameAsset | null> {
  const headers = await authHeader(getToken)
  if (!headers) return null
  try {
    const res = await fetch(`/api/game-assets?id=${encodeURIComponent(id)}`, { headers })
    if (!res.ok) return null
    const parsed = UserGameAssetSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 1 件をクラウドへ保存。枚数上限は 'limit_reached'、サイズ超過は 'too_large'。 */
export async function putHostedAsset(
  getToken: GetToken,
  asset: UserGameAsset,
): Promise<HostedPutResult> {
  const headers = await authHeader(getToken)
  if (!headers) return 'failed'
  try {
    const res = await fetch(`/api/game-assets?id=${encodeURIComponent(asset.id)}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(asset),
    })
    if (res.ok) return 'ok'
    if (res.status === 409) return 'limit_reached'
    if (res.status === 413) return 'too_large'
    return 'failed'
  } catch {
    return 'failed'
  }
}

/** 1 件をクラウドから削除。 */
export async function deleteHostedAsset(getToken: GetToken, id: string): Promise<boolean> {
  const headers = await authHeader(getToken)
  if (!headers) return false
  try {
    const res = await fetch(`/api/game-assets?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    })
    return res.ok
  } catch {
    return false
  }
}
