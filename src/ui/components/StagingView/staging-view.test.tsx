import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Staging } from '@/core/game'
import { FREE_IMPORT_LIMIT, HOSTED_ASSET_LIMIT, type UserGameAsset } from '@/core/game/assets'
import {
  EMPTY_TEMPLATE_MANIFEST,
  type TemplateEntry,
  type TemplateManifest,
} from '@/core/game/templates'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { Work } from '@/core/schema'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { AuthContext, type AuthState, GUEST_AUTH_STATE } from '@/ui/auth/auth-context'
import { setTemplateCatalog } from '@/ui/game/template-catalog'
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
vi.mock('@/ui/_api/game-templates', () => ({
  fetchTemplateManifest: async () => null,
  // 目録の画像の実体（テンプレ立ち絵の割り当てで取りに行く）
  fetchTemplateBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp' }),
}))
// happy-dom は AudioContext 非対応なので、BGM の試聴は差し替える
vi.mock('@/ui/_utils/bgmPlayer', () => ({
  toggleCatalogBgm: vi.fn(),
  isCatalogBgmPreviewing: () => false,
  subscribeBgmPreview: () => () => {},
  bgmPreviewingUrl: () => null,
}))
// この版は効果音を隠している（features.ts）。効果音の欄そのものはここで検証し続ける。
// フラグが落ちているときの振る舞いは staging-view.features.test.tsx
vi.mock('@/core/game/features', () => ({ GAME_FEATURES: { se: true } }))

/** 運営テンプレの目録（テストごとに差し込み、終わったら消す＝ほかのテストに漏らさない）。 */
const templateEntry = (over: Partial<TemplateEntry> & Pick<TemplateEntry, 'kind' | 'slug'>) => ({
  label: '',
  category: over.slug.split('-')[1] ?? over.slug,
  tone: ['#000000', '#000000', '#000000'] as [string, string, string],
  mime: 'image/webp',
  bytes: 1,
  hash: 'h',
  updatedAt: 1,
  ...over,
})
const templateManifest = (entries: TemplateEntry[]): TemplateManifest => ({
  ...EMPTY_TEMPLATE_MANIFEST,
  entries,
})

