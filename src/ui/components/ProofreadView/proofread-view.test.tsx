import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import { countAutoVariants, frequentWords, type NameCandidate } from '@/core/proofread'
import type { ProofreadRecord } from '@/core/proofread/decisions'
import { sampleTokens } from '@/core/proofread/morph/fixtures'
import type { NameDismissals } from '@/core/proofread/name-dismissals'
import { NOVEL_RULES } from '@/core/proofread/types'
import type { ProofreadRules } from '@/core/proofread/work-rules'
import type { Work } from '@/core/schema'
import type { NameDismissalRepo } from '@/ui/hooks/use-name-dismissals'
import { reloadProofreadPrefs } from '@/ui/hooks/use-proofread-prefs'
import type { ProofreadRulesRepo } from '@/ui/hooks/use-proofread-rules'
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

function fakeRepo(initial?: ProofreadRecord, others: ProofreadRecord[] = []) {
  const rows = new Map<string, ProofreadRecord>()
  for (const r of [...others, ...(initial ? [initial] : [])])
    rows.set(`${r.workId}:${r.episodeId}`, r)
  return {
    rows,
    get: vi.fn(async (w: string, e: string) => rows.get(`${w}:${e}`)),
    save: vi.fn(async (r: ProofreadRecord) => {
      rows.set(`${r.workId}:${r.episodeId}`, r)
    }),
    listByWork: vi.fn(async (w: string) => [...rows.values()].filter((r) => r.workId === w)),
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
      names: [],
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
  opts: {
    repo?: ReturnType<typeof fakeRepo>
    analyzer?: ReturnType<typeof fakeAnalyzer>
    namesRepo?: NameDismissalRepo
    rulesRepo?: ProofreadRulesRepo
    onRegisterName?: (draft: {
      name: string
      reading?: string
      category?: string
    }) => Promise<'created' | 'cancelled'>
  } = {},
) {
  const repo = opts.repo ?? fakeRepo()
  const analyzer = opts.analyzer ?? fakeAnalyzer()
  const onFixInEditor = vi.fn()
  const ui = (next: Work) => (
    <ProofreadView
      work={next}
      currentEpisodeId={w.episodes[0]?.id ?? null}
      repo={repo}
      onFixInEditor={onFixInEditor}
      namesRepo={opts.namesRepo}
      rulesRepo={opts.rulesRepo}
      onRegisterName={opts.onRegisterName}
      createAnalyzer={() => analyzer}
      now={() => 1000}
    />
  )
  const view = render(ui(w))
  await act(async () => {})
  /** 作品（用語集など）を替えて描き直す。 */
  const rerenderWork = async (next: Work) => {
    view.rerender(ui(next))
    await act(async () => {})
  }
  return { ...view, repo, analyzer, onFixInEditor, rerenderWork }
}

/** 一覧の指摘カード（「確認する項目」のチップと名前が重なるので、カードの「本文で見る」ボタンから辿る）。 */
const findingCard = (text: RegExp) =>
  screen
    .getByRole('button', { name: new RegExp(`^本文で見る：.*${text.source}`) })
    .closest('li') as HTMLElement

// 既定は何も選ばれていない（COT-40）。指摘を見るテストは、すべての項目を選んだ状態から始める
const selectAll = () => {
  localStorage.setItem('ns-proofread-on', JSON.stringify(NOVEL_RULES.map((r) => r.id)))
  reloadProofreadPrefs()
}
beforeEach(selectAll)
afterEach(() => {
  localStorage.removeItem('ns-proofread-on')
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

  it('最初は「確認する項目」が開いていて何も選ばれておらず、選んだ項目の指摘だけが出る', async () => {
    localStorage.removeItem('ns-proofread-on')
    reloadProofreadPrefs()
    await renderView(work([{ id: 'e1', title: '第一話', body: '「待って。」\n彼は言った。' }]))
    const group = screen.getByRole('group', { name: '確認する項目' })
    for (const b of within(group).getAllByRole('button'))
      expect(b).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByText('上の「確認する項目」から、確かめたい項目を選んでください'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^指摘を選ぶ/ })).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: '字下げ' }))
    expect(screen.getByText('未判断 1 ・ 直す 0 ・ このまま 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '指摘を選ぶ：彼' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('ns-proofread-on') ?? '[]')).toEqual(['indent'])
    // 欄は「確認する項目」で閉じられる
    fireEvent.click(screen.getByRole('button', { name: '確認する項目' }))
    expect(screen.queryByRole('group', { name: '確認する項目' })).toBeNull()
  })

  it('項目にフォーカス（ホバー）すると、何を探す項目かの説明が出る', async () => {
    await renderView(work([{ id: 'e1', title: '第一話', body: '「待って。」' }]))
    const chip = within(screen.getByRole('group', { name: '確認する項目' })).getByRole('button', {
      name: '！？の後の空白',
    })
    await act(async () => {
      fireEvent.focus(chip)
    })
    expect(
      (await screen.findAllByText(/！や？の後ろに全角空白を空けずに文が続く箇所を探します/)).length,
    ).toBeGreaterThan(0)
  })

  it('確認する項目で外した項目は一覧にも本文にも出ない（9 項目）', async () => {
    await renderView(work([{ id: 'e1', title: '第一話', body: '「待って。」\n彼は言った。' }]))
    const group = screen.getByRole('group', { name: '確認する項目' })
    expect(within(group).getAllByRole('button')).toHaveLength(9)
    fireEvent.click(within(group).getByRole('button', { name: '字下げ' }))
    expect(screen.queryByRole('button', { name: '指摘を選ぶ：彼' })).toBeNull()
    expect(screen.getByText('未判断 1 ・ 直す 0 ・ このまま 0')).toBeInTheDocument()
  })

  it('本文の印を押すと、右の一覧をその指摘のカードまで送る（直すの印なら「直す」へ切り替えてから）', async () => {
    const original = Element.prototype.scrollIntoView
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    try {
      await renderView(
        work([
          {
            id: 'e1',
            title: '第一話',
            body: '「待って。」\n彼は言った。\n　光がが揺れた。\n　「行こう!」',
          },
        ]),
      )
      const scrolledCards = () =>
        spy.mock.contexts.filter(
          (el): el is HTMLElement => el instanceof HTMLElement && el.tagName === 'LI',
        )
      fireEvent.click(screen.getByRole('button', { name: '指摘を選ぶ：がが' }))
      await act(async () => {})
      expect(scrolledCards().at(-1)).toBe(findingCard(/同じ語の連続「がが」/))
      expect(findingCard(/同じ語の連続「がが」/)).toHaveClass('border-primary')

      // 「直す」にした指摘の印から選ぶと、絞り込みを「直す」に替えてからそのカードまで送る
      fireEvent.click(
        within(findingCard(/閉じ括弧の前の句読点/)).getByRole('button', { name: '直す' }),
      )
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: '指摘を選ぶ：。」' }))
      await act(async () => {})
      expect(screen.getByRole('button', { name: '直す 1' })).toHaveAttribute('aria-pressed', 'true')
      expect(scrolledCards().at(-1)).toBe(findingCard(/閉じ括弧の前の句読点「。」」/))
      // カードを押したとき（一覧から選ぶ）は一覧を送らない（本文の段落を送るだけ）
      spy.mockClear()
      fireEvent.click(screen.getByRole('button', { name: /本文で見る：閉じ括弧の前の句読点/ }))
      await act(async () => {})
      expect(scrolledCards()).toEqual([])
      expect(spy.mock.contexts.some((el) => el instanceof HTMLElement && el.tagName === 'P')).toBe(
        true,
      )
    } finally {
      Element.prototype.scrollIntoView = original
    }
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

