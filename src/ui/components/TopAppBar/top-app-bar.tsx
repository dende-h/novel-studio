import {
  Check,
  CircleDot,
  CloudOff,
  CreditCard,
  Download,
  HardDrive,
  History,
  LoaderCircle,
} from 'lucide-react'
import type React from 'react'
import { lazy, Suspense } from 'react'
import { cn } from '@/lib/utils'
import { openBillingPortal } from '@/ui/_api/billing'
import { useAuth } from '@/ui/auth/auth-context'
import { Button } from '@/ui/components/ui/button'
import type { SaveStatus } from '@/ui/store/editorStore'

// 会員のアカウント操作（解約／サインアウト）は Clerk の UserButton。@clerk/clerk-react を含むので
// 別チャンク化し、会員描画時だけ lazy import する（ゲストの主バンドルに Clerk を混ぜない）。
const ClerkUserButton = lazy(() => import('@/ui/auth/clerk-user-button'))

export interface SaveState {
  dirty: boolean
  status: SaveStatus
}

interface TopAppBarProps {
  /** ブランド表示。省略時は「コトノハ-leaf-」ロゴを描画する。 */
  brand?: React.ReactNode
  onBrandClick?: () => void
  /** 開いている作品のタイトル（パンくず）。指定時のみブランド横に表示。 */
  workTitle?: string
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
        <Check className="size-4 text-primary" aria-hidden />
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
      <HardDrive className="size-4" aria-hidden />
      ローカル保存
    </span>
  )
}

/** アカウント（クラウドバックアップ・認証）。Clerk 構成時（publishable key あり）のみ表示。 */
function AccountControl() {
  const auth = useAuth()
  if (!auth.available) return null
  if (auth.status === 'member') {
    // 「プラン」で Stripe Customer Portal（解約・支払い方法・請求履歴）へ、Clerk UserButton で
    // プロフィール／サインアウトへ。チャンク読み込み中は表示名だけ出してレイアウトの揺れを防ぐ。
    return (
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void openBillingPortal(auth.getToken)}
          className="gap-1.5 text-on-surface-variant hover:text-primary"
          title="プランの管理・解約"
        >
          <CreditCard className="size-4" aria-hidden />
          <span className="hidden sm:inline">プラン</span>
        </Button>
        <Suspense
          fallback={
            <span className="max-w-[10rem] truncate font-sans text-on-surface-variant text-xs">
              {auth.displayName ?? 'サインイン中'}
            </span>
          }
        >
          <ClerkUserButton />
        </Suspense>
      </div>
    )
  }
  if (auth.status === 'guest') {
    // クラウド未接続のゲスト。「サインイン済みだが未課金」は Root の全画面オンボーディングが担うため、
    // ここに来る guest は実質「未サインイン」だけ。クリックでサインイン → クラウドバックアップが使える。
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={auth.openSignIn}
        className="gap-2 text-on-surface-variant hover:text-primary"
      >
        <CloudOff className="size-4" aria-hidden />
        ログインでクラウドバックアップ
      </Button>
    )
  }
  // 'loading'：判定中はちらつき防止で何も出さない。
  return null
}

/** 全画面共通のトップバー（ブランド・作品パンくず・保存状態・履歴・書き出し）。 */
export function TopAppBar({
  brand,
  onBrandClick,
  workTitle,
  saveStatus,
  onExport,
  exportDisabled,
  onToggleHistory,
  historyOpen,
}: TopAppBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-outline-variant/30 border-b bg-surface-container-lowest px-5">
      <div className="flex min-w-0 items-center gap-3.5 pl-3">
        <button
          type="button"
          onClick={onBrandClick}
          disabled={!onBrandClick}
          className="flex items-center gap-2 transition-opacity hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100"
        >
          {brand ?? (
            <>
              <img
                src="/logo-clean.png"
                alt=""
                aria-hidden
                className="h-10 w-auto object-contain"
              />
              {/* タイトルロゴは濃紺の文字画像。暗背景では消えるのでダーク時のみ反転して明色にする。 */}
              <img
                src="/app_title_text-clean.png"
                alt="コトノハ-leaf-"
                className="h-10 w-auto object-contain dark:opacity-90 dark:brightness-0 dark:invert"
              />
            </>
          )}
        </button>
        {workTitle ? (
          <span className="flex min-w-0 items-center gap-2 text-on-surface-variant text-xs">
            <span aria-hidden="true" className="text-outline-variant">
              ／
            </span>
            <span className="truncate">{workTitle}</span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {saveStatus ? <SaveIndicator {...saveStatus} /> : null}
        {onToggleHistory ? (
          <button
            type="button"
            onClick={onToggleHistory}
            aria-label="履歴"
            aria-pressed={historyOpen}
            title="ローカル・セーフティネット（版履歴）"
            className={cn(
              'flex size-8 items-center justify-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface',
              historyOpen && 'border-primary/40 bg-primary/10 text-primary',
            )}
          >
            <History className="size-4" aria-hidden />
          </button>
        ) : null}
        {onExport ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exportDisabled}
            className="gap-2"
          >
            <Download className="size-4" aria-hidden />
            書き出し
          </Button>
        ) : null}
        <AccountControl />
      </div>
    </header>
  )
}
