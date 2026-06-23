/**
 * 同期計画の組み立て（Phase 2）。ローカルとサーバ（マニフェスト）の状態を突き合わせ、
 * 「どの Work を pull / push / ローカル削除するか」を決める純ロジック。実際の I/O は
 * エンジン（src/core/sync/engine.ts・Phase 2c）が注入された関数で行う。
 */

import { resolvePull, resolvePush } from './lww'
import type { ManifestEntry } from './manifest'

/** ローカル 1 Work の現在状態（現物から算出したハッシュ＋更新時刻）。 */
export interface LocalEntry {
  workId: string
  updatedAt: number
  docHash: string
  mediaHash: string
}

export interface LoginSyncPlan {
  /** サーバから取得して反映する workId。 */
  toPull: string[]
  /** サーバへアップロードする workId（パートはエンジンが resolvePush で決める）。 */
  toPush: string[]
  /** リモートで削除されたのでローカルもゴミ箱へ送る workId。 */
  toTrashLocal: string[]
  /** pull 前にローカルを退避（スナップショット）すべき workId（敗者保全）。 */
  snapshotBeforePull: string[]
}

/**
 * ログイン時の全双方向同期計画。ローカルとリモートの和集合を 1 件ずつ判定する。
 * - ローカルのみ → push（新規アップロード）
 * - リモートのみ（生存）→ pull（新規ダウンロード）／（削除済み）→ 何もしない
 * - 両方あり・リモート削除済み → ローカルが新しければ push（復活）、でなければローカルもゴミ箱へ
 * - 両方あり・生存 → resolvePull に委ねる
 */
export function planLoginSync(local: LocalEntry[], remote: ManifestEntry[]): LoginSyncPlan {
  const localMap = new Map(local.map((e) => [e.workId, e]))
  const remoteMap = new Map(remote.map((e) => [e.workId, e]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])

  const plan: LoginSyncPlan = {
    toPull: [],
    toPush: [],
    toTrashLocal: [],
    snapshotBeforePull: [],
  }

  for (const id of ids) {
    const l = localMap.get(id)
    const r = remoteMap.get(id)

    if (l && !r) {
      plan.toPush.push(id)
      continue
    }
    if (!l && r) {
      if (!r.deleted) {
        plan.toPull.push(id)
      }
      continue
    }
    if (!l || !r) {
      continue // 到達しない（型の絞り込み用）。
    }

    if (r.deleted) {
      if (l.updatedAt > r.updatedAt) {
        plan.toPush.push(id) // 削除後にローカルで編集 → 復活させる。
      } else {
        plan.toTrashLocal.push(id) // 削除を伝播。
      }
      continue
    }

    const decision = resolvePull(
      { updatedAt: l.updatedAt, docHash: l.docHash, mediaHash: l.mediaHash },
      { updatedAt: r.updatedAt, docHash: r.docHash, mediaHash: r.mediaHash },
    )
    if (decision.action === 'take-remote') {
      plan.toPull.push(id)
      if (decision.snapshotLocal) {
        plan.snapshotBeforePull.push(id)
      }
    } else if (decision.action === 'keep-local') {
      plan.toPush.push(id)
    }
    // noop → 何もしない。
  }

  return plan
}

export interface AutosavePushPlan {
  shouldPush: boolean
  parts: Array<'doc' | 'media'>
}

/**
 * autosave 時、編集中 Work のうち変わったパートだけを push する計画。
 * `lastSynced` は最後にサーバと一致させたハッシュ（未同期なら null）。
 */
export function planAutosavePush(
  current: { docHash: string; mediaHash: string },
  lastSynced: { docHash: string; mediaHash: string } | null,
): AutosavePushPlan {
  const changed = resolvePush(current, lastSynced)
  const parts: Array<'doc' | 'media'> = []
  if (changed.doc) {
    parts.push('doc')
  }
  if (changed.media) {
    parts.push('media')
  }
  return { shouldPush: parts.length > 0, parts }
}
