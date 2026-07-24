import { ProfileRepository } from '../../core/profile'
import { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
import { ActivityRepository } from '../../core/storage/activityRepository'
import { IdbStore } from '../../core/storage/idbStore'
import { IdeaRepository } from '../../core/storage/ideaRepository'
import { StructureRepository } from '../../core/storage/structureRepository'
import { WorkRepository } from '../../core/storage/workRepository'
import { createEditorStore, type EditorStore } from './editorStore'

/** 履歴の集約間隔：連続編集中はこの間隔内の保存を最新版へ合体する（90秒）。 */
const SNAPSHOT_MIN_INTERVAL_MS = 90_000

/** ゴミ箱の保持期間：捨ててから30日で自動削除。 */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 本番用ストア：IndexedDB 永続化＋crypto.randomUUID の id 採番。クラウドは明示バックアップ/復元。 */
export function createDefaultStore(): EditorStore {
  const store = new IdbStore('novel-studio')
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  const profileRepo = new ProfileRepository(store)
  const activityRepo = new ActivityRepository(store)
  return createEditorStore({
    repo,
    snapshotRepo,
    profileRepo,
    activityRepo,
    genId: () => crypto.randomUUID(),
    now: () => Date.now(),
    snapshotMinIntervalMs: SNAPSHOT_MIN_INTERVAL_MS,
    trashTtlMs: TRASH_TTL_MS,
  })
}

/** 執筆活動ページ（読み取り専用）が同じ IndexedDB を参照するためのリポジトリ。 */
export function createDefaultActivityRepository(): ActivityRepository {
  return new ActivityRepository(new IdbStore('novel-studio'))
}

/** ネタ帳ページが同じ IndexedDB を参照するためのリポジトリ。 */
export function createDefaultIdeaRepository(): IdeaRepository {
  return new IdeaRepository(new IdbStore('novel-studio'))
}

/** 構造レイヤー（アウトライン／相関図／マインドマップ）用のリポジトリ。 */
export function createDefaultStructureRepository(): StructureRepository {
  return new StructureRepository(new IdbStore('novel-studio'))
}
