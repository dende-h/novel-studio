import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  addBeat,
  addSection,
  emptyPlot,
  type Plot,
  type PlotBeat,
  upsertForeshadow,
  upsertSecret,
} from '@/core/plot'
import type { Episode, GlossaryEntry } from '@/core/schema'
import { IdeaRepository } from '@/core/storage/ideaRepository'
import { MemoryStore } from '@/core/storage/memoryStore'
import { PlotRepository } from '@/core/storage/plotRepository'
import { PlotPeek } from './plot-peek'

/**
 * 本文エディタの「この話のプロット」パネル。
 * 関心は「プロット画面へ行かずに、この話のビートを最後まで読めるか」。
 * 一覧に何が並ぶか・詳細で何が読めるか・消えた参照をどう残すかを固定する。
 */

const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'g-yuki',
    name: 'ユキ',
    aliases: [],
    category: '人物',
    summary: '主人公。',
    createdAt: 0,
    updatedAt: 0,
  },
  { id: 'g-ren', name: 'レン', aliases: [], category: '人物', createdAt: 0, updatedAt: 0 },
  { id: 'g-station', name: '駅前', aliases: [], category: '場所', createdAt: 0, updatedAt: 0 },
]

const EPISODES: Episode[] = [
  { id: 'ep1', title: '第一話', blocks: [] },
  { id: 'ep2', title: '第二話', blocks: [] },
]

const beat = (id: string, extra: Partial<PlotBeat> = {}): PlotBeat => ({
  id,
  title: id,
  castRefs: [],
  placeRefs: [],
  lineRefs: [],
  status: 'idea',
  ...extra,
})

/**
 * 第一幕に 3 ビート。b1 と b3 が ep1、b2 が ep2 に紐づく。
 * b1 には視点・登場・舞台・作中時間・メモ・ライン・伏線・秘密・予定字数・ネタ帳まで揃える。
 */
function fixture(): Plot {
  let p = emptyPlot('p1', 'w1', 100)
  p = addSection(p, { id: 'sec1', title: '第一幕', beatIds: [] })
  p = addBeat(
    p,
    'sec1',
    beat('b1', {
      title: '駅前の再会',
      summary: '[[ユキ]]が改札で足を止める。',
      note: '視点はユキのまま動かさない。',
      guide: '主人公の日常を見せる',
      povRef: 'g-yuki',
      castRefs: ['g-ren', 'g-missing'],
      placeRefs: ['g-station'],
      timeLabel: '三日後の夜',
      lineRefs: ['l1'],
      episodeRef: 'ep1',
      ideaRef: 'idea-1',
      targetLength: 8000,
      status: 'writing',
    }),
  )
  p = addBeat(p, 'sec1', beat('b2', { title: '別の話のビート', episodeRef: 'ep2' }))
  p = addBeat(p, 'sec1', beat('b3', { title: '終電', episodeRef: 'ep1' }))
  p = { ...p, lines: [{ id: 'l1', title: 'メイン', note: '本筋。' }] }
  p = upsertForeshadow(p, {
    id: 'f1',
    title: '手紙の署名',
    note: '差出人は伏せる。',
    plantBeatId: 'b1',
    payoffBeatId: 'b3',
  })
  p = upsertSecret(p, { id: 's1', title: 'ユキの正体', truth: 'レンの妹', revealBeatId: 'b1' })
  p = upsertSecret(p, { id: 's2', title: '駅の火事', truth: '放火だった' })
  return p
}

