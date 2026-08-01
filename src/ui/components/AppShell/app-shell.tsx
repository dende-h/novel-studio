import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { type SaveState, TopAppBar } from '@/ui/components/TopAppBar/top-app-bar'

interface AppShellProps {
  onBrandClick?: () => void
  /** ヘッダーのパンくずに出す作品タイトル（任意） */
  workTitle?: string
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
  workTitle,
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
  // 狭幅（lg 未満）でサイドバーをドロワーにするための開閉。ルート遷移では Root が
  // 別コンポーネントを返して AppShell ごと unmount されるため、閉じ直しは state 初期化で足りる。
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopAppBar
        onBrandClick={onBrandClick}
        workTitle={workTitle}
        saveStatus={saveStatus}
        onExport={onExport}
        exportDisabled={exportDisabled}
        onToggleHistory={onToggleHistory}
        historyOpen={historyOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        navOpen={navOpen}
      />
      <div className="relative flex min-h-0 flex-1">
        {/* 左サイドバー。lg 以上は行内の列、lg 未満は 248px を本文から奪わないようドロワー表示。 */}
        {navOpen ? (
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 z-30 bg-black/30 lg:hidden"
          />
        ) : null}
        {/* 閉状態は hidden（display:none）にする。transform で退避しないのは、
            translate が position:fixed の包含ブロックを作り、内部の固定要素の位置を壊すため。 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: この div 自体は操作対象ではなく、内部の button/a のクリックを拾うだけの委譲 */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 委譲先が button/a なのでキーボードの Enter/Space でも click が発火・bubbling する。キーハンドラを足すと二重発火になる */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 z-40 flex shrink-0 shadow-2xl lg:static lg:z-auto lg:shadow-none',
            !navOpen && 'max-lg:hidden',
          )}
          // ナビ内の操作＝行き先が決まったとみなして閉じる。同一 AppShell 内の画面切替
          // （activeScreen）は unmount されないため、SideNav 側に prop を足さずここで拾う。
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, a')) setNavOpen(false)
          }}
        >
          {sidebar}
        </div>
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
