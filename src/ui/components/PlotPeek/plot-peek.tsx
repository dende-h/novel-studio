import { ArrowLeft, ArrowRight, Milestone, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  beatsInStoryOrder,
  nextBeatStatus,
  type Plot,
  type PlotBeat,
  pickPrimaryPlot,
  updateBeat,
} from '@/core/plot'
import type { Episode, GlossaryEntry } from '@/core/schema'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import type { PlotRepository } from '@/core/storage/plotRepository'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { fmtCount, plainOf, STATUS_UI } from '@/ui/plot/beat-ui'
import { subscribeSyncApplied, subscribeSyncTouch } from '@/ui/sync/sync-touch'
import { BeatDetail } from './beat-detail'

interface PlotPeekProps {
  repo: PlotRepository
  workId: string
  /** いま開いている話（null なら未選択）。 */
  episodeId: string | null
  /** 現在の話の実字数（下書きベース・進捗バーに使う）。 */
  actualChars: number
  /** 用語集（ビート詳細の視点・登場人物・舞台の解決先）。 */
  glossary: GlossaryEntry[]
  /** 本文の話一覧（ビート詳細の「対応する話」の名前を出す）。 */
  episodes: Episode[]
  /** 用語集に居る語の集合（要約・メモのプレビューで解決/未解決を描き分ける）。 */
  resolvedNames: Set<string>
  /** ネタ帳（ビートの種になったメモを読む）。省略時はメモを出さない。 */
  ideaRepo?: IdeaRepository
  /** 要約・メモ・人物チップの用語クリック（用語集パネルで開く）。 */
  onRefClick?: (name: string) => void
  /** ビートをプロット画面で開く（該当カードへ着地）。 */
  onJumpBeat: (beatId: string) => void
  /** プロット画面を開く（紐づくビートが無いときの導線）。 */
  onOpenPlot: () => void
  onClose: () => void
}

/**
 * 「この話のプロット」パネル（エディタ右の aside・用語集パネルと同列）。
 *
 * 一覧（この話に紐づくビートを物語順に）と、選んだ 1 件の詳細の二段になっている。
 * 一覧では状態切替と進捗（実字数／予定字数）を、詳細では要約・人物と舞台・メモ・伏線・秘密・
 * ネタ帳まで、そのビートに紐づくものを全部読める＝プロット画面へ行かずに書き進められる。
 * 詳細は幅の広い 2xl 以上でだけ一覧の隣に並べ、それより狭い画面では一覧と入れ替える
 * （本文の幅を二枚のパネルで削らない）。
 */