/** 外した語の偽の repo。 */
function fakeNamesRepo(initial?: NameDismissals, opts: { broken?: boolean } = {}) {
  let row = initial
  return {
    get row() {
      return row
    },
    get: vi.fn(async () => {
      if (opts.broken) throw new Error('壊れた記録')
      return row
    }),
    save: vi.fn(async (r: NameDismissals) => {
      row = r
    }),
  }
}

const NAMES: NameCandidate[] = [
  { name: '湊斗', count: 3, episodes: 2, signals: ['split-kanji'] },
  {
    name: 'リリアーナ',
    count: 2,
    episodes: 1,
    signals: ['katakana'],
    category: '人物',
    reading: 'りりあーな',
  },
  {
    name: '新宿',
    count: 2,
    episodes: 1,
    signals: ['dict-proper'],
    category: '場所',
    reading: 'しんじゅく',
  },
  { name: 'レオンハルト', count: 2, episodes: 1, signals: ['katakana'], reading: 'れおんはると' },
]
const NAME_BODY = '「リリアーナ様」\n　湊斗は新宿にいた。湊斗が笑う。'

/** 分析タブを開いた状態で、名前の候補を返す解析器を準備できたところまで進める。 */
async function openNames(
  opts: Parameters<typeof renderView>[1] & {
    names?: NameCandidate[]
    glossary?: Work['glossary']
  } = {},
) {
  const analyzer = fakeAnalyzer({ names: opts.names ?? NAMES })
  const w = { ...work([{ id: 'e1', title: '第一話', body: NAME_BODY }]), glossary: opts.glossary }
  const view = await renderView(w, { ...opts, analyzer })
  await act(async () => analyzer.set({ status: 'ready', work: null }))
  await act(async () => {})
  fireEvent.click(screen.getByRole('tab', { name: '分析' }))
  return { ...view, w }
}
/** 名前の行の、名前のボタン（押すと本文に印を付ける）。 */
const nameButton = (name: string) =>
  screen
    .getAllByRole('button', { name: new RegExp(`^${name}`) })
    .find((b) => b.hasAttribute('aria-pressed')) as HTMLElement
