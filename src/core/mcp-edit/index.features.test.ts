import { describe, expect, it } from 'vitest'
import { GAME_FEATURES } from '../game/features'
import { parseEpisodeBody } from '../parser/parseNotation'
import type { Work } from '../schema'
import { setStagingCues } from './index'

// b1=地の文 / b2=セリフ
const work = (): Work => ({
  id: 'w1',
  title: '作品',
  episodes: [
    { id: 'e1', title: '第一話', blocks: parseEpisodeBody('　雨が降りはじめた。\n「——行こうか」') },
  ],
})

/**
 * 効果音を出さない版（features.ts の GAME_FEATURES.se＝false）の MCP。
 * 欄はスキーマに残るが、付けることはできない（外すのは通す＝以前の版で付いた分を掃除できる）。
 */
describe('mcp-edit — 効果音を出さない版（GAME_FEATURES.se＝false）', () => {
  it('この版のフラグは落ちている', () => {
    expect(GAME_FEATURES.se).toBe(false)
  })

  it('se / se_repeat は付けられない（空文字で外すのは通る）', () => {
    expect(() =>
      setStagingCues([], [work()], 'w1', 'e1', [{ blockId: 'b1', se: 'preset:se/rain' }], [], 100),
    ).toThrow(/効果音（se）はいまは使えません/)
    expect(() =>
      setStagingCues([], [work()], 'w1', 'e1', [{ blockId: 'b1', seRepeat: 'loop' }], [], 100),
    ).toThrow(/効果音（se_repeat）はいまは使えません/)

    const before = [
      {
        workId: 'w1',
        episodeId: 'e1',
        cues: [{ blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' as const }],
        updatedAt: 1,
      },
    ]
    const cleared = setStagingCues(
      before,
      [work()],
      'w1',
      'e1',
      [{ blockId: 'b1', se: '', seRepeat: '' }],
      [],
      100,
    )
    expect(cleared.stagings[0]?.cues).toHaveLength(0)
  })

  it('「変更する項目がありません」の案内に se を載せない', () => {
    expect(() => setStagingCues([], [work()], 'w1', 'e1', [{ blockId: 'b1' }], [], 100)).toThrow(
      /scene_break \/ bg \/ transition \/ clear/,
    )
  })
})
