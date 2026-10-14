import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import { countAutoVariants, frequentWords } from '@/core/proofread'
import type { ProofreadRecord } from '@/core/proofread/decisions'
import { sampleTokens } from '@/core/proofread/morph/fixtures'
import type { Work } from '@/core/schema'
import { reloadProofreadPrefs } from '@/ui/hooks/use-proofread-prefs'
import type { AnalyzerState, MorphAnalyzerClient } from '@/ui/proofread/analyzer-client'
import type { AnalysisResult } from '@/ui/proofread/protocol'
import { ProofreadView } from './proofread-view'

const RA = '　食べれる。起きれる。寝れない。来れない。見れる。'
const FREQ = 'ふと、思わず、小さく笑った。ふと見ると、ゆっくり歩いていた。'

const work = (episodes: { id: string; title: string; body: string }[]): Work => ({
  id: 'w',
  title: '夜の校舎',
  episodes: episodes.map((e) => ({ id: e.id, title: e.title, blocks: parseEpisodeBody(e.body) })),
})

function fakeRepo(initial?: ProofreadRecord) {
  const rows = new Map<string, ProofreadRecord>()
  if (initial) rows.set(`${initial.workId}:${initial.episodeId}`, initial)
  return {
    rows,
    get: vi.fn(async (w: string, e: string) => rows.get(`${w}:${e}`)),
    save: vi.fn(async (r: ProofreadRecord) => {
      rows.set(`${r.workId}:${r.episodeId}`, r)
    }),
  }
}

/** 偽の解析器。状態は set で動かし、analyze は result を返す。 */
function fakeAnalyzer(result: Partial<AnalysisResult> = {}) {
  let state: AnalyzerState = { status: 'idle' }
  const listeners = new Set<() => void>()
  const client: MorphAnalyzerClient & { set: (s: AnalyzerState) => void } = {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    start: vi.fn(() => client.set({ status: 'loading', loaded: 0, total: 0 })),
    stop: vi.fn(),
    analyze: vi.fn(async () => ({
      currentTokens: [],
      workVariants: { groups: [], groupOf: {} },
      frequent: [],
      ...result,
    })),
    set(s) {
      state = s
      for (const l of listeners) l()
    },
  }
  return client
}

async function renderView(
  w: Work,
  opts: { repo?: ReturnType<typeof fakeRepo>; analyzer?: ReturnType<typeof fakeAnalyzer> } = {},
) {
  const repo = opts.repo ?? fakeRepo()
  const analyzer = opts.analyzer ?? fakeAnalyzer()
  const onFixInEditor = vi.fn()
  const view = render(
    <ProofreadView
      work={w}
      currentEpisodeId={w.episodes[0]?.id ?? null}
      repo={repo}
      onFixInEditor={onFixInEditor}
      createAnalyzer={() => analyzer}
      now={() => 1000}
    />,
  )
  await act(async () => {})
  return { ...view, repo, analyzer, onFixInEditor }
}

const findingCard = (text: RegExp) =>
  screen.getByRole('button', { name: text }).closest('li') as HTMLElement

beforeEach(() => {
  localStorage.removeItem('ns-proofread-off')
  reloadProofreadPrefs()
})
afterEach(() => {
  localStorage.removeItem('ns-proofread-off')
  reloadProofreadPrefs()
})

