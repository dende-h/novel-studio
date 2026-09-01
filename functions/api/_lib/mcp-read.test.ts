// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FULL_BYTES,
  DEFAULT_INDEX_BYTES,
  DEFAULT_TEXT_BYTES,
  utf8Bytes,
} from '../../../src/core/mcp-read'
import type { Work } from '../../../src/core/schema'
import { handleMcpMessage } from './mcp-server'
import {
  callMsg,
  fatSnapshot,
  fixturePlot,
  fixtureSnapshot,
  fixtureWork,
  makeReadDeps,
  resultIsError,
  resultStructured,
  resultText,
} from './mcp-test-util'

/**
 * 読み取りの索引・絞り込み・応答予算。
 *
 * 直したい事故：作品が育つとホスト側の応答サイズ上限に当たり、**中身を一度も見られない**まま
 * 捨てられる（Genspark 実測：世界観設定 140,000 バイト・用語集 210,000 バイトが破棄）。
 * ここで固定するのは「索引から id を得て中身に辿り着けること」と
 * 「予算を超えても必ず何かが返り、次の一手が本文に書いてあること」。
 */

const call = async (
  name: string,
  args?: Record<string, unknown>,
  limits?: { maxBytes?: number; indexMaxBytes?: number },
) => {
  const { deps, saveCount } = makeReadDeps(fixtureSnapshot(), limits)
  const res = await handleMcpMessage(callMsg(name, args), deps)
  return {
    text: resultText(res),
    isError: resultIsError(res),
    structured: resultStructured(res),
    saveCount: saveCount(),
  }
}

