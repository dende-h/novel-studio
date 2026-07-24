import { useSyncExternalStore } from 'react'

/**
 * 表示設定（外観テーマ・本文の文字サイズ）の最小ストア。
 * 依存ゼロ（useSyncExternalStore + localStorage）で、設定変更を即座に <html> へ反映する。
 * 初回描画のちらつき（テーマの一瞬の切り替わり）は index.html の先読みスクリプトが防ぐ。
 */

export type Theme = 'light' | 'dark' | 'system'
export type ReadingSize = 'small' | 'medium' | 'large'

// localStorage キー。index.html の先読みスクリプトと同じ文字列を使うこと（あちらは import 不可）。
const THEME_KEY = 'ns-theme'
const SIZE_KEY = 'ns-reading-size'

// 本文（エディタ・プレビュー）の基準フォントサイズ。index.html の先読みスクリプトと値を揃えること。
// medium は既定値なので変数を設定せず CSS 側の初期値（15px）に委ねる。
const SIZE_PX: Record<Exclude<ReadingSize, 'medium'>, string> = {
  small: '13.5px',
  large: '17px',
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage 不可（プライベートモード等）は既定へフォールバック
  }
  return 'system'
}

function readSize(): ReadingSize {
  try {
    const v = localStorage.getItem(SIZE_KEY)
    if (v === 'small' || v === 'medium' || v === 'large') return v
  } catch {
    // 同上
  }
  return 'medium'
}

interface PrefState {
  theme: Theme
  readingSize: ReadingSize
}

let state: PrefState = { theme: readTheme(), readingSize: readSize() }
const listeners = new Set<() => void>()

function notify(next: Partial<PrefState>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** テーマを解決して <html> の .dark クラスを付け外し（Tailwind の dark: バリアントと連動）。 */
function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  try {
    document.documentElement.classList.toggle('dark', dark)
  } catch {
    // 非 DOM 環境（テスト等）は no-op
  }
}

/** 本文サイズを <html> の CSS 変数に反映（.editor / .preview が参照）。 */
function applyReadingSize(size: ReadingSize): void {
  try {
    const el = document.documentElement
    if (size === 'medium') el.style.removeProperty('--reading-font-size')
    else el.style.setProperty('--reading-font-size', SIZE_PX[size])
  } catch {
    // 同上
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // 保存できなくてもその場の切り替えは効かせる
  }
  applyTheme(theme)
  notify({ theme })
}

export function setReadingSize(size: ReadingSize): void {
  try {
    localStorage.setItem(SIZE_KEY, size)
  } catch {
    // 同上
  }
  applyReadingSize(size)
  notify({ readingSize: size })
}

// システムのカラースキーム変更に追従（theme='system' のときだけ再適用）。
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme('system')
  })
} catch {
  // matchMedia 非対応環境は無視
}

// 先読みスクリプトが走らない経路（テスト・埋め込み）でも整合させるため、読み込み時に一度反映する。
applyTheme(state.theme)
applyReadingSize(state.readingSize)

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): PrefState {
  return state
}

export interface UsePreferences extends PrefState {
  setTheme: (theme: Theme) => void
  setReadingSize: (size: ReadingSize) => void
}

export function usePreferences(): UsePreferences {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { theme: s.theme, readingSize: s.readingSize, setTheme, setReadingSize }
}
