import { describe, expect, it } from 'vitest'
import {
  buildProtectedResourceMetadata,
  DEFAULT_MCP_SCOPES,
  PRM_WELL_KNOWN_PATH,
  parseScopes,
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

  it('PRM の位置は RFC 9728 の path-aware 形式（401 の案内先と揃える）', () => {
    expect(PRM_WELL_KNOWN_PATH).toBe('/.well-known/oauth-protected-resource/api/mcp')
  })
})

describe('parseScopes（要求してほしいスコープ）', () => {
  it('未設定・空白だけなら既定値へ倒す（黙らない）', () => {
    expect(parseScopes(undefined)).toEqual(DEFAULT_MCP_SCOPES)
    expect(parseScopes('')).toEqual(DEFAULT_MCP_SCOPES)
    expect(parseScopes('   ')).toEqual(DEFAULT_MCP_SCOPES)
  })

  it('既定値にはリフレッシュ用の offline_access が入る', () => {
    // 抜けるとトークンの期限切れで接続が黙って死ぬ（10-mcp-oauth.md §2-H）。
    expect(DEFAULT_MCP_SCOPES).toContain('offline_access')
  })

  it('設定があればそれを使う（空白の連続も潰す）', () => {
    expect(parseScopes('openid  profile\temail')).toEqual(['openid', 'profile', 'email'])
  })
})
