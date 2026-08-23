/**
 * OAuth 2.0 Protected Resource Metadata（RFC 9728）とその案内ヘッダの純ロジック。
 * MCP を「OAuth リソースサーバー」として名乗るために使う。認可サーバーは Clerk（別ホスト）。
 * これ自体は Clerk 設定に依存しない（設定値は呼び出し側が config で渡す）。
 */

export interface ProtectedResourceConfig {
  /** 保護リソースの正準 URI（＝MCP エンドポイント。例: https://host/api/mcp）。 */
  resource: string
  /** 認可サーバーの issuer URL 群（＝Clerk）。 */
  authorizationServers: string[]
  /** 対応スコープ（任意）。 */
  scopesSupported?: string[]
  /** 表示名（任意）。 */
  resourceName?: string
  /** ドキュメント URL（任意）。 */
  resourceDocumentation?: string
}

export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
  bearer_methods_supported: string[]
  scopes_supported?: string[]
  resource_name?: string
  resource_documentation?: string
}

/** RFC 9728 の Protected Resource Metadata ドキュメントを組む。 */
export function buildProtectedResourceMetadata(
  cfg: ProtectedResourceConfig,
): ProtectedResourceMetadata {
  const meta: ProtectedResourceMetadata = {
    resource: cfg.resource,
    authorization_servers: cfg.authorizationServers,
    // アクセストークンは Authorization ヘッダのみ（クエリ文字列は 2026 仕様でも禁止）。
    bearer_methods_supported: ['header'],
  }
  if (cfg.scopesSupported && cfg.scopesSupported.length > 0) {
    meta.scopes_supported = cfg.scopesSupported
  }
  if (cfg.resourceName) meta.resource_name = cfg.resourceName
  if (cfg.resourceDocumentation) meta.resource_documentation = cfg.resourceDocumentation
  return meta
}

/**
 * RFC 9728 に沿った WWW-Authenticate（401 応答用）。
 * `resource_metadata` で PRM ドキュメントの URL をクライアントへ案内する。
 * error は任意（例: invalid_token）。
 */
export function wwwAuthenticateBearer(resourceMetadataUrl: string, error?: string): string {
  const params = [`resource_metadata="${resourceMetadataUrl}"`]
  if (error) params.unshift(`error="${error}"`)
  return `Bearer ${params.join(', ')}`
}

// ---------------------------------------------------------------------------
// 認可サーバー窓口（ファサード）— ChatGPT 対応のための同一オリジン化
// ---------------------------------------------------------------------------
// ChatGPT のコネクタは PRM の authorization_servers ポインタを辿らず、MCP ホストの
// `/.well-known/oauth-authorization-server` を直接叩く。RFC 8414 §3.3 は「well-known を
// 引いたホストと issuer が一致すること」を求めるため、Clerk のドキュメントをそのまま
// 中継すると issuer が別ホスト（*.clerk.accounts.dev）になり弾かれる。
// そこで **issuer もエンドポイントも自オリジンに書き換えた**ドキュメントを配り、実体は
// /api/oauth/* が Clerk へ中継する。トークンを発行・検証するのは従来どおり Clerk。

/**
 * 窓口のパス。Service Worker の navigateFallbackDenylist / NetworkOnly が `/api/` を
 * 既に除外しているため、**必ず /api/ 配下に置く**（/oauth/authorize に置くと PWA の
 * ナビゲーションフォールバックがアプリの index.html に差し替えて認可画面へ行けない）。
 */
export const OAUTH_FACADE_PATHS: Record<string, string> = {
  authorization_endpoint: '/api/oauth/authorize',
  token_endpoint: '/api/oauth/token',
  registration_endpoint: '/api/oauth/register',
  revocation_endpoint: '/api/oauth/revoke',
  introspection_endpoint: '/api/oauth/introspect',
  userinfo_endpoint: '/api/oauth/userinfo',
  jwks_uri: '/api/oauth/jwks',
}

/** 中継先が無い＝自オリジンに存在しない窓口。名乗ると壊れるので落とす対象かを判定する。 */
const isEndpointKey = (key: string) => key.endsWith('_endpoint') || key.endsWith('_uri')

/**
 * 上流（Clerk）の認可サーバーメタデータを、自オリジンを名乗るドキュメントへ書き換える。
 * - issuer と中継できる窓口は自オリジンへ差し替え。
 * - 上流に無い窓口は名乗らない（例: DCR 未対応なら registration_endpoint を出さない）。
 * - 中継しない `*_endpoint` / `*_uri` は削除する（上流ホストの URL を残すと同一オリジン性が崩れる）。
 * - scopes_supported や code_challenge_methods_supported など能力の申告は上流のまま。
 */
export function buildFacadeAuthServerMetadata(
  upstream: Record<string, unknown>,
  origin: string,
): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...upstream, issuer: origin }
  for (const [key, path] of Object.entries(OAUTH_FACADE_PATHS)) {
    // authorize/token は必須。それ以外は上流が持つときだけ差し替える。
    const required = key === 'authorization_endpoint' || key === 'token_endpoint'
    if (required || typeof upstream[key] === 'string') doc[key] = `${origin}${path}`
  }
  for (const key of Object.keys(doc)) {
    if (isEndpointKey(key) && !(key in OAUTH_FACADE_PATHS)) delete doc[key]
  }
  return doc
}
