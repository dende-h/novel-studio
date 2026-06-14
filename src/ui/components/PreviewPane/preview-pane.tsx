import { Columns2, Rows2 } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface PreviewPaneProps {
  html: string
}

type Orientation = 'horizontal' | 'vertical'

/**
 * ライブプレビュー。core/exporter/toHtml が生成した安全な HTML を描画する。
 * （HTML は core 側で全エスケープ済み。ユーザー入力は属性ではなくテキストとして閉じている）
 * 横書き／縦書き（writing-mode: vertical-rl）をフローティングツールバーで切替。
 */
export function PreviewPane({ html }: PreviewPaneProps) {
  // 日本語小説の標準である縦書きを既定にする（横書きへはツールバーで切替）。
  const [orientation, setOrientation] = useState<Orientation>('vertical')
  const vertical = orientation === 'vertical'

  return (
    <div className="relative h-full min-h-0 overflow-auto bg-[#f9f9f9] px-10 py-16 shadow-[inset_1px_0_10px_rgba(0,0,0,0.02)]">
      {/* フローティングツールバー */}
      <div className="absolute top-4 right-6 z-10 flex items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container-lowest px-2 py-1.5 shadow-sm">
        <button
          type="button"
          aria-label="横書き"
          aria-pressed={!vertical}
          onClick={() => setOrientation('horizontal')}
          className={cn(
            'flex size-8 items-center justify-center rounded-full transition-colors',
            !vertical
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high',
          )}
        >
          <Columns2 className="size-4" />
        </button>
        <button
          type="button"
          aria-label="縦書き"
          aria-pressed={vertical}
          onClick={() => setOrientation('vertical')}
          className={cn(
            'flex size-8 items-center justify-center rounded-full transition-colors',
            vertical
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high',
          )}
        >
          <Rows2 className="size-4" />
        </button>
      </div>

      {/* 紙面 */}
      <article
        className={cn(
          'preview mx-auto rounded-md border border-outline-variant/10 bg-surface-container-lowest p-12 font-serif text-[18px] text-on-surface shadow-[0_2px_20px_rgba(0,0,0,0.04)] lg:p-16',
          vertical
            ? 'h-[min(760px,72vh)] min-h-[480px] w-fit max-w-none leading-[2.6] tracking-[0.08em] [writing-mode:vertical-rl]'
            : 'w-full max-w-[720px] leading-[1.9]',
        )}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML は core/toHtml で全エスケープ済み
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
