/**
 * OAuth 2.0 Protected Resource Metadata（RFC 9728）とその案内ヘッダの純ロジック。
 * MCP を「OAuth リソースサーバー」として名乗るために使う。
 *
 * 認可サーバーは**自オリジン**（`oauth-server.ts` が実体・2026-09 の Phase 2）。以前は Clerk を
 * 指していたが、認可応答が誰にも見えない・触れないことが問題の根だった
 *（docs/requirement/10-mcp-oauth.md §2-A / §4）。**名乗る issuer と、応答を書く主体は同じにする。**
 */

import { OAUTH_SCOPES } from './oauth-server'

/**
 * RFC 9728 の path-aware な PRM の位置（リソースが `/api/mcp` のとき）。
 * ミドルウェアが配る URL と、401 の `resource_metadata` が案内する URL を 1 か所で持つ。
 */
export const PRM_WELL_KNOWN_PATH = '/.well-known/oauth-protected-resource/api/mcp'

/**
 * クライアントに要求してほしいスコープの既定値（RFC 9728 `scopes_supported`）。
 *
 * **認可サーバーが実際に許す語だけを書く。** ここは「使える一覧」ではなく「これを要求せよ」
 * という指示として読まれるので、1 語間違えると認可の入口で全部落ちる（10-mcp-oauth.md §2-I で
 * `openid` を書いて実際に踏んだ）。自前の認可サーバーになった今は `OAUTH_SCOPES` が正本。
 * `offline_access` が無いとリフレッシュトークンを出さないので、外すと期限切れで接続が死ぬ。
 *
 * `MCP_OAUTH_SCOPES` を設定すればそちらが優先される。
 */
export const DEFAULT_MCP_SCOPES = OAUTH_SCOPES

/** `MCP_OAUTH_SCOPES`（スペース区切り）を読む。未設定・空なら既定値。 */
export function parseScopes(raw: string | undefined): string[] {
  const scopes = raw?.split(/\s+/).filter(Boolean) ?? []
  return scopes.length > 0 ? scopes : DEFAULT_MCP_SCOPES
}

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
