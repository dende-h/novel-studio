import { SlidersHorizontal } from 'lucide-react'
import type { NotationKind } from '@/ui/components/EditorPane/notation'
import { NotationButtons } from '@/ui/components/EditorPane/notation-buttons'
import { type SaveState, SaveStatus } from '@/ui/components/SaveStatus/save-status'
import { Button } from '@/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu'
import type { useWritingMode } from '@/ui/hooks/use-writing-mode'
import {
  focusShortcutLabel,
  typewriterShortcutLabel,
  WritingModeControls,
} from './writing-mode-controls'

export function FocusToolbar({
  mode,
  save,
  scriptMode,
  onApply,
  onFocusEditor,
}: {
  mode: ReturnType<typeof useWritingMode>
  save: SaveState
  scriptMode: boolean
  onApply: (kind: NotationKind) => void
  onFocusEditor: () => void
}) {
  return (
    <div className="writing-focus-controls shrink-0 bg-surface-container-lowest">
      <div className="flex min-h-11 flex-wrap items-center gap-1 px-3">
        {mode.controlsVisible ? (
          <WritingModeControls mode={mode} onFocusEditor={onFocusEditor} />
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <SaveStatus {...save} alwaysLabel />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-11 gap-1.5 px-2 text-xs"
                aria-label="集中モードの表示設定"
              >
                <SlidersHorizontal className="size-4" aria-hidden />
                <span>表示</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                onFocusEditor()
              }}
            >
              <DropdownMenuCheckboxItem
                checked={mode.showShortcuts}
                onCheckedChange={mode.toggleShortcuts}
              >
                記法・ショートカットを表示
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={mode.controlsVisible}
                onCheckedChange={mode.toggleControls}
              >
                操作ボタンを表示
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={mode.vertical}
                onCheckedChange={mode.toggleVertical}
              >
                本文を縦書きにする
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={mode.typewriter}
                onCheckedChange={mode.toggleTypewriter}
              >
                入力行を中央に保つ
                <DropdownMenuShortcut aria-hidden>{typewriterShortcutLabel()}</DropdownMenuShortcut>
              </DropdownMenuCheckboxItem>
              {mode.fullscreenAvailable ? (
                <DropdownMenuItem onSelect={() => void mode.toggleFullscreen()}>
                  {mode.fullscreen ? '全画面を終了' : '全画面にする'}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={mode.toggleFocus}>
                集中モードを終了
                <DropdownMenuShortcut aria-hidden>{focusShortcutLabel()}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {mode.showShortcuts ? (
        <div
          role="toolbar"
          aria-label="記法・ショートカット"
          className="flex flex-wrap items-center gap-1 px-3"
        >
          <NotationButtons scriptMode={scriptMode} onApply={onApply} />
        </div>
      ) : null}
    </div>
  )
}
