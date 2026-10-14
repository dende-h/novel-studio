import type { DialogueRatio, FrequentWord } from '@/core/proofread'
import { dialoguePercent } from '@/core/proofread'
import { cn } from '@/lib/utils'

interface AnalysisPanelProps {
  /** null＝くわしい確認がまだ（準備中・作品全体を解析中）、'error'＝使えない。 */
  frequent: ReadonlyArray<FrequentWord> | null | 'error'
  word: string | null
  onWord: (base: string | null) => void
  current: DialogueRatio
  work: DialogueRatio
  episodes: ReadonlyArray<{ id: string; title: string; ratio: DialogueRatio }>
}

const fmt = (n: number) => n.toLocaleString('ja-JP')

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

/** 推敲画面の「分析」（COT-40）。指摘ではないので判断のボタンは付けない。 */
export function AnalysisPanel({
  frequent,
  word,
  onWord,
  current,
  work,
  episodes,
}: AnalysisPanelProps) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 font-medium text-on-surface text-xs">
          よく使う言葉（作品全体・副詞と形容詞）
        </h3>
        {frequent === 'error' ? (
          <p className="py-3 text-on-surface-variant text-xs">くわしい確認は、いまは使えません。</p>
        ) : frequent === null ? (
          <p className="py-3 text-on-surface-variant text-xs">
            くわしい確認の準備ができると表示します。
          </p>
        ) : frequent.length === 0 ? (
          <p className="py-3 text-on-surface-variant text-xs">まだ数えられる言葉がありません。</p>
        ) : (
          <>
            <ol className="space-y-0.5">
              {frequent.map((w, i) => (
                <li key={w.base}>
                  <button
                    type="button"
                    aria-pressed={word === w.base}
                    onClick={() => onWord(word === w.base ? null : w.base)}
                    className={cn(
                      'grid w-full grid-cols-[1.6em_1fr_auto_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs tabular-nums',
                      word === w.base
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
              ))}
            </ol>
            <p className="mt-1.5 text-[11px] text-on-surface-variant">
              言葉を押すと、この話の本文に点線の枠が付きます。
            </p>
          </>
        )}
      </section>
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
