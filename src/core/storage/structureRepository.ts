import { emptyStructure, type Structure, type StructureKind } from '../structure'
import type { KeyValueStore } from './types'

/**
 * 構造レイヤー（アウトライン／相関図／マインドマップ）の永続化。
 * KeyValueStore に `structure:<id>` で 1 インスタンス 1 レコードを持つ。純ローカル。
 * replaceAll はクラウド／ローカル両バックアップの全置換復元で使う。
 */
const PREFIX = 'structure:'
const keyOf = (id: string) => `${PREFIX}${id}`

export class StructureRepository {
  constructor(
    private store: KeyValueStore,
    private genId: () => string = () => crypto.randomUUID(),
    private now: () => number = () => Date.now(),
  ) {}

  /** ID で1件取得。 */
  async get(id: string): Promise<Structure | undefined> {
    return this.store.get<Structure>(keyOf(id))
  }

  /** 空の構造を作成して保存し、作成した構造を返す。 */
  async create(workId: string, kind: StructureKind, title?: string): Promise<Structure> {
    const s = emptyStructure(this.genId(), workId, kind, this.now(), title)
    await this.store.set(keyOf(s.id), s)
    return s
  }

  /** 構造を保存する（updatedAt を現在時刻に更新して上書き）。 */
  async save(structure: Structure): Promise<Structure> {
    const next: Structure = { ...structure, updatedAt: this.now() }
    await this.store.set(keyOf(next.id), next)
    return next
  }

  /** 指定作品の構造を updatedAt の新しい順で返す。 */
  async listByWork(workId: string): Promise<Structure[]> {
    const all = await this.list()
    return all.filter((s) => s.workId === workId).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 構造を削除する。 */
  async remove(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /** 指定作品の構造をまとめて削除する（作品削除時などに使う）。 */
  async removeByWork(workId: string): Promise<void> {
    const all = await this.list()
    await Promise.all(all.filter((s) => s.workId === workId).map((s) => this.remove(s.id)))
  }

  /** 全構造（バックアップ用）。 */
  async list(): Promise<Structure[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map((k) => this.store.get<Structure>(k)))
    return rows.filter((r): r is Structure => r != null)
  }

  /** 全置換する（クラウド復元用・既存を消してから書き込む）。 */
  async replaceAll(structures: Structure[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(structures.map((s) => this.store.set(keyOf(s.id), s)))
  }
}