export function PlotPeek({
  repo,
  workId,
  episodeId,
  actualChars,
  glossary,
  episodes,
  resolvedNames,
  ideaRepo,
  onRefClick,
  onJumpBeat,
  onOpenPlot,
  onClose,
}: PlotPeekProps) {
  const [plot, setPlot] = useState<Plot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [openBeatId, setOpenBeatId] = useState<string | null>(null)

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
      : beatsInStoryOrder(plot).filter((b) => b.episodeRef === episodeId)
  const targetTotal = beats.reduce((sum, b) => sum + (b.targetLength ?? 0), 0)
  const percent = targetTotal > 0 ? Math.min(100, Math.round((actualChars / targetTotal) * 100)) : 0
  // 開いていたビートが消えた（話の切替・削除・同期の pull）ときは黙って一覧へ戻す。
  const openBeat = beats.find((b) => b.id === openBeatId) ?? null

  // 種になったネタ帳メモは詳細を開いたときだけ引く（一覧では要らない）。
  // 読み出しは非同期なので「どのビートのメモか」を一緒に持つ。裸の文字列で持つと、
  // 別のビートへ切り替えた直後の描画に、前のビートのメモがそのビートのものとして出る。
  const [idea, setIdea] = useState<{ beatId: string; text: string | null } | null>(null)
  const openId = openBeat?.id
  const ideaRef = openBeat?.ideaRef
  useEffect(() => {
    if (!ideaRepo || openId === undefined || ideaRef === undefined) return
    let alive = true
    void ideaRepo.get(ideaRef).then((note) => {
      if (alive) setIdea({ beatId: openId, text: note?.text ?? null })
    })
    return () => {
      alive = false
    }
  }, [ideaRepo, openId, ideaRef])
  const ideaText = idea !== null && idea.beatId === openId ? idea.text : null

  // 開閉でフォーカスを迷子にしない。2xl 未満では詳細を開くと一覧ごと display:none になり、
  // いま押したカードのボタンが消える＝フォーカスが body へ落ちて、文書の先頭から辿り直しになる。
  const backRef = useRef<HTMLButtonElement>(null)
  const cardRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const focusReturn = useRef<string | null>(null)
  useEffect(() => {
    if (openId !== undefined) {
      backRef.current?.focus()
      focusReturn.current = openId
      return
    }
    // 閉じたら開いたカードへ戻す（話の切替などでカードごと消えていれば何も起きない）。
    const id = focusReturn.current
    focusReturn.current = null
    if (id !== null) cardRefs.current.get(id)?.focus()
  }, [openId])

  const cycleStatus = (beat: PlotBeat) => {
    if (!plot) return
    void repo.save(updateBeat(plot, beat.id, { status: nextBeatStatus(beat.status) })).then(setPlot)
  }

  return (
    <>
      {/* ビート詳細。一覧の左に開く＝一覧は画面の端に留まり、開閉で位置がずれない。 */}
      {plot && openBeat ? (
        <aside
          aria-label="ビートの詳細"
          className="flex w-[min(360px,92vw)] shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-lowest font-sans"
        >
          <div className="flex shrink-0 items-center gap-1 border-outline-variant/30 border-b px-2 py-3">
            <Button
              ref={backRef}
              variant="ghost"
              size="icon"
              aria-label="ビートの一覧へ戻る"
              onClick={() => setOpenBeatId(null)}
              className="size-8 text-on-surface-variant hover:text-on-surface"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </Button>
            <span className="flex-1 font-medium text-[13px] text-on-surface">ビートの詳細</span>
            {/* 一覧のヘッダは 2xl 未満では隠れる。閉じ道がこのパネルから消えないよう、ここにも置く。 */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="パネルを閉じる"
              onClick={onClose}
              className="size-8 text-on-surface-variant hover:text-on-surface"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <BeatDetail
              plot={plot}
              beat={openBeat}
              glossary={glossary}
              episodes={episodes}
              ideaText={ideaText}
              resolvedNames={resolvedNames}
              onRefClick={onRefClick}
              onCycleStatus={() => cycleStatus(openBeat)}
              onJump={() => onJumpBeat(openBeat.id)}
            />
          </ScrollArea>
        </aside>
      ) : null}

      <aside
        aria-label="この話のプロット"
        className={`flex w-[min(300px,85vw)] shrink-0 flex-col border-outline-variant/30 border-l bg-surface-container-lowest font-sans ${
          openBeat ? 'max-2xl:hidden' : ''
        }`}
      >
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
                        実績 {fmtCount(actualChars)}字 ／ 予定 {fmtCount(targetTotal)}字
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
                  {beats.map((beat) => {
                    // 記法だけの要約は plainOf で空になる。色分けも表示テキストも
                    // 同じ値で決める＝ガイド文が要約の濃さで出てしまうのを防ぐ。
                    const preview = plainOf(beat.summary)
                    return (
                      <li
                        key={beat.id}
                        className={`rounded-lg border bg-surface p-2.5 transition-colors hover:border-primary/40 ${
                          openBeat?.id === beat.id
                            ? 'border-primary/60 ring-1 ring-primary/30'
                            : 'border-outline-variant/30'
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <button
                            type="button"
                            onClick={() => cycleStatus(beat)}
                            title="クリックで状態を切替（検討中→確定→執筆中→済）"
                            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-[10.5px] transition-colors ${STATUS_UI[beat.status].className}`}
                          >
                            {STATUS_UI[beat.status].label}
                          </button>
                          {/* カードの本体そのものが詳細への入口（狭い画面でも押し外しにくい）。 */}
                          <button
                            type="button"
                            ref={(el) => {
                              cardRefs.current.set(beat.id, el)
                            }}
                            aria-label={`「${beat.title || '無題のビート'}」の詳細`}
                            aria-pressed={openBeat?.id === beat.id}
                            title="ビートの詳細を開く"
                            onClick={() => setOpenBeatId((id) => (id === beat.id ? null : beat.id))}
                            className="group min-w-0 flex-1 cursor-pointer text-left"
                          >
                            <span className="block truncate font-medium text-[12.5px] text-on-surface transition-colors group-hover:text-primary">
                              {beat.title || '無題のビート'}
                            </span>
                            {/* line-clamp は display:-webkit-box を敷くので block を重ねない
                                （あとに出る .block が勝って刈り込みが効かなくなる）。 */}
                            {preview || beat.guide ? (
                              <span
                                className={`mt-1 line-clamp-2 text-[11.5px] leading-relaxed ${
                                  preview ? 'text-on-surface-variant' : 'text-on-surface-variant/50'
                                }`}
                              >
                                {preview || beat.guide}
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            aria-label={`「${beat.title || '無題のビート'}」をプロット画面で開く`}
                            title="プロット画面で開く"
                            onClick={() => onJumpBeat(beat.id)}
                            className="shrink-0 rounded p-0.5 text-on-surface-variant/50 transition-colors hover:bg-surface-container-high hover:text-primary"
                          >
                            <ArrowRight className="size-3.5" />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </ScrollArea>
      </aside>
    </>
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
