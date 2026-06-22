import { CircleDot, Cloud, CloudCheck, Download, History, LoaderCircle, LogIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/ui/auth/auth-context'
import { Button } from '@/ui/components/ui/button'
import type { SaveStatus } from '@/ui/store/editorStore'

export interface SaveState {
  dirty: boolean
  status: SaveStatus
}

interface TopAppBarProps {
  /** ブランド名（製品識別）。クリックで入口へ戻す。 */
  brand?: string
  onBrandClick?: () => void
  /** 編集中のみ保存状態を表示 */
  saveStatus?: SaveState
  /** 書き出しダイアログを開く。未指定なら非表示 */
  onExport?: () => void
  exportDisabled?: boolean
  /** 履歴ドロワーの開閉トグル。未指定なら非表示 */
  onToggleHistory?: () => void
  historyOpen?: boolean
}

function SaveIndicator({ dirty, status }: SaveState) {
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 font-sans text-on-surface-variant text-xs">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        保存中…
      </span>
    )
  }
  if (status === 'saved' && !dirty) {
    return (
      <span className="flex items-center gap-1.5 font-sans text-on-surface-variant text-xs">
        <CloudCheck className="size-4 text-primary" aria-hidden />
        保存済み
      </span>
    )
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1.5 font-sans text-on-surface-variant text-xs">
        <CircleDot className="size-4" aria-hidden />
        未保存
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 font-sans text-on-surface-variant/60 text-xs">
      <Cloud className="size-4" aria-hidden />
      ローカル保存
    </span>
  )
}

/** アカウント（同期・認証）。Clerk 構成時（publishable key あり）のみ表示。 */
function AccountControl() {
  const auth = useAuth()
  if (!auth.available) return null
  if (auth.status === 'member') {
    return (
      <div className="flex items-center gap-2">
        <span className="max-w-[10rem] truncate font-sans text-on-surface-variant text-xs">
          {auth.displayName ?? 'サインイン中'}
        </span>
        <button
          type="button"
          onClick={auth.signOut}
          className="shrink-0 font-sans text-on-surface-variant text-xs transition-colors hover:text-primary hover:underline"
        >
          サインアウト
        </button>
      </div>
    )
  }
  if (auth.status === 'guest') {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={auth.openSignIn}
        className="gap-2 text-on-surface-variant hover:text-primary"
      >
        <LogIn className="size-4" aria-hidden />
        同期するにはサインイン
      </Button>
    )
  }
  // 'loading'：判定中はちらつき防止で何も出さない。
  return null
}

/** 全画面共通のトップバー（ブランド・保存状態・履歴・書き出し）。 */
export function TopAppBar({
  brand = 'novel-studio',
  onBrandClick,
  saveStatus,
  onExport,
  exportDisabled,
  onToggleHistory,
  historyOpen,
}: TopAppBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-outline-variant/30 border-b bg-surface/80 px-gutter backdrop-blur-md">
      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={onBrandClick}
          disabled={!onBrandClick}
          className="font-semibold font-serif text-2xl text-primary transition-opacity hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100"
        >
          {brand}
        </button>
      </div>
      <div className="flex items-center gap-4">
        {saveStatus ? <SaveIndicator {...saveStatus} /> : null}
        {onToggleHistory ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleHistory}
            aria-label="履歴"
            aria-pressed={historyOpen}
            className={cn(
              'text-on-surface-variant hover:text-primary',
              historyOpen && 'bg-primary/10 text-primary',
            )}
          >
            <History className="size-5" aria-hidden />
          </Button>
        ) : null}
        {onExport ? (
          <Button onClick={onExport} disabled={exportDisabled} className="gap-2">
            <Download className="size-4" aria-hidden />
            書き出し
          </Button>
        ) : null}
        <AccountControl />
      </div>
    </header>
  )
}
