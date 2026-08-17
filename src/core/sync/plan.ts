import type { ConflictInfo, PlanInput, PlanResult, RemoteWorkMeta, SyncBase, SyncOp } from './types'

/**
 * 三方向差分（ローカル／リモート／base）から同期の実行計画を立てる**純関数**。
 * ハッシュは呼び出し側が事前計算して渡すので async にしない。
 *
 * 設計の芯：
 * - base（最後に同期した時点の記録）との比較で「どちらが動いたか」を判定し、
 *   旧同期の失敗＝黙った LWW 上書き・削除の復活を構造的に排除する。
 * - 両側が動いた競合だけ updatedAt の LWW で勝者を決め、conflicts に記録する
 *   （敗者の退避＝snapshot は執行側の責務。planner は関知しない）。
 * - ops は workId 昇順の決定的順序（1 work 1〜2 op）。
 */

interface LocalActive {
  workId: string
  updatedAt: number
  hash: string
}

interface LocalTrashed {
  workId: string
  updatedAt: number
  trashedAt: number
  hash: string
}

export function planReconcile(input: PlanInput): PlanResult {
  const locals = new Map(input.localWorks.map((w) => [w.workId, w]))
  const trashes = new Map(input.localTrash.map((t) => [t.workId, t]))
  const bases = new Map(input.bases.map((b) => [b.workId, b]))
  const remotes = new Map(input.remote.map((r) => [r.workId, r]))

  const ids = [
    ...new Set([...locals.keys(), ...trashes.keys(), ...bases.keys(), ...remotes.keys()]),
  ].sort()

  const ops: SyncOp[] = []
  const conflicts: ConflictInfo[] = []

  for (const workId of ids) {
    planOne(
      workId,
      locals.get(workId),
      trashes.get(workId),
      bases.get(workId),
      remotes.get(workId),
      input.now,
      ops,
      conflicts,
    )
  }

  return { ops, conflicts }
}

