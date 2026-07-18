import { type IdeaNote, normalizeIdeaText, sortIdeasByNewest } from '../idea'
import type { KeyValueStore } from './types'

/**
 * ネタ帳（アイデアの受け皿）の永続化。KeyValueStore に `idea:<id>` で 1 メモ 1 レコードを持つ。
 * 純ローカル（同期・課金と無関係）。replaceAll はクラウド復元へ組み込む次段に備えて用意する。
 */
const PREFIX = 'idea:'
const keyOf = (id: string) => `${PREFIX}${id}`

export class IdeaRepository {
  constructor(
    private store: KeyValueStore,
    private genId: () => string = () => crypto.randomUUID(),
    private now: () => number = () => Date.now(),
  ) {}

  /** テキストを 1 メモとして追加する。空（空白のみ）なら何もせず null を返す。 */
  async add(text: string): Promise<IdeaNote | null> {
    const t = normalizeIdeaText(text)
    if (t === null) return null
    const at = this.now()
    const note: IdeaNote = { id: this.genId(), text: t, createdAt: at, updatedAt: at }
    await this.store.set(keyOf(note.id), note)
    return note
  }

  /** 既存メモの本文を書き換える。空なら更新しない。存在しなければ null。 */
  async update(id: string, text: string): Promise<IdeaNote | null> {
    const t = normalizeIdeaText(text)
    if (t === null) return null
    const prev = await this.store.get<IdeaNote>(keyOf(id))
    if (!prev) return null
    const next: IdeaNote = { ...prev, text: t, updatedAt: this.now() }
    await this.store.set(keyOf(id), next)
    return next
  }

  /** メモを削除する。 */
  async remove(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /** 全メモ（新しい順）。 */
  async list(): Promise<IdeaNote[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map((k) => this.store.get<IdeaNote>(k)))
    return sortIdeasByNewest(rows.filter((r): r is IdeaNote => r != null))
  }

  /** ネタ帳を全置換する（クラウド復元用・既存を消してから書き込む）。 */
  async replaceAll(notes: IdeaNote[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(notes.map((n) => this.store.set(keyOf(n.id), n)))
  }
}
