/// <reference types="@cloudflare/workers-types" />
/**
 * Svix（Clerk）webhook 署名検証（自前・依存追加なし・Web Crypto）。
 *
 * Clerk は svix で署名する：
 *   sig = base64( HMAC-SHA256( base64decode(secret 〔'whsec_' 接頭辞を除く〕), `${id}.${timestamp}.${body}` ) )
 * `svix-signature` ヘッダにはスペース区切りで "v1,<sig> v1,<sig2> ..." のように複数列挙されうる。
 * リプレイ・時計ずれ対策として `svix-timestamp` の許容ずれ（既定 5 分）も検査する。
 */

const TOLERANCE_SEC = 5 * 60

export interface SvixHeaders {
  id: string | null
  timestamp: string | null
  signature: string | null
}

/** 署名・タイムスタンプを検証する。1 つでも欠落・不一致・時刻超過なら false。 */
export async function verifySvix(
  secret: string,
  headers: SvixHeaders,
  body: string,
  nowMs: number,
): Promise<boolean> {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(nowMs / 1000 - ts) > TOLERANCE_SEC) return false // リプレイ/時計ずれを拒否

  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''))
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )
  const expected = bytesToBase64(new Uint8Array(mac))

  // "v1,<sig>" のうち v1 の署名と定数時間比較で一致するものが 1 つでもあれば OK。
  for (const part of signature.split(' ')) {
    const comma = part.indexOf(',')
    if (comma === -1) continue
    const version = part.slice(0, comma)
    const sig = part.slice(comma + 1)
    if (version === 'v1' && sig && timingSafeEqual(sig, expected)) return true
  }
  return false
}

/** 長さ・内容ともに定数時間で比較（タイミング攻撃対策）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
