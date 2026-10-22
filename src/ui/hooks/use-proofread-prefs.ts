import { useSyncExternalStore } from 'react'
import { isNovelRuleId, type NovelRuleId } from '@/core/proofread'

/**
 * 推敲画面の「確認する項目」で選んだ項目（COT-40）。最初は何も選ばれていない（作者が自分で選ぶ）。
 * 端末設定（localStorage）で、作品をまたいで効く。use-preferences と同型の最小ストア。
 * snapshot の Set は toggle のときだけ差し替える（毎回 new Set にすると useSyncExternalStore が再描画し続ける）。
 *
 * 旧キー `ns-proofread-off`（COT-30 の「オフにした項目」・既定はすべてオン）は意味が逆なので読まない。
 * 使われていたのは stg だけで、端末の表示設定（作品のデータではない）なので、新しいキーで選び直してもらう。
 */
const KEY = 'ns-proofread-on'

function readEnabled(): ReadonlySet<NovelRuleId> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(isNovelRuleId))
  } catch {
    // localStorage 不可・壊れた値は何も選ばれていない扱い
    return new Set()
  }
}

let enabled: ReadonlySet<NovelRuleId> = readEnabled()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ReadonlySet<NovelRuleId> {
  return enabled
}

export function toggleProofreadRule(id: NovelRuleId): void {
  const next = new Set(enabled)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  enabled = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    // 保存できなくてもその場の切り替えは効かせる
  }
  for (const l of listeners) l()
}

/** テスト用：localStorage を読み直す。 */
export function reloadProofreadPrefs(): void {
  enabled = readEnabled()
  for (const l of listeners) l()
}

export function useProofreadPrefs(): {
  enabled: ReadonlySet<NovelRuleId>
  toggle: (id: NovelRuleId) => void
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { enabled: current, toggle: toggleProofreadRule }
}
