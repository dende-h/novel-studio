import { describe, expect, it } from 'vitest'
import { buildProtectedResourceMetadata, wwwAuthenticateBearer } from './oauth-metadata'

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
