import { ZoomIn } from 'lucide-react'
import type { WorkSummary } from '@/core/storage/workRepository'
import { coverTone } from '@/ui/_utils/cover-tone'
import { formatCount, formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'
import type { ProjectActionHandlers } from './project-actions'
import { ProjectMenu } from './project-menu'

interface ProjectCardProps extends ProjectActionHandlers {
  summary: WorkSummary
  now: number
}

/**
 * ライブラリの作品カード（本の表紙型）。カード全体のクリックで執筆へ、
 * 副次操作（書き出し・情報を編集・ゴミ箱へ移動）は右下のケバブメニューに集約する。
 */
export function ProjectCard({
  summary,
  now,
  onWrite,
  onExport,
  onEditMeta,
  onDelete,
}: ProjectCardProps) {
  const { id, title, episodeCount, charCount, updatedAt, coverImage } = summary
  return (
    <article className="group relative flex flex-col rounded-lg border border-outline-variant/30 bg-surface-container-lowest transition-all hover:border-outline-variant/50 hover:shadow-md">
      {/* カード全体クリック＝執筆（透明オーバーレイ。ケバブだけ上層で操作可能にする） */}
      <button
        type="button"
        onClick={onWrite}
        aria-label={`「${title}」を執筆`}
        className="absolute inset-0 z-0 rounded-lg outline-ring/50 focus-visible:outline-2"
      />

      {/* 表紙 */}
      <div className="pointer-events-none p-2.5 pb-0">
        <div
          className="relative aspect-[3/4] overflow-hidden rounded-md border border-outline-variant/30"
          style={{ background: coverTone(id) }}
        >
          {coverImage ? (
            <>
              <img src={coverImage} alt="" className="absolute inset-0 size-full object-cover" />
              {/* カード全体は「執筆を開く」なので、表紙の拡大は隅の虫めがねに分離する
                  （pointer-events-auto＋z-10 でオーバーレイより前面に置く）。 */}
              <ZoomableImage
                src={coverImage}
                alt={`${title}の表紙`}
                wrapperClassName="pointer-events-auto absolute top-1.5 right-1.5 z-10 rounded-full bg-black/45 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/65 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <ZoomIn className="size-4" aria-hidden />
              </ZoomableImage>
            </>
          ) : (
            <>
              <div className="absolute inset-0 flex items-center justify-center px-3 py-4">
                <div className="max-h-full max-w-full overflow-hidden font-medium font-serif text-[15px] text-on-surface leading-[1.9] tracking-[0.16em] [writing-mode:vertical-rl]">
                  {title}
                </div>
              </div>
              <div className="absolute bottom-2 left-2.5 font-serif text-[9px] text-on-surface-variant/50 tracking-[0.08em]">
                novel-studio
              </div>
            </>
          )}
        </div>
      </div>

      {/* メタ */}
      <div className="pointer-events-none flex flex-col gap-1.5 px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-1.5">
          <h3 className="min-w-0 flex-1 truncate font-medium font-sans text-[13px] text-on-surface">
            {title}
          </h3>
          <span className="pointer-events-auto z-10">
            <ProjectMenu
              title={title}
              onExport={onExport}
              onEditMeta={onEditMeta}
              onDelete={onDelete}
            />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="bg-primary-container font-sans text-on-primary-container"
          >
            {episodeCount}話
          </Badge>
          <span className="text-[11px] text-on-surface-variant">{formatCount(charCount)}字</span>
        </div>
        <div className="text-[11px] text-on-surface-variant/70">
          {updatedAt ? `${formatRelative(updatedAt, now)}に編集` : '未保存'}
        </div>
      </div>
    </article>
  )
}
