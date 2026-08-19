import { ArrowRight, Milestone, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  beatsOfSection,
  nextBeatStatus,
  type Plot,
  type PlotBeat,
  type PlotBeatStatus,
  pickPrimaryPlot,
  updateBeat,
} from '@/core/plot'
import type { PlotRepository } from '@/core/storage/plotRepository'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { subscribeSyncApplied, subscribeSyncTouch } from '@/ui/sync/sync-touch'

interface PlotPeekProps {
  repo: PlotRepository
  workId: string
  /** いま開いている話（null なら未選択）。 */
  episodeId: string | null
  /** 現在の話の実字数（下書きベース・進捗バーに使う）。 */
  actualChars: number
  /** ビートをプロット画面で開く（該当カードへ着地）。 */
  onJumpBeat: (beatId: string) => void
  /** プロット画面を開く（紐づくビートが無いときの導線）。 */
  onOpenPlot: () => void
  onClose: () => void
}

const STATUS_UI: Record<PlotBeatStatus, { label: string; className: string }> = {
  idea: { label: '検討中', className: 'bg-surface-container-high text-on-surface-variant' },
  fixed: { label: '確定', className: 'bg-secondary-container text-on-secondary-container' },
  writing: { label: '執筆中', className: 'bg-primary/12 text-primary' },
  done: { label: '済', className: 'bg-primary text-primary-foreground' },
}

const fmt = (n: number) => n.toLocaleString('ja-JP')

/**
 * 「この話のプロット」パネル（エディタ右の aside・図鑑パネルと同列）。
 * episodeRef が現在の話を指すビートを物語順に並べ、状態切替と進捗（実字数／予定字数）を
 * その場で見せる＝プロット画面へ行かずに「この話で書くべきこと」を横目に置ける。
 */
export function PlotPeek({
  repo,
  workId,
  episodeId,
  actualChars,
  onJumpBeat,
  onOpenPlot,
  onClose,
}: PlotPeekProps) {
  const [plot, setPlot] = useState<Plot | null>(null)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    const found = pickPrimaryPlot(await repo.listByWork(workId))
    setPlot(found ?? null)
    setLoaded(true)
  }, [repo, workId])

  useEffect(() => {
    void reload()
  }, [reload])
  // プロット画面での編集（sync-touch）と同期の pull（sync-applied）の両方に追随する。
  useEffect(() => subscribeSyncTouch(() => void reload()), [reload])
  useEffect(() => subscribeSyncApplied(() => void reload()), [reload])

  // この話に紐づくビート（物語順＝幕→幕内の並び）。
  const beats =
    plot === null || episodeId === null
      ? []
      : plot.sections
          .flatMap((s) => beatsOfSection(plot, s.id))
          .filter((b) => b.episodeRef === episodeId)
  const targetTotal = beats.reduce((sum, b) => sum + (b.targetLength ?? 0), 0)
  const percent = targetTotal > 0 ? Math.min(100, Math.round((actualChars / targetTotal) * 100)) : 0

  const cycleStatus = (beat: PlotBeat) => {
    if (!plot) return
    void repo.save(updateBeat(plot, beat.id, { status: nextBeatStatus(beat.status) })).then(setPlot)
  }

  return (
    <aside className="flex w-[min(300px,85vw)] shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-lowest font-sans">
      <div className="flex items-center justify-between border-outline-variant/30 border-b px-4 py-3">
        <span className="flex items-center gap-1.5 font-medium text-[13px] text-on-surface">
          <Milestone className="size-4 text-primary" aria-hidden />
          この話のプロット
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="パネルを閉じる"
          onClick={onClose}
          className="size-7 text-on-surface-variant hover:text-on-surface"
        >
          <X className="size-4" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-4 py-3">
          {!loaded ? null : plot === null ? (
            <Hint text="この作品のプロットはまだありません。">
              <OpenPlotButton onClick={onOpenPlot} label="プロットを作る" />
            </Hint>
          ) : beats.length === 0 ? (
            <Hint text="この話に紐づくビートはありません。プロットのビート詳細「対応する話」で紐付けます。">
              <OpenPlotButton onClick={onOpenPlot} label="プロットを開く" />
            </Hint>
          ) : (
            <>
              {targetTotal > 0 ? (
                <div>
                  <div className="flex items-baseline justify-between text-[11.5px] text-on-surface-variant tabular-nums">
                    <span>
                      実績 {fmt(actualChars)}字 ／ 予定 {fmt(targetTotal)}字
                    </span>
                    <span>{percent}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-container-high">
                    <div
                      className="h-1.5 rounded-full bg-[var(--forest-400)]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              ) : null}
              <ul className="flex flex-col gap-2">
                {beats.map((beat) => (
                  <li
                    key={beat.id}
                    className="rounded-lg border border-outline-variant/30 bg-surface p-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => cycleStatus(beat)}
                        title="クリックで状態を切替（検討中→確定→執筆中→済）"
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-[10.5px] transition-colors ${STATUS_UI[beat.status].className}`}
                      >
                        {STATUS_UI[beat.status].label}
                      </button>
                      <span className="min-w-0 flex-1 truncate font-medium text-[12.5px] text-on-surface">
                        {beat.title || '無題のビート'}
                      </span>
                      <button
                        type="button"
                        aria-label="プロット画面で開く"
                        title="プロット画面で開く"
                        onClick={() => onJumpBeat(beat.id)}
                        className="rounded p-0.5 text-on-surface-variant/50 transition-colors hover:bg-surface-container-high hover:text-primary"
                      >
                        <ArrowRight className="size-3.5" />
                      </button>
                    </div>
                    {beat.summary || beat.guide ? (
                      <p
                        className={`mt-1 text-[11.5px] leading-relaxed ${
                          beat.summary ? 'text-on-surface-variant' : 'text-on-surface-variant/50'
                        }`}
                      >
                        {beat.summary || beat.guide}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function Hint({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-[12px] text-on-surface-variant leading-relaxed">{text}</p>
      {children}
    </div>
  )
}

function OpenPlotButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
    >
      {label}
      <ArrowRight className="size-3.5" />
    </button>
  )
}
