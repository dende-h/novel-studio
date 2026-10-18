import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { plainTextOfBlock } from '@/core/game'
import {
  addRatio,
  createVariantCountCache,
  type DialogueRatio,
  dialogueRatio,
  inlineSignalsOf,
  type NameCandidate,
  proofreadNovel,
} from '@/core/proofread'
import {
  classify,
  decide,
  type FindingN,
  findingKey,
  openFixes,
  type ProofreadDecision,
  type ProofreadRecord,
  undecide,
  type Verdict,
  withNth,
} from '@/core/proofread/decisions'
import { dismissName, restoreName } from '@/core/proofread/name-dismissals'
import { NOVEL_RULES } from '@/core/proofread/types'
import { glossaryTerms } from '@/core/proofread/user-dict'
import type { Work } from '@/core/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'
import { Progress } from '@/ui/components/ui/progress'
import { useMorphAnalyzer } from '@/ui/hooks/use-morph-analyzer'
import { type NameDismissalRepo, useNameDismissals } from '@/ui/hooks/use-name-dismissals'
import { useProofreadPrefs } from '@/ui/hooks/use-proofread-prefs'
import { type ProofreadRecordRepo, useProofreadRecord } from '@/ui/hooks/use-proofread-record'
import type { MorphAnalyzerClient } from '@/ui/proofread/analyzer-client'
import { textsHash } from '@/ui/proofread/analyzer-engine'
import type { AnalysisResult } from '@/ui/proofread/protocol'
import { AnalysisPanel } from './analysis-panel'
import { type FindingFilter, FindingList } from './finding-list'
import { NameCandidatesSection } from './name-candidates-section'
import { ProofreadText } from './proofread-text'
import { RuleToggles } from './rule-toggles'

export interface FixInEditorTarget {
  episodeId: string
  decision: ProofreadDecision
}

interface ProofreadViewProps {
  work: Work
  currentEpisodeId: string | null
  repo: ProofreadRecordRepo
  /** 「本文で直す」。執筆画面へ戻り、その話を開いて該当箇所を選ぶ（App が配線する）。 */
  onFixInEditor: (target: FixInEditorTarget) => void
  /** 候補から外した語（COT-59）。省略時は外した語を保存しない。 */
  namesRepo?: NameDismissalRepo
  /** 名前の候補を用語集に登録する（App のクイック作成を開き、閉じたら「作成したか」を返す・COT-59）。 */
  onRegisterName?: (draft: {
    name: string
    reading?: string
    category?: string
  }) => Promise<'created' | 'cancelled'>
  /** テスト用：解析器の窓口を差し替える。 */
  createAnalyzer?: () => MorphAnalyzerClient
  now?: () => number
}

const SELECT_CLASS =
  'w-56 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 text-base text-on-surface outline-none focus:border-primary md:text-sm'

const fmtMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/** 動きを減らす設定の人には、なめらかに送らず一度で送る。 */
const scrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'

const ZERO: DialogueRatio = { dialogue: 0, narration: 0 }
const NO_GLOSSARY: NonNullable<Work['glossary']> = []

/**
 * 推敲画面（COT-40）。本文は読むだけで、指摘ごとに「直す／このまま」を選ぶ。
 * くわしい確認（形態素解析）は、この画面を開いている間だけ Worker で動かす。
 */