const namesSection = () => screen.getByRole('region', { name: '用語集に無い名前（作品全体）' })

describe('用語集に無い名前（COT-59）', () => {
  it('前回の結果が無く準備中なら準備中、使えないなら使えない、0件ならその旨を出す', async () => {
    const analyzer = fakeAnalyzer({ names: [] })
    await renderView(work([{ id: 'e1', title: '第一話', body: NAME_BODY }]), { analyzer })
    fireEvent.click(screen.getByRole('tab', { name: '分析' }))
    const section = namesSection
    expect(
      within(section()).getByText('くわしい確認の準備ができると表示します。'),
    ).toBeInTheDocument()
    await act(async () => analyzer.set({ status: 'ready', work: null }))
    await act(async () => {})
    expect(
      within(section()).getByText('用語集に無い名前は見つかりませんでした。'),
    ).toBeInTheDocument()
    await act(async () => analyzer.set({ status: 'error', reason: 'memory' }))
    expect(within(section()).getByText('くわしい確認は、いまは使えません。')).toBeInTheDocument()
  })

  it('行に名前・分類・回数・話数と、名前を含めて読み上げるボタンを出す', async () => {
    await openNames()
    expect(screen.getByText('人物・2回・1話')).toBeInTheDocument()
    expect(screen.getByText('3回・2話')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'リリアーナを用語集に登録' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'リリアーナを外す' })).toBeInTheDocument()
  })

  it('名前を押すと本文にマーカーが引かれ、もう一度で消える。この話に無い名前なら補足が替わる', async () => {
    const { container } = await openNames()
    fireEvent.click(nameButton('湊斗'))
    expect(nameButton('湊斗')).toHaveAttribute('aria-pressed', 'true')
    expect([...container.querySelectorAll('[data-word-mark]')].map((el) => el.textContent)).toEqual(
      ['湊斗', '湊斗'],
    )
    expect(
      screen.getByText('名前を押すと、この話の本文にマーカーが引かれます。'),
    ).toBeInTheDocument()
    fireEvent.click(nameButton('湊斗'))
    expect(container.querySelectorAll('[data-word-mark]')).toHaveLength(0)
    fireEvent.click(nameButton('レオンハルト'))
    expect(screen.getByText('この話には出てきません。')).toBeInTheDocument()
  })

  it('よく使う言葉を選んでいるときに名前を押すと、言葉の選択が外れる', async () => {
    const analyzer = fakeAnalyzer({
      names: NAMES,
      frequent: frequentWords([sampleTokens(FREQ)], 10000, new Set()),
    })
    await renderView(work([{ id: 'e1', title: '第一話', body: NAME_BODY }]), { analyzer })
    await act(async () => analyzer.set({ status: 'ready', work: null }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('tab', { name: '分析' }))
    const fu = () => screen.getByRole('button', { name: /ふと/ })
    fireEvent.click(fu())
    expect(fu()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(nameButton('湊斗'))
    expect(fu()).toHaveAttribute('aria-pressed', 'false')
    expect(nameButton('湊斗')).toHaveAttribute('aria-pressed', 'true')
  })

  it('外すと一覧から消えて「外した語」に入り、フォーカスは次の行へ。戻すと一覧に戻る', async () => {
    const namesRepo = fakeNamesRepo()
    await openNames({ namesRepo })
    fireEvent.click(screen.getByRole('button', { name: 'リリアーナを外す' }))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'リリアーナを外す' })).toBeNull()
    expect(namesRepo.save).toHaveBeenCalledWith({
      workId: 'w',
      words: [{ text: 'リリアーナ', at: 1000 }],
      updatedAt: 1000,
    })
    expect(document.activeElement).toBe(nameButton('新宿'))
    expect(screen.getByText('外した語（1）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'リリアーナを戻す' }))
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'リリアーナを外す' })).toBeInTheDocument()
    expect(namesRepo.row?.words).toEqual([])
    expect(screen.queryByText(/外した語（/)).toBeNull()
  })

  it('最後の行を外すと前の行へ、全部外すと見出しへフォーカスを移す', async () => {
    await openNames({ names: NAMES.slice(0, 2), namesRepo: fakeNamesRepo() })
    fireEvent.click(screen.getByRole('button', { name: 'リリアーナを外す' }))
    await act(async () => {})
    expect(document.activeElement).toBe(nameButton('湊斗'))
    fireEvent.click(screen.getByRole('button', { name: '湊斗を外す' }))
    await act(async () => {})
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: '用語集に無い名前（作品全体）' }),
    )
  })

  it('本文から無くなった外した語も「外した語」に並び、記録が壊れていても一覧は出る', async () => {
    const { unmount } = await openNames({
      namesRepo: fakeNamesRepo({ workId: 'w', words: [{ text: 'エルフ', at: 1 }], updatedAt: 1 }),
    })
    expect(screen.getByText('外した語（1）')).toBeInTheDocument()
    expect(screen.getByText('エルフ')).toBeInTheDocument()
    unmount()
    await openNames({ namesRepo: fakeNamesRepo(undefined, { broken: true }) })
    expect(screen.getByRole('button', { name: 'リリアーナを外す' })).toBeInTheDocument()
  })

  it('用語集にある名前は出さず、くわしい確認の作り直し中も前回の一覧を出し続ける', async () => {
    const { analyzer, rerenderWork, w } = await openNames()
    await rerenderWork({
      ...w,
      glossary: [{ id: 'g1', name: '新宿', aliases: [], createdAt: 1, updatedAt: 1 }],
    })
    expect(screen.queryByRole('button', { name: '新宿を外す' })).toBeNull()
    await act(async () => analyzer.set({ status: 'loading', loaded: 0, total: 0 }))
    expect(screen.getByRole('button', { name: 'リリアーナを外す' })).toBeInTheDocument()
    expect(
      within(namesSection()).queryByText('くわしい確認の準備ができると表示します。'),
    ).toBeNull()
  })

  it('「用語集に登録」は名前・読み・分類を渡し、作成で行が消えたら次の行、キャンセルなら押したボタンへ戻す', async () => {
    let resolve: (r: 'created' | 'cancelled') => void = () => {}
    const onRegisterName = vi.fn(
      () =>
        new Promise<'created' | 'cancelled'>((r) => {
          resolve = r
        }),
    )
    const { rerenderWork, w } = await openNames({ onRegisterName })
    fireEvent.click(screen.getByRole('button', { name: 'リリアーナを用語集に登録' }))
    expect(onRegisterName).toHaveBeenCalledWith({
      name: 'リリアーナ',
      reading: 'りりあーな',
      category: '人物',
    })
    await act(async () => resolve('cancelled'))
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'リリアーナを用語集に登録' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'リリアーナを用語集に登録' }))
    await rerenderWork({
      ...w,
      glossary: [{ id: 'g1', name: 'リリアーナ', aliases: [], createdAt: 1, updatedAt: 1 }],
    })
    expect(screen.queryByRole('button', { name: 'リリアーナを用語集に登録' })).toBeNull()
    await act(async () => resolve('created'))
    expect(document.activeElement).toBe(nameButton('新宿'))
  })

  it('名前を直して作成した（行が残った）なら、その行の名前のボタンへ戻す', async () => {
    let resolve: (r: 'created' | 'cancelled') => void = () => {}
    const onRegisterName = vi.fn(
      () =>
        new Promise<'created' | 'cancelled'>((r) => {
          resolve = r
        }),
    )
    await openNames({ onRegisterName })
    fireEvent.click(screen.getByRole('button', { name: '新宿を用語集に登録' }))
    await act(async () => resolve('created'))
    expect(document.activeElement).toBe(nameButton('新宿'))
  })
})

