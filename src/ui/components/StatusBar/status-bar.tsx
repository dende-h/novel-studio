import type { SaveStatus } from '../../store/editorStore'

interface StatusBarProps {
  dirty: boolean
  status: SaveStatus
}

/** 保存状態の表示（自動保存の安心材料）。 */
export function StatusBar({ dirty, status }: StatusBarProps) {
  const label =
    status === 'saving' ? '保存中…' : dirty ? '未保存' : status === 'saved' ? '保存済み' : '—'
  return (
    <div className="flex items-center px-3 py-1 text-neutral-500 text-xs" aria-live="polite">
      {label}
    </div>
  )
}