async function setup(
  over: {
    plot?: Plot | null
    episodeId?: string | null
    onRefClick?: (name: string) => void
    onJumpBeat?: (beatId: string) => void
    withIdea?: boolean
  } = {},
) {
  const store = new MemoryStore()
  const repo = new PlotRepository(
    store,
    () => 'gen',
    () => 200,
  )
  const plot = over.plot === undefined ? fixture() : over.plot
  if (plot) await repo.save(plot)

  const ideaRepo = new IdeaRepository(
    store,
    () => 'idea-1',
    () => 0,
  )
  if (over.withIdea !== false)
    await ideaRepo.put({ id: 'idea-1', text: '改札の場面から始める', createdAt: 0, updatedAt: 0 })

  const onRefClick = vi.fn(over.onRefClick)
  const onJumpBeat = vi.fn(over.onJumpBeat)
  const onOpenPlot = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <PlotPeek
      repo={repo}
      workId="w1"
      episodeId={over.episodeId === undefined ? 'ep1' : over.episodeId}
      actualChars={4000}
      glossary={GLOSSARY}
      episodes={EPISODES}
      resolvedNames={new Set(['ユキ', 'レン', '駅前'])}
      ideaRepo={ideaRepo}
      onRefClick={onRefClick}
      onJumpBeat={onJumpBeat}
      onOpenPlot={onOpenPlot}
      onClose={onClose}
    />,
  )
  return { repo, view, onRefClick, onJumpBeat, onOpenPlot, onClose }
}

const list = () => screen.getByRole('complementary', { name: 'この話のプロット' })
const detail = () => screen.getByRole('complementary', { name: 'ビートの詳細' })
const openDetail = async (title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `「${title}」の詳細` }))
  return detail()
}

