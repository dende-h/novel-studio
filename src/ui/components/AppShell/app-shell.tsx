import type { ReactNode } from 'react'
import { type SaveState, TopAppBar } from '@/ui/components/TopAppBar/top-app-bar'

interface AppShellProps {
  onBrandClick?: () => void
  saveStatus?: SaveState
  onExport?: () => void
  exportDisabled?: boolean
  /** 左サイドバー（SideNav） */
  sidebar: ReactNode
  /** メイン領域 */
  children: ReactNode
  /** 右ペイン（履歴など・任意） */
  aside?: ReactNode
}

/** トップバー＋サイドバー＋メイン（＋任意の右ペイン）の共通レイアウト。 */
export function AppShell({
  onBrandClick,
  saveStatus,
  onExport,
  exportDisabled,
  sidebar,
  children,
  aside,
}: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopAppBar
        onBrandClick={onBrandClick}
        saveStatus={saveStatus}
        onExport={onExport}
        exportDisabled={exportDisabled}
      />
      <div className="flex min-h-0 flex-1">
        {sidebar}
        <main className="flex min-h-0 min-w-0 flex-1">{children}</main>
        {aside}
      </div>
    </div>
  )
}
