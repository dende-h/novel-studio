// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../../../src/core/mcp-read'
import type { Work } from '../../../src/core/schema'
import { handleMcpMessage } from './mcp-server'
import {
  callMsg,
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
  const tiny = { maxBytes: 300, indexMaxBytes: 300 }

  it('予算を超えると索引に落ち、次の一手と復旧線が本文に出る（isError にはしない）', async () => {
    const res = await call('get_glossary', { work_id: 'w1' }, tiny)
    expect(res.isError).toBe(false)
    expect(res.text).toContain('truncated=true')
    expect(res.text).toContain('[entry_id: g1]')
    expect(res.text).not.toContain('灯台守の少女。')
    // 復旧線には既存ツール名＋引数を必ず書く（新ツールが見えないホストで行き止まりにしない）。
    expect(res.text).toContain('get_glossary(work_id="w1", entry_id="g1")')
    expect(res.text).toContain('get_glossary(work_id="w1", max_bytes=0)')
  })

  it('max_bytes=0 なら無制限＝改修前とまったく同じ全量が返る', async () => {
    const limited = await call('get_glossary', { work_id: 'w1' }, tiny)
    const unlimited = await call('get_glossary', { work_id: 'w1', max_bytes: 0 }, tiny)
    const normal = await call('get_glossary', { work_id: 'w1' })
    expect(limited.text).not.toBe(normal.text)
    expect(unlimited.text).toBe(normal.text)
  })

  it('縮退した get_plot でも世界観設定の枠（slot・note_id・件数）は【プロット】より前に残る', async () => {
    const res = await call('get_plot', { work_id: 'w1' }, tiny)
    expect(res.text).toContain('truncated=true')
    const worldAt = res.text.indexOf('[slot: stage, note_id: wn1]')
    const plotAt = res.text.indexOf('【プロット】')
    expect(worldAt).toBeGreaterThan(-1)
    expect(plotAt).toBeGreaterThan(worldAt)
    // 本文（世界観の中身・ビートの要約）は落ちるが、存在と id は残る。
    expect(res.text).not.toContain('星の消えた海辺の町。')
    expect(res.text).toContain('[beat_id: bt1]')
  })

  it('本文は途中で切らない。話の索引に落とす', async () => {
    const res = await call('get_work', { work_id: 'w1' }, tiny)
    expect(res.text).toContain('truncated=true')
    expect(res.text).toContain('[episode_id: e1]')
    expect(res.text).not.toContain('夜が明けた。')
    expect(res.text).toContain('get_work(work_id="w1", episode_id="e1")')
  })

  it('世界観・構造データも索引へ落ちる', async () => {
    const world = await call('get_world', { work_id: 'w1' }, tiny)
    expect(world.text).toContain('世界観設定の索引')
    expect(world.text).toContain('[slot: custom, note_id: wn3]')

    const structures = await call('get_structures', { work_id: 'w1' }, tiny)
    expect(structures.text).toContain('構造データの索引')
    expect(structures.text).toContain('[kind: outline]')
  })

  it('索引が予算を超えるときは structuredContent を落として text を残す', async () => {
    const roomy = await call('list_glossary_entries', { work_id: 'w1' })
    expect(roomy.structured).toBeDefined()
    // text は収まるが text＋JSON では溢れる予算 → 構造化データだけ落として text は残す。
    const res = await call('list_glossary_entries', { work_id: 'w1' }, { indexMaxBytes: 700 })
    expect(res.structured).toBeUndefined()
    expect(res.text).toContain('[entry_id: g1]')
  })

  it('大きい世界観設定でも、索引と個別取得で必ず中身に届く', async () => {
    // 実際の事故（26 項目・約 14 万バイト）に近い形を作る。
    const plot = fixturePlot()
    plot.world = Array.from({ length: 26 }, (_, i) => ({
      id: `wn${i}`,
      slot: i === 0 ? 'stage' : 'custom',
      title: `設定 ${i}`,
      body: 'あ'.repeat(1800),
      updatedAt: 5,
    }))
    const snapshot = { ...fixtureSnapshot(), plots: [plot] }
    const { deps } = makeReadDeps(snapshot)

    const full = resultText(await handleMcpMessage(callMsg('get_world', { work_id: 'w1' }), deps))
    expect(utf8Bytes(full)).toBeLessThanOrEqual(100_000)
    expect(full).toContain('truncated=true')
    expect(full).toContain('note_id: wn7]')

    const one = resultText(
      await handleMcpMessage(callMsg('get_world', { work_id: 'w1', note_id: 'wn7' }), deps),
    )
    expect(one).toContain('設定 7')
    expect(one).toContain('あ'.repeat(1800))
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
