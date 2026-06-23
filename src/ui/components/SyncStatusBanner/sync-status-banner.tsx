import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import type { SyncPhase } from '@/ui/sync/sync-controller'

interface SyncStatusBannerProps {
  /** 別端末にセッションを奪われ、この端末の同期が停止しているか（セッション監視由来）。 */
  superseded: boolean
  /** 同期コントローラのフェーズ（push 由来の停止・進捗）。 */
  phase?: SyncPhase
  /** 手動で全同期を再試行（オフライン復帰・容量解消後）。 */
  onSyncNow?: () => void
}

/**
 * 同期状態バナー（Phase 2）。優先度の高い順に「別端末で停止 > 容量超過 > オフライン > 同期中」を表示。
 * superseded はセッション監視（useSessionGuard）と push の 409 の両方を統合する。
 * 一時停止（容量・オフライン）では「今すぐ同期」で手動再試行できる。superseded は再ログインが必要なので出さない。
 */
export function SyncStatusBanner({ superseded, phase = 'idle', onSyncNow }: SyncStatusBannerProps) {
  const supersededActive = superseded || phase === 'paused-superseded'

  if (supersededActive) {
    return (
      <Bar tone="alert" role="alert" icon={<TriangleAlert className="size-4 shrink-0" />}>
        別の端末でログインされたため、この端末の同期は停止しています。続けるにはこの端末で再度ログインしてください。
      </Bar>
    )
  }
  if (phase === 'paused-capacity') {
    return (
      <Bar
        tone="alert"
        role="alert"
        icon={<TriangleAlert className="size-4 shrink-0" />}
        onSyncNow={onSyncNow}
      >
        保存容量の上限に達したため、クラウド同期を一時停止しています。不要な作品を削除すると再開できます。
      </Bar>
    )
  }
  if (phase === 'paused-offline') {
    return (
      <Bar
        tone="muted"
        role="status"
        icon={<CloudOff className="size-4 shrink-0" />}
        onSyncNow={onSyncNow}
      >
        オフラインのため同期を保留しています。変更は端末に保存され、接続が戻ると自動で同期します。
      </Bar>
    )
  }
  if (phase === 'syncing') {
    return (
      <Bar tone="muted" role="status" icon={<RefreshCw className="size-4 shrink-0 animate-spin" />}>
        同期中…
      </Bar>
    )
  }
  return null
}

function Bar({
  tone,
  role,
  icon,
  children,
  onSyncNow,
}: {
  tone: 'alert' | 'muted'
  role: 'alert' | 'status'
  icon: React.ReactNode
  children: React.ReactNode
  onSyncNow?: () => void
}) {
  const palette =
    tone === 'alert'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
      : 'bg-muted text-muted-foreground'
  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-sm ${palette}`} role={role}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {onSyncNow ? (
        <button
          type="button"
          onClick={onSyncNow}
          className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
        >
          今すぐ同期
        </button>
      ) : null}
    </div>
  )
}
