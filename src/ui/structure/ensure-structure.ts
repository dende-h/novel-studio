import type { StructureRepository } from '@/core/storage/structureRepository'
import {
  isTrivialStructure,
  pickPrimaryStructure,
  type Structure,
  type StructureKind,
  singletonStructureId,
} from '@/core/structure'

/**
 * ビューが表示すべき構造（作品×種別で 1 つ）を取得する。3 ビュー共通の唯一の入口。
 *
 * - 既存があれば pickPrimaryStructure で**内容優先**に 1 つ選ぶ（同期レースで生まれた
 *   「新しくて空」ではなく、書きかけの内容を持つ方が常に表示される）。
 * - 選ばれなかった**空の重複**はその場で削除する（同期がトゥームストーンとして他端末へも
 *   伝播し、増殖が収束する）。内容を持つ重複は消さない（手動で救えるように残す）。
 * - 1 つも無ければ決定的 id（workId:kind）で自動生成する＝どの端末が作っても同じレコード。
 */
export async function ensurePrimaryStructure(
  repo: StructureRepository,
  workId: string,
  kind: StructureKind,
  title?: string,
): Promise<Structure> {
  const list = await repo.listByWork(workId)
  const primary = pickPrimaryStructure(list, kind)
  if (primary) {
    const emptyDupes = list.filter(
      (s) => s.kind === kind && s.id !== primary.id && isTrivialStructure(s),
    )
    await Promise.all(emptyDupes.map((s) => repo.remove(s.id)))
    return primary
  }
  return repo.create(workId, kind, title, singletonStructureId(workId, kind))
}
