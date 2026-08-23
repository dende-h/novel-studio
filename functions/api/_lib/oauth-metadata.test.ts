import { describe, expect, it } from 'vitest'
import {
  buildFacadeAuthServerMetadata,
  buildProtectedResourceMetadata,
  wwwAuthenticateBearer,
} from './oauth-metadata'

describe('oauth-metadata（RFC 9728）', () => {
  it('必須項目と bearer_methods_supported=header を出す', () => {
    const m = buildProtectedResourceMetadata({
      resource: 'https://x/api/mcp',
      authorizationServers: ['https://clerk.example.com'],
    })
    expect(m).toMatchObject({
      resource: 'https://x/api/mcp',
      authorization_servers: ['https://clerk.example.com'],
      bearer_methods_supported: ['header'],
    })
    expect('scopes_supported' in m).toBe(false) // 空は出さない
  })

  it('scopes/name は与えたときだけ出す', () => {
    const m = buildProtectedResourceMetadata({
      resource: 'https://x/api/mcp',
      authorizationServers: ['https://a'],
      scopesSupported: ['cloud'],
      resourceName: 'コトノハ-leaf-',
    })
    expect(m.scopes_supported).toEqual(['cloud'])
    expect(m.resource_name).toBe('コトノハ-leaf-')
  })

  it('wwwAuthenticateBearer は resource_metadata を含み、error は任意', () => {
    expect(wwwAuthenticateBearer('https://x/prm')).toBe('Bearer resource_metadata="https://x/prm"')
    expect(wwwAuthenticateBearer('https://x/prm', 'invalid_token')).toBe(
      'Bearer error="invalid_token", resource_metadata="https://x/prm"',
    )
  })
})

describe('buildFacadeAuthServerMetadata（RFC 8414・同一オリジン化）', () => {
  const upstream = {
    issuer: 'https://credible-stork-66.clerk.accounts.dev',
    authorization_endpoint: 'https://credible-stork-66.clerk.accounts.dev/oauth/authorize',
    token_endpoint: 'https://credible-stork-66.clerk.accounts.dev/oauth/token',
    registration_endpoint: 'https://credible-stork-66.clerk.accounts.dev/oauth/register',
    jwks_uri: 'https://credible-stork-66.clerk.accounts.dev/.well-known/jwks.json',
    userinfo_endpoint: 'https://credible-stork-66.clerk.accounts.dev/oauth/userinfo',
    scopes_supported: ['openid', 'profile'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  }

  it('issuer と窓口を自オリジンへ差し替える', () => {
    const doc = buildFacadeAuthServerMetadata(upstream, 'https://stg.example.pages.dev')
    expect(doc.issuer).toBe('https://stg.example.pages.dev')
    expect(doc.authorization_endpoint).toBe('https://stg.example.pages.dev/api/oauth/authorize')
    expect(doc.token_endpoint).toBe('https://stg.example.pages.dev/api/oauth/token')
    expect(doc.registration_endpoint).toBe('https://stg.example.pages.dev/api/oauth/register')
    expect(doc.jwks_uri).toBe('https://stg.example.pages.dev/api/oauth/jwks')
    expect(doc.userinfo_endpoint).toBe('https://stg.example.pages.dev/api/oauth/userinfo')
  })

  it('能力の申告は上流のまま残す', () => {
    const doc = buildFacadeAuthServerMetadata(upstream, 'https://x')
    expect(doc.scopes_supported).toEqual(['openid', 'profile'])
    expect(doc.code_challenge_methods_supported).toEqual(['S256'])
    expect(doc.grant_types_supported).toEqual(['authorization_code', 'refresh_token'])
  })

  it('上流に無い窓口は名乗らない（DCR 未対応なら registration_endpoint を出さない）', () => {
    const { registration_endpoint, ...noDcr } = upstream
    const doc = buildFacadeAuthServerMetadata(noDcr, 'https://x')
    expect('registration_endpoint' in doc).toBe(false)
    // authorize/token は必須なので常に出る。
    expect(doc.authorization_endpoint).toBe('https://x/api/oauth/authorize')
  })

  it('中継しない窓口は残さない（上流ホストの URL が漏れない）', () => {
    const doc = buildFacadeAuthServerMetadata(
      { ...upstream, device_authorization_endpoint: 'https://clerk.example/device' },
      'https://x',
    )
    expect('device_authorization_endpoint' in doc).toBe(false)
    for (const value of Object.values(doc)) {
      expect(String(value)).not.toContain('clerk.accounts.dev')
    }
  })
})
