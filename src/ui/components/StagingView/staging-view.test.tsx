import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Staging } from '@/core/game'
import { HOSTED_ASSET_LIMIT, type UserGameAsset } from '@/core/game/assets'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { AuthContext, type AuthState, GUEST_AUTH_STATE } from '@/ui/auth/auth-context'
import StagingView from './staging-view'

// happy-dom は canvas 非対応のため、リサイズは固定値を返す疑似実装に差し替える
vi.mock('@/ui/_utils/imageResizer', () => ({
  gameBgToDataUrl: async () => ({
    dataUrl: 'data:image/webp;base64,SGk=',
    tone: ['#111111', '#222222', '#333333'],
  }),
}))

// クラウド保管の API（fetch 層）だけ差し替え、配線（asset-hosting）は本物を通す
const hostApi = vi.hoisted(() => ({
  listHostedAssets: vi.fn(),
  getHostedAsset: vi.fn(),
  putHostedAsset: vi.fn(),
  deleteHostedAsset: vi.fn(),
}))
vi.mock('@/ui/_api/game-assets', () => hostApi)

beforeEach(() => {
  hostApi.listHostedAssets.mockReset().mockResolvedValue([])
  hostApi.getHostedAsset.mockReset().mockResolvedValue(null)
  hostApi.putHostedAsset.mockReset().mockResolvedValue('ok')
  hostApi.deleteHostedAsset.mockReset().mockResolvedValue(true)
})

/** メモリ実装の疑似リポジトリ（get/save だけ本物と同じ形）。 */
function fakeRepo(initial?: Staging) {
  const saved: Staging[] = []
  let current = initial
  return {
    saved,
    repo: {
      get: async () => current,
      save: async (s: Staging) => {
        current = s
        saved.push(s)
      },
    } as unknown as StagingRepository,
  }
}

function makeWork(): Work {
  return {
    id: 'w1',
    title: '夜の物語',
    episodes: [
      {
        id: 'e1',
        title: '第一話',
        blocks: parseEpisodeBody(
          '　[[灯]]が振り返った。\n「——まだ、書いてるんだね」\n\n\n　場面が変わる。',
        ),
      },
    ],
    glossary: [
      {
        id: 'g1',
        name: '灯',
        aliases: [],
        category: '人物',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  }
}

describe('StagingView（演出エディタ）', () => {
  it('本文の行がセリフ/地の文の別つきで並び、場面の切れ目の提案が出る', async () => {
    const { repo } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    expect(await screen.findByText('「——まだ、書いてるんだね」')).toBeInTheDocument()
    expect(screen.getByText('セリフ')).toBeInTheDocument()
    expect(screen.getAllByText('地の文')).toHaveLength(2)
    // 空行2つのあとの行に「場面の切れ目？」の提案
    expect(screen.getByText('場面の切れ目？')).toBeInTheDocument()
  })

  it('セリフ行を選んで話者を付けると、その場で保存される', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '灯' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues).toEqual([{ blockId: 'b2', speaker: '灯' }])
    // 一覧の行にも話者が出る
    expect(await screen.findByText('話者：灯')).toBeInTheDocument()
  })

  it('話者は ？？？（名前を伏せる）を選べる', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '？？？' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', speaker: '？？？' })
  })

  it('話者は自由記述できる（入力欄で確定して保存）', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '__custom__' } })
    // 選んだだけでは保存されない（入力の確定で保存）
    expect(saved).toHaveLength(0)
    const input = screen.getByLabelText('話者名を入力')
    fireEvent.change(input, { target: { value: '謎の声' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', speaker: '謎の声' })
  })

  it('話者候補（直前の地の文の参照）がボタンで出て、1クリックで適用できる', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.click(screen.getByRole('button', { name: '候補「灯」を使う' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', speaker: '灯' })
  })

  it('場面の切れ目スイッチと背景選択が cue に載る', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    // 既定のテキストマッチャは前後の空白（字下げの全角空白）を正規化する
    fireEvent.click(await screen.findByText('場面が変わる。'))
    fireEvent.click(screen.getByRole('switch', { name: /ここから場面が変わる/ }))
    fireEvent.change(screen.getByLabelText('背景'), { target: { value: 'preset:bg/room-night' } })
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]?.cues[0]).toMatchObject({
      blockId: 'b5',
      sceneBreak: true,
      bg: 'preset:bg/room-night',
    })
  })

  it('背景の「画像を追加…」で持ち込み画像が保存され、その行の背景になる', async () => {
    const { repo, saved } = fakeRepo()
    const assetSaved: UserGameAsset[] = []
    const assetRepo = {
      list: async () => [],
      save: async (a: UserGameAsset) => {
        assetSaved.push(a)
      },
    } as unknown as GameAssetRepository
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    // 「画像を追加…」を選んだだけでは保存されない（ファイル選択で保存）
    fireEvent.change(screen.getByLabelText('背景'), { target: { value: '__add_image__' } })
    expect(saved).toHaveLength(0)
    const file = new File(['x'], '海辺の夕暮れ.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('背景画像を選ぶ'), { target: { files: [file] } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(assetSaved).toHaveLength(1)
    expect(assetSaved[0]).toMatchObject({
      kind: 'bg',
      name: '海辺の夕暮れ',
      dataUrl: 'data:image/webp;base64,SGk=',
      tone: ['#111111', '#222222', '#333333'],
    })
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', bg: `user:${assetSaved[0]?.id}` })
    // 一覧の行と背景セレクトに持ち込み画像の名前が出る
    expect(await screen.findByText('背景 海辺の夕暮れ')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '海辺の夕暮れ' })).toBeInTheDocument()
  })

  it('素材の管理を開くと、非会員にはクラウド保管が有料である案内が出る', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo([memoryAsset('a1', '海辺')])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: '素材の管理' }))
    expect(await screen.findByText(/有料のクラウド版の機能です/)).toBeInTheDocument()
    expect(screen.getByText('海辺')).toBeInTheDocument()
    // 非会員はクラウド操作もバッジも出ない
    expect(screen.queryByRole('button', { name: 'クラウドへ上げる' })).not.toBeInTheDocument()
    expect(hostApi.listHostedAssets).not.toHaveBeenCalled()
  })

  it('行き先を失った演出（orphan）が列挙され、外せる', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b99', speaker: '灯' }],
      updatedAt: 1,
    })
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    expect(await screen.findByText('行き先を失った演出')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /外す/ }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues).toHaveLength(0)
  })
})

