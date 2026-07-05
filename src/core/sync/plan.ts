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
  /** LWW の時計。active は最終編集時刻、trashed はゴミ箱へ入れた時刻を入れる。 */
  updatedAt: number
  docHash: string
  mediaHash: string
  /** ローカルでゴミ箱に入れた時刻（epoch ms）。0/未設定 = active。>0 = ローカル trashed。 */
  trashedAt?: number
}

export interface LoginSyncPlan {
  /** サーバから取得して active として反映する workId。 */
  toPull: string[]
  /** サーバへアップロード（active 化＝サーバ側 restore も兼ねる）する workId。 */
  toPush: string[]
  /** リモート削除（trash/purge）をローカルに適用：active をゴミ箱へ送る workId。 */
  toTrashLocal: string[]
  /** リモートが active（他端末で復元/編集され新しい）＝ローカルのゴミ箱から復元する workId（共有ゴミ箱）。 */
  toRestoreLocal: string[]
  /** ローカルのゴミ箱状態が勝ち＝サーバへ trashed を伝播（PATCH）する workId（共有ゴミ箱）。 */
  toPushTrash: string[]
  /** pull 前にローカルを退避（スナップショット）すべき workId（敗者保全）。 */
  snapshotBeforePull: string[]
}

/**
 * ログイン時の全双方向同期計画。ローカルとリモートの和集合を 1 件ずつ判定する（純ロジック）。
 * 状態は active / trashed（ゴミ箱・blob 保持）/ purged（完全削除）の3つ。**ゴミ箱状態も同期**し、
 * 「別端末で削除→pull で復活」「各端末でゴミ箱が増殖」を解消する（D-SYNC-TOMBSTONE 改）。
 * trashed の時計は `trashedAt`（＝そのエントリの `updatedAt` にも入れて渡す）で、編集 vs 削除は
 * LWW（新しい方が勝つ＝編集が新しければ復活）。
 */
export function planLoginSync(local: LocalEntry[], remote: ManifestEntry[]): LoginSyncPlan {
  const localMap = new Map(local.map((e) => [e.workId, e]))
  const remoteMap = new Map(remote.map((e) => [e.workId, e]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])

  const plan: LoginSyncPlan = {
    toPull: [],
    toPush: [],
    toTrashLocal: [],
    toRestoreLocal: [],
    toPushTrash: [],
    snapshotBeforePull: [],
  }

  for (const id of ids) {
    const l = localMap.get(id)
    const r = remoteMap.get(id)
    const lTrashed = !!l && (l.trashedAt ?? 0) > 0
    const rPurged = !!r && r.deleted
    const rTrashed = !!r && !r.deleted && (r.trashedAt ?? 0) > 0

    if (l && !r) {
      // ローカルのみ。active は新規アップロード。trashed（未同期のゴミ箱）はサーバに無いので何もしない。
      if (!lTrashed) plan.toPush.push(id)
      continue
    }
    if (!l && r) {
      // リモートのみ。active は取得。trashed/purged で手元に無いものは materialize しない（v1）。
      if (!rPurged && !rTrashed) plan.toPull.push(id)
      continue
    }
    if (!l || !r) {
      continue // 到達しない（型の絞り込み用）。
    }

    if (rPurged) {
      // リモートが完全削除。ローカル編集が新しければ復活、そうでなければ削除を適用（active→退避）。
      if (!lTrashed && l.updatedAt > r.updatedAt) plan.toPush.push(id)
      else if (!lTrashed) plan.toTrashLocal.push(id)
      // ローカルも既に trashed → ローカルの TTL に任せる（noop）。
      continue
    }

    if (rTrashed) {
      if (lTrashed) continue // 両方ゴミ箱 → 一致（noop）。
      // ローカルは active：編集が trash より新しければ復活（push で active 化）、でなければゴミ箱へ。
      if (l.updatedAt > r.updatedAt) plan.toPush.push(id)
      else plan.toTrashLocal.push(id)
      continue
    }

    // ここからリモートは active。
    if (lTrashed) {
      // ローカルの trash が新しければサーバへ伝播、そうでなければ（他端末の復元/編集が新しい）復元。
      if (l.updatedAt > r.updatedAt) plan.toPushTrash.push(id)
      else plan.toRestoreLocal.push(id)
      continue
    }

    // ローカルもリモートも active → 内容の LWW に委ねる。
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
