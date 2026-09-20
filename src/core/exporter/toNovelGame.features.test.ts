import { describe, expect, it } from 'vitest'
import type { Staging } from '../game'
import { GAME_FEATURES } from '../game/features'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Episode, Work } from '../schema'
import type { GameScenario } from './novelGamePlayer'
import { buildNovelGameFiles, buildNovelGameHtml } from './toNovelGame'

// b1=地の文 / b2=セリフ / b3=地の文
const episode: Episode = {
  id: 'e1',
  title: '音の話',
  blocks: parseEpisodeBody('　雨が降りはじめた。\n「——行こうか」\n　やがて、雨はやんだ。'),
}
const work: Work = { id: 'w1', title: '作品', episodes: [episode] }
const staging = (cues: Staging['cues']): Staging => ({
  workId: 'w1',
  episodeId: 'e1',
  cues,
  updatedAt: 0,
})

function scenarioOf(html: string): GameScenario {
  const m = /<script id="scenario" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m?.[1]) throw new Error('シナリオ JSON が無い')
  return JSON.parse(m[1]) as GameScenario
}

/**
 * 効果音を出さない版（features.ts の GAME_FEATURES.se＝false）の書き出し。
 * 保存済みの cue.se は消さないが、シナリオには載せない＝プレイヤーの効果音ボタンも出ない。
 * 効果音経路そのものの検証は toNovelGame.test.ts（フラグを立てて動かす）。
 */
describe('toNovelGame — 効果音を出さない版（GAME_FEATURES.se＝false）', () => {
  it('この版のフラグは落ちている', () => {
    expect(GAME_FEATURES.se).toBe(false)
  })

  it('cue に se があってもシナリオに ses・se・seRepeat を載せず、クレジットにも出ない', () => {
    const files = buildNovelGameFiles(
      work,
      episode,
      staging([
        { blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' },
        { blockId: 'b2', se: 'preset:se/knock', seRepeat: 2 },
        { blockId: 'b3', se: 'stop' },
      ]),
    )
    const html = files.find((f) => f.path === 'index.html')?.data
    if (typeof html !== 'string') throw new Error('index.html が無い')
    const s = scenarioOf(html)
    expect(s.ses).toBeUndefined()
    for (const page of s.pages) {
      expect(page.se).toBeUndefined()
      expect(page.seRepeat).toBeUndefined()
    }
    expect(JSON.stringify(s.credits)).not.toContain('効果音')
    // 音声ファイルの素材を渡されても同梱しない
    expect(files.some((f) => f.path.startsWith('assets/se/'))).toBe(false)
  })

  it('テンプレの効果音ファイルを渡されても、zip にもインライン HTML にも入れない', () => {
    const seAsset = {
      key: 'preset:se/weather-rain-heavy',
      id: 'tpl-se-weather-rain-heavy',
      label: '強い雨',
      tone: ['#000000', '#000000', '#000000'] as [string, string, string],
      mime: 'audio/mpeg',
      data: new Uint8Array([1, 2, 3]),
      kind: 'se' as const,
      preset: 'preset:se/weather-rain-heavy',
      dataUrl: 'data:audio/mpeg;base64,AQID',
    }
    const cues = staging([{ blockId: 'b1', se: 'preset:se/weather-rain-heavy', seRepeat: 'loop' }])
    const files = buildNovelGameFiles(work, episode, cues, { userAssets: [seAsset] })
    expect(files.map((f) => f.path)).not.toContain('assets/se/weather-rain-heavy.mp3')
    const html = buildNovelGameHtml(work, episode, cues, {
      gameAssets: [
        {
          id: seAsset.id,
          kind: 'se',
          name: seAsset.label,
          dataUrl: seAsset.dataUrl,
          tone: seAsset.tone,
          preset: seAsset.preset,
          createdAt: 1,
        },
      ],
    })
    expect(html).not.toContain('data:audio/')
    expect(scenarioOf(html).ses).toBeUndefined()
  })
})
