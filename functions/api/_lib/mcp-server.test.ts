// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CloudBackup } from '../../../src/core/backup'
import type { Work } from '../../../src/core/schema'
import { addEdge, addNode, emptyStructure, type Structure } from '../../../src/core/structure'
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

const snapshot = (works: Work[] = [], structures: Structure[] = []): CloudBackup => ({
  version: 1,
  createdAt: 0,
  works,
  trash: [],
  profile: {},
  activity: [],
  ideas: [],
  structures,
})

/** スナップショットとバックアップを保持する fake deps（書き込み/復元の往復を検証できる）。 */
function makeDeps(initial: CloudBackup | null) {
  let snap = initial
  const backups = new Map<string, string>()
  let idSeq = 0
  const deps: McpDeps = {
    loadSnapshot: async () => snap,
    saveSnapshot: async (b) => {
      snap = b
      return true
    },
    createBackup: async () => {
      if (!snap) return null
      const createdAt = 1000 + idSeq
      const id = `${createdAt}-b${idSeq}`
      idSeq += 1
      backups.set(id, JSON.stringify(snap))
      return { id, createdAt }
    },
    listBackups: async () =>
      [...backups.keys()]
        .map((id) => ({ id, createdAt: Number(id.split('-')[0]) }))
        .sort((a, b) => b.createdAt - a.createdAt),
    restoreBackup: async (id) => {
      const p = backups.get(id)
      if (!p) return false
      snap = JSON.parse(p)
      return true
    },
    now: () => 100,
    genId: () => `gen-${idSeq++}`,
  }
  return { deps, get: () => snap }
}

const deps = (works: Work[] = [], structures: Structure[] = []) =>
  makeDeps(snapshot(works, structures)).deps

const call = (name: string, args?: Record<string, unknown>) =>
  ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as const

const contentText = (res: unknown) =>
  (res as { result: { content: { text: string }[] } }).result.content[0]?.text ?? ''
const isError = (res: unknown) => (res as { result: { isError?: boolean } }).result.isError === true

describe('handleMcpMessage — プロトコル', () => {
  it('initialize は serverInfo・要求版のエコー', async () => {
    const res = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      deps(),
    )) as { result: { protocolVersion: string; serverInfo: { name: string } } }
    expect(res.result.protocolVersion).toBe('2025-03-26')
    expect(res.result.serverInfo.name).toBe('novel-studio')
  })

  it('notifications/initialized は null', async () => {
    expect(
      await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps()),
    ).toBeNull()
  })

  it('tools/list は 13 ツール（読み4・書き6・バックアップ3）', async () => {
    const res = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      deps(),
    )) as {
      result: { tools: { name: string }[] }
    }
    const names = res.result.tools.map((t) => t.name)
    expect(MCP_TOOLS).toHaveLength(13)
    expect(names).toContain('set_episode')
    expect(names).toContain('upsert_glossary_entry')
    expect(names).toContain('set_structure')
    expect(names).toContain('create_backup')
    expect(names).toContain('restore_backup')
  })

  it('ping は空結果、未知メソッドは -32601', async () => {
    expect(
      (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }, deps())) as unknown,
    ).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    })
    const res = (await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'foo/bar' }, deps())) as {
      error: { code: number }
    }
    expect(res.error.code).toBe(-32601)
  })
})

describe('handleMcpMessage — 読み取り', () => {
  it('list_works は work_id / episode_id 付き一覧', async () => {
    const t = contentText(await handleMcpMessage(call('list_works'), deps([work()])))
    expect(t).toContain('[work_id: w1]')
    expect(t).toContain('[episode_id: e1]')
    expect(t).toContain('1話')
  })

  it('get_work は本文プレーンテキスト、未検出は isError', async () => {
    expect(
      contentText(await handleMcpMessage(call('get_work', { work_id: 'w1' }), deps([work()]))),
    ).toContain('夜が明けた。')
    expect(
      isError(await handleMcpMessage(call('get_work', { work_id: 'nope' }), deps([work()]))),
    ).toBe(true)
  })

  it('get_glossary / get_structures', async () => {
    const glossaryText = contentText(
      await handleMcpMessage(call('get_glossary', { work_id: 'w1' }), deps([work()])),
    )
    expect(glossaryText).toContain('アカリ')
    // upsert/delete の対象指定に使う entry_id が読み取り結果に出ること。
    expect(glossaryText).toContain('[entry_id: g1]')
    let chart = emptyStructure('c', 'w1', 'chart', 0)
    chart = addNode(chart, { id: 'n1', kind: 'character', label: '', glossaryRef: 'g1' })
    chart = addNode(chart, { id: 'n2', kind: 'character', label: '師匠' })
    chart = addEdge(chart, { id: 'e', from: 'n1', to: 'n2', label: '師弟', kind: 'relation' })
    const t = contentText(
      await handleMcpMessage(call('get_structures', { work_id: 'w1' }), deps([work()], [chart])),
    )
    expect(t).toContain('アカリ —（師弟）→ 師匠')
  })
})

