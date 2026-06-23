/**
 * Work レベルの Last-Write-Wins 解決（Phase 2）。
 *
 * 同時編集はしない前提（単一アクティブセッションが構造的に防ぐ）なので、残る競合は
 * 「別端末で更新された Work をこちらでも触っていた」程度。`updatedAt` で勝者を決め、
 * pull で remote が勝つとき・かつローカルが異なるなら、上書き前にローカルをスナップショット
 * 退避する（敗者保全）。I/O は持たず判定だけを返す（core 境界準拠）。
 */

interface SideHashes {
  docHash: string
  mediaHash: string
}

interface TimedSide extends SideHashes {
  updatedAt: number
}

export interface PullDecision {
  /** take-remote=remote を取得して上書き / keep-local=ローカルを残す（後で push）/ noop=同一。 */
  action: 'take-remote' | 'keep-local' | 'noop'
  /** take-remote で上書きする前にローカルを退避すべきか（敗者保全）。 */
  snapshotLocal: boolean
}

/** どのパートを push すべきか。 */
export interface PushParts {
  doc: boolean
  media: boolean
}

/**
 * ログイン同期で remote 1 件に対しどうするか決める。
 * local が null（ローカルに無い）なら無条件に取得。ハッシュ一致なら何もしない。
 * remote が新しく内容が異なれば取得（＋退避）、そうでなければローカルを残す。
 */
export function resolvePull(local: TimedSide | null, remote: TimedSide): PullDecision {
  if (local === null) {
    return { action: 'take-remote', snapshotLocal: false }
  }
  if (local.docHash === remote.docHash && local.mediaHash === remote.mediaHash) {
    return { action: 'noop', snapshotLocal: false }
  }
  if (remote.updatedAt > local.updatedAt) {
    // remote が新しく、かつ内容が違う＝未同期のローカル編集を上書きする → 退避してから取得。
    return { action: 'take-remote', snapshotLocal: true }
  }
  // ローカルが同等以上に新しい → ローカルを残す（このあと push して正本にする）。
  return { action: 'keep-local', snapshotLocal: false }
}

/**
 * 変わったパートだけ push する。`against` は「サーバが既に持っているはずのハッシュ」
 * （ログイン時は remote マニフェスト、autosave 時はローカル同期メタ）。null は未アップロード。
 * media は実体が無い側を '' で表すので、'' どうしは送らない。
 */
export function resolvePush(local: SideHashes, against: SideHashes | null): PushParts {
  if (against === null) {
    return { doc: true, media: local.mediaHash !== '' }
  }
  return {
    doc: local.docHash !== against.docHash,
    media: local.mediaHash !== against.mediaHash,
  }
}