describe('索引 → 個別取得（読み書きの粒度を揃える）', () => {
  it('list_glossary_entries は本文を含まない索引を返し、そこから全文へ辿れる', async () => {
    const index = await call('list_glossary_entries', { work_id: 'w1' })
    expect(index.isError).toBe(false)
    expect(index.text).toContain('[entry_id: g1]')
    expect(index.text).toContain('公開情報 7字')
    // 本文（公開情報・作者メモ）は索引に載せない。
    expect(index.text).not.toContain('灯台守の少女。')
    expect(index.text).not.toContain('実は星の欠片から生まれた。')

    const one = await call('get_glossary', { work_id: 'w1', entry_id: 'g1' })
    expect(one.text).toContain('灯台守の少女。')
    expect(one.text).toContain('実は星の欠片から生まれた。')
  })

  it('索引の id を全部たどると全量と同じ集合になり、1 件ずつの本文も全量と文字列一致する', async () => {
    const full = await call('get_glossary', { work_id: 'w1' })
    const index = await call('list_glossary_entries', { work_id: 'w1' })
    const ids = (index.structured?.entries as { entry_id: string }[]).map((e) => e.entry_id)
    expect(ids).toEqual(['g1', 'g2', 'g3'])

    for (const id of ids) {
      const one = await call('get_glossary', { work_id: 'w1', entry_id: id })
      // 全量出力から見出しブロックを切り出し、id 指定の出力と 1 文字も違わないことを見る
      // ＝索引経由で分類・よみ・別名・作者メモが落ちない。
      const block = one.text.split('# 用語集\n\n')[1]
      expect(full.text).toContain(block)
    }
  })

  it('entry_ids で複数件をまとめて取れる（往復を減らす）', async () => {
    const res = await call('get_glossary', { work_id: 'w1', entry_ids: ['g1', 'g3'] })
    expect(res.text).toContain('[entry_id: g1]')
    expect(res.text).toContain('[entry_id: g3]')
    expect(res.text).not.toContain('[entry_id: g2]')
  })

  it('list_world_notes は未記入の枠も出し、note_id から全文へ辿れる', async () => {
    const index = await call('list_world_notes', { work_id: 'w1' })
    expect(index.text).toContain('[slot: stage, note_id: wn1]')
    expect(index.text).toContain('まだ書かれていない枠')
    expect(index.text).toContain('[slot: rules]')

    const one = await call('get_world', { work_id: 'w1', note_id: 'wn1' })
    expect(one.text).toContain('星の消えた海辺の町。時代は近代に近い。')
    expect(one.text).not.toContain('青は喪失、金は継承を表す。')
  })

  it('get_world は slots で複数の枠だけ返す', async () => {
    const res = await call('get_world', { work_id: 'w1', slots: ['style', 'custom'] })
    expect(res.text).toContain('[slot: style, note_id: wn2]')
    expect(res.text).toContain('[slot: custom, note_id: wn3]')
    expect(res.text).not.toContain('[slot: stage')
  })

  it('list_plot_beats は要約本文を含まず、section_id から幕の中身へ辿れる', async () => {
    const index = await call('list_plot_beats', { work_id: 'w1' })
    expect(index.text).toContain('[beat_id: bt1]')
    expect(index.text).toContain('要約 19字')
    expect(index.text).not.toContain('アカリが空から星が消えたことに気づく。')
    expect(index.text).toContain('伏線 1件 ／ 秘密 1件')

    const section = await call('get_plot', { work_id: 'w1', section_id: 's1' })
    expect(section.text).toContain('アカリが空から星が消えたことに気づく。')
    expect(section.text).not.toContain('[section_id: s2]')
  })

  it('get_plot は beat_ids でビート単位に絞れる（幕の通し番号は変わらない）', async () => {
    const res = await call('get_plot', { work_id: 'w1', beat_ids: ['bt2'] })
    expect(res.text).toContain('2. [執筆中] 訪問者 [beat_id: bt2]')
    expect(res.text).not.toContain('[beat_id: bt1]')
  })

  it('get_work は episode_id で 1 話だけ返す', async () => {
    const res = await call('get_work', { work_id: 'w1', episode_id: 'e2' })
    expect(res.text).toContain('## 第二話 海')
    expect(res.text).not.toContain('## 第一話 灯台')
    // 作品の見出しは全話ぶんと同じ形で残す。
    expect(res.text).toContain('# 星のない空')
  })

  it('get_structures は kind で種別を絞れる', async () => {
    const res = await call('get_structures', { work_id: 'w1', kind: 'chart' })
    expect(res.text).toContain('【相関図】')
    expect(res.text).not.toContain('【アウトライン】')
  })

  it('get_work_map は各器の件数と次の呼び出しの実例を返す', async () => {
    const res = await call('get_work_map', { work_id: 'w1' })
    expect(res.text).toContain('用語集: 3項目')
    expect(res.text).toContain('世界観設定: 3項目')
    expect(res.text).toContain('list_glossary_entries(work_id="w1")')
    expect(res.text).toContain('max_bytes=0')
    expect(utf8Bytes(res.text)).toBeLessThanOrEqual(8_000)
    expect(res.structured?.glossary_entries).toBe(3)
  })

  it('絞り込みは query（名前・別名・よみ）と category で効く', async () => {
    const byQuery = await call('list_glossary_entries', { work_id: 'w1', query: '灯の子' })
    expect(byQuery.text).toContain('[entry_id: g1]')
    expect(byQuery.text).not.toContain('[entry_id: g2]')

    const byCategory = await call('get_glossary', { work_id: 'w1', category: '場所' })
    expect(byCategory.text).toContain('[entry_id: g2]')
    expect(byCategory.text).not.toContain('[entry_id: g1]')
  })

  it('世界観も索引→note_id→全文が文字列一致する（用語集と同じ強度で）', async () => {
    const full = await call('get_world', { work_id: 'w1' })
    const index = await call('list_world_notes', { work_id: 'w1' })
    const ids = (index.structured?.notes as { note_id: string }[]).map((n) => n.note_id)
    expect(ids).toEqual(['wn1', 'wn2', 'wn3'])
    for (const id of ids) {
      const one = await call('get_world', { work_id: 'w1', note_id: id })
      // 見出し行から末尾までが、全量出力にそのまま含まれること。
      const block = one.text.split('\n\n').slice(2).join('\n\n')
      expect(full.text).toContain(block)
    }
  })

  it('プロットも索引→beat_id→中身が文字列一致する', async () => {
    const full = await call('get_plot', { work_id: 'w1' })
    const index = await call('list_plot_beats', { work_id: 'w1' })
    const sections = index.structured?.sections as { beats: { beat_id: string }[] }[]
    const ids = sections.flatMap((sec) => sec.beats.map((b) => b.beat_id))
    expect(ids).toEqual(['bt1', 'bt2', 'bt3'])
    for (const id of ids) {
      const one = await call('get_plot', { work_id: 'w1', beat_ids: [id] })
      const block = one.text.split('\n').filter((l) => l.includes(`[beat_id: ${id}]`))[0] as string
      expect(full.text).toContain(block)
    }
  })

  it('読み取りはスナップショットを保存しない（書き込みに紛れていない）', async () => {
    for (const name of [
      'get_work',
      'get_glossary',
      'get_world',
      'get_plot',
      'get_structures',
      'get_work_map',
      'list_glossary_entries',
      'list_world_notes',
      'list_plot_beats',
    ]) {
      expect((await call(name, { work_id: 'w1' })).saveCount).toBe(0)
    }
  })
})

