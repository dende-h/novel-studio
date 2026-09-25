import type { KeptGlossaryDraft } from '@/ui/components/GlossaryView/glossary-view'

/**
 * 用語集の登録前の下書き（と会話）の置き場。作品 id ごと。
 * 画面（App）はルートを離れると unmount されるので、ここに置いて戻ってきたときに続きから開く。
 * 端末には保存しない（ページを閉じると消える＝対話の冒頭でそう案内している）。
 */
const kept = new Map<string, KeptGlossaryDraft>()

export function getKeptGlossaryDraft(workId: string): KeptGlossaryDraft | null {
  return kept.get(workId) ?? null
}

export function setKeptGlossaryDraft(workId: string, draft: KeptGlossaryDraft | null): void {
  if (draft) kept.set(workId, draft)
  else kept.delete(workId)
}

/** テスト用。 */
export function clearKeptGlossaryDrafts(): void {
  kept.clear()
}
