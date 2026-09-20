import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

/**
 * 入力欄のラベル横に置くⓘボタン。押すと、その欄の説明をダイアログで出す。
 *
 * 欄の下に説明文を並べると、画面が説明で埋まって**操作するものが見えなくなる**。
 * 説明はここへ畳み、欄の脇には短いラベルだけを残す——代わりに、畳んだ先では
 * 長さを気にせず「何が起きるか」「いつ効くか」まで書ける。
 *
 * 記法つき欄の説明（`NotationHelpButton`）もこの部品で出している。
 */
export function FieldHelp({
  title,
  description,
  ariaLabel,
  className,
  children,
}: {
  /** ダイアログの見出し。ふつうは欄のラベルと同じ言葉にする */
  title: string
  /** 見出しの下の一行。「結局これは何か」を先に言う */
  description?: ReactNode
  /** ボタンの読み上げ名（既定は「◯◯の説明を開く」） */
  ariaLabel?: string
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel ?? `${title}の説明を開く`}
        title={title}
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-on-surface-variant/50 transition-colors hover:bg-surface-container-high hover:text-primary',
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-on-surface">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody className="space-y-3 text-[13px] text-on-surface-variant leading-relaxed">
            {children}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
