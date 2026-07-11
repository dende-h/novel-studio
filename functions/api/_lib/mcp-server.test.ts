// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Work } from '../../../src/core/schema'
import { handleMcpMessage, MCP_TOOLS, type McpDeps } from './mcp-server'

const work = (over: Partial<Work> = {}): Work => ({
  id: 'w1',
  title: '銀河の終わり',
  author: '星野',
  episodes: [
    {
      id: 'e1',
      title: '第一話',
      blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: '夜が明けた。' }] }],
    },
  ],
  glossary: [
    { id: 'g1', name: 'アカリ', aliases: [], summary: '主人公', createdAt: 1, updatedAt: 1 },
  ],
  ...over,
})

const deps = (works: Work[]): McpDeps => ({ loadWorks: async () => works })
const call = (name: string, args?: Record<string, unknown>) =>
  ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as const

// tools/call 結果からテキストを取り出す小ヘルパ。
const contentText = (res: unknown) =>
  (res as { result: { content: { text: string }[] } }).result.content[0]?.text ?? ''

describe('handleMcpMessage', () => {
  it('initialize は serverInfo と tools capability・要求版のエコーを返す', async () => {
    const res = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      deps([]),
    )) as {
      result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } }
    }
    expect(res.result.protocolVersion).toBe('2025-03-26')
    expect(res.result.capabilities).toEqual({ tools: {} })
    expect(res.result.serverInfo.name).toBe('novel-studio')
  })

  it('notifications/initialized は応答しない（null）', async () => {
    expect(
      await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps([])),
    ).toBeNull()
  })

  it('tools/list は read-only 3 ツールを返す', async () => {
    const res = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      deps([]),
    )) as { result: { tools: { name: string }[] } }
    expect(res.result.tools.map((t) => t.name)).toEqual(['list_works', 'get_work', 'get_glossary'])
    expect(MCP_TOOLS).toHaveLength(3)
  })

  it('list_works は id 付き一覧を返す', async () => {
    const res = await handleMcpMessage(call('list_works'), deps([work()]))
    const t = contentText(res)
    expect(t).toContain('[id: w1]')
    expect(t).toContain('1話')
  })

  it('list_works は作品ゼロなら空を明示する', async () => {
    expect(contentText(await handleMcpMessage(call('list_works'), deps([])))).toContain(
      '作品はまだありません',
    )
  })

  it('get_work は本文プレーンテキストを返す', async () => {
    const res = await handleMcpMessage(call('get_work', { work_id: 'w1' }), deps([work()]))
    const t = contentText(res)
    expect(t).toContain('# 銀河の終わり')
    expect(t).toContain('夜が明けた。')
  })

  it('get_work は未検出を isError で返す（例外にしない）', async () => {
    const res = (await handleMcpMessage(call('get_work', { work_id: 'nope' }), deps([work()]))) as {
      result: { isError?: boolean }
    }
    expect(res.result.isError).toBe(true)
    expect(contentText(res)).toContain('見つかりません')
  })

  it('get_glossary は図鑑テキストを返し、空なら空を明示する', async () => {
    expect(
      contentText(await handleMcpMessage(call('get_glossary', { work_id: 'w1' }), deps([work()]))),
    ).toContain('アカリ')
    const empty = await handleMcpMessage(
      call('get_glossary', { work_id: 'w1' }),
      deps([work({ glossary: [] })]),
    )
    expect(contentText(empty)).toContain('図鑑は空です')
  })

  it('ping は空結果、未知メソッド（id あり）は -32601', async () => {
    expect(
      (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }, deps([]))) as unknown,
    ).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    })
    const res = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'foo/bar' },
      deps([]),
    )) as { error: { code: number } }
    expect(res.error.code).toBe(-32601)
  })
})
