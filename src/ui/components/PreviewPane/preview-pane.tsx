import { Columns2, Rows2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface PreviewPaneProps {
  html: string
  /** @参照（.ref[data-ref-name]）のクリック／Enter・Space 押下で名前を通知する。 */
  onRefClick?: (name: string) => void
}

type Orientation = 'horizontal' | 'vertical'

/**
 * ライブプレビュー。core/exporter/toHtml が生成した安全な HTML を描画する。
 * （HTML は core 側で全エスケープ済み。ユーザー入力は属性ではなくテキストとして閉じている）
 * 横書き／縦書き（writing-mode: vertical-rl）をフローティングツールバーで切替。
 *
 * @参照リンクの相互作用（クリック/キーボード/フォーカス）は本コンポーネントが担う：
 * core が吐くのは class＋data-ref-name までで、role/tabindex 付与と委譲は UI 層の責務とする。
 */
export function PreviewPane({ html, onRefClick }: PreviewPaneProps) {
  // 日本語小説の標準である縦書きを既定にする（横書きへはツールバーで切替）。
  const [orientation, setOrientation] = useState<Orientation>('vertical')
  const vertical = orientation === 'vertical'
  const articleRef = useRef<HTMLElement>(null)

  // dangerouslySetInnerHTML で描く .ref を、UI 層でフォーカス可能なリンクにし、
  // クリック／Enter・Space を name 付きで onRefClick へ委譲する（再描画ごとに貼り直す）。
  // html は本体で未参照だが、本文書換で増減する innerHTML 内の .ref を貼り直す再描画シグナルとして必須。
  // biome-ignore lint/correctness/useExhaustiveDependencies: html は innerHTML 再描画の検知に依存が必要
  useEffect(() => {
    const el = articleRef.current
    if (!el || !onRefClick) return
    for (const ref of el.querySelectorAll<HTMLElement>('.ref[data-ref-name]')) {
      ref.setAttribute('role', 'link')
      ref.tabIndex = 0
    }
    const handle = (e: Event) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ref-name]')
      if (!target) return
      if (e.type === 'keydown') {
        const key = (e as KeyboardEvent).key
        if (key !== 'Enter' && key !== ' ') return
        e.preventDefault()
      }
      onRefClick(target.getAttribute('data-ref-name') ?? '')
    }
    el.addEventListener('click', handle)
    el.addEventListener('keydown', handle)
    return () => {
      el.removeEventListener('click', handle)
      el.removeEventListener('keydown', handle)
    }
  }, [html, onRefClick])

  return (
    <div className="relative h-full min-h-0 overflow-auto bg-[#f9f9f9] px-10 py-16 shadow-[inset_1px_0_10px_rgba(0,0,0,0.02)]">
      {/* 組み方向の切替（セグメント型トグル。選択中を塗りつぶしで明示） */}
      <fieldset
        aria-label="本文の組み方向"
        className="absolute top-4 right-6 z-10 m-0 flex min-w-0 items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container-lowest p-1 shadow-sm"
      >
        <button
          type="button"
          aria-pressed={!vertical}
          onClick={() => setOrientation('horizontal')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans font-medium text-xs transition-colors',
            !vertical
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-on-surface-variant hover:bg-surface-container-high',
          )}
        >
          <Rows2 className="size-3.5" />
          横書き
        </button>
        <button
          type="button"
          aria-pressed={vertical}
          onClick={() => setOrientation('vertical')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans font-medium text-xs transition-colors',
            vertical
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-on-surface-variant hover:bg-surface-container-high',
          )}
        >
          <Columns2 className="size-3.5" />
          縦書き
        </button>
      </fieldset>

      {/* 紙面 */}
      <article
        ref={articleRef}
        className={cn(
          'preview mx-auto rounded-md border border-outline-variant/10 bg-surface-container-lowest p-12 font-serif text-[16px] text-on-surface shadow-[0_2px_20px_rgba(0,0,0,0.04)] lg:p-16',
          vertical
            ? 'h-[min(760px,72vh)] min-h-[480px] w-fit max-w-none leading-[2.4] tracking-[0.08em] [writing-mode:vertical-rl]'
            : 'w-full max-w-[720px] leading-[1.7]',
        )}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML は core/toHtml で全エスケープ済み
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
