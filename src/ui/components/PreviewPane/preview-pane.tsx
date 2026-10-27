import { useEffect, useLayoutEffect, useRef } from 'react'
import { plainOffsetMap } from '@/core/parser/parseNotation'
import { cn } from '@/lib/utils'

export type PreviewOrientation = 'horizontal' | 'vertical'

export interface PreviewPosition {
  value: string
  offset: number
}

interface PreviewPaneProps {
  position?: PreviewPosition | null
  followActive?: boolean
  html: string
  /** @参照（.ref[data-ref-name]）のクリック／Enter・Space 押下で名前を通知する。 */
  onRefClick?: (name: string) => void
  /** 組み方向（切替 UI はエディタ画面のツールバーが持つ）。既定は日本語小説の標準＝縦書き。 */
  orientation?: PreviewOrientation
}

/**
 * ライブプレビュー。core/exporter/toHtml が生成した安全な HTML を紙色（paper）面に描画する。
 * （HTML は core 側で全エスケープ済み。ユーザー入力は属性ではなくテキストとして閉じている）
 *
 * @参照リンクの相互作用（クリック/キーボード/フォーカス）は本コンポーネントが担う：
 * core が吐くのは class＋data-ref-name までで、role/tabindex 付与と委譲は UI 層の責務とする。
 */
export function PreviewPane({
  html,
  onRefClick,
  orientation = 'vertical',
  position,
  followActive = true,
}: PreviewPaneProps) {
  const vertical = orientation === 'vertical'
  const articleRef = useRef<HTMLElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = articleRef.current
    if (!vertical || !el) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const unit =
        event.deltaMode === 1
          ? Number.parseFloat(getComputedStyle(el).lineHeight) || 32
          : event.deltaMode === 2
            ? el.clientWidth
            : 1
      const before = el.scrollLeft
      el.scrollLeft -= event.deltaY * unit
      if (el.scrollLeft !== before) event.preventDefault()
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [vertical])

  // パーサの1行＝1段落。記法の記号・ルビの読みを除いてキャレットの表示位置を探す。
  // 手動スクロールは監視せず、本文の操作・組み方向の変更・再表示だけで追従する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: html の更新後に DOM の位置を測る
  useLayoutEffect(() => {
    if (!position || !followActive) return
    const article = articleRef.current
    const scroller = vertical ? article : containerRef.current
    if (!article || !scroller) return
    const prefix = position.value.slice(0, position.offset)
    const blockIndex = prefix.split('\n').length - 1
    const line = position.value.split('\n')[blockIndex] ?? ''
    const rawOffset = prefix.length - prefix.lastIndexOf('\n') - 1
    const { sourceOf } = plainOffsetMap(line)
    const next = sourceOf.findIndex((offset) => offset !== null && offset >= rawOffset)
    let remaining = next < 0 ? sourceOf.length : next
    const paragraph = article.children[blockIndex]
    if (!paragraph) return
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    })
    let node = walker.nextNode()
    let rect = paragraph.getBoundingClientRect()
    while (node) {
      const length = node.textContent?.length ?? 0
      if (remaining <= length) {
        const range = document.createRange()
        // 末尾でも直前の文字を測り、折返し・縦書きで空の Range に依存しない。
        const start = Math.max(0, Math.min(remaining, length - 1))
        range.setStart(node, start)
        range.setEnd(node, Math.min(length, start + 1))
        rect = range.getBoundingClientRect()
        break
      }
      remaining -= length
      node = walker.nextNode()
    }
    const viewport = scroller.getBoundingClientRect()
    if (vertical)
      scroller.scrollLeft += (rect.left + rect.right - viewport.left - viewport.right) / 2
    else scroller.scrollTop += (rect.top + rect.bottom - viewport.top - viewport.bottom) / 2
  }, [html, position, vertical, followActive])

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
    <div
      ref={containerRef}
      className={cn(
        // 縦書きは py が行長（1列に入る文字数）を直接削るので、狭い画面では余白を詰める。
        // 左右の余白はスマホのエッジスワイプ（ブラウザの「戻る」）のデッドゾーンも兼ねる。
        'h-full min-h-0 overscroll-contain bg-surface-variant px-4 py-5 sm:px-8 sm:py-9',
        vertical ? 'overflow-hidden' : 'overflow-y-auto',
      )}
    >
      <article
        ref={articleRef}
        className={cn(
          'preview font-serif text-on-surface',
          vertical
            ? 'h-full w-full overflow-auto leading-[2.3] tracking-[0.05em] [writing-mode:vertical-rl]'
            : 'mx-auto w-full max-w-[640px] leading-[2.2] tracking-[0.03em]',
        )}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML は core/toHtml で全エスケープ済み
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
