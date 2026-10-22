import { Merge } from 'lucide-react'
import { episodeKey, type SplitEpisode, type SplitReason } from '@/core/importer'
import { cn } from '@/lib/utils'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { countChars, MESSAGES, type TextImportActions } from './use-text-import'

interface PreviewPaneProps {
  episodes: SplitEpisode[]
  headingFound: boolean
  totalChars: number
  /** 見出しで分けるモードか（「見出しが見つからなかった」案内の判定に使う）。 */
  headingMode: boolean
  /** ファイル入力のときだけ元ファイル名を出す。 */
  showSource: boolean
  actions: Pick<TextImportActions, 'setEpisodeTitle' | 'mergeInto'>
}

const REASON_LABEL: Record<SplitReason, string> = {
  heading: '見出し',
  separator: '区切り',
  file: 'ファイル',
  preamble: '見出しの前',
  whole: '全体',
}

const fmt = (n: number) => n.toLocaleString('ja-JP')

/** 本文の冒頭（空行を除いた最初の 2 行）。 */
const excerptOf = (body: string) =>
  body
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, 2)
    .join(' ')

/** 右ペイン：話の分かれ方のプレビューと手直し。 */
export function PreviewPane({
  episodes,
  headingFound,
  totalChars,
  headingMode,
  showSource,
  actions,
}: PreviewPaneProps) {
  if (episodes.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-outline-variant/30 border-dashed p-6 text-center text-on-surface-variant text-sm">
        {MESSAGES.emptyPreview}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p
        aria-live="polite"
        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
      >
        <span className="font-serif text-lg text-on-surface">{episodes.length} 話に分かれます</span>
        <span className="text-on-surface-variant text-xs tabular-nums">
          合計 {fmt(totalChars)} 字
        </span>
      </p>

      {headingMode && !headingFound ? (
        <p className="rounded-md border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-on-surface-variant text-sm">
          {MESSAGES.noHeading}
        </p>
      ) : null}

      <ol className="flex flex-col gap-2.5" aria-label="話の一覧">
        {episodes.map((e, i) => {
          const key = episodeKey(e)
          const excerpt = excerptOf(e.body)
          return (
            <li
              key={key}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5"
            >
              <span className="row-span-3 pt-2 text-on-surface-variant text-xs tabular-nums">
                {i + 1}
              </span>
              <Input
                aria-label={`${i + 1}話目のタイトル`}
                value={e.title}
                onChange={(ev) => actions.setEpisodeTitle(key, ev.target.value)}
                className="h-8 text-sm"
              />
              <p
                className={cn(
                  'line-clamp-2 text-on-surface-variant text-xs leading-5',
                  excerpt === '' && 'italic',
                )}
              >
                {excerpt === '' ? '（本文なし）' : excerpt}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-on-surface-variant text-xs">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={cn(
                      e.reason === 'heading' && 'bg-primary-container text-on-primary-container',
                      (e.reason === 'file' || e.reason === 'whole') &&
                        'bg-surface-container text-on-surface-variant',
                    )}
                  >
                    {REASON_LABEL[e.reason]}
                  </Badge>
                  {showSource && e.sourceName ? (
                    <span className="truncate">{e.sourceName}</span>
                  ) : null}
                  <span className="tabular-nums">{fmt(countChars(e.body))} 字</span>
                </span>
                {i > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-on-surface-variant text-xs"
                    onClick={() => actions.mergeInto(key)}
                  >
                    <Merge className="size-3.5" aria-hidden />
                    前の話とつなげる
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
