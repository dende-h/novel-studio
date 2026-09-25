import { BookOpen, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 「読者に見せる／作者だけ」の印（対話ペインの吹き出し・まとめと、フォームの対話ノートで共用）。 */
export function VisibilityLabel({
  isPublic,
  label,
  className,
}: {
  isPublic: boolean
  label?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-[10.5px]',
        isPublic
          ? 'bg-primary-container text-on-primary-container'
          : 'bg-secondary-container text-on-secondary-container',
        className,
      )}
    >
      {isPublic ? (
        <BookOpen className="size-2.5" aria-hidden />
      ) : (
        <Lock className="size-2.5" aria-hidden />
      )}
      {label ?? (isPublic ? '読者に見せる' : '作者だけ')}
    </span>
  )
}
