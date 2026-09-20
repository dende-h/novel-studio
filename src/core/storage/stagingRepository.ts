import type { Staging } from '../game'
import type { KeyValueStore } from './types'

/**
 * 演出譜（サウンドノベルの Staging・07-novel-game.md §2.4）の永続化。
 * KeyValueStore に `staging:<workId>:<episodeId>` で 1話 1 レコードを持つ。純ローカル。
 *
 * id は `workId:episodeId` の決定的合成（singletonStructureId と同型）＝複数端末が同時に
 * 演出を付け始めても同じレコードに収束し、同期レースで空の演出譜が増殖しない。
 * replaceAll はクラウド／ローカル両バックアップの全置換復元で使う（plotRepository と同型）。
 */
const PREFIX = 'staging:'
const keyOf = (id: string) => `${PREFIX}${id}`

/** 決定的レコード id。同期 id は `staging:` を前置したもの。 */
export const stagingIdOf = (workId: string, episodeId: string) => `${workId}:${episodeId}`

export class StagingRepository {
  constructor(private store: KeyValueStore) {}

  /** 1話ぶんの演出譜。無ければ undefined（演出ゼロでもゲーム書き出しは成立する）。 */
  async get(workId: string, episodeId: string): Promise<Staging | undefined> {
    return this.getById(stagingIdOf(workId, episodeId))
  }

  /** レコード id（`workId:episodeId`）で1件取得。同期の pull / purge が使う。 */
  async getById(id: string): Promise<Staging | undefined> {
    return (await this.store.get<Staging>(keyOf(id))) ?? undefined
  }

  /** 保存する（updatedAt は呼び出し側が patchCue 等で刻印済み。ここでは触らない）。 */
  async save(staging: Staging): Promise<void> {
    await this.store.set(keyOf(stagingIdOf(staging.workId, staging.episodeId)), staging)
  }

  /**
   * 同期 pull 用の素通し保存。save と同じく updatedAt を刻印しない
   * （刻印すると pull のたびに時計が進み、LWW で常にこちらが勝ってしまう）。
   */
  async put(staging: Staging): Promise<void> {
    await this.save(staging)
  }

  async remove(workId: string, episodeId: string): Promise<void> {
    await this.removeById(stagingIdOf(workId, episodeId))
  }

  async removeById(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /** 指定作品の演出譜をまとめて削除する（作品の完全削除時に使う）。 */
  async removeByWork(workId: string): Promise<void> {
    const all = await this.list()
    await Promise.all(
      all.filter((s) => s.workId === workId).map((s) => this.remove(s.workId, s.episodeId)),
    )
  }

  /** 指定作品の演出譜（episodeId 順は保証しない）。 */
  async listByWork(workId: string): Promise<Staging[]> {
    return (await this.list()).filter((s) => s.workId === workId)
  }

  /** 全件（同期の収集・バックアップ用）。 */
  async list(): Promise<Staging[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map((k) => this.store.get<Staging>(k)))
    return rows.filter((r): r is Staging => r != null)
  }

  /** 全置換する（クラウド復元用・既存を消してから書き込む）。 */
  async replaceAll(stagings: Staging[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(stagings.map((s) => this.save(s)))
  }
}
