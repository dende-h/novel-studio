import type { DialogAnswer, GlossaryEntry } from '../schema'
import { DIALOG_VERSION } from './dialog'
import { withPublicText } from './index'

/**
 * 用語集の項目のフィールド更新パッチ（name は対象外＝改名は renameEntry）。
 * store の updateGlossaryEntry と、登録前の下書き（画面）が同じ規則で当てる。
 */
export interface GlossaryFieldPatch {
  aliases?: string[]
  category?: string
  reading?: string
  summary?: string
  body?: string
  /** 作者だけが見るメモ（公開時に落とす）。 */
  authorNote?: string
  /** サムネ画像の data URL。空文字 '' は削除（キーを落とす）、undefined は据え置き。 */
  thumbnail?: string
  /**
   * 対話ノートの**鍵ごと**のパッチ（`null` はその鍵を削除）。対話ペインが使う＝答えた鍵だけを
   * 書き換え、同期や MCP で届いた他の鍵の答えを巻き込まない。保存中の最新の record に重ねる。
   */
  dialogPatch?: Record<string, DialogAnswer | null>
  dialogVersion?: number
}

/**
 * 項目にフィールドパッチを当てる純関数。
 * - thumbnail の空文字 '' は削除（undefined＝据え置きと区別）
 * - summary を渡したら旧・詳細（body）は畳む（D-GLOS-PUBLIC-ONE・withPublicText）
 * - dialogPatch は鍵ごとに重ね、null は削除。空になったら record ごと落とす
 */
export function applyGlossaryFieldPatch(
  cur: GlossaryEntry,
  patch: GlossaryFieldPatch,
  ts: number,
): GlossaryEntry {
  const { dialogPatch, dialogVersion, summary, body, ...rest } = patch
  let updated: GlossaryEntry = { ...cur, ...rest, updatedAt: ts }
  if (patch.thumbnail === '') delete updated.thumbnail
  if ('summary' in patch) updated = withPublicText(updated, summary ?? '')
  // 旧・詳細（body）を明示的に渡されたときだけ触る（undefined＝落とす）。
  if ('body' in patch) {
    if (body === undefined) delete updated.body
    else updated.body = body
  }
  // 版は対話ノートと一緒にだけ動く（dialog の無い項目に版だけ残さない）。
  if (dialogPatch !== undefined) {
    const merged: Record<string, DialogAnswer> = { ...(cur.dialog ?? {}) }
    for (const [key, value] of Object.entries(dialogPatch)) {
      if (value === null) delete merged[key]
      else merged[key] = value
    }
    updated.dialog = merged
    updated.dialogVersion = dialogVersion ?? cur.dialogVersion ?? DIALOG_VERSION
  }
  // 版だけの更新は、対話ノートがある項目にだけ効く（無い項目に版だけ残さない）。
  if (dialogPatch === undefined && dialogVersion !== undefined && updated.dialog !== undefined) {
    updated.dialogVersion = dialogVersion
  }
  if (updated.dialog !== undefined && Object.keys(updated.dialog).length === 0) {
    delete updated.dialog
    delete updated.dialogVersion
  }
  return updated
}