/** 作品の決まりの偽の repo。 */
function fakeRulesRepo(initial?: ProofreadRules) {
  let row = initial
  return {
    get row() {
      return row
    },
    get: vi.fn(async () => row),
    save: vi.fn(async (r: ProofreadRules) => {
      row = r
    }),
  }
}

// 同じ語の連続（正規表現の項目）と辞書の表記ゆれは、解析器の準備を待たずに出る
const RULE_BODY = '　彼は言った言った。\n　子供が笑った。子どもも走った。\n　夜だった。'
const ruleWork = () => work([{ id: 'e1', title: '第一話', body: RULE_BODY }])
const keepDecision = (episodeId: string, n: number): ProofreadRecord => ({
  workId: 'w',
  episodeId,
  decisions: Array.from({ length: n }, (_, i) => ({
    blockId: `x${i}`,
    code: 'successive-word',
    text: '言った言った',
    nth: 0,
    anchor: 'contains',
    verdict: 'keep',
    decidedAt: 1,
  })),
  updatedAt: 1,
})
const cardOf = (text: RegExp) => findingCard(text)

describe('作品の決まり（COT-62）', () => {
  it('言葉に結び付く項目のカードにだけ、例外とメニューのボタンが出る', async () => {
    await renderView(ruleWork(), { rulesRepo: fakeRulesRepo() })
    expect(
      within(cardOf(/同じ語の連続「言った言った」/)).getByRole('button', {
        name: '言った言ったをこの作品では指摘しない',
      }),
    ).toBeInTheDocument()
    expect(
      within(cardOf(/表記ゆれ「子供」/)).getByRole('button', {
        name: '子ども・子供の決まりを選ぶ',
      }),
    ).toBeInTheDocument()
  })

  it('「この作品では指摘しない」で例外ができ、カードが消え、次のカードへフォーカスが移る', async () => {
    const rulesRepo = fakeRulesRepo()
    await renderView(ruleWork(), { rulesRepo })
    fireEvent.click(screen.getByRole('button', { name: '言った言ったをこの作品では指摘しない' }))
    await act(async () => {})
    expect(rulesRepo.row?.exceptions).toEqual([
      { key: 'successive-word:言った言った', label: '言った言った', at: 1000 },
    ])
    expect(screen.queryByRole('button', { name: /^本文で見る：同じ語の連続/ })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getAllByRole('button', { name: /^本文で見る：/ })[0] as HTMLElement,
    )
    expect(screen.getByRole('button', { name: 'この作品の決まり（1）' })).toBeInTheDocument()
  })

  it('メニューの「子どもにそろえる」で好みになり、好みの書き方が消えて説明が替わる', async () => {
    const rulesRepo = fakeRulesRepo()
    await renderView(ruleWork(), { rulesRepo })
    const trigger = within(cardOf(/表記ゆれ「子供」/)).getByRole('button', {
      name: '子ども・子供の決まりを選ぶ',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '子どもにそろえる' }))
    await act(async () => {})
    expect(rulesRepo.row?.preferences).toMatchObject([
      { group: 'dict:kodomo', preferred: '子ども' },
    ])
    expect(screen.queryByRole('button', { name: /^本文で見る：表記ゆれ「子ども」/ })).toBeNull()
    expect(
      within(cardOf(/表記ゆれ「子供」/)).getByText(
        '「子供」は、この作品の表記「子ども」と違います。',
      ),
    ).toBeInTheDocument()
  })

  it('「書き分けを許す」で組のどの書き方も出なくなる', async () => {
    const rulesRepo = fakeRulesRepo()
    await renderView(ruleWork(), { rulesRepo })
    const trigger = within(cardOf(/表記ゆれ「子供」/)).getByRole('button', {
      name: '子ども・子供の決まりを選ぶ',
    })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '書き分けを許す' }))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /^本文で見る：表記ゆれ/ })).toBeNull()
  })

  it('決まりの一覧：0件の案内・行・戻す（フォーカスは次の行）・提案しない言葉', async () => {
    const rulesRepo = fakeRulesRepo({
      workId: 'w',
      exceptions: [
        { key: 'successive-word:言った言った', label: '言った言った', at: 1 },
        { key: 'ra-nuki:見れる', label: '見れる', at: 2 },
      ],
      preferences: [],
      declined: [{ kind: 'exception', key: 'ra-nuki:来れる', label: '来れる', at: 3 }],
      updatedAt: 3,
    })
    await renderView(ruleWork(), { rulesRepo })
    fireEvent.click(screen.getByRole('button', { name: 'この作品の決まり（2）' }))
    expect(screen.getByText('— 同じ語の連続は指摘しない', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('提案しない言葉（1）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '言った言ったの決まりを戻す' }))
    await act(async () => {})
    expect(rulesRepo.row?.exceptions.map((x) => x.key)).toEqual(['ra-nuki:見れる'])
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '見れるの決まりを戻す' }),
    )
    expect(screen.getByRole('button', { name: /^本文で見る：同じ語の連続/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '来れるの提案を戻す' }))
    await act(async () => {})
    expect(rulesRepo.row?.declined).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '見れるの決まりを戻す' }))
    await act(async () => {})
    expect(
      screen.getByText('決まりはまだありません。指摘のカードから作れます。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この作品の決まり' })).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'この作品の決まり' }))
  })

  it('同じ言葉を全話で3回「このまま」にすると提案が出て、「指摘しない」で例外になる', async () => {
    const rulesRepo = fakeRulesRepo()
    const repo = fakeRepo(undefined, [keepDecision('e0', 2)])
    await renderView(ruleWork(), { repo, rulesRepo })
    const status = () =>
      screen.getAllByRole('status').find((el) => el.textContent?.includes('このまま')) ?? null
    expect(status()).toBeNull()
    fireEvent.click(
      within(cardOf(/同じ語の連続「言った言った」/)).getByRole('button', { name: 'このまま' }),
    )
    await act(async () => {})
    expect(
      screen.getByText(
        '「言った言った」を3回このままにしました。この作品では指摘しないようにしますか？',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'このまま 1' }))
    expect(screen.queryByText(/を3回このままにしました/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^未判断 \d+$/ }))
    fireEvent.click(screen.getByRole('button', { name: '指摘しない' }))
    await act(async () => {})
    expect(rulesRepo.row?.exceptions.map((x) => x.key)).toEqual(['successive-word:言った言った'])
    expect(screen.queryByText(/を3回このままにしました/)).toBeNull()
  })

  it('「提案しない」は覚えて、同じ提案を出さない。未判断が0件になった直後にも提案は出る', async () => {
    const rulesRepo = fakeRulesRepo()
    const repo = fakeRepo(undefined, [keepDecision('e0', 2)])
    await renderView(work([{ id: 'e1', title: '第一話', body: '　彼は言った言った。' }]), {
      repo,
      rulesRepo,
    })
    fireEvent.click(
      within(cardOf(/同じ語の連続「言った言った」/)).getByRole('button', { name: 'このまま' }),
    )
    await act(async () => {})
    expect(screen.getByText('未判断の指摘はありません')).toBeInTheDocument()
    expect(screen.getByText(/を3回このままにしました/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提案しない' }))
    await act(async () => {})
    expect(rulesRepo.row?.declined.map((d) => d.key)).toEqual(['successive-word:言った言った'])
    expect(screen.queryByText(/を3回このままにしました/)).toBeNull()
  })

  it('状態の入れ物（role=status）は常にあり、推敲画面に「辞書」の文字が無い（準備中を含む）', async () => {
    const analyzer = fakeAnalyzer()
    const { container } = await renderView(ruleWork(), { analyzer, rulesRepo: fakeRulesRepo() })
    await act(async () => analyzer.set({ status: 'loading', loaded: 1_000_000, total: 12_000_000 }))
    expect(screen.getByText(/初回だけ時間がかかります/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('辞書')
    const labels = [...container.querySelectorAll('[aria-label]')].map((el) =>
      el.getAttribute('aria-label'),
    )
    expect(labels.some((l) => l?.includes('辞書'))).toBe(false)
    expect(container.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull()
  })
})
