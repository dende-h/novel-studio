import { type ReactNode, useId } from 'react'
import type { DialogueRatio, EndingKind, FrequentKind, FrequentWord } from '@/core/proofread'
import { dialoguePercent, ENDING_KINDS, ENDING_RUN_MIN } from '@/core/proofread'
import { cn } from '@/lib/utils'

export type FrequentScope = 'episode' | 'work'

interface FrequentLists {
  /** 副詞・形容詞・形容動詞。 */
  words: ReadonlyArray<FrequentWord>
  conjunctions: ReadonlyArray<FrequentWord>
}

interface PickedWord {
  base: string
  kind: FrequentKind
}

interface EndingTotals {
  counts: Readonly<Record<EndingKind, number>>
  /** 同じ文末が続いたところの数。 */
  runs: number
}

/** 文末の行のどれを選んでいるか（文末の種類か、同じ文末が続くところ）。 */
export type EndingPick = EndingKind | 'runs'

interface AnalysisPanelProps {
  /** 先頭に置く欄（用語集に無い名前・COT-59）。 */
  names?: ReactNode
  /** null＝くわしい確認がまだ（準備中・作品全体を解析中）、'error'＝使えない。 */
  frequent: FrequentLists | null | 'error'
  /** よく使う言葉を数える範囲（この話／作品全体）。 */
  scope: FrequentScope
  onScope: (scope: FrequentScope) => void
  /** 選んでいる言葉（「また」は副詞と接続詞の両方にあるので種類つき）。 */
  selected: PickedWord | null
  /** 選んだ言葉がこの話に出てくるか（作品全体で選んだときの補足に使う）。 */
  wordInEpisode: boolean
  onWord: (word: PickedWord | null) => void
  /** 文末の偏り（地の文）。null＝くわしい確認がまだ、'error'＝使えない。 */
  endings: { current: EndingTotals; work: EndingTotals } | null | 'error'
  selectedEnding: EndingPick | null
  onEnding: (pick: EndingPick | null) => void
  current: DialogueRatio
  work: DialogueRatio
  episodes: ReadonlyArray<{ id: string; title: string; ratio: DialogueRatio }>
}

const fmt = (n: number) => n.toLocaleString('ja-JP')

const ENDING_LABEL: Record<EndingKind, string> = {
  ta: '〜た',
  present: '〜る・〜い・〜だ など',
  noun: '体言止め',
  other: 'そのほか',
}

const totalOf = (t: EndingTotals) => ENDING_KINDS.reduce((sum, k) => sum + t.counts[k], 0)
const percent = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

const SCOPES = [
  ['episode', 'この話'],
  ['work', '作品全体'],
] as const

function RatioRow({ label, ratio }: { label: string; ratio: DialogueRatio }) {
  const pct = dialoguePercent(ratio)
  return (
    <div className="grid grid-cols-[6em_1fr_3.2em] items-center gap-2 text-xs tabular-nums">
      <span className="truncate text-on-surface">{label}</span>
      <span
        role="img"
        aria-label={`${label} セリフ ${pct}％ 地の文 ${100 - pct}％`}
        className="flex h-2.5 overflow-hidden rounded-full bg-secondary-container"
      >
        <span className="block bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right text-on-surface-variant">{pct}％</span>
    </div>
  )
}

