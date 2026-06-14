import { Download, PenLine } from 'lucide-react'
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

interface ProjectCardProps {
  summary: WorkSummary
  now: number
  onWrite: () => void
  onExport: () => void
}

/** ライブラリの作品カード（タイトル・話数・文字数・最終編集・操作）。 */
export function ProjectCard({ summary, now, onWrite, onExport }: ProjectCardProps) {
  const { title, episodeCount, charCount, updatedAt } = summary
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
      <CardContent>
        <div className="font-sans text-on-surface-variant text-sm">
          {formatCount(charCount)} 文字
        </div>
      </CardContent>
      <CardFooter className="mt-auto justify-between border-outline-variant/20 border-t pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onWrite}
          className="gap-2 px-2 text-primary hover:text-primary"
        >
          <PenLine className="size-4" />
          執筆
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onExport}
          className="gap-2 px-2 text-on-surface-variant hover:text-primary"
        >
          <Download className="size-4" />
          書き出し
        </Button>
      </CardFooter>
    </Card>
  )
}