describe('ProofreadView（推敲画面・COT-40）', () => {
  it('本文は読むだけで、正規表現の項目の指摘はくわしい確認の準備を待たずに出る', async () => {
    await renderView(work([{ id: 'e1', title: '第一話', body: '「待って。」\n彼は言った。' }]))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/くわしい確認の準備をしています/)).toBeInTheDocument()
    expect(screen.getByText('未判断 2 ・ 直す 0 ・ このまま 0')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '本文で見る：閉じ括弧の前の句読点「。」」' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '指摘を選ぶ：。」' })).toHaveAttribute(
      'data-finding-mark',
      'pending',
    )
  })

  it('直す・このまま・未判断に戻すで一覧を移り、判断を保存する', async () => {
    const { repo } = await renderView(
      work([{ id: 'e1', title: '第一話', body: '「待って。」\n彼は言った。' }]),
    )
    fireEvent.click(
      within(findingCard(/閉じ括弧の前の句読点/)).getByRole('button', { name: '直す' }),
    )
    await act(async () => {})
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workId: 'w',
        episodeId: 'e1',
        decisions: [
          expect.objectContaining({ code: 'punct-before-close', verdict: 'fix', occurrence: 0 }),
        ],
      }),
    )
    expect(screen.getByText('未判断 1 ・ 直す 1 ・ このまま 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '指摘を選ぶ：。」' })).toHaveAttribute(
      'data-finding-mark',
      'fix',
    )
    fireEvent.click(within(findingCard(/字下げ/)).getByRole('button', { name: 'このまま' }))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: '指摘を選ぶ：彼' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'このまま 1' }))
    fireEvent.click(within(findingCard(/字下げ/)).getByRole('button', { name: '未判断に戻す' }))
    await act(async () => {})
    expect(screen.getByText('未判断 1 ・ 直す 1 ・ このまま 0')).toBeInTheDocument()
  })

  it('同じ項目・同じ文字列が 2 件以上あれば、まとめてこのままにできる', async () => {
    const { repo } = await renderView(
      work([{ id: 'e1', title: '第一話', body: '「行こう。」「うん。」' }]),
    )
    const cards = screen.getAllByRole('button', { name: /同じ指摘をすべてこのまま（2件）/ })
    fireEvent.click(cards[0] as HTMLElement)
    await act(async () => {})
    expect(
      repo.save.mock.lastCall?.[0].decisions.map((d: { verdict: string }) => d.verdict),
    ).toEqual(['keep', 'keep'])
  })

  it('本文で直す：まだ直っていない判断を渡す', async () => {
    const { onFixInEditor } = await renderView(
      work([{ id: 'e1', title: '第一話', body: '「待って。」' }]),
    )
    fireEvent.click(
      within(findingCard(/閉じ括弧の前の句読点/)).getByRole('button', { name: '直す' }),
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: '直す 1' }))
    fireEvent.click(screen.getByRole('button', { name: '本文で直す' }))
    expect(onFixInEditor).toHaveBeenCalledWith({
      episodeId: 'e1',
      decision: expect.objectContaining({ text: '。」', verdict: 'fix' }),
    })
  })

  it('準備ができると品詞を使う指摘が加わり、分析によく使う言葉が出る', async () => {
    const tokens = [
      sampleTokens(RA.slice(1)).map((t) => ({ ...t, start: t.start + 1, end: t.end + 1 })),
    ]
    const freqTokens = sampleTokens(FREQ)
    const analyzer = fakeAnalyzer({
      currentTokens: tokens,
      workVariants: countAutoVariants([], new Set()),
      frequent: frequentWords([freqTokens], 10000, new Set()),
    })
    await renderView(work([{ id: 'e1', title: '第一話', body: RA }]), { analyzer })
    expect(screen.queryByRole('button', { name: /本文で見る：ら抜き言葉/ })).toBeNull()
    await act(async () => analyzer.set({ status: 'ready', work: null }))
    await act(async () => {})
    expect(analyzer.analyze).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'e1', texts: [RA] })],
      'e1',
    )
    expect(screen.getAllByRole('button', { name: /本文で見る：ら抜き言葉/ })).toHaveLength(5)
    fireEvent.click(screen.getByRole('tab', { name: '分析' }))
    fireEvent.click(screen.getByRole('button', { name: /ふと/ }))
    expect(screen.getByRole('button', { name: /ふと/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('セリフと地の文')).toBeInTheDocument()
  })

  it('準備に失敗したら、くわしい確認は使えない旨ともう一度試すを出し、ほかの項目は動き続ける', async () => {
    const analyzer = fakeAnalyzer()
    await renderView(work([{ id: 'e1', title: '第一話', body: '「待って。」' }]), { analyzer })
    await act(async () => analyzer.set({ status: 'error', reason: 'offline' }))
    expect(screen.getByText(/くわしい確認は、いまは使えません。/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '本文で見る：閉じ括弧の前の句読点「。」」' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(analyzer.start).toHaveBeenCalledTimes(2)
    await act(async () => analyzer.set({ status: 'error', reason: 'memory' }))
    fireEvent.click(screen.getByRole('tab', { name: '分析' }))
    expect(screen.getAllByText(/くわしい確認は、いまは使えません。/).length).toBeGreaterThan(1)
    expect(screen.getByText('セリフと地の文')).toBeInTheDocument()
  })

  it('空の話・指摘 0 件の表示', async () => {
    const { unmount } = await renderView(work([{ id: 'e1', title: '第一話', body: '' }]))
    expect(screen.getByText('この話にはまだ本文がありません')).toBeInTheDocument()
    unmount()
    await renderView(work([{ id: 'e1', title: '第一話', body: '　夜だった。' }]))
    expect(
      screen.getByText('確認する項目では、気になる箇所は見つかりませんでした'),
    ).toBeInTheDocument()
  })

  it('確認する項目でオフにした項目は一覧にも本文にも出ない（9 項目）', async () => {
    await renderView(work([{ id: 'e1', title: '第一話', body: '「待って。」\n彼は言った。' }]))
    fireEvent.click(screen.getByRole('button', { name: '確認する項目' }))
    const group = screen.getByRole('group', { name: '確認する項目' })
    expect(within(group).getAllByRole('button')).toHaveLength(9)
    fireEvent.click(within(group).getByRole('button', { name: '字下げ' }))
    expect(screen.queryByRole('button', { name: '指摘を選ぶ：彼' })).toBeNull()
    expect(screen.getByText('未判断 1 ・ 直す 0 ・ このまま 0')).toBeInTheDocument()
  })

  it('話を切り替えると、その話の指摘と判断を出す', async () => {
    await renderView(
      work([
        { id: 'e1', title: '第一話', body: '「待って。」' },
        { id: 'e2', title: '第二話', body: '　光がが揺れた。' },
      ]),
    )
    fireEvent.change(screen.getByRole('combobox', { name: /話/ }), { target: { value: 'e2' } })
    await act(async () => {})
    expect(
      screen.getByRole('button', { name: '本文で見る：同じ語の連続「がが」' }),
    ).toBeInTheDocument()
  })
})
