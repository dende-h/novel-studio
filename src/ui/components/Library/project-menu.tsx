import { Download, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { ProjectActionHandlers } from './project-actions'

type ProjectMenuProps = Pick<ProjectActionHandlers, 'onExport' | 'onEditMeta' | 'onDelete'> & {
  /** 作品タイトル（aria-label 用） */
  title: string
}

/**
 * 作品の副次操作メニュー（書き出し・情報を編集・ゴミ箱へ移動）。
 * Radix を使わない軽量実装：トリガー＋固定スクリムで開閉し、項目クリックで閉じてから実行する。
 */
export function ProjectMenu({ title, onExport, onEditMeta, onDelete }: ProjectMenuProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`「${title}」のメニュー`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex size-6 items-center justify-center rounded-full text-on-surface-variant/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <Ellipsis className="size-[15px]" />
      </button>
      {open ? (
        <>
          {/* スクリム（外側クリックで閉じる） */}
          <button
            type="button"
            aria-label="メニューを閉じる"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            id={menuId}
            className="absolute right-0 top-7 z-50 flex w-44 flex-col rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-1.5 font-sans shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onExport)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <Download className="size-3.5 shrink-0" />
              書き出し
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onEditMeta)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <Pencil className="size-3.5 shrink-0" />
              情報を編集
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onDelete)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-error-container"
            >
              <Trash2 className="size-3.5 shrink-0" />
              ゴミ箱へ移動
            </button>
          </div>
        </>
      ) : null}
    </span>
  )
}
