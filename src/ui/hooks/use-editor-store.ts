import { useSyncExternalStore } from 'react'
import type { EditorState, EditorStore } from '../store/editorStore'

/** EditorStore を React に橋渡しする（自前ストア × useSyncExternalStore）。 */
export function useEditorStore(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
