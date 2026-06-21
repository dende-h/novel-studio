import { ProfileRepository } from '../../core/profile'
import { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
import { IdbStore } from '../../core/storage/idbStore'
import { WorkRepository } from '../../core/storage/workRepository'
import { createEditorStore, type EditorStore } from './editorStore'

/** 履歴の集約間隔：連続編集中はこの間隔内の保存を最新版へ合体する（90秒）。 */
const SNAPSHOT_MIN_INTERVAL_MS = 90_000

/** ゴミ箱の保持期間：捨ててから30日で自動削除（D-SYNC-TOMBSTONE）。 */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 本番用ストア：IndexedDB 永続化＋crypto.randomUUID の id 採番。 */
export function createDefaultStore(): EditorStore {
  const store = new IdbStore('novel-studio')
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  const profileRepo = new ProfileRepository(store)
  return createEditorStore({
    repo,
    snapshotRepo,
    profileRepo,
    genId: () => crypto.randomUUID(),
    now: () => Date.now(),
    snapshotMinIntervalMs: SNAPSHOT_MIN_INTERVAL_MS,
    trashTtlMs: TRASH_TTL_MS,
  })
}
