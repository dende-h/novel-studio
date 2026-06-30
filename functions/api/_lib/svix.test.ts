// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { verifySvix } from './svix'

const SECRET = `whsec_${btoa('0123456789abcdef0123456789abcdef')}`
const NOW_MS = 1_700_000_000_000
const TS = String(Math.floor(NOW_MS / 1000))

/** verifySvix とは独立に署名を作る（検証器のクロスチェック）。 */
async function sign(secret: string, id: string, ts: string, body: string): Promise<string> {
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

const BODY = JSON.stringify({ type: 'subscriptionItem.ended', data: {} })

describe('verifySvix（Svix 署名検証）', () => {
  it('正しい署名・タイムスタンプは true', async () => {
    const sig = await sign(SECRET, 'msg_1', TS, BODY)
    const ok = await verifySvix(
      SECRET,
      { id: 'msg_1', timestamp: TS, signature: `v1,${sig}` },
      BODY,
      NOW_MS,
    )
    expect(ok).toBe(true)
  })

  it('複数署名のうち 1 つが一致すれば true', async () => {
    const sig = await sign(SECRET, 'msg_1', TS, BODY)
    const ok = await verifySvix(
      SECRET,
      { id: 'msg_1', timestamp: TS, signature: `v1,AAAA v1,${sig}` },
      BODY,
      NOW_MS,
    )
    expect(ok).toBe(true)
  })

  it('本文が改竄されていれば false', async () => {
    const sig = await sign(SECRET, 'msg_1', TS, BODY)
    const ok = await verifySvix(
      SECRET,
      { id: 'msg_1', timestamp: TS, signature: `v1,${sig}` },
      `${BODY} tampered`,
      NOW_MS,
    )
    expect(ok).toBe(false)
  })

  it('署名が誤りなら false', async () => {
    const ok = await verifySvix(
      SECRET,
      { id: 'msg_1', timestamp: TS, signature: 'v1,AAAA' },
      BODY,
      NOW_MS,
    )
    expect(ok).toBe(false)
  })

  it('タイムスタンプが許容（5分）を超えていれば false（リプレイ拒否）', async () => {
    const sig = await sign(SECRET, 'msg_1', TS, BODY)
    const ok = await verifySvix(
      SECRET,
      { id: 'msg_1', timestamp: TS, signature: `v1,${sig}` },
      BODY,
      NOW_MS + 6 * 60 * 1000,
    )
    expect(ok).toBe(false)
  })

  it('ヘッダ欠落は false', async () => {
    expect(
      await verifySvix(SECRET, { id: null, timestamp: TS, signature: 'v1,x' }, BODY, NOW_MS),
    ).toBe(false)
    expect(
      await verifySvix(SECRET, { id: 'm', timestamp: null, signature: 'v1,x' }, BODY, NOW_MS),
    ).toBe(false)
    expect(
      await verifySvix(SECRET, { id: 'm', timestamp: TS, signature: null }, BODY, NOW_MS),
    ).toBe(false)
  })
})
