import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useLocalFlag } from '@/ui/hooks/use-local-flag'

export const FEATURE_INTROS = {
  glossary: {
    label: '用語集',
    summary: '人物や場所を登録し、本文から呼び出せます。',
    firstStep: '「新しく登録」から、登場人物を一人追加します。',
  },
  plot: {
    label: 'プロット',
    summary: '物語の出来事をカードにして、幕ごとに並べられます。',
    firstStep: '「ビートを追加」から、書きたい出来事を一つ置きます。',
  },
} as const

export function FeatureIntro({
  feature,
  firstStep,
}: {
  feature: keyof typeof FEATURE_INTROS
  firstStep?: string
}) {
  const { label, summary, firstStep: defaultStep } = FEATURE_INTROS[feature]
  const [seen, markSeen] = useLocalFlag(`ns-feature-intro-${feature}`)
  const [open, setOpen] = useState(!seen)
  const contentId = useId()
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!seen) markSeen()
  }, [seen, markSeen])

  return (
    <div className="mt-2 text-left text-xs">
      <button
        ref={toggle}
        type="button"
        className="rounded px-1 py-1 text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${label}のはじめ方`}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        はじめ方
      </button>
      <div
        id={contentId}
        hidden={!open}
        className="relative mt-1 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 pr-10 text-on-surface-variant leading-relaxed"
      >
        <p>
          {summary} {firstStep ?? defaultStep}
        </p>
        <button
          type="button"
          aria-label={`${label}の案内を閉じる`}
          className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            setOpen(false)
            toggle.current?.focus()
          }}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
    </div>
  )
}
