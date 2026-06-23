/**
 * クラウド同期のマニフェスト型（Phase 2）。
 * サーバ（D1 works テーブル）が返す各 Work の同期メタと、クライアントが
 * ローカルに保持する「最後に同期した状態」を表す。I/O を持たない型定義のみ（core 境界準拠）。
 */

/** サーバ上の 1 Work の同期メタ（D1 works の 1 行に対応）。 */
export interface ManifestEntry {
  workId: string
  /** 最終更新時刻（epoch ms）。LWW の比較キー。 */
  updatedAt: number
  /** ソフトデリート済みか（purge 済み = true）。 */
  deleted: boolean
  /** doc パート（本文＝画像を除いた Work）の SHA-256（hex）。 */
  docHash: string
  /** media パート（coverImage＋thumbnails）の SHA-256（hex）。media 無しは ''。 */
  mediaHash: string
  /** R2 に保存された暗号化ブロブの合計バイト数（容量計算用）。 */
  size: number
}

/** GET /api/sync/manifest のレスポンス。 */
export interface Manifest {
  entries: ManifestEntry[]
}

/**
 * クライアントが持つ「最後にサーバと一致させた状態」。autosave push の差分判定
 * （変わった側だけ送る）に使う。IndexedDB の `syncmeta:<userId>:<workId>` に保存。
 */
export interface LocalSyncMeta {
  workId: string
  docHash: string
  mediaHash: string
  /** 最後に push/pull で一致させた時刻（epoch ms）。 */
  syncedAt: number
}
