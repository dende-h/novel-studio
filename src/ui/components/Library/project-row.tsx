import { PenLine } from 'lucide-react'
import type { WorkSummary } from '@/core/storage/workRepository'
import { coverTone } from '@/ui/_utils/cover-tone'
import { formatCount, formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import type { ProjectActionHandlers } from './project-actions'
import { ProjectMenu } from './project-menu'

interface ProjectRowProps extends ProjectActionHandlers {
  summary: WorkSummary
  now: number
}

/** ライブラリのリスト表示用の 1 行（執筆ボタン＋ケバブメニュー）。 */
export function ProjectRow({
  summary,
  now,
  onWrite,
  onExport,
  onEditMeta,
  onDelete,
}: ProjectRowProps) {
  const { id, title, episodeCount, charCount, author, updatedAt, coverImage } = summary
  const initial = title.trim().charAt(0) || '無'
  return (
    <div className="flex items-center gap-3.5 border-outline-variant/30 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-container-low">
      {/* 表紙サムネ（画像が無ければトーン地に頭文字） */}
      <div
        aria-hidden="true"
        className="relative flex h-[54px] w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-outline-variant/30 font-serif text-[16px] text-on-surface"
        style={{ background: coverTone(id) }}
      >
        {coverImage ? (
          <img src={coverImage} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          initial
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium font-sans text-[14px] text-on-surface">{title}</h3>
          <Badge
            variant="secondary"
            className="shrink-0 bg-primary-container font-sans text-on-primary-container"
          >
            {episodeCount}話
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-on-surface-variant">
          {author ? <span className="mr-2">著者: {author}</span> : null}
          {formatCount(charCount)}字 ・{' '}
          {updatedAt ? `${formatRelative(updatedAt, now)}に編集` : '未保存'}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onWrite}
        className="shrink-0 gap-1.5 text-on-surface-variant hover:text-primary"
      >
        <PenLine className="size-4" />
        執筆
      </Button>
      <ProjectMenu title={title} onExport={onExport} onEditMeta={onEditMeta} onDelete={onDelete} />
    </div>
  )
}
