import type { ReadPosition } from './board-notification-store'

const encoder = new TextEncoder()
const keyFor = (secret: string) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

export async function boardReadToken(
  secret: string,
  userId: string,
  position: ReadPosition,
): Promise<string> {
  const payload = btoa(encodeURIComponent(JSON.stringify(position)))
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await keyFor(secret),
      encoder.encode('board/read/v1\n' + userId + '\n' + payload),
    ),
  )
  return payload + '.' + btoa(String.fromCharCode(...signature))
}

export async function verifyBoardReadToken(
  secret: string,
  userId: string,
  token: string,
): Promise<ReadPosition | null> {
  try {
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra !== undefined) return null
    const valid = await crypto.subtle.verify(
      'HMAC',
      await keyFor(secret),
      Uint8Array.from(atob(signature), (ch) => ch.charCodeAt(0)),
      encoder.encode('board/read/v1\n' + userId + '\n' + payload),
    )
    return valid ? (JSON.parse(decodeURIComponent(atob(payload))) as ReadPosition) : null
  } catch {
    return null
  }
}
