import type { NudgeAck } from '@/core/nudge/backup-nudge'

/**
 * バックアップ案内（タスク4）の「どこまで案内済みか」を localStorage に持つ最小ストア。
 * 判定は開くたびに一度だけ（Library マウント時）行うので、リアクティブなフックにはしない。
 * 読みは readNudgeAck()、解散時の書き戻しは acknowledgeNudge() を使う。純ローカル（課金・同期と無関係）。
 */

const CHAR_LEVEL = 'ns-backup-nudge-char-level'
const DAY_LEVEL = 'ns-backup-nudge-day-level'
const DISMISSED_AT = 'ns-backup-nudge-dismissed-at'

function readNum(key: string): number {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function writeNum(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n))
  } catch {
    // プライベートモード等では記録できないが、その場の表示制御は成立させる。
  }
}

/** 承認済みレベルと最終解散時刻を読む。 */
export function readNudgeAck(): NudgeAck {
  return {
    charLevel: readNum(CHAR_LEVEL),
    dayLevel: readNum(DAY_LEVEL),
    dismissedAt: readNum(DISMISSED_AT),
  }
}

/**
 * 案内を解散したことを記録：現在レベルを承認済みに繰り上げ、解散時刻でクールダウンを開始する。
 * ファイルバックアップを実行した場合も×で閉じた場合も、等しく「一度出した」として扱う。
 */
export function acknowledgeNudge(charLevel: number, dayLevel: number, at: number): void {
  writeNum(CHAR_LEVEL, charLevel)
  writeNum(DAY_LEVEL, dayLevel)
  writeNum(DISMISSED_AT, at)
}
