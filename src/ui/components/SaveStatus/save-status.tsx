import { Check, CircleDot, HardDrive, LoaderCircle } from 'lucide-react'
import type { SaveStatus as EditorSaveStatus } from '@/ui/store/editorStore'

export interface SaveState {
  dirty: boolean
  status: EditorSaveStatus
}

export function SaveStatus({
  dirty,
  status,
  alwaysLabel = false,
}: SaveState & { alwaysLabel?: boolean }) {
  if (status === 'saving') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 font-sans text-on-surface-variant text-xs"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        {/* 狭幅は横幅を稼ぐためラベルを視覚的に畳む。sr-only なので読み上げには残る。 */}
        <span className={alwaysLabel ? undefined : 'max-sm:sr-only'}>保存中…</span>
      </span>
    )
  }
  if (status === 'saved' && !dirty) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 font-sans text-on-surface-variant text-xs"
      >
        <Check className="size-4 text-primary" aria-hidden />
        <span className={alwaysLabel ? undefined : 'max-sm:sr-only'}>保存済み</span>
      </span>
    )
  }
  if (dirty) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 font-sans text-on-surface-variant text-xs"
      >
        <CircleDot className="size-4" aria-hidden />
        <span className={alwaysLabel ? undefined : 'max-sm:sr-only'}>未保存</span>
      </span>
    )
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 font-sans text-on-surface-variant/60 text-xs"
    >
      <HardDrive className="size-4" aria-hidden />
      <span className={alwaysLabel ? undefined : 'max-sm:sr-only'}>ローカル保存</span>
    </span>
  )
}