function planOne(
  workId: string,
  L: LocalActive | undefined,
  T: LocalTrashed | undefined,
  B: SyncBase | undefined,
  R: RemoteWorkMeta | undefined,
  now: number,
  ops: SyncOp[],
  conflicts: ConflictInfo[],
): void {
  // ローカル時計：active なら updatedAt、ゴミ箱なら「編集」と「捨てた操作」の遅い方。
  const cL = L ? L.updatedAt : T ? Math.max(T.updatedAt, T.trashedAt) : 0

  // ---- リモート無し ----
  if (!R) {
    if (L) {
      // #1 新規 ／ #2 base 有＝tombstone 物理削除後とみなしデータ保全バイアスで再 push。
      // 消す判断は取り返しがつかないので、リモートの根拠（tombstone 行）が無い限り消さない。
      ops.push({ op: 'push', workId, baseHash: '', updatedAt: L.updatedAt, trashedAt: 0 })
      return
    }
    if (T) {
      // #3 #4 オフラインで作って捨てた作品も共有ゴミ箱へ（#4 も同じ保全バイアス）
      ops.push({ op: 'push', workId, baseHash: '', updatedAt: cL, trashedAt: T.trashedAt })
      return
    }
    // base だけ残った（サーバ側で行ごと消えた等）→ 掃除
    if (B) ops.push({ op: 'dropBase', workId })
    return
  }

  // ---- リモート tombstone（purge 済み・blob 無し）----
  if (R.deleted === 1) {
    if (L) {
      // #18 復活（編集勝ち）か、削除の伝播（snapshot 退避は執行側）
      if (cL > R.updatedAt) {
        ops.push({ op: 'push', workId, baseHash: '', updatedAt: L.updatedAt, trashedAt: 0 })
      } else {
        ops.push({ op: 'purgeLocal', workId })
        ops.push({ op: 'dropBase', workId })
        // 未同期の編集を消すときだけ競合として知らせる
        if (!B || L.hash !== B.baseHash) conflicts.push({ workId, winner: 'remote' })
      }
      return
    }
    if (T) {
      // #17 ゴミ箱内の版が tombstone より新しければ復活 push、古ければ削除に追随
      if (cL > R.updatedAt) {
        ops.push({ op: 'push', workId, baseHash: '', updatedAt: cL, trashedAt: T.trashedAt })
      } else {
        ops.push({ op: 'purgeLocal', workId })
        ops.push({ op: 'dropBase', workId })
      }
      return
    }
    // #9 ローカルに実体無し。base だけ掃除
    if (B) ops.push({ op: 'dropBase', workId })
    return
  }

  // ---- リモート live・ローカル実体無し ----
  if (!L && !T) {
    if (B) {
      if (R.docHash !== B.baseHash) {
        // #6' #8' purge 後にリモートが前進していた＝別端末がその後も編集している。
        // 削除 vs 編集は編集勝ち（D-SYNC-TOMBSTONE）なので、purge は伝播せず取り戻す。
        ops.push({ op: 'pullContent', workId, toTrashedAt: R.trashedAt > 0 ? R.trashedAt : null })
        return
      }
      // #6 #8 この端末で purge 済み（base が同期の証拠・リモートは base のまま）→ サーバへ伝播
      ops.push({ op: 'purgeRemote', workId, at: now })
      ops.push({ op: 'dropBase', workId })
    } else {
      // #5 #7 他端末の新規（active／共有ゴミ箱）を取り込む
      ops.push({ op: 'pullContent', workId, toTrashedAt: R.trashedAt > 0 ? R.trashedAt : null })
    }
    return
  }

  // ---- リモート live・ローカル active ----
  if (L) {
    if (R.trashedAt > 0) {
      // #14 リモートはゴミ箱。LWW：ローカル編集が新しければ復活 push、古ければ追随して trash
      if (cL > R.updatedAt) {
        ops.push({ op: 'push', workId, baseHash: R.docHash, updatedAt: L.updatedAt, trashedAt: 0 })
      } else {
        ops.push({ op: 'trashLocal', workId, trashedAt: R.trashedAt })
        if (!B || L.hash !== B.baseHash) conflicts.push({ workId, winner: 'remote' })
      }
      return
    }

    // #10〜#13 双方 active。内容一致なら base の記録だけ直す（#10、B 無も含む）
    if (L.hash === R.docHash) {
      if (!B || B.baseHash !== L.hash || B.remoteUpdatedAt !== R.updatedAt) {
        ops.push({ op: 'adoptBase', workId, hash: L.hash, remoteUpdatedAt: R.updatedAt })
      }
      return
    }

    const dirty = !B || L.hash !== B.baseHash
    const remoteChanged = !B || R.docHash !== B.baseHash

    if (!dirty && remoteChanged) {
      // #11 ローカルは base のまま・リモートだけ前進 → 安全に取り込める
      ops.push({ op: 'pullContent', workId, toTrashedAt: null })
      return
    }
    if (dirty && !remoteChanged) {
      // #12 ローカルだけ前進 → CAS push（base はサーバの現 hash と一致しているはず）
      ops.push({
        op: 'push',
        workId,
        baseHash: B?.baseHash ?? R.docHash,
        updatedAt: L.updatedAt,
        trashedAt: 0,
      })
      return
    }
    // #13 両側前進＝競合。updatedAt の LWW で勝者を決め、必ず conflicts に記録する
    // （敗者側の内容は執行側が snapshot へ退避する）
    if (cL > R.updatedAt) {
      ops.push({ op: 'push', workId, baseHash: R.docHash, updatedAt: L.updatedAt, trashedAt: 0 })
      conflicts.push({ workId, winner: 'local' })
    } else {
      ops.push({ op: 'pullContent', workId, toTrashedAt: null })
      conflicts.push({ workId, winner: 'remote' })
    }
    return
  }

  // ---- リモート live・ローカルゴミ箱 ----
  if (T) {
    if (R.trashedAt === 0) {
      // #15 リモートは active。捨てた操作が新しければゴミ箱状態を伝播、
      // 古ければ復元し、内容が違えば取り込む（一致なら base だけ直す）
      if (cL > R.updatedAt) {
        ops.push({ op: 'patchTrash', workId, trashedAt: T.trashedAt, updatedAt: cL })
      } else {
        ops.push({ op: 'restoreLocal', workId })
        if (R.docHash !== T.hash) {
          ops.push({ op: 'pullContent', workId, toTrashedAt: null })
        } else {
          ops.push({ op: 'adoptBase', workId, hash: T.hash, remoteUpdatedAt: R.updatedAt })
        }
      }
      return
    }
    // #16 双方ゴミ箱。trashedAt が違えば LWW で揃える。同じなら base の記録だけ
    if (T.trashedAt !== R.trashedAt) {
      if (cL > R.updatedAt) {
        ops.push({ op: 'patchTrash', workId, trashedAt: T.trashedAt, updatedAt: cL })
      } else {
        ops.push({ op: 'trashLocal', workId, trashedAt: R.trashedAt })
      }
      return
    }
    if (!B) {
      ops.push({ op: 'adoptBase', workId, hash: T.hash, remoteUpdatedAt: R.updatedAt })
    }
  }
}
