import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react'
import { createCaretMeasurer } from '@/ui/_utils/caretCoordinates'

interface TypewriterOptions {
  enabled: boolean
  readOnly: boolean
  value: string
  layout: unknown
  onScroll: (element: HTMLTextAreaElement) => void
}

/** textareaだけをスクロールする。scroll自体はトリガにせず、読み返しを邪魔しない。 */
export function useTypewriterScroll(
  ref: RefObject<HTMLTextAreaElement | null>,
  options: TypewriterOptions,
) {
  const current = useRef(options)
  current.current = options
  const frame = useRef<number | null>(null)
  const composing = useRef(false)
  const padding = useRef(0)
  const measurer = useRef<ReturnType<typeof createCaretMeasurer> | null>(null)

  const schedule = useCallback(() => {
    if (!current.current.enabled || frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const el = ref.current
      if (!el || !current.current.enabled || composing.current) return
      const rect = el.getBoundingClientRect()
      const viewport = window.visualViewport
      const top = Math.max(rect.top, viewport?.offsetTop ?? 0)
      let bottom = Math.min(
        rect.bottom,
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
      )
      const obstruction = el.parentElement?.querySelector<HTMLElement>('[data-writing-obstruction]')
      if (obstruction) bottom = Math.min(bottom, obstruction.getBoundingClientRect().top)
      if (rect.width <= 0 || bottom <= top) return
      const style = getComputedStyle(el)
      const line = Number.parseFloat(style.lineHeight)
      if (!Number.isFinite(line) || line <= 0) return
      const target = (top + bottom) / 2
      const nextPadding = Math.max(28, target - rect.top - line / 2)
      const oldScroll = el.scrollTop
      el.style.paddingTop = `${nextPadding}px`
      el.style.paddingBottom = `${Math.max(28, rect.bottom - target - line / 2)}px`
      el.scrollTop = oldScroll + nextPadding - (padding.current || 28)
      padding.current = nextPadding
      if (
        current.current.readOnly ||
        document.activeElement !== el ||
        el.selectionStart !== el.selectionEnd
      )
        return
      const caret = measurer.current?.measure(el.selectionStart)
      if (!caret) return
      if (caret.height <= 0) return
      const delta = rect.top + caret.top + caret.height / 2 - target
      const nextScroll = Math.max(
        0,
        Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + delta),
      )
      if (Math.abs(nextScroll - el.scrollTop) > 0.5) {
        el.scrollTop = nextScroll
        current.current.onScroll(el)
      }
    })
  }, [ref])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !options.enabled) return
    measurer.current = createCaretMeasurer(el)
    const start = () => {
      composing.current = true
    }
    const end = () => {
      composing.current = false
      schedule()
    }
    const selection = () => {
      if (document.activeElement === el) schedule()
    }
    el.addEventListener('input', schedule)
    el.addEventListener('select', schedule)
    el.addEventListener('focus', schedule)
    el.addEventListener('click', schedule)
    el.addEventListener('compositionstart', start)
    el.addEventListener('compositionend', end)
    document.addEventListener('selectionchange', selection)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(el)
    const preferences = new MutationObserver(schedule)
    preferences.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    document.fonts?.addEventListener('loadingdone', schedule)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      measurer.current?.dispose()
      measurer.current = null
      observer?.disconnect()
      preferences.disconnect()
      el.removeEventListener('input', schedule)
      el.removeEventListener('select', schedule)
      el.removeEventListener('focus', schedule)
      el.removeEventListener('click', schedule)
      el.removeEventListener('compositionstart', start)
      el.removeEventListener('compositionend', end)
      document.removeEventListener('selectionchange', selection)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      document.fonts?.removeEventListener('loadingdone', schedule)
      window.removeEventListener('resize', schedule)
      const previousScroll = el.scrollTop
      el.style.removeProperty('padding-top')
      el.style.removeProperty('padding-bottom')
      el.scrollTop = Math.max(0, previousScroll - padding.current + 28)
      padding.current = 0
      composing.current = false
    }
  }, [options.enabled, ref, schedule])

  // DOMのvalueと表示面が確定したあとに、次フレームの計測へまとめる。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 値・レイアウト・操作可否の変化は計測のトリガ。
  useLayoutEffect(schedule, [options.value, options.layout, options.readOnly, schedule])
}
