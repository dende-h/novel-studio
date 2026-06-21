import type { WorkSummary } from '@/core/storage/workRepository'
import { formatCount, formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'
import { type ProjectActionHandlers, SecondaryActions, WriteButton } from './project-actions'

interface ProjectRowProps extends ProjectActionHandlers {
  summary: WorkSummary
  now: number
}

/** ライブラリのリスト表示用の 1 行（カードと同じ情報・操作を横並びにしたもの）。 */
export function ProjectRow({
  summary,
  now,
  onWrite,
  onExport,
  onEditMeta,
  onDelete,
}: ProjectRowProps) {
  const { title, episodeCount, charCount, author, updatedAt, coverImage } = summary
  return (
    <div className="flex items-center gap-4 rounded-lg border border-outline-variant/20 px-4 py-3 transition-colors hover:bg-surface-container-low">
      {coverImage ? (
        <ZoomableImage
          src={coverImage}
          alt="表紙"
          className="h-16 w-auto max-w-12 rounded border border-outline-variant/20 object-contain"
          wrapperClassName="shrink-0"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-serif text-lg text-on-surface">{title}</h3>
          <Badge variant="secondary" className="shrink-0 font-sans uppercase tracking-wider">
            {episodeCount}話
          </Badge>
        </div>
        <div className="truncate font-sans text-on-surface-variant text-sm">
          {author ? <span className="mr-3">著者: {author}</span> : null}
          {formatCount(charCount)} 文字
          <span className="mx-2 text-on-surface-variant/50">·</span>
          {updatedAt ? `${formatRelative(updatedAt, now)}に編集` : '未保存'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <WriteButton onWrite={onWrite} />
        <SecondaryActions onExport={onExport} onEditMeta={onEditMeta} onDelete={onDelete} />
      </div>
    </div>
  )
}