describe('応答予算（大きすぎて読めない、を無くす）', () => {
  /** 育った作品（実際に事故が起きた規模）を、**既定の予算のまま**通す。 */
  const fat = async (name: string, args?: Record<string, unknown>) => {
    const { deps } = makeReadDeps(fatSnapshot())
    const res = await handleMcpMessage(callMsg(name, args), deps)
    return { text: resultText(res), isError: resultIsError(res) }
  }

  const READ_TOOLS = [
    'get_work',
    'get_glossary',
    'get_world',
    'get_plot',
    'get_structures',
    'get_work_map',
    'list_works',
    'list_glossary_entries',
    'list_world_notes',
    'list_plot_beats',
  ]

  it('育った作品でも、どの読み取りツールも既定の予算を超えない（索引そのものが溢れない）', async () => {
    // 直したい事故の再発検査。縮退させた索引が予算を超えたら、ホストはまたそれを捨てる。
    const { deps } = makeReadDeps(
      fatSnapshot({ episodes: 200, glossary: 2000, worldNotes: 500, beats: 1500 }),
    )
    for (const name of READ_TOOLS) {
      const res = await handleMcpMessage(callMsg(name, { work_id: 'w1' }), deps)
      const body = resultText(res)
      expect(resultIsError(res), name).toBe(false)
      expect(body, name).not.toBe('')
      expect(utf8Bytes(body), name).toBeLessThanOrEqual(DEFAULT_TEXT_BYTES)
      if (name !== 'get_work') {
        expect(utf8Bytes(body), name).toBeLessThanOrEqual(DEFAULT_FULL_BYTES)
      }
    }
  })

  it('予算を超えると索引に落ち、次の一手と復旧線が本文に出る（isError にはしない）', async () => {
    const res = await fat('get_glossary', { work_id: 'w1' })
    expect(res.isError).toBe(false)
    expect(res.text).toContain('truncated=true')
    expect(res.text).toContain('[entry_id: g0]')
    expect(res.text).not.toContain('い'.repeat(300))
    // 復旧線には既存ツール名＋引数を必ず書く（新ツールが見えないホストで行き止まりにしない）。
    expect(res.text).toContain('get_glossary(work_id="w1", entry_id="g0")')
    expect(res.text).toContain('get_glossary(work_id="w1", max_bytes=0)')
  })

  it('max_bytes=0 なら無制限＝改修前とまったく同じ全量が返る（全ツール）', async () => {
    for (const name of ['get_work', 'get_glossary', 'get_world', 'get_plot']) {
      const limited = await fat(name, { work_id: 'w1' })
      const unlimited = await fat(name, { work_id: 'w1', max_bytes: 0 })
      expect(limited.text, name).toContain('truncated=true')
      expect(unlimited.text, name).not.toContain('truncated=true')
      expect(utf8Bytes(unlimited.text), name).toBeGreaterThan(utf8Bytes(limited.text))
    }
  })

  it('縮退した get_plot でも世界観設定の枠（slot・note_id・件数）は【プロット】より前に残る', async () => {
    const res = await fat('get_plot', { work_id: 'w1' })
    expect(res.text).toContain('truncated=true')
    const worldAt = res.text.indexOf('note_id: wn0]')
    const plotAt = res.text.indexOf('【プロット】')
    expect(worldAt).toBeGreaterThan(-1)
    expect(plotAt).toBeGreaterThan(worldAt)
    // 本文（世界観の中身・ビートの要約）は落ちるが、存在と id は残る。
    expect(res.text).not.toContain('え'.repeat(100))
    expect(res.text).toContain('[beat_id: bt0]')
  })

  it('本文は途中で切らない。話の索引に落とす', async () => {
    const res = await fat('get_work', { work_id: 'w1' })
    expect(res.text).toContain('truncated=true')
    expect(res.text).toContain('[episode_id: e0]')
    expect(res.text).not.toContain('あ'.repeat(100))
    expect(res.text).toContain('get_work(work_id="w1", episode_id="e0")')
  })

  it('世界観も索引へ落ち、そこから個別取得で中身に届く', async () => {
    const world = await fat('get_world', { work_id: 'w1' })
    expect(world.text).toContain('世界観設定の索引')
    expect(world.text).toContain('note_id: wn5]')
    const one = await fat('get_world', { work_id: 'w1', note_id: 'wn5' })
    expect(one.text).toContain('え'.repeat(800))
  })

  it('list_works は話の一覧を落とした形へ縮退し、work_id は必ず残る', async () => {
    const { deps } = makeReadDeps(fatSnapshot({ episodes: 4000, episodeChars: 10 }))
    const res = await handleMcpMessage(callMsg('list_works'), deps)
    const body = resultText(res)
    expect(body).toContain('truncated=true')
    expect(body).toContain('[work_id: w1]')
    expect(body).not.toContain('[episode_id: e0]')
    expect(utf8Bytes(body)).toBeLessThanOrEqual(DEFAULT_FULL_BYTES)
  })

  it('索引が予算を超えるときは structuredContent を落として text を残す', async () => {
    const roomy = await call('list_glossary_entries', { work_id: 'w1' })
    expect(roomy.structured).toBeDefined()
    // text は収まるが text＋JSON では溢れる予算 → 構造化データだけ落として text は残す。
    const res = await call('list_glossary_entries', { work_id: 'w1' }, { indexMaxBytes: 700 })
    expect(res.structured).toBeUndefined()
    expect(res.text).toContain('[entry_id: g1]')
  })

  it('既定の予算そのものを固定する（値の変更＝仕様変更としてレビューに乗せる）', () => {
    expect(DEFAULT_TEXT_BYTES).toBe(300_000)
    expect(DEFAULT_FULL_BYTES).toBe(120_000)
    expect(DEFAULT_INDEX_BYTES).toBe(60_000)
  })

  it('既定予算の直下では全量、直上では索引（境界）', async () => {
    // 用語集の全量 ≒ 120,000 バイトの前後で切り替わることを、既定値のまま確かめる。
    const under = await (async () => {
      const { deps } = makeReadDeps(fatSnapshot({ glossary: 100, glossaryChars: 300 }))
      return resultText(await handleMcpMessage(callMsg('get_glossary', { work_id: 'w1' }), deps))
    })()
    const over = await (async () => {
      const { deps } = makeReadDeps(fatSnapshot({ glossary: 160, glossaryChars: 300 }))
      return resultText(await handleMcpMessage(callMsg('get_glossary', { work_id: 'w1' }), deps))
    })()
    expect(utf8Bytes(under)).toBeLessThanOrEqual(DEFAULT_FULL_BYTES)
    expect(under).not.toContain('truncated=true')
    expect(over).toContain('truncated=true')
  })
})

