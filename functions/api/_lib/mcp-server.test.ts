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

  // 器の住み分け（用語集は公開・世界観設定は非公開）を知らせるのは instructions が唯一の場所。
  // ここが落ちると AI が設定を用語集へ書き戻すので、初期化の応答に載ることを固定する。
  it('initialize は器の住み分けを instructions で渡す', async () => {
    const res = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      deps(),
    )) as { result: { instructions?: string } }
    const text = res.result.instructions ?? ''
    expect(text).toContain('get_world')
    expect(text).toContain('set_world_note')
    expect(text).toMatch(/用語集[\s\S]*読者にも見え/)
  })

  it('notifications/initialized は null', async () => {
    expect(
      await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps()),
    ).toBeNull()
  })

  /**
   * 改修前から公開している 27 本。**この一覧から名前が消える変更は通してはいけない**
   * （接続済みのホストは tools/list をキャッシュしているので、名前が変わると呼べなくなる）。
   */
  const TOOLS_BEFORE_INDEXING = [
    'list_works',
    'get_work',
    'get_glossary',
    'get_structures',
    'get_plot',
    'get_world',
    'set_work_meta',
    'set_episode',
    'add_episode',
    'create_work',
    'set_outline',
    'upsert_glossary_entry',
    'delete_glossary_entry',
    'set_structure',
    'set_plot_meta',
    'upsert_plot_section',
    'upsert_plot_beat',
    'delete_plot_beat',
    'upsert_plot_line',
    'upsert_foreshadow',
    'upsert_secret',
    'delete_plot_item',
    'set_world_note',
    'delete_world_note',
    'create_backup',
    'list_backups',
    'restore_backup',
  ]

  it('tools/list は 31 ツール（読み10・書き18・バックアップ3）', async () => {
    const res = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      deps(),
    )) as {
      result: { tools: { name: string }[] }
    }
    const names = res.result.tools.map((t) => t.name)
    expect(MCP_TOOLS).toHaveLength(31)
    expect(names).toEqual(expect.arrayContaining(TOOLS_BEFORE_INDEXING))
    // 索引ツール（軽い読み口）は 4 本。
    expect(names).toContain('get_work_map')
    expect(names).toContain('list_glossary_entries')
    expect(names).toContain('list_world_notes')
    expect(names).toContain('list_plot_beats')
  })

  it('引数を足しても required は増やさず、未知キーは受け付けないまま', () => {
    // 旧クライアントは新しい引数を知らないまま呼ぶ。必須化すると、その瞬間に呼べなくなる。
    const required = (n: string) =>
      (MCP_TOOLS.find((t) => t.name === n)?.inputSchema as { required?: string[] }).required ?? []
    expect(required('get_work')).toEqual(['work_id'])
    expect(required('get_glossary')).toEqual(['work_id'])
    expect(required('get_world')).toEqual(['work_id'])
    expect(required('get_plot')).toEqual(['work_id'])
    expect(required('get_structures')).toEqual(['work_id'])
    expect(required('list_works')).toEqual([])
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
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

  it('create_work は work_id を返し、list_works・set_episode 経路で使える', async () => {
    const { deps: d } = makeDeps(snapshot([]))
    const res = contentText(
      await handleMcpMessage(call('create_work', { title: '新作', author: '星野' }), d),
    )
    expect(res).toContain('work_id: gen-0')
    const list = contentText(await handleMcpMessage(call('list_works'), d))
    expect(list).toContain('新作')
    expect(list).toContain('（著者: 星野）')
    // 追加した作品に話を足せる（作成 → 執筆開始の一連の流れ）
    const added = contentText(
      await handleMcpMessage(call('add_episode', { work_id: 'gen-0', title: '第一話' }), d),
    )
    expect(added).toContain('episode_id:')
  })

  it('create_work はタイトル空を isError で弾く', async () => {
    const res = await handleMcpMessage(call('create_work', { title: '  ' }), deps([]))
    expect(isError(res)).toBe(true)
  })

  it('set_outline は階層付きメモを書き込み、get_structures に反映される', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    const notes = '起：夜明けの描写\n  - 主人公の紹介\n    伏線：時計\n転：事件発生'
    const res = await handleMcpMessage(
      call('set_outline', { work_id: 'w1', episode_id: 'e1', notes }),
      d,
    )
    expect(isError(res)).toBe(false)
    const t = contentText(await handleMcpMessage(call('get_structures', { work_id: 'w1' }), d))
    expect(t).toContain('- 起：夜明けの描写')
    expect(t).toContain('      - 主人公の紹介') // 1 段（インデント 2 半角スペース）
    expect(t).toContain('         - 伏線：時計') // 2 段
    expect(t).toContain('- 転：事件発生')
    // 空文字で全消去できる
    await handleMcpMessage(call('set_outline', { work_id: 'w1', episode_id: 'e1', notes: '' }), d)
    const cleared = contentText(
      await handleMcpMessage(call('get_structures', { work_id: 'w1' }), d),
    )
    expect(cleared).not.toContain('夜明けの描写')
  })

  it('set_outline は未知の話を isError で弾く', async () => {
    const res = await handleMcpMessage(
      call('set_outline', { work_id: 'w1', episode_id: 'zzz', notes: 'a' }),
      deps([work()]),
    )
    expect(isError(res)).toBe(true)
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

describe('プロットツール（get_plot / set_plot_meta / upsert_* / delete_*）', () => {
  it('get_plot はプロットが無ければ作成方法の案内文を返す', async () => {
    const res = await handleMcpMessage(call('get_plot', { work_id: 'w1' }), deps([work()]))
    expect(isError(res)).toBe(false)
    expect(contentText(res)).toContain('set_plot_meta')
  })

  it('set_plot_meta →幕→ビート→ライン→伏線の一連の書き込みが get_plot に反映される', async () => {
    const env = makeDeps(snapshot([work()]))
    const d = env.deps
    // 作成（決定的 id へ収束）
    let res = await handleMcpMessage(
      call('set_plot_meta', { work_id: 'w1', premise: '届くはずのない手紙の話' }),
      d,
    )
    expect(isError(res)).toBe(false)
    expect(env.get()?.plots?.[0]?.id).toBe('w1:plot')
    // 幕
    res = await handleMcpMessage(call('upsert_plot_section', { work_id: 'w1', title: '第一幕' }), d)
    const sectionId = /section_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
    expect(sectionId).not.toBe('')
    // ビート（幕が1つだけなので section_id 省略可）
    res = await handleMcpMessage(
      call('upsert_plot_beat', {
        work_id: 'w1',
        title: '手紙が届く',
        summary: '十年ぶりの手紙。差出人は故人。',
        pov: 'g1',
        status: 'fixed',
        target_length: 8000,
        episode_id: 'e1',
      }),
      d,
    )
    expect(isError(res)).toBe(false)
    const beatId = /beat_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
    // ライン → ビートへ割り当て（渡した項目だけ書き換え）
    res = await handleMcpMessage(call('upsert_plot_line', { work_id: 'w1', title: 'メイン' }), d)
    const lineId = /line_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
    res = await handleMcpMessage(
      call('upsert_plot_beat', { work_id: 'w1', id: beatId, line_ids: [lineId] }),
      d,
    )
    expect(isError(res)).toBe(false)
    // 伏線（張るだけ＝未回収）
    res = await handleMcpMessage(
      call('upsert_foreshadow', { work_id: 'w1', title: '手紙の署名', plant_beat_id: beatId }),
      d,
    )
    expect(isError(res)).toBe(false)

    const text = contentText(await handleMcpMessage(call('get_plot', { work_id: 'w1' }), d))
    expect(text).toContain('ログライン: 届くはずのない手紙の話')
    expect(text).toContain(`[section_id: ${sectionId}]`)
    expect(text).toContain('[確定] 手紙が届く')
    expect(text).toContain('視点: アカリ') // 用語集名へ解決
    expect(text).toContain('ライン: メイン')
    expect(text).toContain('対応話: 第一話')
    expect(text).toContain('[未回収] 手紙の署名')
  })

  it('不正な指定はドメインエラー（isError）で返し、以降の操作を壊さない', async () => {
    const env = makeDeps(snapshot([work()]))
    const d = env.deps
    // プロット未作成でビート追加 → set_plot_meta への誘導
    let res = await handleMcpMessage(call('upsert_plot_beat', { work_id: 'w1', title: 'x' }), d)
    expect(isError(res)).toBe(true)
    expect(contentText(res)).toContain('set_plot_meta')
    await handleMcpMessage(call('set_plot_meta', { work_id: 'w1', title: '本編プロット' }), d)
    // 幕なしでのビート追加は幕作成へ誘導
    res = await handleMcpMessage(call('upsert_plot_beat', { work_id: 'w1', title: 'x' }), d)
    expect(isError(res)).toBe(true)
    await handleMcpMessage(call('upsert_plot_section', { work_id: 'w1', title: '第一幕' }), d)
    // 不正 status
    res = await handleMcpMessage(
      call('upsert_plot_beat', { work_id: 'w1', title: 'x', status: 'invalid' }),
      d,
    )
    expect(isError(res)).toBe(true)
    // 存在しないビートの削除
    res = await handleMcpMessage(call('delete_plot_beat', { work_id: 'w1', beat_id: 'nope' }), d)
    expect(isError(res)).toBe(true)
    // 最後の1幕は削除不可
    const sectionId = env.get()?.plots?.[0]?.sections[0]?.id ?? ''
    res = await handleMcpMessage(
      call('delete_plot_item', { work_id: 'w1', kind: 'section', item_id: sectionId }),
      d,
    )
    expect(isError(res)).toBe(true)
    // kind 不正
    res = await handleMcpMessage(
      call('delete_plot_item', { work_id: 'w1', kind: 'beat', item_id: 'x' }),
      d,
    )
    expect(isError(res)).toBe(true)
  })

  it('delete_plot_item は幕のビートを隣の幕へ逃がす', async () => {
    const env = makeDeps(snapshot([work()]))
    const d = env.deps
    await handleMcpMessage(call('set_plot_meta', { work_id: 'w1', title: '本編' }), d)
    const sec = async (title: string) =>
      /section_id: (\S+)/.exec(
        contentText(
          await handleMcpMessage(call('upsert_plot_section', { work_id: 'w1', title }), d),
        ),
      )?.[1] ?? ''
    const s1 = await sec('第一幕')
    const s2 = await sec('第二幕')
    const res = await handleMcpMessage(
      call('upsert_plot_beat', { work_id: 'w1', section_id: s2, title: '逃がすビート' }),
      d,
    )
    const beatId = /beat_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
    await handleMcpMessage(
      call('delete_plot_item', { work_id: 'w1', kind: 'section', item_id: s2 }),
      d,
    )
    const plot = env.get()?.plots?.[0]
    expect(plot?.sections.map((s) => s.id)).toEqual([s1])
    expect(plot?.sections[0]?.beatIds).toContain(beatId)
    expect(plot?.beats.some((b) => b.id === beatId)).toBe(true)
  })
})

describe('秘密ツール（upsert_secret / delete_plot_item kind:secret）', () => {
  /** 幕1つ＋ビート1つのプロットを作り、その beat_id を返す。 */
  const seedPlot = async (d: McpDeps) => {
    await handleMcpMessage(call('set_plot_meta', { work_id: 'w1', title: '本編' }), d)
    await handleMcpMessage(call('upsert_plot_section', { work_id: 'w1', title: '第一幕' }), d)
    const res = await handleMcpMessage(
      call('upsert_plot_beat', { work_id: 'w1', title: '正体が明かされる' }),
      d,
    )
    return /beat_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
  }

  it('秘密は開示ビート未設定だと [開示未定]、設定すると [開示予定] で get_plot に出る', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    const beatId = await seedPlot(d)
    let res = await handleMcpMessage(
      call('upsert_secret', { work_id: 'w1', title: 'ユキの正体', truth: '三年前に死んだ妹' }),
      d,
    )
    expect(isError(res)).toBe(false)
    const secretId = /secret_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
    let text = contentText(await handleMcpMessage(call('get_plot', { work_id: 'w1' }), d))
    expect(text).toContain('[開示未定] ユキの正体')
    expect(text).toContain('真相: 三年前に死んだ妹')

    res = await handleMcpMessage(
      call('upsert_secret', { work_id: 'w1', id: secretId, reveal_beat_id: beatId }),
      d,
    )
    expect(isError(res)).toBe(false)
    text = contentText(await handleMcpMessage(call('get_plot', { work_id: 'w1' }), d))
    expect(text).toContain('[開示予定] ユキの正体')
    expect(text).toContain('読者に明かす: 正体が明かされる')
  })

  it('keep_hidden で点検対象から外れ、開示ビートを決めると印は下りる', async () => {
    const env = makeDeps(snapshot([work()]))
    const d = env.deps
    const beatId = await seedPlot(d)
    const res = await handleMcpMessage(
      call('upsert_secret', { work_id: 'w1', title: '語り手の正体', keep_hidden: true }),
      d,
    )
    const secretId = /secret_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
    expect(contentText(await handleMcpMessage(call('get_plot', { work_id: 'w1' }), d))).toContain(
      '[明かさない] 語り手の正体',
    )
    await handleMcpMessage(
      call('upsert_secret', { work_id: 'w1', id: secretId, reveal_beat_id: beatId }),
      d,
    )
    expect(env.get()?.plots?.[0]?.secrets[0]?.keepHidden).toBeUndefined()
  })

  it('不正な指定は isError（存在しない開示ビート・存在しない secret_id・title なし）', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    await seedPlot(d)
    expect(
      isError(
        await handleMcpMessage(
          call('upsert_secret', { work_id: 'w1', title: 'x', reveal_beat_id: 'nope' }),
          d,
        ),
      ),
    ).toBe(true)
    expect(
      isError(await handleMcpMessage(call('upsert_secret', { work_id: 'w1', id: 'nope' }), d)),
    ).toBe(true)
    expect(isError(await handleMcpMessage(call('upsert_secret', { work_id: 'w1' }), d))).toBe(true)
  })

  it('delete_plot_item kind:secret で削除できる', async () => {
    const env = makeDeps(snapshot([work()]))
    const d = env.deps
    await seedPlot(d)
    const res = await handleMcpMessage(call('upsert_secret', { work_id: 'w1', title: '秘密' }), d)
    const secretId = /secret_id: (\S+)/.exec(contentText(res))?.[1] ?? ''
    await handleMcpMessage(
      call('delete_plot_item', { work_id: 'w1', kind: 'secret', item_id: secretId }),
      d,
    )
    expect(env.get()?.plots?.[0]?.secrets).toHaveLength(0)
  })
})

describe('世界観設定ツール（get_world / set_world_note / delete_world_note）', () => {
  it('プロットが無い作品でも書ける（決め事はプロットより先に決まる）', async () => {
    const { deps: d, get } = makeDeps(snapshot([work()]))
    const res = await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'rules', body: '死者は生き返らない' }),
      d,
    )
    expect(isError(res)).toBe(false)
    expect(contentText(res)).toContain('note_id:')
    expect(get()?.plots?.[0]?.world).toHaveLength(1)

    const read = await handleMcpMessage(call('get_world', { work_id: 'w1' }), d)
    expect(contentText(read)).toContain('この作品の約束事')
    expect(contentText(read)).toContain('死者は生き返らない')
    expect(contentText(read)).toContain('公開されません')
  })

  it('同じ定型枠へ書き直すと上書きされる（枠が増えない）', async () => {
    const { deps: d, get } = makeDeps(snapshot([work()]))
    await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'style', body: '一人称' }),
      d,
    )
    await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'style', body: '一人称・現在形' }),
      d,
    )
    expect(get()?.plots?.[0]?.world).toHaveLength(1)
    expect(get()?.plots?.[0]?.world?.[0]?.body).toBe('一人称・現在形')
  })

  it('自由枠は title 必須、未知の slot は弾く', async () => {
    const d = deps([work()])
    const noTitle = await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'custom', body: 'x' }),
      d,
    )
    expect(isError(noTitle)).toBe(true)
    expect(contentText(noTitle)).toContain('title')

    const badSlot = await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'nope', body: 'x' }),
      d,
    )
    expect(isError(badSlot)).toBe(true)
  })

  it('body を空文字にすると枠ごと消える', async () => {
    const { deps: d, get } = makeDeps(snapshot([work()]))
    await handleMcpMessage(call('set_world_note', { work_id: 'w1', slot: 'rules', body: 'x' }), d)
    const res = await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'rules', body: '' }),
      d,
    )
    expect(contentText(res)).toContain('削除')
    expect(get()?.plots?.[0]?.world).toEqual([])
  })

  it('delete_world_note は note_id 指定で消し、無い id はエラー', async () => {
    const { deps: d, get } = makeDeps(snapshot([work()]))
    const saved = await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'history', body: '年表' }),
      d,
    )
    const noteId = /note_id: (\S+)/.exec(contentText(saved))?.[1] ?? ''
    expect(noteId).not.toBe('')
    expect(
      isError(
        await handleMcpMessage(call('delete_world_note', { work_id: 'w1', note_id: 'nope' }), d),
      ),
    ).toBe(true)
    await handleMcpMessage(call('delete_world_note', { work_id: 'w1', note_id: noteId }), d)
    expect(get()?.plots?.[0]?.world).toEqual([])
  })

  it('世界観設定が未記入なら、用語集ではなくここへ書くよう促す', async () => {
    const d = deps([work()])
    expect(
      contentText(await handleMcpMessage(call('get_glossary', { work_id: 'w1' }), d)),
    ).toContain('set_world_note')
    // プロット側も同じ案内を先頭に出す
    expect(contentText(await handleMcpMessage(call('get_plot', { work_id: 'w1' }), d))).toContain(
      'set_world_note',
    )
  })

  // 「作品を触る前に決め事を読む」は本文・構造にも要る。読み取りの先頭に導線を置いてある。
  it('本文・構造の読み取りにも世界観設定への導線が出る', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'style', body: '一人称・現在形' }),
      d,
    )
    for (const tool of ['get_work', 'get_structures']) {
      const out = contentText(await handleMcpMessage(call(tool, { work_id: 'w1' }), d))
      expect(out).toContain('get_world')
      // 本体（本文・構造）はそのまま続く＝導線を足しただけで中身は削らない
      expect(out.length).toBeGreaterThan('get_world'.length)
    }
  })

  it('本文の書き込みツールの説明が get_world を指す', () => {
    const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)?.description ?? ''
    expect(byName('set_episode')).toContain('get_world')
    expect(byName('add_episode')).toContain('get_world')
    expect(byName('get_work')).toContain('get_world')
    expect(byName('get_structures')).toContain('get_world')
  })

  it('世界観設定があれば get_plot の先頭に丸ごと載る（読み落とさせない）', async () => {
    const { deps: d } = makeDeps(snapshot([work()]))
    await handleMcpMessage(
      call('set_world_note', { work_id: 'w1', slot: 'forbidden', body: '神視点を書かない' }),
      d,
    )
    const plotText = contentText(await handleMcpMessage(call('get_plot', { work_id: 'w1' }), d))
    expect(plotText.indexOf('神視点を書かない')).toBeGreaterThanOrEqual(0)
    expect(plotText.indexOf('神視点を書かない')).toBeLessThan(plotText.indexOf('【プロット】'))
    // 用語集側は件数の案内だけ（本体は get_world に取りに行かせる）
    const glossaryText = contentText(
      await handleMcpMessage(call('get_glossary', { work_id: 'w1' }), d),
    )
    expect(glossaryText).toContain('get_world')
    expect(glossaryText).not.toContain('神視点を書かない')
  })

  it('用語集の作者メモは保存され、非公開の見出し付きで読み出される', async () => {
    const { deps: d, get } = makeDeps(snapshot([work()]))
    await handleMcpMessage(
      call('upsert_glossary_entry', {
        work_id: 'w1',
        id: 'g1',
        name: 'アカリ',
        author_note: '正体は管理AI',
      }),
      d,
    )
    expect(get()?.works[0]?.glossary?.[0]?.authorNote).toBe('正体は管理AI')
    const text = contentText(await handleMcpMessage(call('get_glossary', { work_id: 'w1' }), d))
    expect(text).toContain('作者メモ（非公開）')
    expect(text).toContain('正体は管理AI')
  })
})
