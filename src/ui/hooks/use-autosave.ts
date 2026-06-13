import { useEffect, useRef } from 'react'

/**
 * 自前の debounced 自動保存。trigger（draft 等）が変わるたびにタイマーを張り直し、
 * dirty の間だけ delayMs の静止で save を1回呼ぶ。安全網（最小版管理は別途 snapshot）。
 */
export function useAutosave(
  trigger: string,
  dirty: boolean,
  save: () => void,
  delayMs = 800,
): void {
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => saveRef.current(), delayMs)
    return () => clearTimeout(t)
  }, [trigger, dirty, delayMs])
}
