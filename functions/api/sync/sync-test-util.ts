/// <reference types="@cloudflare/workers-types" />
/**
 * 同期 API テスト用の in-memory フェイク（works / rate_limits / subscriptions と R2）。
 * `_lib/subs-test-util.ts` の流儀＝SQL 文字列の部分一致でクエリを分岐する簡易実装。
 * 会員判定は members セット（membership.ts の SELECT status に active を返すだけ）。
 */

/** D1 `works` の 1 行（work.ts の WorkRow と同形）。 */
export interface FakeWorkRow {
  user_id: string
  work_id: string
  updated_at: number
  deleted: number
  doc_key: string
  doc_hash: string
  doc_size: number
  media_key: string | null
  media_hash: string
  media_size: number
  synced_at: number
  trashed_at: number
}

export interface FakeRateRow {
  user_id: string
  window_start: number
  count: number
}

const workKey = (userId: string, workId: string) => `${userId}:${workId}`

/** works / rate_limits / subscriptions を Map で持つ D1 フェイク。 */
export function makeSyncDb(opts: { members?: string[] } = {}) {
  const works = new Map<string, FakeWorkRow>()
  const rates = new Map<string, FakeRateRow>()
  const members = new Set(opts.members ?? [])

  const db = {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM subscriptions')) {
            // isActiveMember 用。members に居れば active の行があることにする。
            return (members.has(args[0] as string) ? { status: 'active' } : null) as T | null
          }
          if (sql.includes('FROM rate_limits')) {
            return (rates.get(args[0] as string) ?? null) as T | null
          }
          if (sql.includes('SUM(doc_size)')) {
            // クォータ: live 行の合計から当該 work を除外。
            const [userId, workId] = args as [string, string]
            let total = 0
            for (const r of works.values()) {
              if (r.user_id === userId && r.deleted === 0 && r.work_id !== workId) {
                total += r.doc_size
              }
            }
            return { total } as T
          }
          if (sql.includes('FROM works WHERE user_id = ? AND work_id = ?')) {
            const [userId, workId] = args as [string, string]
            return (works.get(workKey(userId, workId)) ?? null) as T | null
          }
          throw new Error(`makeSyncDb: first 未対応 SQL: ${sql}`)
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes('ORDER BY work_id')) {
            // manifest: ユーザー分全行を work_id 昇順で。
            const userId = args[0] as string
            const results = [...works.values()]
              .filter((r) => r.user_id === userId)
              .sort((a, b) => (a.work_id < b.work_id ? -1 : 1))
            return { results: results as unknown as T[] }
          }
          throw new Error(`makeSyncDb: all 未対応 SQL: ${sql}`)
        },
        async run() {
          // 実 D1 と同様、書き込んだ行数を meta.changes で返す（PUT の条件付き CAS が参照する）。
          let changes = 0
          if (sql.startsWith('INSERT INTO rate_limits')) {
            const [user_id, window_start, count] = args as [string, number, number]
            rates.set(user_id, { user_id, window_start, count })
            changes = 1
          } else if (sql.startsWith('INSERT INTO works')) {
            // 条件付き新規（ON CONFLICT DO NOTHING）: 既存行があれば書かず changes 0。
            const [
              user_id,
              work_id,
              updated_at,
              doc_key,
              doc_hash,
              doc_size,
              synced_at,
              trashed_at,
            ] = args as [string, string, number, string, string, number, number, number]
            if (!works.has(workKey(user_id, work_id))) {
              works.set(workKey(user_id, work_id), {
                user_id,
                work_id,
                updated_at,
                deleted: 0,
                doc_key,
                doc_hash,
                doc_size,
                media_key: null,
                media_hash: '',
                media_size: 0,
                synced_at,
                trashed_at,
              })
              changes = 1
            }
          } else if (sql.startsWith('UPDATE works SET updated_at')) {
            // 条件付き更新（CAS）: WHERE の deleted/doc_hash・updated_at 条件を再現する。
            const [
              updated_at,
              doc_key,
              doc_hash,
              doc_size,
              synced_at,
              trashed_at,
              user_id,
              work_id,
              cond,
            ] = args as [number, string, string, number, number, number, string, string, unknown]
            const r = works.get(workKey(user_id, work_id))
            const matches = r
              ? sql.includes('deleted = 1 AND updated_at < ?')
                ? r.deleted === 1 && r.updated_at < (cond as number)
                : r.deleted === 0 && r.doc_hash === (cond as string)
              : false
            if (r && matches) {
              works.set(workKey(user_id, work_id), {
                ...r,
                updated_at,
                deleted: 0,
                doc_key,
                doc_hash,
                doc_size,
                synced_at,
                trashed_at,
              })
              changes = 1
            }
          } else if (sql.startsWith('UPDATE works SET trashed_at')) {
            const [trashed_at, updated_at, synced_at, user_id, work_id] = args as [
              number,
              number,
              number,
              string,
              string,
            ]
            const r = works.get(workKey(user_id, work_id))
            if (r) {
              works.set(workKey(user_id, work_id), { ...r, trashed_at, updated_at, synced_at })
              changes = 1
            }
          } else if (sql.startsWith('UPDATE works SET deleted = 1')) {
            const [updated_at, synced_at, user_id, work_id] = args as [
              number,
              number,
              string,
              string,
            ]
            const r = works.get(workKey(user_id, work_id))
            if (r) {
              works.set(workKey(user_id, work_id), { ...r, deleted: 1, updated_at, synced_at })
              changes = 1
            }
          } else {
            throw new Error(`makeSyncDb: run 未対応 SQL: ${sql}`)
          }
          return { success: true, meta: { changes } }
        },
      }
      return stmt
    },
  } as unknown as D1Database

  return { db, works, rates, members }
}

/** Map ベースの R2 フェイク（get/put/delete/head/list の最小実装）。 */
export function makeFakeR2() {
  const objects = new Map<string, Uint8Array>()

  const bucket = {
    async put(key: string, value: ArrayBuffer | Uint8Array) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
      objects.set(key, new Uint8Array(bytes))
      return null
    },
    async get(key: string) {
      const bytes = objects.get(key)
      if (!bytes) return null
      return {
        key,
        size: bytes.byteLength,
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        },
      }
    },
    async head(key: string) {
      const bytes = objects.get(key)
      return bytes ? { key, size: bytes.byteLength } : null
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k)
    },
    async list(opts: { prefix?: string } = {}) {
      const prefix = opts.prefix ?? ''
      const list = [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ key: k, size: v.byteLength }))
      return { objects: list, truncated: false }
    },
  } as unknown as R2Bucket

  return { bucket, objects }
}

/** テスト用の base64 32byte 暗号鍵（実物の webcrypto で使える）。 */
export function makeTestKeyB64(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...raw))
}

/** works 行のフェイクを既定値付きで作る（テストのシード用）。 */
export function fakeWorkRow(over: Partial<FakeWorkRow> = {}): FakeWorkRow {
  return {
    user_id: 'user_1',
    work_id: 'w1',
    updated_at: 100,
    deleted: 0,
    doc_key: 'user_1/works/w1/doc',
    doc_hash: 'hash1',
    doc_size: 10,
    media_key: null,
    media_hash: '',
    media_size: 0,
    synced_at: 100,
    trashed_at: 0,
    ...over,
  }
}
