/**
 * OAuth 2.0 Protected Resource Metadata（RFC 9728）とその案内ヘッダの純ロジック。
 * MCP を「OAuth リソースサーバー」として名乗るために使う。認可サーバーは Clerk（別ホスト）。
 * これ自体は Clerk 設定に依存しない（設定値は呼び出し側が config で渡す）。
 *
 * **自オリジンを認可サーバーとして名乗ってはいけない**（2026-09・docs/requirement/10-mcp-oauth.md）。
 * 名乗るとメタデータの issuer は自分になるのに、認可応答の `iss` を書くのは Clerk のままで、
 * RFC 9207 の照合に落ちる（ChatGPT はここで接続を切る）。`authorization_servers` には
 * **Clerk の issuer をそのまま**書き、クライアントを Clerk のメタデータへ辿らせる。
 */

/**
 * RFC 9728 の path-aware な PRM の位置（リソースが `/api/mcp` のとき）。
 * ミドルウェアが配る URL と、401 の `resource_metadata` が案内する URL を 1 か所で持つ。
 */
export const PRM_WELL_KNOWN_PATH = '/.well-known/oauth-protected-resource/api/mcp'

/**
 * クライアントに要求してほしいスコープの既定値（RFC 9728 `scopes_supported`）。
 *
 * **`openid` を入れてはいけない。** Clerk は動的登録（DCR）したクライアントに `openid` を
 * 許さず、認可の入口で弾く（実測・10-mcp-oauth.md §2-I）：
 *   `invalid_scope … The OAuth 2.0 Client is not allowed to request scope 'openid'.`
 * ChatGPT はここに書いた値をそのまま要求するので、1 語間違えるとログイン直後に落ちる。
 * **Clerk が DCR クライアントへ実際に割り当てる 3 つ**（登録応答の `scope` がこれを返す）に揃える。
 *
 * ここを黙っていてもいけない。クライアントは要求すべきスコープをリソース側に聞きに来る
 * （RFC 9728 §2）。とくに `offline_access` が無いとリフレッシュトークンが出ず、期限が切れた
 * 時点で接続が黙って死ぬ。
 *
 * `MCP_OAUTH_SCOPES` を設定すればそちらが優先される（Clerk の設定を変えたときはここも直す）。
 */
export const DEFAULT_MCP_SCOPES = ['profile', 'email', 'offline_access']

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
