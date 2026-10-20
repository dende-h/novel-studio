import { type ProofreadRules, ProofreadRulesSchema } from '../proofread/work-rules'
import type { KeyValueStore } from './types'

/**
 * 推敲の作品の決まり（COT-62・例外・表記の好み・提案しない言葉）の永続化。外した語（nameDismissalRepository.ts）の写し。
 * KeyValueStore に `proofread-rules:<workId>` で作品ごとに1レコードを持つ（id は workId）。
 * 接頭辞を `proofread:` で始めないこと：ProofreadRepository の keys('proofread:') に拾われ、
 * 推敲の判断の復元（replaceAll）で消えてしまう。
 * 読むときは Zod を通し、読めない（壊れた）レコードは無いものとして扱う（消さない）。
 */
const PREFIX = 'proofread-rules:'
const keyOf = (workId: string) => `${PREFIX}${workId}`

const parse = (raw: unknown): ProofreadRules | undefined => {
  const r = ProofreadRulesSchema.safeParse(raw)
  return r.success ? r.data : undefined
}

export class ProofreadRulesRepository {
  constructor(private store: KeyValueStore) {}

  /** 作品の記録。無い・読めなければ undefined。 */
  async get(workId: string): Promise<ProofreadRules | undefined> {
    return this.getById(workId)
  }

  /** レコード id（＝workId）で1件取得。同期の pull / purge が使う。 */
  async getById(id: string): Promise<ProofreadRules | undefined> {
    return parse(await this.store.get<unknown>(keyOf(id)))
  }

  /** 保存する（updatedAt は呼び出し側が dismissName 等で刻印済み。ここでは触らない）。 */
  async save(record: ProofreadRules): Promise<void> {
    await this.store.set(keyOf(record.workId), record)
  }

  /** 同期 pull 用の素通し保存。updatedAt を刻印しない（LWW の時計を進めない）。 */
  async put(record: ProofreadRules): Promise<void> {
    await this.save(record)
  }

  async removeById(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /** 作品の記録を消す（作品の完全削除時に使う）。 */
  async removeByWork(workId: string): Promise<void> {
    await this.removeById(workId)
  }

  /** 全件（同期の収集・バックアップ用）。 */
  async list(): Promise<ProofreadRules[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map(async (k) => parse(await this.store.get<unknown>(k))))
    return rows.filter((r): r is ProofreadRules => r != null)
  }

  /**
   * 全件を読まずに生のまま返す（同期の列挙用）。読めない（壊れた）レコードも id ごと返すので、
   * 同期側は「判断保留（masked）」に回せる（ProofreadRepository.listRaw と同じ理由）。
   */
  async listRaw(): Promise<{ id: string; raw: unknown }[]> {
    const keys = await this.store.keys(PREFIX)
    return Promise.all(
      keys.map(async (k) => ({
        id: k.slice(PREFIX.length),
        raw: await this.store.get<unknown>(k),
      })),
    )
  }

  /** 全置換する（クラウド／ローカル両バックアップの復元用・既存を消してから書き込む）。 */
  async replaceAll(records: ProofreadRules[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(records.map((r) => this.save(r)))
  }
}