describe('PlotPeek（この話のプロット）', () => {
  it('この話に紐づくビートだけを物語順に並べる', async () => {
    await setup()
    expect(await screen.findByRole('button', { name: '「駅前の再会」の詳細' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '「終電」の詳細' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '「別の話のビート」の詳細' })).toBeNull()
    // 予定字数の合算（b1 の 8000 のみ）と実績から進捗が出る
    expect(within(list()).getByText('実績 4,000字 ／ 予定 8,000字')).toBeInTheDocument()
    expect(within(list()).getByText('50%')).toBeInTheDocument()
  })

  it('ビートを開くと、要約・人物と舞台・メモ・伏線・秘密・進捗・ネタ帳まで読める', async () => {
    await setup()
    const panel = await openDetail('駅前の再会')

    expect(within(panel).getByRole('heading', { name: '駅前の再会' })).toBeInTheDocument()
    expect(within(panel).getByText(/第一幕/)).toBeInTheDocument()
    expect(within(panel).getByText(/物語順 1／3/)).toBeInTheDocument()

    // 要約は記法つきで描く（[[ユキ]] が用語のリンクになる）
    expect(within(panel).getByText('が改札で足を止める。', { exact: false })).toBeInTheDocument()
    expect(panel.querySelector('[data-ref-name="ユキ"]')).not.toBeNull()

    // 人物と舞台
    expect(within(panel).getByRole('button', { name: 'ユキ' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'レン' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '駅前' })).toBeInTheDocument()
    expect(within(panel).getByText('三日後の夜')).toBeInTheDocument()

    // メモ・プロットライン
    expect(within(panel).getByText('視点はユキのまま動かさない。')).toBeInTheDocument()
    expect(within(panel).getByText('メイン')).toBeInTheDocument()
    expect(within(panel).getByText('本筋。')).toBeInTheDocument()

    // 伏線は張る/回収の別と相方のビート名、メモまで
    expect(within(panel).getByText('張る: 手紙の署名')).toBeInTheDocument()
    expect(within(panel).getByText('回収は「終電」')).toBeInTheDocument()
    expect(within(panel).getByText('差出人は伏せる。')).toBeInTheDocument()

    // 秘密は真相と、この時点の未開示分まで
    expect(within(panel).getByText('ここで明かす: ユキの正体')).toBeInTheDocument()
    expect(within(panel).getByText('レンの妹')).toBeInTheDocument()
    expect(within(panel).getByText(/この時点で読者が知らないこと：駅の火事/)).toBeInTheDocument()

    // 進捗と対応する話
    expect(within(panel).getByText('8,000字')).toBeInTheDocument()
    expect(within(panel).getByText('第一話')).toBeInTheDocument()

    // 種になったネタ帳メモ（プロット画面にも出ていない情報）
    expect(await within(panel).findByText('改札の場面から始める')).toBeInTheDocument()
  })

  it('テンプレートのガイド文は要約を書いたあとも残る', async () => {
    await setup()
    const panel = await openDetail('駅前の再会')
    expect(within(panel).getByText('テンプレートの目安：主人公の日常を見せる')).toBeInTheDocument()
  })

  it('用語集から消えた参照は「（削除済み）」で場所を残す', async () => {
    await setup()
    const panel = await openDetail('駅前の再会')
    expect(within(panel).getByText('（削除済み）')).toBeInTheDocument()
  })

  it('中身がタイトルだけのビートはその旨を伝える', async () => {
    let bare = emptyPlot('p1', 'w1', 100)
    bare = addSection(bare, { id: 'sec1', title: '第一幕', beatIds: [] })
    bare = addBeat(bare, 'sec1', beat('b9', { title: 'まだ空のビート', episodeRef: 'ep1' }))
    await setup({ plot: bare })
    const panel = await openDetail('まだ空のビート')
    expect(
      within(panel).getByText('このビートに書かれているのはタイトルだけです。'),
    ).toBeInTheDocument()
  })

  it('人物チップを押すと用語集パネルへ渡す（本文の [[用語]] と同じ導線）', async () => {
    const { onRefClick } = await setup()
    const panel = await openDetail('駅前の再会')
    fireEvent.click(within(panel).getByRole('button', { name: 'レン' }))
    expect(onRefClick).toHaveBeenCalledWith('レン')
  })

  it('「ビートの一覧へ戻る」で一覧に戻り、詳細は閉じる', async () => {
    await setup()
    const panel = await openDetail('駅前の再会')
    fireEvent.click(within(panel).getByRole('button', { name: 'ビートの一覧へ戻る' }))
    expect(screen.queryByRole('complementary', { name: 'ビートの詳細' })).toBeNull()
    expect(screen.getByRole('button', { name: '「駅前の再会」の詳細' })).toBeInTheDocument()
  })

  it('詳細の「プロット画面で開く」はそのビートを指して移動する', async () => {
    const { onJumpBeat } = await setup()
    const panel = await openDetail('駅前の再会')
    fireEvent.click(within(panel).getByRole('button', { name: /プロット画面で開く/ }))
    expect(onJumpBeat).toHaveBeenCalledWith('b1')
  })

  it('状態チップは一覧でも詳細でも押すたびに循環し、保存される', async () => {
    const { repo } = await setup()
    const panel = await openDetail('駅前の再会')
    fireEvent.click(within(panel).getByRole('button', { name: '✎ 執筆中' }))
    await waitFor(async () => {
      const saved = await repo.get('p1')
      expect(saved?.beats.find((b) => b.id === 'b1')?.status).toBe('done')
    })
    expect(await within(detail()).findByRole('button', { name: '✓ 済' })).toBeInTheDocument()
  })

  it('話を選んでいなければ「紐づくビートが無い」案内を出す', async () => {
    await setup({ episodeId: null })
    expect(await screen.findByText(/この話に紐づくビートはありません/)).toBeInTheDocument()
  })

  it('プロットがまだ無ければ作る導線を出す', async () => {
    const { onOpenPlot } = await setup({ plot: null })
    fireEvent.click(await screen.findByRole('button', { name: 'プロットを作る' }))
    expect(onOpenPlot).toHaveBeenCalledTimes(1)
  })

  it('ネタ帳のメモが消えていても詳細は開ける', async () => {
    await setup({ withIdea: false })
    const panel = await openDetail('駅前の再会')
    expect(within(panel).getByRole('heading', { name: '駅前の再会' })).toBeInTheDocument()
    expect(within(panel).queryByText('ネタ帳のメモ')).toBeNull()
  })

  it('一覧の → はプロット画面へ、カード本体は詳細へ（別々の入口）', async () => {
    const { onJumpBeat } = await setup()
    fireEvent.click(await screen.findByRole('button', { name: '「終電」をプロット画面で開く' }))
    expect(onJumpBeat).toHaveBeenCalledWith('b3')
    expect(screen.queryByRole('complementary', { name: 'ビートの詳細' })).toBeNull()
  })
})