describe('handleMcpMessage — 書き込み', () => {
  it('set_work_meta が反映され get_work に出る', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    await handleMcpMessage(call('set_work_meta', { work_id: 'w1', title: '新題' }), d)
    expect(contentText(await handleMcpMessage(call('get_work', { work_id: 'w1' }), d))).toContain(
      '# 新題',
    )
  })

  it('set_episode の本文が get_work に反映', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    await handleMcpMessage(
      call('set_episode', { work_id: 'w1', episode_id: 'e1', body: '新しい本文' }),
      d,
    )
    expect(contentText(await handleMcpMessage(call('get_work', { work_id: 'w1' }), d))).toContain(
      '新しい本文',
    )
  })

  it('add_episode は episode_id を返し 2 話になる', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    const res = await handleMcpMessage(call('add_episode', { work_id: 'w1', title: '第二話' }), d)
    expect(contentText(res)).toContain('episode_id:')
    expect(contentText(await handleMcpMessage(call('list_works'), d))).toContain('2話')
  })

  it('upsert / delete glossary が反映', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    await handleMcpMessage(call('upsert_glossary_entry', { work_id: 'w1', name: '師匠' }), d)
    expect(
      contentText(await handleMcpMessage(call('get_glossary', { work_id: 'w1' }), d)),
    ).toContain('師匠')
    await handleMcpMessage(call('delete_glossary_entry', { work_id: 'w1', entry_id: 'g1' }), d)
    expect(
      contentText(await handleMcpMessage(call('get_glossary', { work_id: 'w1' }), d)),
    ).not.toContain('アカリ')
  })

  it('set_structure（JSON）が反映、不正 JSON は isError', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    const s = { ...emptyStructure('s1', 'w1', 'mindmap', 0), title: '発想' }
    await handleMcpMessage(call('set_structure', { structure_json: JSON.stringify(s) }), d)
    expect(
      contentText(await handleMcpMessage(call('get_structures', { work_id: 'w1' }), d)),
    ).toContain('【マインドマップ: 発想】')
    expect(
      isError(await handleMcpMessage(call('set_structure', { structure_json: '{bad' }), d)),
    ).toBe(true)
  })

  it('未検出の作品への書き込みは isError', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    expect(
      isError(await handleMcpMessage(call('set_work_meta', { work_id: 'zzz', title: 'x' }), d)),
    ).toBe(true)
  })

  it('スナップショットが無ければ書き込みは isError', async () => {
    const { deps: d } = makeDeps(null)
    const res = await handleMcpMessage(call('set_work_meta', { work_id: 'w1', title: 'x' }), d)
    expect(isError(res)).toBe(true)
    expect(contentText(res)).toContain('ライブスナップショットがありません')
  })
})

describe('handleMcpMessage — バックアップ', () => {
  it('create → list → restore の往復', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    // タイトルを変えてからバックアップ
    await handleMcpMessage(call('set_work_meta', { work_id: 'w1', title: 'v1' }), d)
    const created = await handleMcpMessage(call('create_backup'), d)
    expect(contentText(created)).toContain('backup_id:')
    const list = contentText(await handleMcpMessage(call('list_backups'), d))
    expect(list).toContain('backup_id:')
    // タイトルを更に変え、バックアップに戻すと v1 に戻る
    await handleMcpMessage(call('set_work_meta', { work_id: 'w1', title: 'v2' }), d)
    const id = list.match(/backup_id: (\S+)]/)?.[1] as string
    await handleMcpMessage(call('restore_backup', { backup_id: id }), d)
    expect(contentText(await handleMcpMessage(call('get_work', { work_id: 'w1' }), d))).toContain(
      '# v1',
    )
  })

  it('list_backups は空を明示、restore_backup は未検出で isError', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    expect(contentText(await handleMcpMessage(call('list_backups'), d))).toContain('まだありません')
    expect(isError(await handleMcpMessage(call('restore_backup', { backup_id: 'x' }), d))).toBe(
      true,
    )
  })
})
