import { Download, Pencil, PenLine, Trash2 } from 'lucide-react'
import type { WorkSummary } from '@/core/storage/workRepository'
import { formatCount, formatRelative } from '@/ui/_utils/format'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
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

interface ProjectCardProps {
  summary: WorkSummary
  now: number
  onWrite: () => void
  onExport: () => void
  /** 作品メタ（タイトル・著者・あらすじ）を編集 */
  onEditMeta: () => void
  /** 作品を削除（呼び出し側で確認ダイアログを出す） */
  onDelete: () => void
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
        {coverImage ? (
          <ZoomableImage
            src={coverImage}
            alt="表紙"
            className="h-24 w-auto max-w-[5rem] rounded-md border border-outline-variant/20 object-contain"
            wrapperClassName="mb-2"
          />
        ) : null}
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
      <CardContent>
        <div className="font-sans text-on-surface-variant text-sm">
          {author ? <span className="mr-3">著者: {author}</span> : null}
          {formatCount(charCount)} 文字
        </div>
      </CardContent>
      <CardFooter className="mt-auto items-center justify-between border-outline-variant/20 border-t pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onWrite}
          className="gap-2 px-2 text-primary hover:text-primary"
        >
          <PenLine className="size-4" />
          執筆
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExport}
            className="gap-2 px-2 text-on-surface-variant hover:text-primary"
          >
            <Download className="size-4" />
            書き出し
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onEditMeta}
            aria-label="情報を編集"
            className="text-on-surface-variant hover:text-primary"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="削除"
            className="text-on-surface-variant hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
