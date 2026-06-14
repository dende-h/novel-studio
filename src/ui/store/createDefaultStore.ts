import { SnapshotRepository } from '../../core/snapshot/snapshotRepository'
import { IdbStore } from '../../core/storage/idbStore'
import { WorkRepository } from '../../core/storage/workRepository'
import { createEditorStore, type EditorStore } from './editorStore'

/** 本番用ストア：IndexedDB 永続化＋crypto.randomUUID の id 採番。 */
export function createDefaultStore(): EditorStore {
  const store = new IdbStore('novel-studio')
  const repo = new WorkRepository(store)
  const snapshotRepo = new SnapshotRepository(store)
  return createEditorStore({
    repo,
    snapshotRepo,
    genId: () => crypto.randomUUID(),
    now: () => Date.now(),
  })
}
