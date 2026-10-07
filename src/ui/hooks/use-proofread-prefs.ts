import { useSyncExternalStore } from 'react'
import { isNovelRuleId, type NovelRuleId } from '@/core/proofread'

/**
 * 推敲チェックの「確認する項目」のオン／オフ（COT-30）。
 * 端末設定（localStorage）で、作品をまたいで効く。use-preferences と同型の最小ストア。
 * snapshot の Set は toggle のときだけ差し替える（毎回 new Set にすると useSyncExternalStore が再描画し続ける）。
 */
const KEY = 'ns-proofread-off'

function readDisabled(): ReadonlySet<NovelRuleId> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(isNovelRuleId))
  } catch {
    // localStorage 不可・壊れた値はすべてオン
    return new Set()
  }
}

let disabled: ReadonlySet<NovelRuleId> = readDisabled()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ReadonlySet<NovelRuleId> {
  return disabled
}

export function toggleProofreadRule(id: NovelRuleId): void {
  const next = new Set(disabled)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  disabled = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    // 保存できなくてもその場の切り替えは効かせる
  }
  for (const l of listeners) l()
}

/** テスト用：localStorage を読み直す。 */
export function reloadProofreadPrefs(): void {
  disabled = readDisabled()
  for (const l of listeners) l()
}

export function useProofreadPrefs(): {
  disabled: ReadonlySet<NovelRuleId>
  toggle: (id: NovelRuleId) => void
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { disabled: current, toggle: toggleProofreadRule }
}
