import type { KeyValueStore } from '../storage/types'

/**
 * 同期で置き換わった／消えた版の退避（`synclost:<syncId>`）の永続化。
 *
 * 「黙って消えない」原則の最終逃げ場。競合の敗者・他端末の削除で消える直前の内容を
 * ここへ 1 世代だけ残す。作品（Work）は履歴（`snap:<workId>`・最大 20 版）が正規の
 * 退避先なので**内容は二重に持たず**、「いつ・どれが・なぜ退避されたか」の記録だけを置く
 * （UI がこの一覧を見せて履歴へ案内する）。構造・プロット・ネタ帳・プロフィールには履歴が
 * 無いので JSON 本体を持つ。
 *
 * 件数は MAX_ENTRIES で頭打ちにし、超えたら古いものから押し出す（無制限に溜めない）。
 * 同じ syncId は上書き＝1 アイテム 1 世代なので、常用でも件数は自然に頭打ちになる。
 */

const PREFIX = 'synclost:'
const keyOf = (syncId: string) => `${PREFIX}${syncId}`

/** 保持する退避の最大件数（超過分は古い順に押し出す）。 */
export const MAX_ENTRIES = 20

export type SyncLostKind = 'work' | 'structure' | 'idea' | 'plot' | 'staging' | 'profile'

/** 退避された理由。競合の敗者か、他端末の削除の伝播か。 */
export type SyncLostReason = 'conflict' | 'remoteDelete'

export interface SyncLostEntry {
  /** 同期 id（`structure:<id>` など。Work は素の id）。 */
  syncId: string
  at: number
  kind: SyncLostKind
  reason: SyncLostReason
  /** 一覧で人が判別するための名前（作品名・見出しなど。取れないときは省略）。 */
  title?: string
  /** 退避した内容（Work は履歴が持つので省略＝一覧は履歴へ案内する）。 */
  json?: string
}

/** 同期 id の接頭辞から種別を割り出す（旧形式の補完用）。 */
const kindOf = (syncId: string): SyncLostKind =>
  syncId.startsWith('structure:')
    ? 'structure'
    : syncId.startsWith('idea:')
      ? 'idea'
      : syncId.startsWith('plot:')
        ? 'plot'
        : syncId.startsWith('staging:')
          ? 'staging'
          : syncId.startsWith('profile:')
            ? 'profile'
            : 'work'

export class SyncLostRepository {
  constructor(
    private store: KeyValueStore,
    private max: number = MAX_ENTRIES,
  ) {}

  /** 新しい順の退避一覧。 */
  async list(): Promise<SyncLostEntry[]> {
    const keys = await this.store.keys(PREFIX)
    const records = await Promise.all(
      keys.map(async (k): Promise<SyncLostEntry | undefined> => {
        const raw = await this.store.get<Partial<SyncLostEntry>>(k)
        if (!raw || typeof raw.at !== 'number') return undefined
        // 旧形式（`{at, json}` だけ）も一覧に出せるよう、足りない項目をキーから補う。
        const syncId = raw.syncId ?? k.slice(PREFIX.length)
        return {
          syncId,
          at: raw.at,
          kind: raw.kind ?? kindOf(syncId),
          reason: raw.reason ?? 'conflict',
          ...(raw.title !== undefined ? { title: raw.title } : {}),
          ...(raw.json !== undefined ? { json: raw.json } : {}),
        }
      }),
    )
    return records.filter((r): r is SyncLostEntry => r !== undefined).sort((a, b) => b.at - a.at)
  }

  /** 1 件退避する（同じ syncId は上書き）。保持上限を超えたら古いものから押し出す。 */
  async save(entry: SyncLostEntry): Promise<void> {
    await this.store.set(keyOf(entry.syncId), entry)
    const all = await this.list()
    const stale = all.slice(Math.max(0, this.max))
    await Promise.all(stale.map((e) => this.store.delete(keyOf(e.syncId))))
  }

  async remove(syncId: string): Promise<void> {
    await this.store.delete(keyOf(syncId))
  }

  /** 全件削除（ユーザーが「すべて削除」を選んだとき）。 */
  async clear(): Promise<void> {
    const keys = await this.store.keys(PREFIX)
    await Promise.all(keys.map((k) => this.store.delete(k)))
  }
}
