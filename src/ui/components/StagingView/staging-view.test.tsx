import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Staging } from '@/core/game'
import { FREE_IMPORT_LIMIT, HOSTED_ASSET_LIMIT, type UserGameAsset } from '@/core/game/assets'
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
  gameSpriteToDataUrl: async () => ({
    dataUrl: 'data:image/png;base64,U1A=',
    tone: ['#000000', '#000000', '#000000'],
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

/** メモリ実装の疑似リポジトリ（get/save/listByWork だけ本物と同じ形）。others は別の話の演出譜。 */
function fakeRepo(initial?: Staging, others: Staging[] = []) {
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
      listByWork: async () => [...others, ...(current ? [current] : [])],
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

  it('自由記述した名前は「この作品の演出で使った名前」として別の行でも選び直せる', async () => {
    const twoLines: Work = {
      ...makeWork(),
      episodes: [{ id: 'e1', title: '第一話', blocks: parseEpisodeBody('「一つ」\n「二つ」') }],
    }
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={twoLines} currentEpisodeId="e1" />)
    // 1行目に自由記述で「謎の声」を付ける
    fireEvent.click(await screen.findByText('「一つ」'))
    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '__custom__' } })
    const input = screen.getByLabelText('話者名を入力')
    fireEvent.change(input, { target: { value: '謎の声' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(saved).toHaveLength(1))
    // 2行目では入力し直さず、プルダウンから選べる
    fireEvent.click(screen.getByText('「二つ」'))
    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '謎の声' } })
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]?.cues).toContainEqual({ blockId: 'b2', speaker: '謎の声' })
  })

  it('別の話の演出で使った名前もプルダウンに並ぶ（本文からの抽出はしない）', async () => {
    const { repo } = fakeRepo(undefined, [
      { workId: 'w1', episodeId: 'e0', cues: [{ blockId: 'x1', speaker: 'おばあ' }], updatedAt: 1 },
    ])
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    const option = await screen.findByRole('option', { name: 'おばあ' })
    // 出所がわかるよう「この作品の演出で使った名前」のグループに入る（用語集の人物とは別）
    expect(option.closest('optgroup')?.getAttribute('label')).toBe('この作品の演出で使った名前')
    expect(
      screen.getByRole('option', { name: '灯' }).closest('optgroup')?.getAttribute('label'),
    ).toBe('用語集の人物')
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

  it('話者を付けたセリフ行で立ち絵を追加できる（表情名つきで保存・話者に自動で紐づく）', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo, map } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '灯' } })
    // 話者が付くと立ち絵の案内と追加ボタンが出る
    expect(await screen.findByText(/「灯」の立ち絵はまだありません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '立ち絵を追加…' }))
    const file = new File(['x'], 'akari.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('立ち絵の画像を選ぶ'), { target: { files: [file] } })
    // 画像を選んだだけでは保存されない（表情名を付けて確定）
    const expr = await screen.findByLabelText('表情名')
    expect(map.size).toBe(0)
    fireEvent.change(expr, { target: { value: '笑顔' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(map.size).toBe(1))
    const saved = [...map.values()][0]
    expect(saved).toMatchObject({
      kind: 'sprite',
      character: '灯',
      expression: '笑顔',
      name: '灯（笑顔）',
      dataUrl: 'data:image/png;base64,U1A=',
    })
    // 追加した表情が選択肢に並ぶ
    expect(await screen.findByRole('option', { name: '笑顔' })).toBeInTheDocument()
  })

  it('話者に立ち絵があると表情を選べて、その場で cue に保存される', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯' }],
      updatedAt: 1,
    })
    const { repo: assetRepo } = memoryAssetRepo([
      { ...memoryAsset('sp1', '灯（通常）'), kind: 'sprite', character: '灯', expression: '通常' },
      { ...memoryAsset('sp2', '灯（笑顔）'), kind: 'sprite', character: '灯', expression: '笑顔' },
    ])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    const select = await screen.findByLabelText('立ち絵')
    fireEvent.change(select, { target: { value: '笑顔' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', speaker: '灯', expression: '笑顔' })
    // 一覧の行にも表情が出る
    expect(await screen.findByText('表情 笑顔')).toBeInTheDocument()
  })

  it('効果音を選ぶとその場で保存され、一覧の行にラベルが出る', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('効果音'), { target: { value: 'preset:se/rain' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', se: 'preset:se/rain' })
    expect(await screen.findByText('効果音 雨')).toBeInTheDocument()
  })

  it('地の文の行で「立ち絵の登場」を選ぶと cue（appear）に保存される', async () => {
    const { repo, saved } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo([
      { ...memoryAsset('sp1', '灯（通常）'), kind: 'sprite', character: '灯', expression: '通常' },
    ])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    const select = await screen.findByLabelText('立ち絵の登場')
    fireEvent.change(select, { target: { value: '灯' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b1', appear: '灯' })
    expect(await screen.findByText('登場 灯')).toBeInTheDocument()
  })

  it('欄のⓘを押すと、その欄の説明が出る（欄の下に説明を並べない）', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    // 効く範囲を知らないと混乱する 2 つは、とくに詳しく出す
    fireEvent.click(screen.getByRole('button', { name: 'ここから立ち絵を出さないの説明を開く' }))
    expect(await screen.findByText(/次の「場面が変わる」までです/)).toBeInTheDocument()
    expect(screen.getByText(/消えるのは絵だけです/)).toBeInTheDocument()
  })

  it('「この行から見る」でプレビューが開く（書き出しを待たずに確かめられる）', async () => {
    const { repo } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯' }],
      updatedAt: 1,
    })
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.click(screen.getByRole('button', { name: 'この行から見る' }))

    const frame = await screen.findByTitle('サウンドノベルのプレビュー')
    const html = frame.getAttribute('srcdoc') ?? ''
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('"start":1') // 選んだ行から始まる
    // 保存領域に触れさせない（アプリと同じオリジンを渡さない）
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('話者の行で「立ち絵を出さない」を入れられる（一枚絵の背景に重ねない）', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯' }],
      updatedAt: 1,
    })
    const { repo: assetRepo } = memoryAssetRepo([
      { ...memoryAsset('sp1', '灯（通常）'), kind: 'sprite', character: '灯', expression: '通常' },
    ])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.click(await screen.findByRole('switch', { name: /ここから立ち絵を出さない/ }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', speaker: '灯', hideSprite: true })
    // どこで止めたかが一覧から分かる（分からないと戻せない）
    expect(await screen.findByText('立ち絵なし')).toBeInTheDocument()
  })

  it('立ち絵が1枚も無くても、地の文で登場させる人物を選べる', async () => {
    // 一言も喋らない人物にも立ち絵を出せること。候補を「立ち絵のある人物」に絞らない
    const { repo, saved } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.change(await screen.findByLabelText('立ち絵の登場'), { target: { value: '灯' } })

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b1', appear: '灯' })
    expect(screen.getByText(/「灯」の立ち絵はまだありません/)).toBeInTheDocument()
  })

  it('登場させた人物の立ち絵を、その行から登録できる（話者でなくても）', async () => {
    const { repo } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b1', appear: '灯' }],
      updatedAt: 1,
    })
    const { repo: assetRepo, map } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.click(await screen.findByRole('button', { name: 'テンプレから選ぶ…' }))
    fireEvent.click(await screen.findByRole('button', { name: /（女性）/ }))

    await waitFor(() => expect(map.size).toBe(1))
    expect([...map.values()][0]).toMatchObject({ kind: 'sprite', character: '灯' })
  })

  it('用語集に無い人物も、自由に入力して登場させられる', async () => {
    const { repo, saved } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.change(await screen.findByLabelText('立ち絵の登場'), {
      target: { value: '__custom__' },
    })
    const input = await screen.findByLabelText('登場する人物の名前を入力')
    fireEvent.change(input, { target: { value: '見知らぬ女' } })
    fireEvent.blur(input)

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b1', appear: '見知らぬ女' })
  })

  it('テンプレから選ぶ…でシルエット立ち絵が話者に割り当てられる（tpl- id・枚数に数えない）', async () => {
    const { repo } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯' }],
      updatedAt: 1,
    })
    const { repo: assetRepo, map } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.click(await screen.findByRole('button', { name: 'テンプレから選ぶ…' }))
    fireEvent.click(await screen.findByRole('button', { name: /（女性）/ }))
    await waitFor(() => expect(map.size).toBe(1))
    const saved = [...map.values()][0]
    expect(saved).toMatchObject({
      kind: 'sprite',
      character: '灯',
      expression: '通常',
      preset: 'preset:sprite/silhouette-woman',
      name: '灯（シルエット（女性））',
    })
    expect(saved?.id.startsWith('tpl-')).toBe(true)
    // もう一度別のテンプレを選ぶと差し替え（増えない）
    fireEvent.click(screen.getByRole('button', { name: 'テンプレから選ぶ…' }))
    fireEvent.click(await screen.findByRole('button', { name: /（フードの人）/ }))
    await waitFor(() => expect([...map.values()][0]?.preset).toBe('preset:sprite/silhouette-hood'))
    expect(map.size).toBe(1)
  })

  it('無料プランは持ち込み 20 枚まで（テンプレは数えない・案内を出してファイル選択を開かない）', async () => {
    const { repo } = fakeRepo()
    const filled = Array.from({ length: FREE_IMPORT_LIMIT }, (_, i) =>
      memoryAsset(`bg-${i}`, `背景${i}`),
    )
    const tpl: UserGameAsset = {
      ...memoryAsset('tpl-x', '灯（シルエット）'),
      kind: 'sprite',
      character: '灯',
      preset: 'preset:sprite/silhouette-woman',
    }
    const { repo: assetRepo, map } = memoryAssetRepo([...filled, tpl])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('背景'), { target: { value: '__add_image__' } })
    expect(await screen.findByText(/無料プランでは 20 枚までです/)).toBeInTheDocument()
    expect(map.size).toBe(FREE_IMPORT_LIMIT + 1) // 何も追加されていない
  })

  it('素材の管理を開くと、非会員には無料枠の枚数とクラウド版の案内が出る', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo([memoryAsset('a1', '海辺')])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: '素材の管理' }))
    expect(await screen.findByText(/持ち込み 1 \/ 20 枚（無料プラン/)).toBeInTheDocument()
    expect(screen.getByText(/クラウド版では 50 枚まで/)).toBeInTheDocument()
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
