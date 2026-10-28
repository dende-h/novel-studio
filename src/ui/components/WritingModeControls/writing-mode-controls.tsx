import { AlignVerticalJustifyCenter, Maximize, Minimize, Scan, X } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import type { useWritingMode } from '@/ui/hooks/use-writing-mode'

/** 集中モードの切替キー（use-writing-mode は event.code で判定するので Mac の Option でも効く）。 */
export function focusShortcutLabel(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return mac ? 'Option+Shift+F' : 'Alt+Shift+F'
}

export function WritingModeControls({
  mode,
  onFocusEditor,
}: {
  mode: ReturnType<typeof useWritingMode>
  onFocusEditor?: () => void
}) {
  return (
    <>
      <Button
        variant="ghost"
        className="h-11 gap-1.5 px-2 text-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
        aria-label={mode.focus ? '集中モードを終了' : '集中モード'}
        aria-pressed={mode.focus}
        aria-keyshortcuts="Alt+Shift+F"
        title={`${mode.focus ? '集中モードを終了' : '集中モード'}（${focusShortcutLabel()}）`}
        onClick={mode.toggleFocus}
      >
        {mode.focus ? (
          <X className="size-4" aria-hidden />
        ) : (
          <Scan className="size-4" aria-hidden />
        )}
        <span className="flex flex-col items-start">
          {mode.focus ? '集中モードを終了' : '集中モード'}
          <kbd aria-hidden className="mt-0.5 text-[10px] leading-tight opacity-60 max-sm:hidden">
            {focusShortcutLabel()}
          </kbd>
        </span>
      </Button>
      <Button
        variant="ghost"
        className="h-11 gap-1.5 px-2 text-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
        aria-label="入力行を中央に保つ"
        aria-pressed={mode.typewriter}
        title="入力行を中央に保つ"
        onClick={() => {
          mode.toggleTypewriter()
          onFocusEditor?.()
        }}
      >
        <AlignVerticalJustifyCenter className="size-4" aria-hidden />
        行を中央に
      </Button>
      {mode.focus && mode.fullscreenAvailable ? (
        <Button
          variant="ghost"
          className="h-11 gap-1.5 px-2 text-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
          aria-label={mode.fullscreen ? '全画面を終了' : '全画面にする'}
          onClick={() => void mode.toggleFullscreen()}
        >
          {mode.fullscreen ? (
            <Minimize className="size-4" aria-hidden />
          ) : (
            <Maximize className="size-4" aria-hidden />
          )}
          <span className="max-sm:sr-only">
            {mode.fullscreen ? '全画面を終了' : '全画面にする'}
          </span>
        </Button>
      ) : null}
    </>
  )
}
