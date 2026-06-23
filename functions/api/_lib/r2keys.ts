/**
 * R2 オブジェクトキーの組み立て（Phase 2）。`<userId>/<workId>/<part>`。
 * ユーザー単位でプレフィックスを切ることで一覧・削除がしやすい。
 */

export type SyncPart = 'doc' | 'media'

export function r2Key(userId: string, workId: string, part: SyncPart): string {
  return `${userId}/${workId}/${part}`
}
