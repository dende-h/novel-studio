import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/ui/components/Toast/toast'

function useWritingFlag(key: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const toggle = useCallback(() => {
    setValue((previous) => !previous)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      /* 端末設定が保存できなくても編集を続ける。 */
    }
  }, [key, value])
  return [value, toggle] as const
}

/**
 * 原稿の外に置く端末設定。Fullscreenの所有権はセッション内だけで管理する。
 * 集中・行を中央に・本文の縦書きは PC（desktop＝lg 以上）だけの機能。狭い画面では
 * 横書き・通常表示に固定し、ショートカットも受け付けない（端末の設定値は消さずに残す）。
 */
export function useWritingMode(eligible: boolean, desktop = true) {
  const [preferredFocus, toggleFocus] = useWritingFlag('ns-writing-focus')
  const [typewriter, toggleTypewriter] = useWritingFlag('ns-writing-typewriter')
  const [hideControls, toggleControls] = useWritingFlag('ns-writing-hide-controls')
  const [showShortcuts, toggleShortcuts] = useWritingFlag('ns-writing-shortcuts')
  const [vertical, toggleVertical] = useWritingFlag('ns-writing-vertical')
  const focus = eligible && desktop && preferredFocus
  const [fullscreen, setFullscreen] = useState(false)
  const owned = useRef(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  const active = useRef(focus)
  active.current = focus
  const { show } = useToast()

  const release = useCallback(() => {
    if (owned.current && document.fullscreenElement === document.documentElement) {
      owned.current = false
      void document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    let composing = false
    const start = () => {
      composing = true
    }
    const end = () => {
      composing = false
    }
    const keydown = (event: KeyboardEvent) => {
      if (
        !eligible ||
        !desktop ||
        event.defaultPrevented ||
        event.repeat ||
        composing ||
        event.isComposing ||
        event.keyCode === 229
      )
        return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return
      if (event.code === 'KeyF') {
        event.preventDefault()
        toggleFocus()
      } else if (event.code === 'KeyG') {
        event.preventDefault()
        toggleTypewriter()
      }
    }
    document.addEventListener('compositionstart', start, true)
    document.addEventListener('compositionend', end, true)
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('compositionstart', start, true)
      document.removeEventListener('compositionend', end, true)
      document.removeEventListener('keydown', keydown)
    }
  }, [eligible, desktop, toggleFocus, toggleTypewriter])

  useEffect(() => {
    mounted.current = true
    const change = () => {
      const current = document.fullscreenElement === document.documentElement
      setFullscreen(current && owned.current)
      if (!current) owned.current = false
    }
    change()
    document.addEventListener('fullscreenchange', change)
    return () => {
      document.removeEventListener('fullscreenchange', change)
      mounted.current = false
      release()
    }
  }, [release])

  useEffect(() => {
    if (!focus) release()
  }, [focus, release])

  // iOSはキーボード表示時も100dvhを保つ。操作列ごとvisual viewport内へ収める。
  useEffect(() => {
    if (!focus) return
    const viewport = window.visualViewport
    const root = document.documentElement
    const measure = () => {
      root.style.setProperty('--writing-vv-top', `${viewport?.offsetTop ?? 0}px`)
      root.style.setProperty('--writing-vv-height', `${viewport?.height ?? window.innerHeight}px`)
    }
    measure()
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      root.style.removeProperty('--writing-vv-top')
      root.style.removeProperty('--writing-vv-height')
    }
  }, [focus])

  const toggleFullscreen = async () => {
    if (!focus || pending.current) return
    if (document.fullscreenElement) {
      if (owned.current) release()
      return
    }
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) return
    pending.current = true
    try {
      await document.documentElement.requestFullscreen()
      owned.current = document.fullscreenElement === document.documentElement
      if (mounted.current) setFullscreen(owned.current)
      if (!mounted.current || !active.current) release()
    } catch {
      show('全画面にできませんでした。もう一度お試しください')
    } finally {
      pending.current = false
    }
  }

  return {
    focus,
    controlsVisible: !hideControls,
    toggleControls,
    showShortcuts,
    toggleShortcuts,
    vertical: desktop && vertical,
    toggleVertical,
    typewriter: desktop && typewriter,
    toggleFocus,
    toggleTypewriter,
    fullscreen,
    toggleFullscreen,
    fullscreenAvailable: Boolean(
      document.fullscreenEnabled &&
        typeof document.documentElement.requestFullscreen === 'function' &&
        (!document.fullscreenElement || owned.current),
    ),
  }
}
