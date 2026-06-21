import type { WorkSummary } from '@/core/storage/workRepository'
import { formatCount, formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/ui/components/ui/card'
import { ZoomableImage } from '@/ui/components/ui/zoomable-image'
import { type ProjectActionHandlers, SecondaryActions, WriteButton } from './project-actions'

interface ProjectCardProps extends ProjectActionHandlers {
  summary: WorkSummary
  now: number
}

/** ライブラリの作品カード（タイトル・話数・文字数・最終編集・操作）。 */
export function ProjectCard({
  summary,
  now,
  onWrite,
  onExport,
  onEditMeta,
  onDelete,
}: ProjectCardProps) {
  const { title, episodeCount, charCount, author, updatedAt, coverImage } = summary
  return (
    <Card className="min-h-[220px] justify-between gap-4 transition-colors hover:bg-surface-container-low">
      <CardHeader>
        <CardTitle className="font-serif text-on-surface text-xl">{title}</CardTitle>
        <CardAction>
          <Badge variant="secondary" className="font-sans uppercase tracking-wider">
            {episodeCount}話
          </Badge>
        </CardAction>
        <CardDescription className="font-sans uppercase tracking-wider">
          {updatedAt ? `${formatRelative(updatedAt, now)}に編集` : '未保存'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {coverImage ? (
          <ZoomableImage
            src={coverImage}
            alt="表紙"
            className="h-40 w-auto max-w-full rounded-md border border-outline-variant/20 object-contain"
            wrapperClassName="mx-auto"
          />
        ) : null}
        <div className="font-sans text-on-surface-variant text-sm">
          {author ? <span className="mr-3">著者: {author}</span> : null}
          {formatCount(charCount)} 文字
        </div>
      </CardContent>
      <CardFooter className="mt-auto items-center justify-between border-outline-variant/20 border-t pt-4">
        <WriteButton onWrite={onWrite} />
        <SecondaryActions onExport={onExport} onEditMeta={onEditMeta} onDelete={onDelete} />
      </CardFooter>
    </Card>
  )
}
