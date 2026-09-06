// @vitest-environment node
/**
 * 認可サーバーの純ロジック。**「通ってはいけないものが通らない」ことを固定する**のが主眼で、
 * ここが緩むと他人の作品が読める種類の事故になる（docs/requirement/10-mcp-oauth.md §5）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildAuthorizeRedirect,
  buildAuthServerMetadata,
  checkAuthorize,
  checkRegistration,
  OAUTH_SCOPES,
  type OAuthClient,
  randomSecret,
  s256,
  verifyPkce,
} from './oauth-server'

const RESOURCE = 'https://x.example/api/mcp'
const client: OAuthClient = {
  clientId: 'cid_abc',
  clientName: 'ChatGPT',
  clientUri: 'https://chatgpt.com',
  redirectUris: ['https://chatgpt.com/cb', 'http://localhost:8765/cb'],
}

/** 正しい認可要求（各テストで 1 か所だけ壊す）。 */
const params = (over: Record<string, string | null> = {}) => {
  const base: Record<string, string> = {
    response_type: 'code',
    client_id: 'cid_abc',
    redirect_uri: 'https://chatgpt.com/cb',
    code_challenge: 'abc',
    code_challenge_method: 'S256',
    state: 'st',
    scope: 'mcp offline_access',
    resource: RESOURCE,
  }
  const out = new URLSearchParams(base)
  for (const [k, v] of Object.entries(over)) {
    if (v === null) out.delete(k)
    else out.set(k, v)
  }
  return out
}

describe('checkAuthorize', () => {
  it('正しい要求は通り、scope が無ければ既定を与える', () => {
    const ok = checkAuthorize(params(), client, RESOURCE)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.value.redirectUri).toBe('https://chatgpt.com/cb')
    expect(ok.value.state).toBe('st')

    const noScope = checkAuthorize(params({ scope: null }), client, RESOURCE)
    expect(noScope.ok && noScope.value.scope).toEqual(OAUTH_SCOPES)
  })

  it('未登録の client_id と、登録外の redirect_uri は**リダイレクトで返さない**', () => {
    // ここを緩めると、知らない URL へ値を運ぶ踏み台になる（RFC 6749 §4.1.2.1）。
    const unknown = checkAuthorize(params(), null, RESOURCE)
    expect(unknown).toMatchObject({ ok: false, redirectable: false })

    const other = checkAuthorize(
      params({ redirect_uri: 'https://evil.example/cb' }),
      client,
      RESOURCE,
    )
    expect(other).toMatchObject({ ok: false, redirectable: false })
  })

  it('前方一致では通さない（完全一致だけ）', () => {
    const sneaky = checkAuthorize(
      params({ redirect_uri: 'https://chatgpt.com/cb.evil.example' }),
      client,
      RESOURCE,
    )
    expect(sneaky).toMatchObject({ ok: false, redirectable: false })
  })

  it('PKCE は必須で、S256 以外は拒む', () => {
    expect(checkAuthorize(params({ code_challenge: null }), client, RESOURCE)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(
      checkAuthorize(params({ code_challenge_method: 'plain' }), client, RESOURCE),
    ).toMatchObject({ ok: false, error: 'invalid_request' })
  })

  it('response_type は code だけ', () => {
    expect(checkAuthorize(params({ response_type: 'token' }), client, RESOURCE)).toMatchObject({
      ok: false,
      error: 'unsupported_response_type',
    })
  })

  it('別の相手向けの resource は invalid_target（末尾スラッシュは同一視）', () => {
    expect(
      checkAuthorize(params({ resource: 'https://other.example/api/mcp' }), client, RESOURCE),
    ).toMatchObject({ ok: false, error: 'invalid_target' })
    expect(checkAuthorize(params({ resource: `${RESOURCE}/` }), client, RESOURCE).ok).toBe(true)
  })

  it('知らないスコープは invalid_scope', () => {
    expect(checkAuthorize(params({ scope: 'mcp admin' }), client, RESOURCE)).toMatchObject({
      ok: false,
      error: 'invalid_scope',
    })
  })
})

describe('buildAuthorizeRedirect', () => {
  it('成功も失敗も iss を必ず載せる（RFC 9207・§2-A の再発防止）', () => {
    const ok = new URL(
      buildAuthorizeRedirect('https://chatgpt.com/cb', 'https://x.example', {
        code: 'c1',
        state: 'st',
      }),
    )
    expect(ok.searchParams.get('iss')).toBe('https://x.example')
    expect(ok.searchParams.get('code')).toBe('c1')

    const denied = new URL(
      buildAuthorizeRedirect('https://chatgpt.com/cb', 'https://x.example', {
        error: 'access_denied',
        state: null,
      }),
    )
    expect(denied.searchParams.get('iss')).toBe('https://x.example')
    expect(denied.searchParams.has('state')).toBe(false)
  })

  it('redirect_uri が元から持っているクエリを壊さない', () => {
    const url = new URL(
      buildAuthorizeRedirect('https://chatgpt.com/cb?tenant=a', 'https://x.example', { code: 'c' }),
    )
    expect(url.searchParams.get('tenant')).toBe('a')
  })
})

describe('PKCE', () => {
  it('正しい verifier だけ通る', async () => {
    const verifier = randomSecret('')
    const challenge = await s256(verifier)
    expect(await verifyPkce(verifier, challenge)).toBe(true)
    expect(await verifyPkce(`${verifier}x`, challenge)).toBe(false)
    expect(await verifyPkce('', challenge)).toBe(false)
  })
})

describe('checkRegistration', () => {
  it('https と http://localhost だけ受け付ける', () => {
    expect(checkRegistration({ redirect_uris: ['https://a.example/cb'] }).ok).toBe(true)
    expect(checkRegistration({ redirect_uris: ['http://localhost:1/cb'] }).ok).toBe(true)
    expect(checkRegistration({ redirect_uris: ['http://a.example/cb'] })).toMatchObject({
      ok: false,
      error: 'invalid_redirect_uri',
    })
  })

  it('redirect_uris が無い・URL でないものは拒む', () => {
    expect(checkRegistration({}).ok).toBe(false)
    expect(checkRegistration({ redirect_uris: ['not a url'] }).ok).toBe(false)
  })

  it('公開クライアント以外は受け付けない', () => {
    expect(
      checkRegistration({
        redirect_uris: ['https://a.example/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    ).toMatchObject({ ok: false, error: 'invalid_client_metadata' })
  })
})

describe('buildAuthServerMetadata', () => {
  it('issuer は自オリジンで、窓口も全部自分（上流の値を混ぜない）', () => {
    const doc = buildAuthServerMetadata('https://x.example')
    expect(doc.issuer).toBe('https://x.example')
    expect(doc.authorization_endpoint).toBe('https://x.example/api/oauth/authorize')
    expect(doc.token_endpoint).toBe('https://x.example/api/oauth/token')
    expect(doc.code_challenge_methods_supported).toEqual(['S256'])
    expect(doc.token_endpoint_auth_methods_supported).toEqual(['none'])
    // iss を返すと名乗る以上、応答側（buildAuthorizeRedirect）も必ず載せること。
    expect(doc.authorization_response_iss_parameter_supported).toBe(true)
    for (const value of Object.values(doc)) {
      expect(JSON.stringify(value)).not.toContain('clerk')
    }
  })
})
