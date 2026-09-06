import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FREE_IMPORT_LIMIT, type UserGameAsset } from '@/core/game/assets'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import { SpriteSection } from './sprite-section'

// happy-dom は canvas 非対応のため、リサイズは固定値を返す疑似実装に差し替える
vi.mock('@/ui/_utils/imageResizer', () => ({
  gameSpriteToDataUrl: async () => ({
    dataUrl: 'data:image/png;base64,U1A=',
    tone: ['#000000', '#000000', '#000000'],
  }),
}))

// クラウド保管の API（fetch 層）は不使用経路（ゲスト）でも import されるので差し替える
const hostApi = vi.hoisted(() => ({
  listHostedAssets: vi.fn(),
  getHostedAsset: vi.fn(),
  putHostedAsset: vi.fn(),
  deleteHostedAsset: vi.fn(),
}))
vi.mock('@/ui/_api/game-assets', () => hostApi)
vi.mock('@/ui/_api/game-templates', () => ({
  fetchTemplateManifest: async () => null,
  fetchTemplateBytes: async () => null,
}))

beforeEach(() => {
  hostApi.listHostedAssets.mockReset().mockResolvedValue([])
  hostApi.getHostedAsset.mockReset().mockResolvedValue(null)
  hostApi.putHostedAsset.mockReset().mockResolvedValue('ok')
  hostApi.deleteHostedAsset.mockReset().mockResolvedValue(true)
})

function memoryAssetRepo(initial: UserGameAsset[] = []) {
  const map = new Map(initial.map((a) => [a.id, a]))
  return {
    map,
    repo: {
      list: async () => [...map.values()].sort((a, b) => b.createdAt - a.createdAt),
      save: async (a: UserGameAsset) => {
        map.set(a.id, a)
      },
      remove: async (id: string) => {
        map.delete(id)
      },
      get: async (id: string) => map.get(id),
    } as unknown as GameAssetRepository,
  }
}

function sprite(id: string, character: string, expression: string, createdAt = 1): UserGameAsset {
  return {
    id,
    kind: 'sprite',
    name: `${character}（${expression}）`,
    dataUrl: 'data:image/webp;base64,SGk=',
    tone: ['#111111', '#222222', '#333333'],
    character,
    expression,
    createdAt,
  }
}

function bg(id: string): UserGameAsset {
  return {
    id,
    kind: 'bg',
    name: id,
    dataUrl: 'data:image/webp;base64,SGk=',
    tone: ['#111111', '#222222', '#333333'],
    createdAt: 1,
  }
}

describe('用語集の立ち絵欄（SpriteSection）', () => {
  it('この人物の立ち絵（旧名＝別名の分も）が表情つきで並ぶ', async () => {
    const { repo } = memoryAssetRepo([
      sprite('s1', '灯', '通常', 1),
      sprite('s2', '灯', '笑顔', 2),
      sprite('s3', 'あかり', '通常', 3), // 改名前の旧名（別名）に紐づく分
      sprite('s4', 'ベニ', '通常', 4), // 他人の分は出ない
    ])
    render(<SpriteSection name="灯" aliases={['あかり']} assetRepo={repo} />)
    expect(await screen.findByAltText('灯（通常）')).toBeInTheDocument()
    expect(screen.getByAltText('灯（笑顔）')).toBeInTheDocument()
    expect(screen.getByAltText('あかり（通常）')).toBeInTheDocument()
    expect(screen.getByText('旧名「あかり」')).toBeInTheDocument()
    expect(screen.queryByAltText('ベニ（通常）')).not.toBeInTheDocument()
  })

  it('アップロードで追加できる（表情名つき・この人物に紐づく）', async () => {
    const { repo, map } = memoryAssetRepo()
    render(<SpriteSection name="灯" aliases={[]} assetRepo={repo} />)
    fireEvent.click(await screen.findByRole('button', { name: '立ち絵を追加…' }))
    const file = new File(['x'], 'akari.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('立ち絵の画像を選ぶ'), { target: { files: [file] } })
    const expr = await screen.findByLabelText('表情名')
    fireEvent.change(expr, { target: { value: '怒り' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(map.size).toBe(1))
    expect([...map.values()][0]).toMatchObject({
      kind: 'sprite',
      character: '灯',
      expression: '怒り',
      name: '灯（怒り）',
    })
  })

  it('テンプレから選ぶとシルエットが割り当てられ、選び直しは差し替えになる', async () => {
    const { repo, map } = memoryAssetRepo()
    render(<SpriteSection name="灯" aliases={[]} assetRepo={repo} />)
    fireEvent.click(await screen.findByRole('button', { name: 'テンプレから選ぶ…' }))
    fireEvent.click(await screen.findByRole('button', { name: /（女性）/ }))
    await waitFor(() => expect(map.size).toBe(1))
    expect([...map.values()][0]?.preset).toBe('preset:sprite/silhouette-woman')
    expect([...map.values()][0]?.id.startsWith('tpl-')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'テンプレから選ぶ…' }))
    fireEvent.click(await screen.findByRole('button', { name: /（少女）/ }))
    await waitFor(() => expect([...map.values()][0]?.preset).toBe('preset:sprite/silhouette-girl'))
    expect(map.size).toBe(1)
  })

  it('無料プランの持ち込み枠（20枚・テンプレ除く）に達すると案内を出して開かない', async () => {
    const five = Array.from({ length: FREE_IMPORT_LIMIT }, (_, i) => bg(`bg-${i}`))
    const { repo, map } = memoryAssetRepo(five)
    render(<SpriteSection name="灯" aliases={[]} assetRepo={repo} />)
    fireEvent.click(await screen.findByRole('button', { name: '立ち絵を追加…' }))
    expect(await screen.findByText(/無料プランでは 20 枚までです/)).toBeInTheDocument()
    expect(map.size).toBe(FREE_IMPORT_LIMIT)
  })

  it('削除は確認してからこの端末の素材を消す', async () => {
    const { repo, map } = memoryAssetRepo([sprite('s1', '灯', '通常', 1)])
    render(<SpriteSection name="灯" aliases={[]} assetRepo={repo} />)
    fireEvent.click(await screen.findByRole('button', { name: '立ち絵「灯（通常）」を削除' }))
    expect(await screen.findByText('立ち絵を削除しますか？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => expect(map.size).toBe(0))
  })
})
