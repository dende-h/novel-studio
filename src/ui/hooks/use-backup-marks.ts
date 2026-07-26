import { useSyncExternalStore } from 'react'

/**
 * 「全体バックアップを最後に取った日時」を localStorage に持つ最小ストア（use-preferences と同型）。
 * - ファイルへの書き出し（無料・誰でも）と、クラウドバックアップ（会員）の最終実行日時。
 * - 保存状態インジケータ（タスク1）と、執筆量に応じた案内の出し分け（タスク4）が参照する。
 * 端末ローカルの記録なので、別端末で取ったバックアップは反映されない（この端末での目安）。
 * 課金・同期とは無関係（プライバシーポリシー §2「端末内設定」の範疇）。
 */

const LOCAL_AT = 'ns-last-local-backup-at'
const LOCAL_CHARS = 'ns-last-local-backup-chars'
const CLOUD_AT = 'ns-last-cloud-backup-at'

function readNum(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writeNum(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n))
  } catch {
    // プライベートモード等。記録できなくてもその場の動作は続行。
  }
}

export interface BackupMarks {
  /** 最後にファイル書き出しをした時刻（epoch ms・未実行は null）。 */
  localBackupAt: number | null
  /** その書き出し時点の総文字数（タスク4「◯字ぶん書き足し」の基準・未実行は null）。 */
  localBackupChars: number | null
  /** 最後にクラウドバックアップをした時刻（epoch ms・未実行は null）。 */
  cloudBackupAt: number | null
}

let state: BackupMarks = {
  localBackupAt: readNum(LOCAL_AT),
  localBackupChars: readNum(LOCAL_CHARS),
  cloudBackupAt: readNum(CLOUD_AT),
}
const listeners = new Set<() => void>()

function notify(next: Partial<BackupMarks>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

/** 全体ファイル書き出しを記録（Library の onExport 成功後に呼ぶ）。 */
export function markLocalBackup(at: number, totalChars: number): void {
  writeNum(LOCAL_AT, at)
  writeNum(LOCAL_CHARS, totalChars)
  notify({ localBackupAt: at, localBackupChars: totalChars })
}

/** 全体クラウドバックアップを記録（CloudBackupDialog の backupNow 成功後に呼ぶ）。 */
export function markCloudBackup(at: number): void {
  writeNum(CLOUD_AT, at)
  notify({ cloudBackupAt: at })
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
function getSnapshot(): BackupMarks {
  return state
}

/** 現在のバックアップ実行状況を一度だけ読む（フック外・案内判定で使う）。 */
export function readBackupMarks(): BackupMarks {
  return state
}

export function useBackupMarks(): BackupMarks {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
