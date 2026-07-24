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
