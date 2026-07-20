/**
 * JWKS ベースの RS256 JWT 検証（Web Crypto・純ロジック）。
 * Clerk が発行する OAuth アクセストークンの署名・iss・aud・exp を検証するために使う。
 * jwks は呼び出し側が渡す（本番は issuer の JWKS を取得、テストはローカル生成鍵を注入）。
 */

export interface JwtClaims {
  iss?: string
  aud?: string | string[]
  exp?: number
  sub?: string
  scope?: string
  [key: string]: unknown
}

export interface VerifyOptions {
  issuer: string
  audience: string
  /** 現在時刻(ms)。テスト用に注入可能。既定は Date.now()。 */
  now?: number
}

/** base64url → バイト列。 */
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** base64url → UTF-8 文字列（JSON 部の復号）。 */
function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s))
}

function audienceMatches(aud: JwtClaims['aud'], expected: string): boolean {
  if (aud == null) return false
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected
}

/**
 * RS256 の JWT を JWKS で検証する。妥当なら claims を、不正・期限切れ・不一致なら null を返す。
 * 検証項目: 署名(RS256/kid 一致)・iss 完全一致・aud 包含・exp 未来。
 */
export async function verifyRs256Jwt(
  token: string,
  jwks: JsonWebKey[],
  opts: VerifyOptions,
): Promise<JwtClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts

  let header: { alg?: string; kid?: string }
  let claims: JwtClaims
  try {
    header = JSON.parse(b64urlToString(headerB64))
    claims = JSON.parse(b64urlToString(payloadB64))
  } catch {
    return null
  }
  if (header.alg !== 'RS256') return null

  // kid 一致（無ければ最初の RSA 鍵）で JWK を選ぶ。
  const jwk = header.kid ? jwks.find((k) => (k as { kid?: string }).kid === header.kid) : jwks[0]
  if (!jwk) return null

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  } catch {
    return null
  }

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const sig = b64urlToBytes(sigB64)
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)
  if (!ok) return null

  const now = opts.now ?? Date.now()
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null
  if (claims.iss !== opts.issuer) return null
  if (!audienceMatches(claims.aud, opts.audience)) return null

  return claims
}
