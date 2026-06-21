import { Download, Pencil, PenLine, Trash2 } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'

/** カード／リスト共通の作品操作ハンドラ。 */
export interface ProjectActionHandlers {
  onWrite: () => void
  onExport: () => void
  /** 作品メタ（タイトル・著者・あらすじ・表紙）を編集 */
  onEditMeta: () => void
  onDelete: () => void
}

/** 主要動線の「執筆」。背景は持たず、濃い primary 文字＋他より大きいフォントで目立たせる。 */
export function WriteButton({ onWrite }: Pick<ProjectActionHandlers, 'onWrite'>) {
  return (
    <Button
      variant="ghost"
      onClick={onWrite}
      className="gap-2 font-bold text-base text-primary hover:bg-primary/5 hover:text-primary"
    >
      <PenLine className="size-4" />
      執筆
    </Button>
  )
}

/** 副次操作（書き出し・情報編集・削除）。執筆と並べて使う。 */
export function SecondaryActions({
  onExport,
  onEditMeta,
  onDelete,
}: Omit<ProjectActionHandlers, 'onWrite'>) {
  return (
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
        size="sm"
        onClick={onEditMeta}
        aria-label="情報を編集"
        className="gap-2 px-2 text-on-surface-variant hover:text-primary"
      >
        <Pencil className="size-4" />
        情報
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
  )
}
