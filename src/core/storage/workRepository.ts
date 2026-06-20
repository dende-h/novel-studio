import { type Work, WorkSchema } from '../schema'
import { countWorkChars } from '../stats'
import type { KeyValueStore } from './types'

/**
 * Work の永続化リポジトリ。KeyValueStore 上に `work:<id>` で保存し、
 * 入出力で WorkSchema 検証して破損データを弾く。
 */

const keyOf = (id: string) => `work:${id}`
const trashKeyOf = (id: string) => `trash:${id}`

/** ゴミ箱に退避した作品の記録（本体＋退避時刻）。`trash:<id>` に保存。 */
interface TrashedRecord {
  work: Work
  trashedAt: number
}

export interface WorkSummary {
  id: string
  title: string
  /** 話数（ライブラリカード表示用の派生値） */
  episodeCount: number
  /** 総文字数（派生値） */
  charCount: number
  /** 著者名（メタ編集ダイアログの初期値・カード表示用） */
  author?: string
  /** あらすじ（メタ編集ダイアログの初期値用） */
  description?: string
  /** 最終更新時刻（未設定の旧データは undefined） */
  updatedAt?: number
  /** 表紙画像の data URL（ライブラリカード表示用。未設定なら undefined） */
  coverImage?: string
}

/** ゴミ箱一覧の要約（WorkSummary に退避時刻を加えたもの）。 */
export interface TrashSummary {
  id: string
  title: string
  episodeCount: number
  charCount: number
  /** ゴミ箱へ移した時刻（30日後に自動 purge する起点） */
  trashedAt: number
  coverImage?: string
}

export class WorkRepository {
  constructor(private store: KeyValueStore) {}

  async saveWork(work: Work): Promise<void> {
    await this.store.set(keyOf(work.id), WorkSchema.parse(work))
  }

  async getWork(id: string): Promise<Work | undefined> {
    const raw = await this.store.get(keyOf(id))
    return raw === undefined ? undefined : WorkSchema.parse(raw)
  }

  async listWorks(): Promise<WorkSummary[]> {
    const keys = await this.store.keys('work:')
    const works = await Promise.all(keys.map((k) => this.store.get(k)))
    return works.map((w) => {
      const parsed = WorkSchema.parse(w)
      return {
        id: parsed.id,
        title: parsed.title,
        episodeCount: parsed.episodes.length,
        charCount: countWorkChars(parsed),
        author: parsed.author,
        description: parsed.description,
        updatedAt: parsed.updatedAt,
        coverImage: parsed.coverImage,
      }
    })
  }

  async deleteWork(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /**
   * 作品をゴミ箱へ退避（active → trashed）。`work:<id>` を消し `trash:<id>` へ移す。
   * 別名前空間なので listWorks（同期対象）には出ず、ローカルにのみ残る。存在しなければ no-op。
   */
  async trashWork(id: string, at: number): Promise<void> {
    const work = await this.getWork(id)
    if (!work) return
    await this.store.set<TrashedRecord>(trashKeyOf(id), { work, trashedAt: at })
    await this.store.delete(keyOf(id))
  }

  /** ゴミ箱の一覧（要約）。listWorks とは独立。 */
  async listTrash(): Promise<TrashSummary[]> {
    const keys = await this.store.keys('trash:')
    const records = await Promise.all(keys.map((k) => this.store.get<TrashedRecord>(k)))
    return records
      .filter((r): r is TrashedRecord => r !== undefined)
      .map((r) => {
        const parsed = WorkSchema.parse(r.work)
        return {
          id: parsed.id,
          title: parsed.title,
          episodeCount: parsed.episodes.length,
          charCount: countWorkChars(parsed),
          trashedAt: r.trashedAt,
          coverImage: parsed.coverImage,
        }
      })
  }

  /** ゴミ箱から復元（trashed → active）。復元した Work を返す。無ければ undefined。 */
  async restoreWork(id: string): Promise<Work | undefined> {
    const rec = await this.store.get<TrashedRecord>(trashKeyOf(id))
    if (rec === undefined) return undefined
    const work = WorkSchema.parse(rec.work)
    await this.saveWork(work)
    await this.store.delete(trashKeyOf(id))
    return work
  }

  /** ゴミ箱の1件を完全に削除（不可逆）。 */
  async purgeTrashedWork(id: string): Promise<void> {
    await this.store.delete(trashKeyOf(id))
  }

  /** 期限切れ（trashedAt + ttlMs <= now）のゴミ箱項目を完全削除し、削除した作品 id を返す。 */
  async purgeExpiredTrash(now: number, ttlMs: number): Promise<string[]> {
    const keys = await this.store.keys('trash:')
    const records = await Promise.all(keys.map((k) => this.store.get<TrashedRecord>(k)))
    const expired = records.filter(
      (r): r is TrashedRecord => r !== undefined && r.trashedAt + ttlMs <= now,
    )
    await Promise.all(expired.map((r) => this.store.delete(trashKeyOf(r.work.id))))
    return expired.map((r) => r.work.id)
  }
}
