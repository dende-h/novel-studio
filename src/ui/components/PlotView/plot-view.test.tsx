import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { addBeat, type Plot, singletonPlotId, upsertSecret } from '@/core/plot'
import { MemoryStore } from '@/core/storage/memoryStore'
import { PlotRepository } from '@/core/storage/plotRepository'
import PlotView from './plot-view'

/**
 * プロット画面の「変更の共通経路」。関心は、欄の blur 確定と直後のボタン操作が
 * 保存の完了を待たずに続いたとき、先の確定が黙って消えないこと。
 * 実際の画面ではクリックの mousedown で欄が blur して要約を保存し始め、その保存の
 * await 中に click が来て状態を保存する。保存をテストが解くまで止めてこの間合いを作る。
 */

const WORK = 'w1'

async function seed(extra: (p: Plot) => Plot = (p) => p) {
  const repo = new PlotRepository(new MemoryStore())
  const base = await repo.create(WORK, 'custom', undefined, singletonPlotId(WORK))
  const sectionId = base.sections[0]?.id ?? ''
  const withBeat = addBeat(base, sectionId, {
    id: 'b1',
    title: '旅立ち',
    castRefs: [],
    placeRefs: [],
    lineRefs: [],
    status: 'idea',
  })
  await repo.save(extra(withBeat))
  return repo
}

/** repo.save を open() まで止める（IndexedDB の書き込み待ちを引き延ばした状態）。 */
function holdSaves(repo: PlotRepository) {
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  const realSave = repo.save.bind(repo)
  vi.spyOn(repo, 'save').mockImplementation(async (p) => {
    await gate
    return realSave(p)
  })
  return {
    open: () =>
      act(async () => {
        open()
      }),
  }
}

const renderPlot = (repo: PlotRepository) =>
  render(
    <PlotView repo={repo} workId={WORK} glossary={[]} episodes={[]} onOpenEpisode={() => {}} />,
  )

const stored = async (repo: PlotRepository) => repo.get(singletonPlotId(WORK))

describe('PlotView（変更の共通経路）', () => {
  it('要約を書いた直後に状態ボタンを押しても、要約と状態の両方が保存に残る', async () => {
    const repo = await seed()
    renderPlot(repo)
    const summary = await screen.findByRole('textbox', { name: 'ビートの要約' })
    const saves = holdSaves(repo)

    fireEvent.focus(summary)
    fireEvent.change(summary, { target: { value: '主人公が村を出る' } })
    // クリックの mousedown で欄が blur → 要約の保存が走り出し、その完了を待たずに click。
    fireEvent.blur(summary)
    fireEvent.click(screen.getByRole('button', { name: '確定' }))
    await saves.open()

    await waitFor(async () => {
      expect((await stored(repo))?.beats[0]).toMatchObject({
        summary: '主人公が村を出る',
        status: 'fixed',
      })
    })
    // 表示も保存後の値に揃う（状態ボタンの押下表示と、要約の欄の中身）。
    //（カードの状態チップも「確定」になるので、押下状態を持つ右パネルのボタンで引く）
    expect(await screen.findByRole('button', { name: '確定', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'ビートの要約' })).toHaveValue('主人公が村を出る')
  })

  it('秘密の真相を書いた直後に「最後まで明かさない」を押しても、真相が消えない', async () => {
    const repo = await seed((p) => upsertSecret(p, { id: 's1', title: 'ユキの正体' }))
    renderPlot(repo)
    fireEvent.click(await screen.findByRole('button', { name: /^伏線・秘密/ }))
    const truth = screen.getByRole('textbox', { name: '秘密の真相' })
    const saves = holdSaves(repo)

    fireEvent.focus(truth)
    fireEvent.change(truth, { target: { value: '実は雪の精' } })
    fireEvent.blur(truth)
    fireEvent.click(screen.getByRole('button', { name: '最後まで明かさない' }))
    await saves.open()

    await waitFor(async () => {
      expect((await stored(repo))?.secrets[0]).toMatchObject({
        truth: '実は雪の精',
        keepHidden: true,
      })
    })
  })
})
