import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Staging } from '@/core/game'
import { GAME_FEATURES } from '@/core/game/features'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import StagingView from './staging-view'

vi.mock('@/ui/_api/game-templates', () => ({
  fetchTemplateManifest: async () => null,
  fetchTemplateBytes: async () => null,
}))

// b1=地の文 / b2=セリフ
const work: Work = {
  id: 'w1',
  title: '夜の物語',
  episodes: [
    { id: 'e1', title: '第一話', blocks: parseEpisodeBody('　雨が降りはじめた。\n「——行こうか」') },
  ],
}

const repoOf = (staging: Staging) =>
  ({
    get: async () => staging,
    save: async () => {},
    listByWork: async () => [staging],
  }) as unknown as StagingRepository

/**
 * 効果音を出さない版（features.ts の GAME_FEATURES.se＝false）の演出エディタ。
 * 欄・レーン・行の印を出さない。保存済みの se は消さない（書き出しが読み飛ばす）。
 * 効果音の欄そのものの検証は staging-view.test.tsx（フラグを立てて動かす）。
 */
describe('演出エディタ — 効果音を出さない版（GAME_FEATURES.se＝false）', () => {
  it('この版のフラグは落ちている', () => {
    expect(GAME_FEATURES.se).toBe(false)
  })

  it('効果音の欄・環境音のレーン・行の印が出ない（保存済みの se があっても）', async () => {
    render(
      <StagingView
        repo={repoOf({
          workId: 'w1',
          episodeId: 'e1',
          cues: [{ blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' }],
          updatedAt: 1,
        })}
        work={work}
        currentEpisodeId="e1"
      />,
    )
    fireEvent.click(await screen.findByText('雨が降りはじめた。'))
    expect(await screen.findByLabelText('背景')).toBeInTheDocument()
    expect(screen.queryByLabelText('効果音')).not.toBeInTheDocument()
    expect(screen.queryByText('環境音')).not.toBeInTheDocument()
    expect(screen.queryByText(/効果音 雨/)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/環境音/)).not.toBeInTheDocument()
    expect(screen.queryByText(/環境音 雨/)).not.toBeInTheDocument()
  })
})
