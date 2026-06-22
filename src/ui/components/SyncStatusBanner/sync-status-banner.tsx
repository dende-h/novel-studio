import { TriangleAlert } from 'lucide-react'

interface SyncStatusBannerProps {
  /** 別端末にセッションを奪われ、この端末の同期が停止しているか。 */
  superseded: boolean
}

/**
 * 同期状態バナー。Phase 1 では「別端末にログインされ同期停止」の sync-paused 表示のみ。
 * 実同期の進捗表示は Phase 3 で拡張する。
 */
export function SyncStatusBanner({ superseded }: SyncStatusBannerProps) {
  if (!superseded) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-amber-900 text-sm dark:bg-amber-950/60 dark:text-amber-200"
    >
      <TriangleAlert className="size-4 shrink-0" />
      <span>
        別の端末でログインされたため、この端末の同期は停止しています。続けるにはこの端末で再度ログインしてください。
      </span>
    </div>
  )
}
