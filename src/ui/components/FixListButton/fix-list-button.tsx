import { SpellCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { plainTextOfBlock } from '@/core/game'
import type { OpenFix, ProofreadDecision } from '@/core/proofread/decisions'
import { novelRuleLabel } from '@/core/proofread/types'
import type { Block } from '@/core/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'

interface FixListButtonProps {
  /** まだ直っていない「直す」の判断（core の openFixes）。0 件ならボタンごと出さない。 */
  fixes: ReadonlyArray<OpenFix>
  /** id 付きの下書きの段落（openFixes に渡したもの）。抜粋に使う。 */
  blocks: ReadonlyArray<Block>
  onJump: (fix: OpenFix) => void
  onRemove: (decision: ProofreadDecision) => void
  /** 推敲画面を開ける（PC・無料会員以上・小説）ときだけ渡す。 */
  onOpenProofread?: () => void
}

const AROUND = 6

/**
 * 執筆画面の「直す箇所 N」（COT-40）。推敲画面で「直す」と決めた箇所だけを一覧にし、選ぶと本文のその文字列を選択する。
 * 一覧は外側を押すか Esc で閉じる（Esc のときはこのボタンへフォーカスを戻す）。
 */
export function FixListButton({
  fixes,
  blocks,
  onJump,
  onRemove,
  onOpenProofread,
}: FixListButtonProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const n = fixes.length

  useEffect(() => {
    if (n === 0) setOpen(false)
  }, [n])

  // 開いている間は、フォーカスがどこにあっても Esc で閉じてボタンへ戻す
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (n === 0) return null

  const close = () => setOpen(false)

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`直すと決めた箇所 ${n}件`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5 rounded-full bg-secondary-container font-semibold text-on-secondary-container tabular-nums hover:bg-secondary-container/80"
      >
        <SpellCheck className="size-4 lg:hidden" aria-hidden />
        <span className="max-lg:hidden">直す箇所</span>
        <span>{n}</span>
      </Button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="一覧を閉じる"
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            role="dialog"
            aria-label="直すと決めた箇所"
            className="absolute top-full right-0 z-40 mt-1.5 flex max-h-[min(70dvh,480px)] w-[360px] flex-col gap-1 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-2 font-sans shadow-lg max-lg:fixed max-lg:inset-x-2 max-lg:top-28 max-lg:w-auto"
          >
            <h3 className="px-2 pt-1 pb-1.5 font-medium text-[13px] text-on-surface">
              直すと決めた箇所
            </h3>
            <ul className="space-y-0.5">
              {fixes.map((fix) => {
                const d = fix.decision
                const block = blocks[fix.blockIndex]
                const text = block ? plainTextOfBlock(block) : ''
                const label = novelRuleLabel(d.code)
                const name = `${label}「${d.text}」`
                return (
                  <li
                    key={`${d.blockId}-${d.code}-${d.text}-${d.nth}`}
                    className="flex items-start gap-1"
                  >
                    <button
                      type="button"
                      aria-label={`その箇所へ移る：${name}`}
                      onClick={() => {
                        close()
                        onJump(fix)
                      }}
                      className="min-w-0 flex-1 space-y-0.5 rounded-md p-2 text-left hover:bg-surface-container-low focus-visible:bg-surface-container-low"
                    >
                      <span className="block text-[11px] text-on-surface-variant">{label}</span>
                      <span className="block break-all text-on-surface text-sm">
                        {text.slice(Math.max(0, fix.start - AROUND), fix.start)}
                        <span className="rounded-sm bg-secondary-container px-0.5">
                          {text.slice(fix.start, fix.end)}
                        </span>
                        {text.slice(fix.end, fix.end + AROUND)}
                      </span>
                      {d.message ? (
                        <span className="block text-[11px] text-on-surface-variant">
                          {d.message}
                        </span>
                      ) : null}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`外す：${name}`}
                      onClick={() => onRemove(d)}
                      className="mt-1 shrink-0 text-on-surface-variant"
                    >
                      外す
                    </Button>
                  </li>
                )
              })}
            </ul>
            {onOpenProofread ? (
              <button
                type="button"
                onClick={() => {
                  close()
                  onOpenProofread()
                }}
                className={cn(
                  'mt-1 flex items-center justify-between border-outline-variant/30 border-t px-2 pt-2 pb-1 font-semibold text-primary text-xs',
                )}
              >
                推敲画面を開く
                <span aria-hidden>→</span>
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
