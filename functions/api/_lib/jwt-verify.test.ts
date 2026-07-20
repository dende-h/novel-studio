import { beforeAll, describe, expect, it } from 'vitest'
import { verifyRs256Jwt } from './jwt-verify'

const ISS = 'https://clerk.example.com'
const AUD = 'https://x/api/mcp'
const NOW = 1_800_000_000_000 // 固定時刻(ms)

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))

let priv: CryptoKey
let jwk: JsonWebKey

async function makeJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'test-kid' },
): Promise<string> {
  const h = b64urlJson(header)
  const p = b64urlJson(payload)
  const data = new TextEncoder().encode(`${h}.${p}`)
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, data))
  return `${h}.${p}.${b64url(sig)}`
}

const validPayload = () => ({
  sub: 'user_123',
  iss: ISS,
  aud: AUD,
  exp: Math.floor(NOW / 1000) + 3600,
})

describe('verifyRs256Jwt（JWKS 検証）', () => {
  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    priv = pair.privateKey
    jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
    jwk.kid = 'test-kid'
  })

  it('妥当なトークンは claims を返す', async () => {
    const token = await makeJwt(validPayload())
    const claims = await verifyRs256Jwt(token, [jwk], { issuer: ISS, audience: AUD, now: NOW })
    expect(claims?.sub).toBe('user_123')
  })

  it('issuer 不一致は null', async () => {
    const token = await makeJwt({ ...validPayload(), iss: 'https://evil' })
    expect(await verifyRs256Jwt(token, [jwk], { issuer: ISS, audience: AUD, now: NOW })).toBeNull()
  })

  it('audience 不一致は null', async () => {
    const token = await makeJwt(validPayload())
    expect(
      await verifyRs256Jwt(token, [jwk], { issuer: ISS, audience: 'https://other', now: NOW }),
    ).toBeNull()
  })

  it('aud が配列でも包含していれば通る', async () => {
    const token = await makeJwt({ ...validPayload(), aud: ['https://other', AUD] })
    const claims = await verifyRs256Jwt(token, [jwk], { issuer: ISS, audience: AUD, now: NOW })
    expect(claims?.sub).toBe('user_123')
  })

  it('期限切れは null', async () => {
    const token = await makeJwt({ ...validPayload(), exp: Math.floor(NOW / 1000) - 1 })
    expect(await verifyRs256Jwt(token, [jwk], { issuer: ISS, audience: AUD, now: NOW })).toBeNull()
  })

  it('署名改竄は null', async () => {
    const token = await makeJwt(validPayload())
    const tampered = `${token.slice(0, -3)}AAA`
    expect(
      await verifyRs256Jwt(tampered, [jwk], { issuer: ISS, audience: AUD, now: NOW }),
    ).toBeNull()
  })

  it('alg が RS256 以外は null', async () => {
    const token = await makeJwt(validPayload(), { alg: 'none', kid: 'test-kid' })
    expect(await verifyRs256Jwt(token, [jwk], { issuer: ISS, audience: AUD, now: NOW })).toBeNull()
  })

  it('形が JWT でなければ null', async () => {
    expect(
      await verifyRs256Jwt('not-a-jwt', [jwk], { issuer: ISS, audience: AUD, now: NOW }),
    ).toBeNull()
  })
})
