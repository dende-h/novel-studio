import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRESET_SES } from '@/core/game/sePresets'
import type { TemplateEntry, TemplateManifest } from '@/core/game/templates'
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

// happy-dom は Audio 非対応なので、音声の下ごしらえも固定値
vi.mock('@/ui/_utils/audioMeta', () => ({
  audioFileToDataUrl: async (file: File) =>
    /\.(mp3|m4a)$/i.test(file.name) ? 'data:audio/mpeg;base64,SUQz' : null,
  audioDurationMs: async () => 4200,
}))
vi.mock('@/ui/_utils/sePlayer', () => ({ playCatalogSe: vi.fn(), playPresetSe: vi.fn() }))

// この版は効果音を隠している（features.ts）。効果音タブそのものはここで検証し続ける。
// フラグが落ちているときの振る舞いは admin-templates-page.features.test.tsx
vi.mock('@/core/game/features', () => ({ GAME_FEATURES: { se: true } }))

// happy-dom は canvas 非対応なので、変換は固定値
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

const entry = (over: Partial<TemplateEntry> = {}): TemplateEntry => ({
  kind: 'bg',
  slug: 'town-alley-night',
  label: '路地（夜）',
  category: 'town',
  time: 'night',
  tone: ['#111111', '#222222', '#333333'],
  mime: 'image/webp',
  bytes: 120_000,
  hash: 'h1',
  updatedAt: 1,
  ...over,
})

const manifest = (entries: TemplateEntry[]): TemplateManifest => ({
  v: 1,
  updatedAt: 1,
  categories: { bg: {}, sprite: {}, se: {} },
  entries,
})

const getToken = async () => 'jwt'

beforeEach(() => {
  api.adminFetchTemplates.mockReset()
  api.adminPatchTemplates.mockReset()
  api.adminPutTemplate.mockReset()
})