/** よく使う言葉の一覧1つ（様子を表す言葉／接続詞）。 */
function WordList({
  label,
  kind,
  words,
  selected,
  onWord,
}: {
  label: string
  kind: FrequentKind
  words: ReadonlyArray<FrequentWord>
  selected: PickedWord | null
  onWord: (word: PickedWord | null) => void
}) {
  const headingId = useId()
  return (
    <div className="mt-2 first:mt-0">
      <h4 id={headingId} className="mb-0.5 px-2 text-[11px] text-on-surface-variant">
        {label}
      </h4>
      {words.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-on-surface-variant">見つかりませんでした。</p>
      ) : (
        <ol aria-labelledby={headingId} className="space-y-0.5">
          {words.map((w, i) => {
            const on = selected?.kind === kind && selected.base === w.base
            return (
              <li key={w.base}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onWord(on ? null : { base: w.base, kind })}
                  className={cn(
                    'grid w-full grid-cols-[1.6em_1fr_auto_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs tabular-nums',
                    on
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface hover:bg-surface-container-low',
                  )}
                >
                  <span className="text-on-surface-variant">{i + 1}</span>
                  <span>{w.base}</span>
                  <span>{fmt(w.count)}件</span>
                  <span className="text-[11px] text-on-surface-variant">
                    1万字あたり {w.per10k}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** 文末の1行（押すと、この話の本文のその文末にマーカーを引く）。 */
function EndingRow({
  label,
  here,
  whole,
  ariaLabel,
  disabled,
  on,
  onClick,
}: {
  label: string
  here: string
  whole: string
  ariaLabel: string
  disabled: boolean
  on: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'grid w-full grid-cols-[1fr_6.5em_4em] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs tabular-nums disabled:cursor-default disabled:opacity-60',
          on
            ? 'bg-primary-container text-on-primary-container'
            : 'text-on-surface enabled:hover:bg-surface-container-low',
        )}
      >
        <span>{label}</span>
        <span className="text-right">{here}</span>
        <span className="text-right text-[11px] text-on-surface-variant">{whole}</span>
      </button>
    </li>
  )
}

/** 文末の偏り（地の文）。この話の文数と割合に、作品全体の割合を並べる。 */
function EndingsSection({
  endings,
  selected,
  onSelect,
}: {
  endings: AnalysisPanelProps['endings']
  selected: EndingPick | null
  onSelect: (pick: EndingPick | null) => void
}) {
  const toggle = (pick: EndingPick) => onSelect(selected === pick ? null : pick)
  return (
    <section>
      <h3 className="mb-1 font-medium text-on-surface text-xs">文末（地の文）</h3>
      {endings === 'error' ? (
        <p className="py-3 text-on-surface-variant text-xs">くわしい確認は、いまは使えません。</p>
      ) : endings === null ? (
        <p className="py-3 text-on-surface-variant text-xs">
          くわしい確認の準備ができると表示します。
        </p>
      ) : totalOf(endings.current) + totalOf(endings.work) === 0 ? (
        <p className="py-3 text-on-surface-variant text-xs">地の文の文がまだありません。</p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="grid grid-cols-[1fr_6.5em_4em] gap-2 px-2 pb-0.5 text-[11px] text-on-surface-variant"
          >
            <span />
            <span className="text-right">この話</span>
            <span className="text-right">作品全体</span>
          </div>
          <ul className="space-y-0.5">
            {ENDING_KINDS.map((k) => {
              const n = endings.current.counts[k]
              const p = percent(n, totalOf(endings.current))
              const wp = percent(endings.work.counts[k], totalOf(endings.work))
              return (
                <EndingRow
                  key={k}
                  label={ENDING_LABEL[k]}
                  here={`${fmt(n)}文 ${p}％`}
                  whole={`${wp}％`}
                  ariaLabel={`${ENDING_LABEL[k]}：この話 ${fmt(n)}文（${p}％）、作品全体 ${wp}％`}
                  disabled={n === 0}
                  on={selected === k}
                  onClick={() => toggle(k)}
                />
              )
            })}
            <EndingRow
              label={`同じ文末が${ENDING_RUN_MIN}文以上続く`}
              here={`${fmt(endings.current.runs)}か所`}
              whole={`${fmt(endings.work.runs)}か所`}
              ariaLabel={`同じ文末が${ENDING_RUN_MIN}文以上続くところ：この話 ${fmt(endings.current.runs)}か所、作品全体 ${fmt(endings.work.runs)}か所`}
              disabled={endings.current.runs === 0}
              on={selected === 'runs'}
              onClick={() => toggle('runs')}
            />
          </ul>
          <p className="mt-1.5 text-[11px] text-on-surface-variant">
            行を押すと、この話の本文の文末にマーカーが引かれます。
          </p>
        </>
      )}
    </section>
  )
}

/** 推敲画面の「分析」（COT-40）。指摘ではないので判断のボタンは付けない（先頭の名前の欄は COT-59）。 */
export function AnalysisPanel({
  names,
  frequent,
  scope,
  onScope,
  selected,
  wordInEpisode,
  onWord,
  endings,
  selectedEnding,
  onEnding,
  current,
  work,
  episodes,
}: AnalysisPanelProps) {
  return (
    <div className="space-y-6">
      {names}
      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="font-medium text-on-surface text-xs">よく使う言葉</h3>
          <fieldset className="flex gap-1 border-0 p-0">
            <legend className="sr-only">よく使う言葉を数える範囲</legend>
            {SCOPES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={scope === key}
                onClick={() => onScope(key)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 font-medium text-[11px] transition-colors',
                  scope === key
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
        {frequent === 'error' ? (
          <p className="py-3 text-on-surface-variant text-xs">くわしい確認は、いまは使えません。</p>
        ) : frequent === null ? (
          <p className="py-3 text-on-surface-variant text-xs">
            くわしい確認の準備ができると表示します。
          </p>
        ) : frequent.words.length === 0 && frequent.conjunctions.length === 0 ? (
          <p className="py-3 text-on-surface-variant text-xs">
            {scope === 'episode'
              ? 'この話には数えられる言葉がありません。'
              : 'まだ数えられる言葉がありません。'}
          </p>
        ) : (
          <>
            <WordList
              label="副詞・形容詞・形容動詞"
              kind="modifier"
              words={frequent.words}
              selected={selected}
              onWord={onWord}
            />
            <WordList
              label="接続詞"
              kind="conjunction"
              words={frequent.conjunctions}
              selected={selected}
              onWord={onWord}
            />
            <p className="mt-1.5 text-[11px] text-on-surface-variant">
              {selected && !wordInEpisode
                ? 'この話には出てきません。'
                : '言葉を押すと、この話の本文にマーカーが引かれます。'}
            </p>
          </>
        )}
      </section>
      <EndingsSection endings={endings} selected={selectedEnding} onSelect={onEnding} />
      <section>
        <h3 className="mb-1 font-medium text-on-surface text-xs">セリフと地の文</h3>
        <p className="mb-2 flex gap-3 text-[11px] text-on-surface-variant">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm bg-primary" />
            セリフ（「」『』の中）
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm bg-secondary-container" />
            地の文
          </span>
        </p>
        <div className="space-y-2">
          <RatioRow label="この話" ratio={current} />
          <RatioRow label="作品全体" ratio={work} />
        </div>
        <p className="mt-1.5 text-[11px] text-on-surface-variant tabular-nums">
          この話：セリフ {fmt(current.dialogue)}字・地の文 {fmt(current.narration)}字
        </p>
        {episodes.length > 1 ? (
          <div className="mt-3 space-y-1.5 border-outline-variant/30 border-t pt-3">
            {episodes.map((e) => (
              <RatioRow key={e.id} label={e.title || '無題'} ratio={e.ratio} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
