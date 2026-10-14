import { type ProofreadRecord, ProofreadRecordSchema } from '../proofread/decisions'
import type { KeyValueStore } from './types'

/**
 * 推敲の判断（COT-40・直す／このまま）の永続化。演出譜（stagingRepository.ts）の写し。
 * KeyValueStore に `proofread:<workId>:<episodeId>` で 1話 1 レコードを持つ。
 * id は `workId:episodeId` の決定的合成＝複数端末で同時に判断しても同じレコードに収束する。
 * 読むときは Zod を通し、読めない（壊れた）レコードは無いものとして扱う（消さない）。
 */
const PREFIX = 'proofread:'
const keyOf = (id: string) => `${PREFIX}${id}`

/** 決定的レコード id。同期 id は `proofread:` を前置したもの。 */
export const proofreadIdOf = (workId: string, episodeId: string) => `${workId}:${episodeId}`

const parse = (raw: unknown): ProofreadRecord | undefined => {
  const r = ProofreadRecordSchema.safeParse(raw)
  return r.success ? r.data : undefined
}

export class ProofreadRepository {
  constructor(private store: KeyValueStore) {}

  /** 1話ぶんの判断。無ければ undefined。 */
  async get(workId: string, episodeId: string): Promise<ProofreadRecord | undefined> {
    return this.getById(proofreadIdOf(workId, episodeId))
  }

  /** レコード id（`workId:episodeId`）で1件取得。同期の pull / purge が使う。 */
  async getById(id: string): Promise<ProofreadRecord | undefined> {
    return parse(await this.store.get<unknown>(keyOf(id)))
  }

  /** 保存する（updatedAt は呼び出し側が decide 等で刻印済み。ここでは触らない）。 */
  async save(record: ProofreadRecord): Promise<void> {
    await this.store.set(keyOf(proofreadIdOf(record.workId, record.episodeId)), record)
  }

  /** 同期 pull 用の素通し保存。updatedAt を刻印しない（LWW の時計を進めない）。 */
  async put(record: ProofreadRecord): Promise<void> {
    await this.save(record)
  }

  async remove(workId: string, episodeId: string): Promise<void> {
    await this.removeById(proofreadIdOf(workId, episodeId))
  }

  async removeById(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /** 指定作品の判断をまとめて削除する（作品の完全削除時に使う）。 */
  async removeByWork(workId: string): Promise<void> {
    const all = await this.list()
    await Promise.all(
      all.filter((r) => r.workId === workId).map((r) => this.remove(r.workId, r.episodeId)),
    )
  }

  async listByWork(workId: string): Promise<ProofreadRecord[]> {
    return (await this.list()).filter((r) => r.workId === workId)
  }

  /** 全件（同期の収集・バックアップ用）。 */
  async list(): Promise<ProofreadRecord[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map(async (k) => parse(await this.store.get<unknown>(k))))
    return rows.filter((r): r is ProofreadRecord => r != null)
  }

  /**
   * 全件を読まずに生のまま返す（同期の列挙用）。読めない（壊れた）レコードも id ごと返すので、
   * 同期側は「判断保留（masked）」に回せる。list() のように黙って外すと、同期の計画が
   * 「端末で消した」と受け取り、ほかの端末の判断まで消してしまう。
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
  async replaceAll(records: ProofreadRecord[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(records.map((r) => this.save(r)))
  }
}