describe('AdminTemplatesPage', () => {
  it('staff でなければ（目録が取れなければ）断りだけ出す', async () => {
    api.adminFetchTemplates.mockResolvedValue(null)
    render(<AdminTemplatesPage getToken={getToken} />)
    expect(await screen.findByText(/このページは表示できません/)).toBeInTheDocument()
  })

  it('目録の項目と組み込み（画像なし）を分類ごとに並べ、画像の無いものは編集できない', async () => {
    api.adminFetchTemplates.mockResolvedValue(manifest([entry()]))
    render(<AdminTemplatesPage getToken={getToken} />)
    expect(await screen.findByText('town-alley-night')).toBeInTheDocument()
    // 組み込みの 24 枚も並ぶ（画像なしの印つき・入力は無効）
    expect(screen.getAllByText('画像なし（組み込みの SVG）').length).toBe(24)
    expect(screen.getByLabelText('room-day の表示名')).toBeDisabled()
    expect(screen.getByLabelText('town-alley-night の表示名')).toHaveValue('路地（夜）')
    expect(screen.getByRole('button', { name: /背景（画像 1）/ })).toBeInTheDocument()
  })

  it('表示名・非表示・分類の表示名を直して「変更を保存」で PATCH が飛ぶ', async () => {
    api.adminFetchTemplates.mockResolvedValue(manifest([entry()]))
    api.adminPatchTemplates.mockImplementation(async (_t, patch) => ({
      ...manifest([entry({ label: '裏路地（夜）', hidden: true })]),
      categories: { bg: patch.categories?.bg ?? {}, sprite: {}, se: {} },
    }))
    render(<AdminTemplatesPage getToken={getToken} />)
    const label = await screen.findByLabelText('town-alley-night の表示名')
    fireEvent.change(label, { target: { value: '裏路地（夜）' } })
    fireEvent.click(screen.getByLabelText('town-alley-night を一覧に出す'))
    fireEvent.change(screen.getByLabelText('分類「town」の表示名'), {
      target: { value: '街なか' },
    })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(api.adminPatchTemplates).toHaveBeenCalledTimes(1))
    expect(api.adminPatchTemplates.mock.calls[0]?.[1]).toEqual({
      entries: [{ kind: 'bg', slug: 'town-alley-night', label: '裏路地（夜）', hidden: true }],
      categories: { bg: { town: '街なか' } },
    })
    expect(await screen.findByText('保存しました')).toBeInTheDocument()
    // 画像の無い組み込みの行は保存の対象にならない（目録に項目が無い）
    expect(screen.getByLabelText('分類「town」の表示名')).toHaveValue('街なか')
  })

  it('TSV を貼ると表示名が下書きに入る（画像の無い名前は数えて知らせる）', async () => {
    api.adminFetchTemplates.mockResolvedValue(manifest([entry()]))
    render(<AdminTemplatesPage getToken={getToken} />)
    await screen.findByText('town-alley-night')
    fireEvent.change(screen.getByLabelText('TSV'), {
      target: {
        value: [
          '新ファイル名\t元ファイル名\t表示名\t場所',
          'town-alley-night.png\tIMG_1.png\t裏通り（夜）\ttown',
          'room-day.png\tIMG_2.png\t自室（昼）\troom',
        ].join('\n'),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '表示名を取り込む' }))
    expect(screen.getByLabelText('town-alley-night の表示名')).toHaveValue('裏通り（夜）')
    expect(
      screen.getByText(/1 件に入れました（未保存）・まだ画像の無い名前 1 件/),
    ).toBeInTheDocument()
  })

  it('ファイルを選ぶと名前を読んで 1 枚ずつ送り、規則に合わない名前は飛ばして知らせる', async () => {
    api.adminFetchTemplates.mockResolvedValue(manifest([]))
    api.adminPutTemplate.mockImplementation(async (_t, kind, slug, input) => ({
      ok: true,
      entry: entry({ kind, slug, label: input.label ?? '', category: input.category ?? slug }),
    }))
    render(<AdminTemplatesPage getToken={getToken} />)
    await screen.findByRole('button', { name: /背景（画像 0）/ })
    const files = [
      new File(['a'], 'sky-dusk.png', { type: 'image/png' }),
      new File(['b'], 'IMG_0001.png', { type: 'image/png' }),
    ]
    fireEvent.change(screen.getByLabelText('テンプレ画像を選ぶ'), { target: { files } })
    await waitFor(() => expect(api.adminPutTemplate).toHaveBeenCalledTimes(1))
    expect(api.adminPutTemplate.mock.calls[0]?.slice(1, 3)).toEqual(['bg', 'sky-dusk'])
    // 新しい名前には命名規則から既定の表示名・分類・時間帯が付く
    expect(api.adminPutTemplate.mock.calls[0]?.[3]).toMatchObject({
      label: '空（夕）',
      category: 'sky',
      time: 'dusk',
    })
    expect(await screen.findByText(/IMG_0001.png：名前が規則に合わない/)).toBeInTheDocument()
    expect(await screen.findByText('1 件を送りました')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /背景（画像 1）/ })).toBeInTheDocument()
  })

  it('効果音タブで分類の表示名を直すと、その分も PATCH に載る（下書きを捨てない）', async () => {
    api.adminFetchTemplates.mockResolvedValue(
      manifest([
        entry({
          kind: 'se',
          slug: 'weather-rain',
          label: '雨',
          category: 'weather',
          mime: 'audio/mpeg',
        }),
      ]),
    )
    api.adminPatchTemplates.mockImplementation(async (_t, patch) => ({
      ...manifest([]),
      categories: { bg: {}, sprite: {}, se: patch.categories?.se ?? {} },
    }))
    render(<AdminTemplatesPage getToken={getToken} />)
    fireEvent.click(await screen.findByRole('button', { name: /効果音（音 1）/ }))
    fireEvent.change(screen.getByLabelText('分類「weather」の表示名'), {
      target: { value: '天気' },
    })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(api.adminPatchTemplates).toHaveBeenCalledTimes(1))
    expect(api.adminPatchTemplates.mock.calls[0]?.[1]).toEqual({
      categories: { se: { weather: '天気' } },
    })
  })

  it('効果音タブ：組み込みの合成レシピは「ファイルなし」、mp3 を入れると長さ付きで並ぶ', async () => {
    api.adminFetchTemplates.mockResolvedValue(manifest([]))
    api.adminPutTemplate.mockImplementation(async (_t, kind, slug, input) => ({
      ok: true,
      entry: entry({
        kind,
        slug,
        label: input.label ?? '',
        category: input.category ?? slug,
        mime: 'audio/mpeg',
        durationMs: input.durationMs,
      }),
    }))
    render(<AdminTemplatesPage getToken={getToken} />)
    fireEvent.click(await screen.findByRole('button', { name: /効果音（音 0）/ }))
    expect(screen.getAllByText('ファイルなし（端末で合成）')).toHaveLength(PRESET_SES.length)
    expect(screen.getByLabelText('rain を試聴')).toBeInTheDocument()

    const files = [
      new File(['a'], 'weather-rain-heavy.mp3', { type: 'audio/mpeg' }),
      new File(['b'], 'door-knock.wav', { type: 'audio/wav' }),
    ]
    fireEvent.change(screen.getByLabelText('テンプレ画像を選ぶ'), { target: { files } })
    await waitFor(() => expect(api.adminPutTemplate).toHaveBeenCalledTimes(1))
    expect(api.adminPutTemplate.mock.calls[0]?.slice(1, 3)).toEqual(['se', 'weather-rain-heavy'])
    expect(api.adminPutTemplate.mock.calls[0]?.[3]).toEqual({
      dataUrl: 'data:audio/mpeg;base64,SUQz',
      durationMs: 4200,
      label: 'rain heavy',
      category: 'weather',
    })
    expect(await screen.findByText(/door-knock.wav：mp3 か m4a だけ/)).toBeInTheDocument()
    expect(await screen.findByText('2 件を送りました')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /効果音（音 1）/ })).toBeInTheDocument()
    expect(screen.getByText(/4\.2 秒/)).toBeInTheDocument()
  })
})
