import type { StructureRepository } from '@/core/storage/structureRepository'
import {
  pickPrimaryStructure,
  type Structure,
  type StructureKind,
  singletonStructureId,
} from '@/core/structure'

/**
 * ビューが表示すべき構造（作品×種別で 1 つ）を取得する。3 ビュー共通の唯一の入口。
 *
 * - 既存があれば pickPrimaryStructure で**内容優先・決定的**に 1 つ選ぶ（同期レースで生まれた
 *   「新しくて空」ではなく、書きかけの内容を持つ方が常に表示される。選び方が全端末で同じなので、
 *   重複が残っていても表示は一意に収束する）。
 * - 重複の**自動削除はしない**。「メモの無いアウトライン」は正当なデータでも nodes が空になるため、
 *   空＝残骸とは判定できず、誤削除が purge として他端末へ伝播する事故があった（stg で実発生）。
 *   選ばれない重複は無害なので放置し、消す判断はしない（データ保全バイアス）。
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
  if (primary) return primary
  return repo.create(workId, kind, title, singletonStructureId(workId, kind))
}