afterEach(() => {
  setTemplateCatalog(null)
  localStorage.removeItem('ns-game-templates')
})

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

  it('背景の「背景を追加」で持ち込み画像が保存され、その行の背景になる', async () => {
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
    // 「背景を追加」を押しただけでは保存されない（ファイル選択で保存）
    fireEvent.click(screen.getByRole('button', { name: '背景を追加' }))
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

  it('席で人物を選ぶと立ち絵を追加でき、追加した表情がその席に選ばれる（話者は関係ない）', async () => {
    const { repo, saved } = fakeRepo()
    const { repo: assetRepo, map } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(await screen.findByLabelText('左の立ち絵'), { target: { value: '灯' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', sprites: [{ pos: 'l', character: '灯' }] })
    // 人物が付くと立ち絵の案内と追加ボタンが出る
    expect(await screen.findByText(/「灯」の立ち絵はまだありません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '立ち絵を追加' }))
    const file = new File(['x'], 'akari.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('立ち絵の画像を選ぶ'), { target: { files: [file] } })
    // 画像を選んだだけでは保存されない（表情名を付けて確定）
    const expr = await screen.findByLabelText('表情名')
    expect(map.size).toBe(0)
    fireEvent.change(expr, { target: { value: '笑顔' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(map.size).toBe(1))
    expect([...map.values()][0]).toMatchObject({
      kind: 'sprite',
      character: '灯',
      expression: '笑顔',
      name: '灯（笑顔）',
      dataUrl: 'data:image/png;base64,U1A=',
    })
    // 追加した表情がその席に選ばれ、選択肢にも並ぶ
    await waitFor(() =>
      expect(saved[saved.length - 1]?.cues[0]).toEqual({
        blockId: 'b2',
        sprites: [{ pos: 'l', character: '灯', expression: '笑顔' }],
      }),
    )
    expect(await screen.findByRole('option', { name: '笑顔' })).toBeInTheDocument()
    expect(screen.getByText('立ち絵 左:灯（笑顔）')).toBeInTheDocument()
  })

  it('席に立てた人物に立ち絵が複数あると表情を選べて、その場で cue に保存される', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯', sprites: [{ pos: 'c', character: '灯' }] }],
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
    const select = await screen.findByLabelText('中央の表情')
    expect(screen.getByRole('option', { name: '指定なし(いまの表情のまま)' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: '笑顔' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({
      blockId: 'b2',
      speaker: '灯',
      sprites: [{ pos: 'c', character: '灯', expression: '笑顔' }],
    })
    expect(await screen.findByText('立ち絵 中央:灯（笑顔）')).toBeInTheDocument()
    // 続きレーンには席つきで出る
    expect(screen.getAllByTitle('立ち絵：中央 灯').length).toBeGreaterThan(0)
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

  it('地の文の行でも席に人物を立たせられる（話者は要らない）', async () => {
    const { repo, saved } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo([
      { ...memoryAsset('sp1', '灯（通常）'), kind: 'sprite', character: '灯', expression: '通常' },
    ])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.change(await screen.findByLabelText('右の立ち絵'), { target: { value: '灯' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b1', sprites: [{ pos: 'r', character: '灯' }] })
    expect(await screen.findByText('立ち絵 右:灯')).toBeInTheDocument()
    // 次の行まで続く（席つきの説明）
    expect(screen.getAllByTitle('立ち絵：右 灯')).toHaveLength(3)
  })

  it('続きレーンが、効いている範囲ぶんの行に立つ（設定した行だけではない）', async () => {
    // 「何がどこまで続くか」が一覧で見えること。線の説明（title）も行ごとに出す
    const { repo } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [
        { blockId: 'b1', bg: 'preset:bg/town-night', se: 'preset:se/rain', seRepeat: 'loop' },
        { blockId: 'b5', sceneBreak: true },
      ],
      updatedAt: 1,
    })
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    await screen.findByText('「——まだ、書いてるんだね」')

    // 背景は 3 行すべてに続く（切れ目でも戻らない）
    expect(screen.getAllByTitle('背景：街（夜）')).toHaveLength(3)
    // 環境音は場面の切れ目まで＝1・2 行目だけ
    expect(screen.getAllByTitle('環境音：雨')).toHaveLength(2)
    expect(screen.getAllByTitle('環境音：なし')).toHaveLength(1)
    // 選択行の右側には「効いているもの」の要約を出さない（レーンだけで見せる）
    fireEvent.click(screen.getByText('「——まだ、書いてるんだね」'))
    expect(await screen.findByLabelText('背景')).toBeInTheDocument()
    expect(screen.queryByText(/この行に効いているもの/)).not.toBeInTheDocument()
  })

  it('効果音の鳴らし方を 1回／2回／ずっと から選べる', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.change(screen.getByLabelText('効果音'), { target: { value: 'preset:se/rain' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    // 音を選ぶまで鳴らし方は出さない（選ぶものが無い欄を並べない）
    fireEvent.change(await screen.findByLabelText('鳴らし方'), { target: { value: 'loop' } })

    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]?.cues[0]).toEqual({ blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' })
    expect(await screen.findByText(/効果音 雨（ずっと）/)).toBeInTheDocument()
  })

  it('「停止する」を選ぶと、鳴らし方の指定も一緒に落ちる', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b1', se: 'preset:se/rain', seRepeat: 'loop' }],
      updatedAt: 1,
    })
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.change(screen.getByLabelText('効果音'), { target: { value: 'stop' } })

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b1', se: 'stop' })
    expect(screen.queryByLabelText('鳴らし方')).not.toBeInTheDocument()
  })

  it('欄のⓘを押すと、その欄の説明が出る（欄の下に説明を並べない）', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    // 効く範囲を知らないと混乱する「場面が変わる」は、とくに詳しく出す
    fireEvent.click(screen.getByRole('button', { name: 'ここから場面が変わるの説明を開く' }))
    expect(await screen.findByText(/次の「場面が変わる」までが1つの場面です/)).toBeInTheDocument()
    expect(screen.getByText(/原稿に区切り線や記号が入ることはありません/)).toBeInTheDocument()
  })

  it('背景の説明に「背景なし(ブラックアウト)」の使い方が載る', async () => {
    const { repo } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.click(screen.getByRole('button', { name: '背景の説明を開く' }))
    expect(await screen.findByText(/画面が真っ黒になります/)).toBeInTheDocument()
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

  it('「ここから立ち絵を出さない」の欄は無いが、既存の hideSprite は一覧に残る（席の「立ち絵なし」で足りる）', async () => {
    const { repo } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯', hideSprite: true }],
      updatedAt: 1,
    })
    const { repo: assetRepo } = memoryAssetRepo([
      { ...memoryAsset('sp1', '灯（通常）'), kind: 'sprite', character: '灯', expression: '通常' },
    ])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    expect(await screen.findByLabelText('左の立ち絵')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /立ち絵を出さない/ })).not.toBeInTheDocument()
    // 旧データの印は一覧から消えない（データが残っているのに見えなくしない）
    expect(screen.getByText('立ち絵なし', { selector: 'span' })).toBeInTheDocument()
  })

  it('背景に「背景なし(ブラックアウト)」を選ぶと予約キー blackout で保存され、一覧にも出る', async () => {
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    expect(screen.getByRole('option', { name: '背景なし(ブラックアウト)' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('背景'), { target: { value: 'blackout' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', bg: 'blackout' })
    expect(await screen.findByText('背景 背景なし(ブラックアウト)')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: '背景プレビュー: 背景なし(ブラックアウト)' }),
    ).toBeInTheDocument()
  })

  it('席を「変更しない(前の行を引継ぐ)」に戻すと、その席の指示（表情ごと）が外れる', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b1', sprites: [{ pos: 'l', character: '灯', expression: '笑顔' }] }],
      updatedAt: 1,
    })
    const { repo: assetRepo } = memoryAssetRepo([
      { ...memoryAsset('sp1', '灯（通常）'), kind: 'sprite', character: '灯', expression: '通常' },
      { ...memoryAsset('sp2', '灯（笑顔）'), kind: 'sprite', character: '灯', expression: '笑顔' },
    ])
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    expect(await screen.findByLabelText('左の表情')).toHaveValue('笑顔')
    fireEvent.change(screen.getByLabelText('左の立ち絵'), { target: { value: '' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues).toHaveLength(0)
    // 「立ち絵なし」はその席だけ下げる指示として残る
    fireEvent.change(screen.getByLabelText('中央の立ち絵'), { target: { value: '__off__' } })
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]?.cues[0]).toEqual({ blockId: 'b1', sprites: [{ pos: 'c' }] })
    expect(await screen.findByText('立ち絵 中央:なし')).toBeInTheDocument()
  })

  it('話者を替えると、前の話者の表情は外れる（表情はその人の絵の名前）', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯', expression: '笑顔' }],
      updatedAt: 1,
    })
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '？？？' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', speaker: '？？？' })
  })

  it('プルダウンの先頭は「なし」と分かる文言で、選んだ話者・背景を外せる', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯', bg: 'preset:bg/town-night' }],
      updatedAt: 1,
    })
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    expect(screen.getByRole('option', { name: 'なし(名前を出さない)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '？？？(名前を伏せる)' })).toBeInTheDocument()
    // 背景と BGM の先頭（どちらも「変更しない」＝前のまま続く）
    expect(screen.getAllByRole('option', { name: '変更しない(前の行を引継ぐ)' })).toHaveLength(2)
    expect(screen.getByRole('option', { name: '停止する' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('話者'), { target: { value: '' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b2', bg: 'preset:bg/town-night' })

    fireEvent.change(screen.getByLabelText('背景'), { target: { value: '' } })
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]?.cues).toHaveLength(0)
  })

  it('立ち絵が1枚も無くても、席に人物を選べる（候補を立ち絵のある人物に絞らない）', async () => {
    const { repo, saved } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.change(await screen.findByLabelText('中央の立ち絵'), { target: { value: '灯' } })

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b1', sprites: [{ pos: 'c', character: '灯' }] })
    expect(screen.getByText(/「灯」の立ち絵はまだありません/)).toBeInTheDocument()
  })

  it('席に選んだ人物の立ち絵を、その行から登録できる（話者でなくても）', async () => {
    const { repo } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b1', sprites: [{ pos: 'c', character: '灯' }] }],
      updatedAt: 1,
    })
    const { repo: assetRepo, map } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.click(await screen.findByRole('button', { name: 'テンプレから選ぶ' }))
    fireEvent.click(await screen.findByRole('button', { name: /（女性）/ }))

    await waitFor(() => expect(map.size).toBe(1))
    expect([...map.values()][0]).toMatchObject({ kind: 'sprite', character: '灯' })
  })

  it('用語集に無い人物も、自由に入力して席に立たせられる', async () => {
    const { repo, saved } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    fireEvent.change(await screen.findByLabelText('右の立ち絵'), {
      target: { value: '__custom__' },
    })
    const input = await screen.findByLabelText('右に立たせる人物の名前を入力')
    fireEvent.change(input, { target: { value: '見知らぬ女' } })
    fireEvent.blur(input)

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({
      blockId: 'b1',
      sprites: [{ pos: 'r', character: '見知らぬ女' }],
    })
  })

  it('テンプレから選ぶでシルエット立ち絵が席の人物に割り当てられる（tpl- id・枚数に数えない）', async () => {
    const { repo } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯', sprites: [{ pos: 'c', character: '灯' }] }],
      updatedAt: 1,
    })
    const { repo: assetRepo, map } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.click(await screen.findByRole('button', { name: 'テンプレから選ぶ' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'テンプレから選ぶ' }))
    fireEvent.click(await screen.findByRole('button', { name: /（フードの人）/ }))
    await waitFor(() => expect([...map.values()][0]?.preset).toBe('preset:sprite/silhouette-hood'))
    expect(map.size).toBe(1)
  })

  it('BGM を選ぶとその場で保存され、一覧の行と続きレーンに曲名が出る。止める行も付けられる', async () => {
    setTemplateCatalog(
      templateManifest([
        templateEntry({
          kind: 'bgm',
          slug: 'bgm-calm-morning',
          category: 'calm',
          label: '朝',
          mime: 'audio/mpeg',
          durationMs: 92_000,
        }),
      ]),
    )
    const { repo, saved } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    expect(await screen.findByLabelText('BGM')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('BGM'), {
      target: { value: 'preset:bgm/bgm-calm-morning' },
    })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues[0]).toEqual({ blockId: 'b1', bgm: 'preset:bgm/bgm-calm-morning' })
    expect(await screen.findByText('BGM 朝')).toBeInTheDocument()
    // 曲は次の行にも続く（場面の切れ目でも止まらない）
    expect(screen.getAllByTitle('BGM：朝')).toHaveLength(3)
    // 試聴ボタンが出る
    expect(screen.getByRole('button', { name: '朝を試聴' })).toBeInTheDocument()
    // 最後の行で止める
    fireEvent.click(screen.getByText('場面が変わる。'))
    fireEvent.change(await screen.findByLabelText('BGM'), { target: { value: 'stop' } })
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]?.cues).toContainEqual({ blockId: 'b5', bgm: 'stop' })
    expect(screen.getAllByTitle('BGM：朝')).toHaveLength(2)
    expect(screen.getAllByTitle('BGM：なし')).toHaveLength(1)
  })

  it('目録に曲が無ければ、BGM の欄は案内だけ出す（一覧から選ぶは出さない）', async () => {
    const { repo } = fakeRepo()
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('灯が振り返った。'))
    expect(await screen.findByLabelText('BGM')).toBeInTheDocument()
    expect(screen.getByText(/使える曲はまだありません/)).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: '背景を追加' }))
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
    fireEvent.click(screen.getByRole('button', { name: '外す' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues).toHaveLength(0)
  })

  it('「この行の演出を外す」は確認してから外す（キャンセルなら残る）', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [{ blockId: 'b2', speaker: '灯', bg: 'preset:bg/town-night' }],
      updatedAt: 1,
    })
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    fireEvent.click(screen.getByRole('button', { name: 'この行の演出を外す' }))
    expect(await screen.findByText('この行の演出を外しますか？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() =>
      expect(screen.queryByText('この行の演出を外しますか？')).not.toBeInTheDocument(),
    )
    expect(saved).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'この行の演出を外す' }))
    fireEvent.click(await screen.findByRole('button', { name: '外す' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.cues).toHaveLength(0)
  })

  it('「この話の演出をすべて外す」は確認してから、行き先を失った分も含めて全部外す', async () => {
    const { repo, saved } = fakeRepo({
      workId: 'w1',
      episodeId: 'e1',
      cues: [
        { blockId: 'b2', speaker: '灯' },
        { blockId: 'b5', bg: 'preset:bg/room-night' },
        { blockId: 'b99', speaker: '灯' }, // 行き先を失った演出
      ],
      updatedAt: 1,
    })
    render(<StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" />)
    await screen.findByText('「——まだ、書いてるんだね」')
    fireEvent.click(screen.getByRole('button', { name: 'この話の演出をすべて外す' }))
    expect(await screen.findByText('この話の演出をすべて外しますか？')).toBeInTheDocument()
    expect(screen.getByText(/演出 3 件をすべて外します/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'すべて外す' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ workId: 'w1', episodeId: 'e1', cues: [] })
    expect(screen.queryByText('行き先を失った演出')).not.toBeInTheDocument()
    // 何も無くなったら押せない
    expect(screen.getByRole('button', { name: 'この話の演出をすべて外す' })).toBeDisabled()
  })

  it('右側の欄は 場面の切れ目 → 背景 → BGM → 話者 → 立ち絵 → この行から見る → 外す の順に並ぶ', async () => {
    const { repo } = fakeRepo()
    const { repo: assetRepo } = memoryAssetRepo()
    render(
      <StagingView repo={repo} work={makeWork()} currentEpisodeId="e1" assetRepo={assetRepo} />,
    )
    fireEvent.click(await screen.findByText('「——まだ、書いてるんだね」'))
    const scene = await screen.findByLabelText('ここから場面が変わる')
    const bg = screen.getByLabelText('背景')
    const bgm = screen.getByLabelText('BGM')
    const speaker = screen.getByLabelText('話者')
    const seat = screen.getByLabelText('左の立ち絵')
    const view = screen.getByRole('button', { name: 'この行から見る' })
    const clear = screen.getByRole('button', { name: 'この行の演出を外す' })
    const precedes = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(precedes(scene, bg)).toBe(true)
    expect(precedes(bg, bgm)).toBe(true)
    expect(precedes(bgm, speaker)).toBe(true)
    expect(precedes(speaker, seat)).toBe(true)
    expect(precedes(seat, view)).toBe(true)
    expect(precedes(view, clear)).toBe(true)
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
    fireEvent.click(screen.getByRole('button', { name: '背景を追加' }))
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
    fireEvent.click(screen.getByRole('button', { name: '背景を追加' }))
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
