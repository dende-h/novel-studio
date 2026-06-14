import { CircleDot, Cloud, CloudCheck, Download, LoaderCircle } from 'lucide-react'
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

/** 全画面共通のトップバー（ブランド・保存状態・書き出し）。 */
export function TopAppBar({
  brand = 'novel-studio',
  onBrandClick,
  saveStatus,
  onExport,
  exportDisabled,
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
        {onExport ? (
          <Button onClick={onExport} disabled={exportDisabled} className="gap-2">
            <Download className="size-4" aria-hidden />
            書き出し
          </Button>
        ) : null}
      </div>
    </header>
  )
}
