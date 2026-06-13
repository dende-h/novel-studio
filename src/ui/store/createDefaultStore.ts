import { IdbStore } from '../../core/storage/idbStore'
import { WorkRepository } from '../../core/storage/workRepository'
import { createEditorStore, type EditorStore } from './editorStore'

/** 本番用ストア：IndexedDB 永続化＋crypto.randomUUID の id 採番。 */
export function createDefaultStore(): EditorStore {
  const repo = new WorkRepository(new IdbStore('novel-studio'))
  return createEditorStore({ repo, genId: () => crypto.randomUUID() })
}
