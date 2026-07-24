import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

/**
 * 最小トースト機構（依存追加なし・所有）。一時的な通知（例：別端末ログインによる強制サインアウト）を
 * 画面下に数秒だけ出す。`useToast().show(message)` で表示。プロバイダ未設定でも no-op で安全に呼べる。
 */

interface ToastItem {
  id: number
  message: string
}

interface ToastApi {
  show: (message: string) => void
}

const AUTO_DISMISS_MS = 6000

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const show = useCallback((message: string) => {
    const id = nextId.current++
    setItems((prev) => [...prev, { id, message }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, AUTO_DISMISS_MS)
    timers.current.add(timer)
  }, [])

  // アンマウント時に保留中のタイマーを破棄する（解放後 setState の警告を防ぐ）。
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto max-w-sm rounded-full bg-on-surface px-5 py-2.5 text-center font-sans text-[13px] text-white shadow-lg"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** トースト API を読む。プロバイダ未設定（テスト・部分描画）でも no-op を返すので安全。 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP_TOAST
}

const NOOP_TOAST: ToastApi = { show: () => {} }
