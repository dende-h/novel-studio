/**
 * MCP Server Card と AI Catalog（SEP-2127「MCP Server Cards – HTTP Server Discovery」・
 * 拡張 id `io.modelcontextprotocol/server-card`・2026-10 に Final）。
 *
 * サイトそのものが「ここに MCP サーバーがある」と名乗るための名刺。AI クライアントや
 * MCP の目録（レジストリの集約サービス）は、ドメインの `/.well-known/ai-catalog.json` を読み、
 * そこから名刺（`/api/mcp/server-card`）を辿って、接続先と名前・説明を知る。
 *
 * 名刺に書くのは「名前・説明・版・接続先」だけで、ツールや認証は書かない（仕様どおり）。
 * 認証は MCP の OAuth ディスカバリ（/.well-known/oauth-protected-resource）で別に見つかる。
 *
 * 公式 MCP Registry に出す `server.json`（リポジトリ直下）と、名前・説明・版・接続先を揃える
 * （server-card.test.ts が突き合わせる）。版は SERVER_INFO に連動するので、MCP の版を上げたら
 * server.json の version も上げて、Registry へ出し直す（docs/requirement/12-ai-search.md）。
 */

import { SERVER_INFO } from './mcp-server'

/** 公式 MCP Registry での名前（逆ドメイン/名前）。HTTP 認証で `org.cotonoha-leaf/*` を名乗れる。 */
export const MCP_SERVER_NAME = 'org.cotonoha-leaf/leaf'
export const MCP_SERVER_TITLE = 'コトノハ-leaf-'
/** 100 文字まで（Registry と名刺の上限）。 */
export const MCP_SERVER_DESCRIPTION =
  '縦書き小説エディタ「コトノハ-leaf-」の作品（本文・用語集・プロット・世界観設定）を、AI から読み書きする MCP サーバー'

export const SERVER_CARD_SCHEMA =
  'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json'
export const AI_CATALOG_MEDIA_TYPE = 'application/ai-catalog+json'
/** 名刺の置き場所。仕様が推奨する「Streamable HTTP の URL ＋ /server-card」。 */
export const SERVER_CARD_PATH = '/api/mcp/server-card'
export const AI_CATALOG_PATH = '/.well-known/ai-catalog.json'

/** 名刺の中身（$schema を除けば、Registry の server.json と同じ形）。 */
export function buildServerCard(origin: string) {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: MCP_SERVER_NAME,
    title: MCP_SERVER_TITLE,
    description: MCP_SERVER_DESCRIPTION,
    version: SERVER_INFO.version,
    websiteUrl: `${origin}/lp/ai/`,
    icons: [{ src: `${origin}/app_icon.png`, mimeType: 'image/png', sizes: '400x400' }],
    remotes: [{ type: 'streamable-http', url: `${origin}/api/mcp` }],
  }
}

/** ドメインの目録。いまは MCP サーバー 1 件だけを、名刺の URL で指す。 */
export function buildAiCatalog(origin: string) {
  const host = new URL(origin).host
  return {
    specVersion: '1.0',
    entries: [
      {
        identifier: `urn:air:${host}:mcp:leaf`,
        type: SERVER_CARD_MEDIA_TYPE,
        url: `${origin}${SERVER_CARD_PATH}`,
      },
    ],
  }
}

/** 仕様が MUST とする CORS（ブラウザ上のクライアントからも読めるように）。 */
export const CARD_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
}

/**
 * 名刺・目録の応答。仕様の SHOULD どおり 1 時間キャッシュさせ、ETag で 304 を返す。
 * OPTIONS には CORS だけを返す。
 */
export async function cardResponse(
  request: Request,
  body: unknown,
  mediaType: string,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CARD_CORS })

  const json = JSON.stringify(body)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  const etag = `"${[...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}"`
  const headers = {
    ...CARD_CORS,
    'cache-control': 'public, max-age=3600',
    etag,
  }
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(json, {
    status: 200,
    headers: { ...headers, 'content-type': `${mediaType}; charset=utf-8` },
  })
}
