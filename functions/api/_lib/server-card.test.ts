// @vitest-environment node
/**
 * MCP Server Card（SEP-2127）と、公式 MCP Registry に出す server.json の契約を固定する。
 * 名刺と server.json が食い違うと、AI クライアントと目録で別の名前・版が出回る。
 * 版は MCP サーバーの SERVER_INFO に連動する——版を上げたら server.json も上げて出し直す。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SERVER_INFO } from './mcp-server'
import {
  AI_CATALOG_MEDIA_TYPE,
  buildAiCatalog,
  buildServerCard,
  CARD_CORS,
  cardResponse,
  MCP_SERVER_DESCRIPTION,
  SERVER_CARD_MEDIA_TYPE,
} from './server-card'

const PROD = 'https://cotonoha-leaf.org'

describe('名刺（Server Card）', () => {
  it('Registry の制約に収まる（名前の形・説明 100 文字まで）', () => {
    const card = buildServerCard(PROD)
    expect(card.name).toMatch(
      /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]\/[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/,
    )
    expect([...MCP_SERVER_DESCRIPTION].length).toBeLessThanOrEqual(100)
    expect(card.version).toBe(SERVER_INFO.version)
    expect(card.remotes).toEqual([{ type: 'streamable-http', url: `${PROD}/api/mcp` }])
  })

  it('server.json（Registry に出すもの）と、$schema 以外が一致する', () => {
    const serverJson = JSON.parse(readFileSync(resolve(process.cwd(), 'server.json'), 'utf8'))
    const { $schema: _card, ...card } = buildServerCard(PROD)
    const { $schema: schema, ...published } = serverJson
    expect(schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\//)
    expect(published).toEqual(card)
  })

  it('オリジンに追従する（stg の名刺は stg の接続先を指す）', () => {
    const card = buildServerCard('https://stg.novel-studio-b2m.pages.dev')
    expect(card.remotes[0].url).toBe('https://stg.novel-studio-b2m.pages.dev/api/mcp')
  })
})

describe('目録（AI Catalog）', () => {
  it('名刺の URL を、名刺の媒体型で指す', () => {
    expect(buildAiCatalog(PROD)).toEqual({
      specVersion: '1.0',
      entries: [
        {
          identifier: 'urn:air:cotonoha-leaf.org:mcp:leaf',
          type: SERVER_CARD_MEDIA_TYPE,
          url: `${PROD}/api/mcp/server-card`,
        },
      ],
    })
  })
})

describe('応答の作法', () => {
  const get = (headers: Record<string, string> = {}) =>
    cardResponse(
      new Request(`${PROD}/api/mcp/server-card`, { headers }),
      buildServerCard(PROD),
      SERVER_CARD_MEDIA_TYPE,
    )

  it('CORS・1 時間のキャッシュ・ETag・媒体型を付ける', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(`${SERVER_CARD_MEDIA_TYPE}; charset=utf-8`)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/)
    for (const [name, value] of Object.entries(CARD_CORS)) {
      expect(res.headers.get(name)).toBe(value)
    }
    expect(((await res.json()) as { name: string }).name).toBe('org.cotonoha-leaf/leaf')
  })

  it('同じ ETag で問い合わせたら 304 を本文なしで返す', async () => {
    const etag = (await get()).headers.get('etag') ?? ''
    const res = await get({ 'if-none-match': etag })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
  })

  it('OPTIONS には CORS だけを返す', async () => {
    const res = await cardResponse(
      new Request(`${PROD}/.well-known/ai-catalog.json`, { method: 'OPTIONS' }),
      buildAiCatalog(PROD),
      AI_CATALOG_MEDIA_TYPE,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
