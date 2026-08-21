/**
 * 同期の進行状況（ヘッダー表示用）の最小ストア。sync-touch と同型のモジュール singleton。
 *
 * 同期は編集のたびに走るので、結果をトーストで知らせると通知が鳴り続けて不安を煽る。
 * 「いま同期している／最後に同期できたのはいつか」だけを淡々と出すために、
 * useAutoSync が状態を publish し、TopAppBar が読む（props のバケツリレーをしない）。
 */

export interface SyncStatus {
  /** 会員で自動同期が動いているか（非会員・未ログインは false＝表示しない）。 */
  enabled: boolean
  /** 本同期（reconcile）の実行中か。軽量 poll だけの往復は含めない。 */
  syncing: boolean
  /** 最後に同期できた時刻（epoch ms・未同期は null）。 */
  lastSyncedAt: number | null
}

let state: SyncStatus = { enabled: false, syncing: false, lastSyncedAt: null }
const listeners = new Set<() => void>()

export function getSyncStatus(): SyncStatus {
  return state
}

/** 状態を更新して購読者へ通知する（同じ値なら何もしない＝再描画を増やさない）。 */
export function publishSyncStatus(next: Partial<SyncStatus>): void {
  const merged = { ...state, ...next }
  if (
    merged.enabled === state.enabled &&
    merged.syncing === state.syncing &&
    merged.lastSyncedAt === state.lastSyncedAt
  ) {
    return
  }
  state = merged
  for (const l of listeners) l()
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** テスト用の初期化（モジュール singleton をテスト間で持ち越さない）。 */
export function resetSyncStatus(): void {
  state = { enabled: false, syncing: false, lastSyncedAt: null }
  for (const l of listeners) l()
}
