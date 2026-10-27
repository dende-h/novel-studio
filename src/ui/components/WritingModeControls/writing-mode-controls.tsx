import { AlignVerticalJustifyCenter, Maximize, Minimize, Scan, X } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import type { useWritingMode } from '@/ui/hooks/use-writing-mode'

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
        className="h-11 gap-1.5 px-2 text-xs aria-pressed:bg-accent aria-pressed:text-primary"
        aria-label={mode.focus ? '集中モードを終了' : '集中モード'}
        aria-pressed={mode.focus}
        aria-keyshortcuts="Alt+Shift+F"
        title="集中モード（Alt+Shift+F）"
        onClick={mode.toggleFocus}
      >
        {mode.focus ? (
          <X className="size-4" aria-hidden />
        ) : (
          <Scan className="size-4" aria-hidden />
        )}
        {mode.focus ? '集中モードを終了' : '集中モード'}
      </Button>
      <Button
        variant="ghost"
        className="h-11 gap-1.5 px-2 text-xs aria-pressed:bg-accent aria-pressed:text-primary"
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
          className="h-11 gap-1.5 px-2 text-xs aria-pressed:bg-accent aria-pressed:text-primary"
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
