import type { ReactNode } from 'react'
import { type SaveState, TopAppBar } from '@/ui/components/TopAppBar/top-app-bar'

interface AppShellProps {
  onBrandClick?: () => void
  saveStatus?: SaveState
  onExport?: () => void
  exportDisabled?: boolean
  /** 履歴ドロワーの開閉トグル（任意） */
  onToggleHistory?: () => void
  historyOpen?: boolean
  /** 左サイドバー（SideNav） */
  sidebar: ReactNode
  /** メイン領域 */
  children: ReactNode
  /** 右ペイン（履歴など・任意） */
  aside?: ReactNode
  /** オーバーレイ時の背景（スクリム）クリックで右ペインを閉じる（任意） */
  onCloseAside?: () => void
}

/** トップバー＋サイドバー＋メイン（＋任意の右ペイン）の共通レイアウト。 */
export function AppShell({
  onBrandClick,
  saveStatus,
  onExport,
  exportDisabled,
  onToggleHistory,
  historyOpen,
  sidebar,
  children,
  aside,
  onCloseAside,
}: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopAppBar
        onBrandClick={onBrandClick}
        saveStatus={saveStatus}
        onExport={onExport}
        exportDisabled={exportDisabled}
        onToggleHistory={onToggleHistory}
        historyOpen={historyOpen}
      />
      <div className="relative flex min-h-0 flex-1">
        {sidebar}
        <main className="flex min-h-0 min-w-0 flex-1">{children}</main>
        {/* 右ペイン（履歴）。xl 以上は行内の列、xl 未満（対応下限〜）は本文を狭めないようオーバーレイ表示。 */}
        {aside ? (
          <>
            {onCloseAside ? (
              <button
                type="button"
                aria-label="履歴ドロワーを閉じる"
                onClick={onCloseAside}
                className="absolute inset-0 z-30 bg-black/30 xl:hidden"
              />
            ) : null}
            <div className="absolute inset-y-0 right-0 z-40 flex shrink-0 shadow-2xl xl:static xl:z-auto xl:shadow-none">
              {aside}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
