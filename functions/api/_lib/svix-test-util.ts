/// <reference types="@cloudflare/workers-types" />
/**
 * テスト用：`verifySvix` と同じ規約で svix v1 署名を作る（本物の HMAC でクロスチェックする）。
 * svix.test.ts と webhooks/clerk.test.ts が共有し、署名規約が変わっても 1 箇所だけ直せばよくする。
 */
export async function signSvix(
  secret: string,
  id: string,
  ts: string,
  body: string,
): Promise<string> {
  const raw = atob(secret.replace(/^whsec_/, ''))
  const keyBytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) keyBytes[i] = raw.charCodeAt(i)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))
  let bin = ''
  for (const b of new Uint8Array(mac)) bin += String.fromCharCode(b)
  return btoa(bin)
}
