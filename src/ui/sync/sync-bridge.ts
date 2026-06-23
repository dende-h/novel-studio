/**
 * 同期ブリッジ（Phase 2）。エディタストアは起動時に 1 度だけ生成されるが、同期コントローラは
 * ログイン中のユーザーごとに生成・破棄される。この間接層で、ストアの保存通知（onSaved/onPurged）を
 * 「今アクティブなコントローラ」へ後付けで繋ぎ替える。未ログイン時は no-op のまま。
 */
export interface SyncBridge {
  onSaved: (workId: string) => void
  onPurged: (workId: string) => void
  /** プロフィール（ペンネーム・アバター）保存通知（同期 push のトリガ）。 */
  onProfileSaved: () => void
}

export function createSyncBridge(): SyncBridge {
  return { onSaved: () => {}, onPurged: () => {}, onProfileSaved: () => {} }
}