/** 素材の保存状態を持つメモリ実装（list/save/remove が本物と同じ形）。 */
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

function memoryAsset(id: string, name: string): UserGameAsset {
  return {
    id,
    kind: 'bg',
    name,
    dataUrl: 'data:image/webp;base64,SGk=',
    tone: ['#111111', '#222222', '#333333'],
    createdAt: 1,
  }
}

const MEMBER_AUTH: AuthState = {
  ...GUEST_AUTH_STATE,
  available: true,
  status: 'member',
  isSignedIn: true,
  userId: 'user_1',
  getToken: async () => 'jwt',
}

function renderAsMember(props: Parameters<typeof StagingView>[0]) {
  return render(
    <AuthContext.Provider value={MEMBER_AUTH}>
      <StagingView {...props} />
    </AuthContext.Provider>,
  )
}

describe('StagingView（クラウド保管・会員）', () => {
  it('開いたときに、クラウドにあってこの端末に無い素材が取り込まれ選択肢に並ぶ', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo, map } = memoryAssetRepo()
    hostApi.listHostedAssets.mockResolvedValue([{ id: 'cloud-1', size: 10 }])
    hostApi.getHostedAsset.mockResolvedValue(memoryAsset('cloud-1', '街の夕方'))
    renderAsMember({ repo, work: makeWork(), currentEpisodeId: 'e1', assetRepo })
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    expect(await screen.findByRole('option', { name: '街の夕方' })).toBeInTheDocument()
    expect(map.has('cloud-1')).toBe(true)
  })

  it('画像を追加すると、この端末への保存に加えてクラウドにも保存される', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    renderAsMember({ repo, work: makeWork(), currentEpisodeId: 'e1', assetRepo })
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('背景'), { target: { value: '__add_image__' } })
    const file = new File(['x'], '海辺の夕暮れ.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('背景画像を選ぶ'), { target: { files: [file] } })
    await waitFor(() => expect(hostApi.putHostedAsset).toHaveBeenCalledTimes(1))
    expect(hostApi.putHostedAsset.mock.calls[0]?.[1]).toMatchObject({
      kind: 'bg',
      name: '海辺の夕暮れ',
    })
  })

  it('クラウドが上限だと、端末には保存しつつ上限の案内を出す', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo, map } = memoryAssetRepo()
    hostApi.putHostedAsset.mockResolvedValue('limit_reached')
    renderAsMember({ repo, work: makeWork(), currentEpisodeId: 'e1', assetRepo })
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('背景'), { target: { value: '__add_image__' } })
    const file = new File(['x'], '海辺.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('背景画像を選ぶ'), { target: { files: [file] } })
    expect(
      await screen.findByText(new RegExp(`クラウドが上限（${HOSTED_ASSET_LIMIT} 枚）です`)),
    ).toBeInTheDocument()
    expect(map.size).toBe(1) // ローカルには保存済み
  })

  it('素材の管理に保管状況（枚数・バッジ）が出て、この端末だけの素材をクラウドへ上げられる', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo([memoryAsset('a1', '海辺')])
    hostApi.listHostedAssets.mockResolvedValue([]) // クラウドは空＝a1 はこの端末のみ
    renderAsMember({ repo, work: makeWork(), currentEpisodeId: 'e1', assetRepo })
    fireEvent.click(await screen.findByRole('button', { name: '素材の管理' }))
    expect(await screen.findByText(new RegExp(`0 / ${HOSTED_ASSET_LIMIT} 枚`))).toBeInTheDocument()
    expect(screen.getByText(/この端末のみ/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'クラウドへ上げる' }))
    await waitFor(() => expect(hostApi.putHostedAsset).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/クラウド保管済み/)).toBeInTheDocument()
  })

  it('素材の削除は、クラウド → この端末の順で消える', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo, map } = memoryAssetRepo([memoryAsset('a1', '海辺')])
    hostApi.listHostedAssets.mockResolvedValue([{ id: 'a1', size: 10 }])
    renderAsMember({ repo, work: makeWork(), currentEpisodeId: 'e1', assetRepo })
    fireEvent.click(await screen.findByRole('button', { name: '素材の管理' }))
    expect(await screen.findByText(/クラウド保管済み/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    // 確認ダイアログの「削除」で確定
    expect(await screen.findByText('素材を削除しますか？')).toBeInTheDocument()
    const confirms = screen.getAllByRole('button', { name: '削除' })
    fireEvent.click(confirms[confirms.length - 1]!)
    await waitFor(() => expect(hostApi.deleteHostedAsset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(map.size).toBe(0))
  })
})
