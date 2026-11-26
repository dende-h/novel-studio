import { useId } from 'react'
import { type PostingResult, toPostingSite } from '@/core/exporter/toPostingSite'
import { manuscriptBlocks } from '@/core/importer/posting-work'
import type { ManuscriptEpisode } from '@/core/importer/site-formats'
import { POSTING_PROFILES, type PostingSiteId, type SourceNotation } from '@/core/sites/portability'
import { Button } from '@/ui/components/ui/button'
import { Textarea } from '@/ui/components/ui/textarea'

export const postingSites = Object.entries(POSTING_PROFILES) as [
  PostingSiteId,
  (typeof POSTING_PROFILES)[PostingSiteId],
][]
export const selectClass =
  'rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2 py-2 text-sm text-on-surface'

export function NotationSelect({
  value,
  onChange,
}: {
  value: SourceNotation
  onChange: (value: SourceNotation) => void
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      元の記法
      <select
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value as SourceNotation)}
      >
        <option value="auto">自動</option>
        <option value="literal">記法を変換しない</option>
        {postingSites.map(([id, { label }]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function IllustrationList({
  result,
  assets = [],
}: {
  result: PostingResult
  assets?: { path: string; url: string }[]
}) {
  return (
    <details open={result.illustrations.length > 0} className="text-sm">
      <summary>挿絵の位置（{result.illustrations.length}件）</summary>
      {!result.illustrations.length && <p>元の本文から挿絵の参照は見つかりませんでした。</p>}
      <ul className="mt-1 space-y-1">
        {result.illustrations.map((ref) => {
          const asset = assets.find((item) => item.path === (ref.assetPath ?? ref.name))
          return (
            <li key={ref.line + '-' + ref.column} className="break-all">
              {ref.line +
                '行目　' +
                ref.name +
                '　' +
                (ref.disposition === 'keep' ? 'そのまま使えるタグ' : '投稿先で差し替え')}
              {asset && (
                <img className="mt-1 max-h-40 max-w-full rounded" alt={ref.name} src={asset.url} />
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

export function PostingWarnings({ result }: { result: PostingResult }) {
  if (!result.warnings.length) return null
  return (
    <details open className="rounded-md border border-outline-variant/50 p-2 text-sm">
      <summary>変換時の確認（{result.warnings.length}件）</summary>
      <ul className="mt-1 space-y-1">
        {result.warnings.map((warning) => (
          <li key={warning.line + '-' + warning.column}>
            {warning.line}行目　{warning.reason}　「{warning.value}」
          </li>
        ))}
      </ul>
    </details>
  )
}

export function ImportPreview({
  episode,
  notation,
  supplements,
  onEdit,
  assets,
  openPdf,
}: {
  episode: ManuscriptEpisode
  notation: SourceNotation
  supplements: boolean
  onEdit?: (text: string) => void
  assets?: { path: string; url: string }[]
  openPdf?: () => void
}) {
  const id = useId()
  const blocks = manuscriptBlocks(episode, notation, supplements)
  const result = toPostingSite(blocks, 'kakuyomu')
  return (
    <div className="space-y-2">
      <p className="break-all text-sm text-on-surface-variant">
        {episode.path}
        {episode.chapter && ` ／ ${episode.chapter}`}
        {episode.pages && ` ／ ${episode.pages}ページ`}
      </p>
      {episode.details && (
        <details className="text-sm">
          <summary>取込情報</summary>
          <pre className="whitespace-pre-wrap">{episode.details}</pre>
        </details>
      )}
      {openPdf && (
        <Button type="button" variant="outline" size="sm" onClick={openPdf}>
          元のPDFを開く
        </Button>
      )}
      {episode.before !== undefined && (
        <details className="text-sm">
          <summary>前書き</summary>
          <p className="whitespace-pre-wrap">{episode.before}</p>
        </details>
      )}
      {episode.after !== undefined && (
        <details className="text-sm">
          <summary>後書き</summary>
          <p className="whitespace-pre-wrap">{episode.after}</p>
        </details>
      )}
      <label htmlFor={id} className="text-sm">
        元の本文
      </label>
      <Textarea
        id={id}
        value={episode.body}
        readOnly={!onEdit}
        onChange={(event) => onEdit?.(event.target.value)}
        rows={7}
      />
      <details open>
        <summary className="text-sm">取り込み後の本文</summary>
        <div className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container-low p-3 font-serif text-sm leading-7">
          {blocks.map((block) => {
            let column = 0
            return (
              <div className="min-h-7" key={block.id}>
                {block.inlines.map((inline) => {
                  const start = column
                  column += (
                    inline.type === 'ruby'
                      ? inline.base
                      : inline.type === 'ref'
                        ? inline.name
                        : inline.text
                  ).length
                  if (inline.type === 'ruby')
                    return (
                      <ruby key={start}>
                        {inline.base}
                        <rt>{inline.reading}</rt>
                      </ruby>
                    )
                  if (inline.type === 'emphasisDots')
                    return (
                      <span key={start} className="[text-emphasis-style:filled_dot]">
                        {inline.text}
                      </span>
                    )
                  return (
                    <span key={start}>{inline.type === 'text' ? inline.text : inline.name}</span>
                  )
                })}
              </div>
            )
          })}
        </div>
      </details>
      <IllustrationList result={result} assets={assets} />
    </div>
  )
}