export function ProofreadView({
  work,
  currentEpisodeId,
  repo,
  onFixInEditor,
  namesRepo,
  onRegisterName,
  createAnalyzer,
  now = Date.now,
}: ProofreadViewProps) {
  const [episodeId, setEpisodeId] = useState(currentEpisodeId ?? work.episodes[0]?.id ?? '')
  const episode = work.episodes.find((e) => e.id === episodeId) ?? work.episodes[0]
  const { enabled, toggle } = useProofreadPrefs()
  // 選んでいない項目は指摘も集計も作らない（最初は何も選ばれていない）
  const disabled = useMemo(
    () => new Set(NOVEL_RULES.map((r) => r.id).filter((id) => !enabled.has(id))),
    [enabled],
  )
  const { record, save } = useProofreadRecord(repo, work.id, episode?.id)
  const {
    state: analyzer,
    client,
    excluded,
    retry,
  } = useMorphAnalyzer(work.glossary ?? NO_GLOSSARY, createAnalyzer)
  const [analysis, setAnalysis] = useState<(AnalysisResult & { episodeId: string }) | null>(null)
  const [filter, setFilter] = useState<FindingFilter>('pending')
  const [tab, setTab] = useState<'findings' | 'analysis'>('findings')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [word, setWord] = useState<string | null>(null)
  // 「確認する項目」は開いた状態で始める（何を確かめるかを作者が選ぶ）
  const [rulesOpen, setRulesOpen] = useState(true)
  const textRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 本文の印から選んだ指摘。一覧（絞り込みが変わることがある）を描き直したあとで、そのカードまで送る。
  const [scrollToKey, setScrollToKey] = useState<string | null>(null)

  // 作品全体を Worker で解析する（準備ができたとき・話や本文が変わったとき）
  const ready = analyzer.status === 'ready'
  const episodesPayload = useMemo(
    () =>
      work.episodes.map((e) => {
        const texts = e.blocks.map(plainTextOfBlock)
        // ルビと [[ ]] は名前の候補だけに使う（トークンのキャッシュはハッシュ＝本文の文字で決まる）
        return { id: e.id, hash: textsHash(texts), texts, ...inlineSignalsOf(e.blocks) }
      }),
    [work.episodes],
  )
  useEffect(() => {
    if (!ready || !episode) return
    let alive = true
    client.analyze(episodesPayload, episode.id).then(
      (r) => {
        if (alive) setAnalysis({ ...r, episodeId: episode.id })
      },
      () => {
        // 止めた・落ちたときは状態（error）の表示に任せる
      },
    )
    return () => {
      alive = false
    }
  }, [ready, client, episodesPayload, episode])

  // 他の話の辞書の表記ゆれ集計（話ごとにキャッシュ）
  const variantCache = useMemo(() => createVariantCountCache(), [])
  const baseCounts = useMemo(
    () => variantCache(work.episodes.filter((e) => e.id !== episode?.id)),
    [variantCache, work.episodes, episode?.id],
  )

  const morph = useMemo(
    () =>
      ready && analysis && analysis.episodeId === episode?.id
        ? { tokens: analysis.currentTokens, workVariants: analysis.workVariants, excluded }
        : undefined,
    [ready, analysis, episode?.id, excluded],
  )
  const findings = useMemo<FindingN[]>(
    () => (episode ? withNth(proofreadNovel(episode.blocks, { disabled, baseCounts, morph })) : []),
    [episode, disabled, baseCounts, morph],
  )
  const groups = useMemo(() => classify(findings, record), [findings, record])

  const ids = { workId: work.id, episodeId: episode?.id ?? '' }
  const persist = (next: ProofreadRecord) => {
    void save(next)
  }
  const setVerdict = (fs: FindingN[], verdict: Verdict) => {
    if (!episode) return
    persist(decide(record, ids, fs, verdict, now(), episode.blocks))
    setActiveKey(null)
  }
  const undo = (f: FindingN) => {
    if (!record) return
    persist(undecide(record, f, now()))
    setActiveKey(null)
  }
  const fixInEditor = (f: FindingN) => {
    if (!episode || !record) return
    const decision = record.decisions.find(
      (d) => d.blockId === f.blockId && d.code === f.code && d.text === f.text && d.nth === f.nth,
    )
    if (!decision) return
    // まだ直っていない判断だけを渡す（直っていれば移る先が無い）
    const open = openFixes({ ...record, decisions: [decision] }, episode.blocks)
    if (open.length > 0) onFixInEditor({ episodeId: episode.id, decision })
  }
  const select = useCallback((f: FindingN) => {
    setActiveKey(findingKey(f))
    textRef.current
      ?.querySelector(`#proofread-p-${f.blockIndex}`)
      ?.scrollIntoView?.({ block: 'center', behavior: scrollBehavior() })
  }, [])
  const selectFromText = (f: FindingN) => {
    const key = findingKey(f)
    setTab('findings')
    setFilter(groups.fix.some((g) => findingKey(g) === key) ? 'fix' : 'pending')
    setActiveKey(key)
    setScrollToKey(key)
  }
  useEffect(() => {
    if (!scrollToKey || tab !== 'findings') return
    const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-finding-key]') ?? []
    const card = [...cards].find((el) => el.dataset.findingKey === scrollToKey)
    card?.scrollIntoView?.({ block: 'center', behavior: scrollBehavior() })
    setScrollToKey(null)
  })

  // 分析（セリフと地の文はくわしい確認を使わない）
  const ratios = useMemo(
    () => work.episodes.map((e) => ({ id: e.id, title: e.title, ratio: dialogueRatio(e.blocks) })),
    [work.episodes],
  )
  const currentRatio = ratios.find((r) => r.id === episode?.id)?.ratio ?? ZERO
  const workRatio = ratios.reduce((sum, r) => addRatio(sum, r.ratio), ZERO)
  const frequent =
    analyzer.status === 'error' ? 'error' : ready && analysis ? analysis.frequent : null

  // 用語集に無い名前（COT-59）。用語集が変わると解析器は作り直されるが、その間も前回の結果を
  // いまの用語集と外した語で絞って出し続ける（準備中にするのは、まだ一度も結果が無いときだけ）。
  const { record: dismissals, save: saveDismissals } = useNameDismissals(namesRepo, work.id)
  const dismissedWords = useMemo(() => (dismissals?.words ?? []).map((w) => w.text), [dismissals])
  const glossaryNow = useMemo(
    () => new Set(glossaryTerms(work.glossary ?? NO_GLOSSARY)),
    [work.glossary],
  )
  const names = useMemo<ReadonlyArray<NameCandidate> | null | 'error'>(() => {
    if (analyzer.status === 'error') return 'error'
    if (!analysis) return null
    const hidden = new Set(dismissedWords)
    return analysis.names.filter((c) => !hidden.has(c.name) && !glossaryNow.has(c.name))
  }, [analyzer.status, analysis, dismissedWords, glossaryNow])
  const inThisEpisode = (name: string) =>
    episode?.blocks.some((b) => plainTextOfBlock(b).includes(name)) ?? false
  const dismiss = (name: string) => {
    if (word === name) setWord(null)
    void saveDismissals(dismissName(dismissals, work.id, name, now()))
  }
  const restore = (name: string) => {
    if (dismissals) void saveDismissals(restoreName(dismissals, name, now()))
  }
  const register = (c: NameCandidate) =>
    onRegisterName
      ? onRegisterName({ name: c.name, reading: c.reading, category: c.category })
      : Promise.resolve('cancelled' as const)

  const marks = [
    ...groups.pending.map((f) => ({ finding: f, state: 'pending' as const })),
    ...groups.fix.map((f) => ({ finding: f, state: 'fix' as const })),
  ]
  const shown = groups[filter]
  const morphState: 'ready' | 'loading' | 'error' =
    analyzer.status === 'error' ? 'error' : ready ? 'ready' : 'loading'

  return (
    <div className="flex min-h-0 flex-1 flex-col font-sans">
      <header className="relative shrink-0 border-outline-variant/30 border-b px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <h2 className="font-serif text-primary text-xl">推敲</h2>
            <p className="mt-0.5 text-on-surface-variant text-xs tabular-nums">
              未判断 {groups.pending.length} ・ 直す {groups.fix.length} ・ このまま{' '}
              {groups.keep.length}
            </p>
            <p className="mt-0.5 text-on-surface-variant/80 text-xs">
              指摘ごとに、直すか、このままにするかを選べます。直すと決めた箇所だけが本文の画面に出ます。
            </p>
          </div>
          <label className="ml-auto flex items-center gap-2 text-on-surface-variant text-xs">
            話
            <select
              value={episode?.id ?? ''}
              onChange={(e) => {
                setEpisodeId(e.target.value)
                setActiveKey(null)
                setWord(null)
              }}
              className={SELECT_CLASS}
            >
              {work.episodes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title || '無題'}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={rulesOpen}
            onClick={() => setRulesOpen((v) => !v)}
          >
            確認する項目
          </Button>
          <AnalyzerStatus state={analyzer} onRetry={retry} />
        </div>
        {rulesOpen ? (
          <div className="mt-3">
            <RuleToggles enabled={enabled} onToggle={toggle} morph={morphState} />
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={textRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {!episode || episode.blocks.every((b) => !plainTextOfBlock(b).trim()) ? (
            <p className="p-6 text-center text-on-surface-variant text-sm">
              この話にはまだ本文がありません
            </p>
          ) : (
            <ProofreadText
              blocks={episode.blocks}
              marks={marks}
              activeKey={activeKey}
              word={tab === 'analysis' ? word : null}
              onSelect={selectFromText}
            />
          )}
        </div>

        <aside className="flex w-96 shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-low">
          <div className="flex gap-1.5 px-4 pt-4" role="tablist" aria-label="指摘と分析">
            {(
              [
                ['findings', '指摘'],
                ['analysis', '分析'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={chipClass(tab === key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'findings' ? (
            <>
              <fieldset className="flex flex-wrap gap-1.5 border-0 px-4 pt-3 pb-2">
                <legend className="sr-only">絞り込み</legend>
                {(
                  [
                    ['pending', '未判断'],
                    ['fix', '直す'],
                    ['keep', 'このまま'],
                  ] as const
                ).map(([key, label]) => (
                  <Chip
                    key={key}
                    active={filter === key}
                    onClick={() => {
                      setFilter(key)
                      setActiveKey(null)
                    }}
                  >
                    {label} {groups[key].length}
                  </Chip>
                ))}
              </fieldset>
              <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                {enabled.size === 0 ? (
                  <p className="p-6 text-center text-on-surface-variant text-sm">
                    上の「確認する項目」から、確かめたい項目を選んでください
                  </p>
                ) : findings.length === 0 &&
                  episode?.blocks.some((b) => plainTextOfBlock(b).trim()) ? (
                  <p className="p-6 text-center text-on-surface-variant text-sm">
                    確認する項目では、気になる箇所は見つかりませんでした
                  </p>
                ) : (
                  <FindingList
                    filter={filter}
                    findings={shown}
                    pending={groups.pending}
                    blocks={episode?.blocks ?? []}
                    activeKey={activeKey}
                    onSelect={select}
                    onFix={(f) => setVerdict([f], 'fix')}
                    onKeep={(f) => setVerdict([f], 'keep')}
                    onKeepAll={(fs) => setVerdict(fs, 'keep')}
                    onUndo={undo}
                    onFixInEditor={fixInEditor}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AnalysisPanel
                names={
                  <NameCandidatesSection
                    candidates={names}
                    dismissed={dismissedWords}
                    selected={word}
                    inThisEpisode={inThisEpisode}
                    onSelect={setWord}
                    onRegister={register}
                    onDismiss={dismiss}
                    onRestore={restore}
                  />
                }
                frequent={frequent}
                word={word}
                onWord={setWord}
                current={currentRatio}
                work={workRatio}
                episodes={ratios}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/** プロット画面の ViewTab と同じ見た目の丸いチップ（選択中は bg-primary）。 */
const chipClass = (active: boolean) =>
  cn(
    'inline-flex items-center rounded-full px-3 py-1 font-medium text-[12px] tabular-nums transition-colors',
    active
      ? 'bg-primary text-primary-foreground'
      : 'border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high',
  )

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={chipClass(active)}>
      {children}
    </button>
  )
}

function AnalyzerStatus({
  state,
  onRetry,
}: {
  state: ReturnType<typeof useMorphAnalyzer>['state']
  onRetry: () => void
}) {
  if (state.status === 'error') {
    return (
      <p className="flex items-center gap-2 text-error text-xs">
        くわしい確認は、いまは使えません。
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          もう一度試す
        </Button>
      </p>
    )
  }
  if (state.status === 'ready') {
    return state.work ? (
      <p className="text-on-surface-variant text-xs tabular-nums">
        作品全体を確認しています（{state.work.done} / {state.work.total}話）
      </p>
    ) : null
  }
  const total = state.status === 'loading' ? state.total : 0
  const loaded = state.status === 'loading' ? state.loaded : 0
  return (
    <div className="flex items-center gap-2 text-on-surface-variant text-xs tabular-nums">
      <span>くわしい確認の準備をしています{total > 0 ? '（辞書の読み込みは初回のみ）' : ''}</span>
      {total > 0 ? (
        <>
          <Progress
            value={Math.min(100, (loaded / total) * 100)}
            className="w-28"
            aria-label="辞書の読み込み"
          />
          <span>
            {fmtMb(loaded)} / {fmtMb(total)}MB
          </span>
        </>
      ) : null}
    </div>
  )
}
export default ProofreadView
