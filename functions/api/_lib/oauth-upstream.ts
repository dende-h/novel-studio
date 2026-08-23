/// <reference types="@cloudflare/workers-types" />
/**
 * 上流の認可サーバー（Clerk）へのアクセス。
 * 窓口（/api/oauth/*）とディスカバリ中継（_middleware）の両方がここを使う。
 *
 * エンドポイントの URL は**上流のメタデータから読む**。Clerk のパスを直書きしない
 * （本番でカスタムドメインへ移しても、DCR の有無が変わっても、ここは触らずに済む）。
 */

/** 上流の認可サーバーメタデータ（必要な項目だけ型を付け、残りは素通し）。 */
export interface UpstreamAsMetadata extends Record<string, unknown> {
  issuer?: string
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string
  jwks_uri?: string
}

/** 上流メタデータの既定パス（RFC 8414）。openid-configuration も同じ形で取れる。 */
export const UPSTREAM_AS_PATH = '/.well-known/oauth-authorization-server'

/** 末尾スラッシュを落とした issuer。未設定なら null。 */
export function normalizeIssuer(issuer: string | undefined): string | null {
  const trimmed = issuer?.trim().replace(/\/$/, '')
  return trimmed ? trimmed : null
}

/**
 * 上流のメタデータを取得する。取得できなければ null（呼び出し側が 503 を返す）。
 * エッジキャッシュを効かせて、OAuth 1 回ごとの往復を増やしすぎないようにする。
 */
export async function fetchUpstreamAs(
  issuer: string,
  path: string = UPSTREAM_AS_PATH,
): Promise<UpstreamAsMetadata | null> {
  try {
    const res = await fetch(`${issuer}${path}`, {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit)
    if (!res.ok) return null
    return (await res.json()) as UpstreamAsMetadata
  } catch {
    return null
  }
}
