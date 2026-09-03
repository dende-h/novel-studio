import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GAME_FEATURES } from '@/core/game/features'
import type { TemplateManifest } from '@/core/game/templates'
import { AdminTemplatesPage } from './admin-templates-page'

const api = vi.hoisted(() => ({
  adminFetchTemplates: vi.fn(),
  adminPatchTemplates: vi.fn(),
  adminPutTemplate: vi.fn(),
}))
vi.mock('@/ui/_api/game-templates', () => ({
  ...api,
  fetchTemplateManifest: async () => null,
  fetchTemplateBytes: async () => null,
}))
vi.mock('@/ui/_utils/audioMeta', () => ({
  audioFileToDataUrl: async () => 'data:audio/mpeg;base64,SUQz',
  audioDurationMs: async () => 4200,
}))
vi.mock('@/ui/_utils/sePlayer', () => ({ playCatalogSe: vi.fn(), playPresetSe: vi.fn() }))
vi.mock('@/ui/_utils/imageResizer', () => ({
  gameBgToDataUrl: async () => ({
    dataUrl: 'data:image/webp;base64,UklGRg==',
    tone: ['#111111', '#222222', '#333333'],
  }),
  gameSpriteToDataUrl: async () => ({
    dataUrl: 'data:image/webp;base64,UklGRg==',
    tone: ['#000000', '#000000', '#000000'],
  }),
  templateThumbToDataUrl: async () => 'data:image/webp;base64,UklGRg==',
}))

const empty: TemplateManifest = {
  v: 1,
  updatedAt: 1,
  categories: { bg: {}, sprite: {}, se: {} },
  entries: [],
}

/** 効果音を出さない版（features.ts の GAME_FEATURES.se＝false）の管理ページ。 */
describe('AdminTemplatesPage — 効果音を出さない版（GAME_FEATURES.se＝false）', () => {
  it('この版のフラグは落ちている', () => {
    expect(GAME_FEATURES.se).toBe(false)
  })

  it('効果音タブが無く、mp3 を入れても送らずに知らせる', async () => {
    api.adminFetchTemplates.mockResolvedValue(empty)
    api.adminPutTemplate.mockResolvedValue({ ok: true, entry: {} })
    render(<AdminTemplatesPage getToken={async () => 'jwt'} />)
    expect(await screen.findByRole('button', { name: /背景（画像 0）/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /立ち絵（画像 0）/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /効果音/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/分類-音\.mp3/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('テンプレ画像を選ぶ'), {
      target: { files: [new File(['a'], 'weather-rain-heavy.mp3', { type: 'audio/mpeg' })] },
    })
    expect(
      await screen.findByText(/weather-rain-heavy\.mp3：効果音はいまは受け付けていません/),
    ).toBeInTheDocument()
    await waitFor(() => expect(api.adminPutTemplate).not.toHaveBeenCalled())
    // ファイル選択の窓も音を勧めない（拒むだけでなく、はじめから出さない）
    expect(screen.getByLabelText('テンプレ画像を選ぶ')).toHaveAttribute('accept', 'image/*')
  })

  it('TSV に効果音の行が混ざっていても、下書きに入れずに数えて知らせる', async () => {
    api.adminFetchTemplates.mockResolvedValue({
      ...empty,
      entries: [
        {
          kind: 'se',
          slug: 'weather-rain',
          label: '雨',
          category: 'weather',
          tone: ['#000000', '#000000', '#000000'],
          mime: 'audio/mpeg',
          bytes: 1,
          hash: 'h',
          updatedAt: 1,
        },
      ],
    })
    render(<AdminTemplatesPage getToken={async () => 'jwt'} />)
    await screen.findByRole('button', { name: /背景（画像 0）/ })
    fireEvent.change(screen.getByLabelText('TSV'), {
      target: {
        value: [
          '新ファイル名\t元ファイル名\t表示名\t場所',
          'weather-rain.mp3\tA.mp3\t大雨\tweather',
        ].join('\n'),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '表示名を取り込む' }))
    expect(
      await screen.findByText(/0 件に入れました（未保存）・いまは扱わない効果音 1 件/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '変更を保存' })).toBeDisabled()
  })
})