describe('引数の寛容さと未検出の扱い', () => {
  it('limit / offset は文字列・負値・巨大値でもエラーにせず、データを落とさない', async () => {
    for (const limit of ['2', -1, 0, 2.7, 1e9, null, 'abc']) {
      const res = await call('list_glossary_entries', { work_id: 'w1', limit })
      expect(res.isError).toBe(false)
      expect(res.text).toContain('[entry_id: g1]')
    }
    // offset が総件数を超えても行き止まりにしない（最後の窓に寄せる）。
    const far = await call('list_glossary_entries', { work_id: 'w1', offset: 999 })
    expect(far.isError).toBe(false)
    expect(far.text).toContain('[entry_id: g3]')
  })

  it('max_bytes の不正値は既定へ倒す（軽い側）', async () => {
    const res = await call('get_glossary', { work_id: 'w1', max_bytes: -5 }, { maxBytes: 300 })
    expect(res.text).toContain('truncated=true')
  })

  it('絞り込みが 0 件でも空文字は返さない（正常応答のまま案内を出す）', async () => {
    const res = await call('list_glossary_entries', { work_id: 'w1', query: '存在しない語' })
    expect(res.isError).toBe(false)
    expect(res.text).not.toBe('')
    expect(res.text).toContain('該当する項目はありません')

    const full = await call('get_glossary', { work_id: 'w1', category: '存在しない分類' })
    expect(full.isError).toBe(false)
    expect(full.text).toContain('条件に合う用語集の項目はありません')
  })

  it('id を指定して見つからないときはエラー（黙って空を返さない）', async () => {
    expect((await call('get_glossary', { work_id: 'w1', entry_id: 'nope' })).isError).toBe(true)
    expect((await call('get_world', { work_id: 'w1', note_id: 'nope' })).isError).toBe(true)
    expect((await call('get_plot', { work_id: 'w1', section_id: 'nope' })).isError).toBe(true)
    expect((await call('get_work', { work_id: 'w1', episode_id: 'nope' })).isError).toBe(true)
    expect((await call('list_plot_beats', { work_id: 'w1', section_id: 'nope' })).isError).toBe(
      true,
    )
  })

  it('空配列の id 指定は「絞り込みなし」として扱う（無意味なエラーにしない）', async () => {
    const glossary = await call('get_glossary', { work_id: 'w1', entry_ids: [] })
    expect(glossary.isError).toBe(false)
    expect(glossary.text).toContain('[entry_id: g1]')
    expect(glossary.text).toContain('[entry_id: g3]')

    const plot = await call('get_plot', { work_id: 'w1', beat_ids: [] })
    expect(plot.isError).toBe(false)
    expect(plot.text).toContain('[beat_id: bt1]')
  })

  it('section_id と beat_ids が噛み合わないときは、黙って空にせずエラーで理由を返す', async () => {
    const res = await call('get_plot', { work_id: 'w1', section_id: 's1', beat_ids: ['bt3'] })
    expect(res.isError).toBe(true)
    expect(res.text).toContain('section_id "s1" の幕に beat_id bt3 は含まれていません')
    // 噛み合う組み合わせは通る。
    const okRes = await call('get_plot', { work_id: 'w1', section_id: 's1', beat_ids: ['bt1'] })
    expect(okRes.isError).toBe(false)
    expect(okRes.text).toContain('[beat_id: bt1]')
  })

  it('旧データ（同じ定型枠に 2 件）でも、索引に出ないノートが note_id で読み出せる', async () => {
    const plot = fixturePlot()
    plot.world = [
      ...plot.world,
      { id: 'wn9', slot: 'stage', body: '古い版の時代設定。', updatedAt: 4 },
    ]
    const { deps } = makeReadDeps({ ...fixtureSnapshot(), plots: [plot] })
    // 索引（worldNotesInOrder）は定型枠ごとに 1 件しか出さない。
    const index = resultText(
      await handleMcpMessage(callMsg('list_world_notes', { work_id: 'w1' }), deps),
    )
    expect(index).not.toContain('note_id: wn9')
    // それでも id を指定すれば本文ごと読める（保存されているのに読めない、を作らない）。
    const one = await handleMcpMessage(
      callMsg('get_world', { work_id: 'w1', note_id: 'wn9' }),
      deps,
    )
    expect(resultIsError(one)).toBe(false)
    expect(resultText(one)).toContain('古い版の時代設定。')
  })

  it('旧データ（secrets 欄が無い Plot）でも読み取りは 500 にならない', async () => {
    // ライブスナップショットは Zod を通らないので、後から足した欄が無いレコードが普通に来る。
    const plot = fixturePlot()
    const legacy = { ...plot } as Record<string, unknown>
    // biome-ignore lint/performance/noDelete: 旧レコードの形（欄そのものが無い）を再現する
    delete legacy.secrets
    // biome-ignore lint/performance/noDelete: 同上
    delete legacy.world
    const { deps } = makeReadDeps({
      ...fixtureSnapshot(),
      plots: [legacy as unknown as ReturnType<typeof fixturePlot>],
    })
    for (const name of ['get_work_map', 'list_plot_beats', 'get_plot', 'get_world']) {
      const res = await handleMcpMessage(callMsg(name, { work_id: 'w1' }), deps)
      expect(resultIsError(res), name).toBe(false)
      expect(resultText(res), name).not.toBe('')
    }
  })

  it('未知の作品はどの読み取りツールでも同じ文言でエラー', async () => {
    for (const name of ['get_work_map', 'list_glossary_entries', 'list_world_notes']) {
      const res = await call(name, { work_id: 'nope' })
      expect(res.isError).toBe(true)
      expect(res.text).toContain('work_id "nope" の作品が見つかりません。')
    }
  })

  it('旧データ（プロット無し・用語集無し・world 欠落）でも落ちない', async () => {
    const bare: Work = { id: 'w9', title: '空の作品', episodes: [] }
    const snapshot = { ...fixtureSnapshot(), works: [bare], plots: [], structures: [] }
    const { deps } = makeReadDeps(snapshot)
    for (const name of [
      'get_work_map',
      'get_work',
      'get_glossary',
      'get_world',
      'get_plot',
      'get_structures',
      'list_glossary_entries',
      'list_world_notes',
      'list_plot_beats',
    ]) {
      const res = await handleMcpMessage(callMsg(name, { work_id: 'w9' }), deps)
      expect(resultIsError(res)).toBe(false)
      expect(resultText(res)).not.toBe('')
    }
  })

  it('旧 2 欄（summary＋body）の項目は索引でも字数が 0 にならない', async () => {
    const index = await call('list_glossary_entries', { work_id: 'w1' })
    const g2 = (index.structured?.entries as { entry_id: string; public_chars: number }[]).find(
      (e) => e.entry_id === 'g2',
    )
    expect(g2?.public_chars).toBeGreaterThan(20)
  })

  it('用語集を持たない作品でも索引は空文字を返さない', async () => {
    const work: Work = { ...fixtureWork(), glossary: undefined }
    const { deps } = makeReadDeps({ ...fixtureSnapshot(), works: [work] })
    const res = await handleMcpMessage(callMsg('list_glossary_entries', { work_id: 'w1' }), deps)
    expect(resultText(res)).toContain('該当する項目はありません')
  })
})
