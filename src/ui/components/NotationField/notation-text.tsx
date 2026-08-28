import { useEffect, useMemo, useRef } from 'react'
import { markdownToHtml } from '@/core/markdown'
import { cn } from '@/lib/utils'

/**
 * 記法つきテキストの読み取り専用表示。保存されている生テキストを、本文プレビューと同じ
 * 見た目（[[用語]]・ルビ・傍点＋軽量マークダウン）で描く。
 *
 * 書ける欄は NotationField、読むだけの場所（パネル・チラ見）はこちらを使う。
 * core/markdown が返すのは全エスケープ済みの HTML で、`.ref[data-ref-name]` までしか付かない。
 * role/tabindex の付与とクリック委譲は UI 層の責務なので、ここで引き受ける（PreviewPane と同じ作法）。
 */
export function NotationText({
  text,
  resolvedNames,
  onRefClick,
  className,
}: {
  text: string
  /** 用語集に居る語の集合（解決済みだけリンクの見た目にする）。未指定ならプレーンへ degrade。 */
  resolvedNames?: Set<string>
  /** 参照クリック／Enter・Space の通知。未指定ならリンクにしない。 */
  onRefClick?: (name: string) => void
  className?: string
}) {
  const html = useMemo(() => markdownToHtml(text, resolvedNames), [text, resolvedNames])
  const hostRef = useRef<HTMLDivElement>(null)

  // html は本体で未参照だが、描き替えのたびに .ref を貼り直すための再実行シグナルとして要る。
  // biome-ignore lint/correctness/useExhaustiveDependencies: html は innerHTML 再描画の検知に必要
  useEffect(() => {
    const el = hostRef.current
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
      ref={hostRef}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: core/markdown が全エスケープ済みの安全な HTML
      dangerouslySetInnerHTML={{ __html: html }}
      className={cn('preview notation-preview', className)}
    />
  )
}
