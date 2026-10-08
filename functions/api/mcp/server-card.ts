/// <reference types="@cloudflare/workers-types" />
/**
 * /api/mcp/server-card — MCP Server Card（SEP-2127）。認証なしで誰でも読める名刺で、
 * 名前・説明・版・接続先だけを返す（利用者のデータは一切含まない）。
 * ドメインの目録 /.well-known/ai-catalog.json（functions/_middleware.ts）がここを指す。
 * 中身と応答の作法は `_lib/server-card.ts`。
 */

import { buildServerCard, cardResponse, SERVER_CARD_MEDIA_TYPE } from '../_lib/server-card'

const respond: PagesFunction = async (context) =>
  cardResponse(
    context.request,
    buildServerCard(new URL(context.request.url).origin),
    SERVER_CARD_MEDIA_TYPE,
  )

export const onRequestGet = respond
export const onRequestOptions = respond
