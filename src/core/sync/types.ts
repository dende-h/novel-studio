/**
 * 自動同期（CAS＋三方向差分）の共有型。
 * サーバ（functions/api/sync）とはワイヤ形（RemoteWorkMeta）だけを共有し、
 * core からは functions を import しない（同形を宣言し直す）。
 */

/** サーバ manifest の 1 行（functions/api/sync と同形）。 */
export interface RemoteWorkMeta {
  workId: string
  updatedAt: number
  trashedAt: number
  deleted: 0 | 1
  docHash: string
  docSize: number
  syncedAt: number
}

/** 端末が最後に同期した時点の記録（三方向差分の base）。`syncbase:<workId>`。 */
export interface SyncBase {
  workId: string
  baseHash: string // 最後に push/pull した平文 canonical JSON の sha256
  remoteUpdatedAt: number // その時点のサーバ updated_at
  syncedAt: number
}

export interface PlanInput {
  now: number
  /** ローカル active 作品（内容は執行側が持つ。planner には要約だけ渡す）。 */
  localWorks: Array<{ workId: string; updatedAt: number; hash: string }>
  /** ローカルゴミ箱。hash は中身（work）の canonical hash。 */
  localTrash: Array<{ workId: string; updatedAt: number; trashedAt: number; hash: string }>
  bases: SyncBase[]
  remote: RemoteWorkMeta[]
}

export type SyncOp =
  | { op: 'push'; workId: string; baseHash: string; updatedAt: number; trashedAt: number }
  | { op: 'pullContent'; workId: string; toTrashedAt: number | null } // null=active へ、number=ゴミ箱へ
  | { op: 'patchTrash'; workId: string; trashedAt: number; updatedAt: number }
  | { op: 'trashLocal'; workId: string; trashedAt: number } // active→trash（または trashedAt の更新）
  | { op: 'restoreLocal'; workId: string } // trash→active
  | { op: 'purgeLocal'; workId: string } // ローカルから除去（執行側は必ず snapshot 退避してから）
  | { op: 'purgeRemote'; workId: string; at: number }
  | { op: 'adoptBase'; workId: string; hash: string; remoteUpdatedAt: number } // 内容一致・base 記録だけ直す
  | { op: 'dropBase'; workId: string }

export interface ConflictInfo {
  workId: string
  winner: 'local' | 'remote'
}

export interface PlanResult {
  ops: SyncOp[]
  conflicts: ConflictInfo[]
}
