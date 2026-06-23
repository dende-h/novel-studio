/**
 * 本番用の同期コントローラ生成（Phase 2）。エディタストアと同じ IndexedDB（DB 名 'novel-studio'）の上に
 * 独立した Repository を張り、_api/sync の fetch ラッパと結ぶ。IndexedDB は DB 名で共有されるため、
 * pull で書いた Work はエディタストア側からも（再 init で）読める。
 */

import { ProfileRepository } from '@/core/profile'
import { SnapshotRepository } from '@/core/snapshot/snapshotRepository'
import { IdbStore } from '@/core/storage/idbStore'
import { SyncMetaRepository } from '@/core/storage/syncMetaRepository'
import { WorkRepository } from '@/core/storage/workRepository'
import { deleteWork, getManifest, hashPart, pullWork, pushWork } from '@/ui/_api/sync'
import { createSyncController, type SyncController, type SyncPhase } from './sync-controller'

/** autosave push の合体間隔（30 秒・D-SYNC のトリガ仕様）。 */
const DEBOUNCE_MS = 30_000

export interface DefaultSyncControllerOptions {
  getToken: () => Promise<string | null>
  userId: string
  isEnabled: () => boolean
  onStatus?: (phase: SyncPhase) => void
}

export function createDefaultSyncController(opts: DefaultSyncControllerOptions): SyncController {
  const store = new IdbStore('novel-studio')
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  const syncMetaRepo = new SyncMetaRepository(store, opts.userId)
  const profileRepo = new ProfileRepository(store)
  const { getToken } = opts

  return createSyncController({
    api: {
      getManifest: () => getManifest(getToken),
      pullWork: (id) => pullWork(getToken, id),
      pushWork: (id, payload) => pushWork(getToken, id, payload),
      deleteWork: (id) => deleteWork(getToken, id),
    },
    repo,
    snapshotRepo,
    syncMetaRepo,
    profileRepo,
    hashPart,
    genId: () => crypto.randomUUID(),
    now: () => Date.now(),
    isEnabled: opts.isEnabled,
    isOnline: () => navigator.onLine,
    debounceMs: DEBOUNCE_MS,
    onStatus: opts.onStatus,
  })
}
