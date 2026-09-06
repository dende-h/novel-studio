/// <reference types="@cloudflare/workers-types" />
/**
 * 認可サーバーの SQL を**本物の SQLite に当てる**テスト用ハーネス（Node 22 の `node:sqlite`）。
 * 掲示板の `board/real-d1.ts` と同じ作法で、こちらは migration 0010 だけを流す。
 *
 * フェイクの D1（SQL を解釈せず固定行を返すもの）では、構文エラー・列名の取り違え・
 * 型の不一致が**永久に検出できない**。認可まわりは「通ってはいけないものが通る」種類の
 * 事故が致命的なので、SQL は本物に当てる。
 *
 * マイグレーションを足したら `OAUTH_MIGRATIONS` に**必ず足す**（ここが本番の順序の写し）。
 */

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

type SqlValue = string | number | bigint | null | Uint8Array

interface RawStatement {
  get(...args: SqlValue[]): unknown
  all(...args: SqlValue[]): unknown[]
  run(...args: SqlValue[]): { changes: number | bigint }
}

interface RawDatabase {
  exec(sql: string): void
  prepare(sql: string): RawStatement
  close(): void
}

const OAUTH_MIGRATIONS = [new URL('../../../migrations/0010_oauth.sql', import.meta.url)]

export interface RealOAuthD1 {
  db: D1Database
  rows<T>(sql: string, ...args: SqlValue[]): T[]
  row<T>(sql: string, ...args: SqlValue[]): T | null
  close(): void
}

export function makeOAuthD1(): RealOAuthD1 {
  const sqlite = new DatabaseSync(':memory:') as unknown as RawDatabase
  for (const file of OAUTH_MIGRATIONS) sqlite.exec(readFileSync(file, 'utf8'))

  const isRead = (sql: string): boolean => /^\s*(SELECT|WITH)/i.test(sql)

  function makeStmt(sql: string) {
    let args: SqlValue[] = []
    const stmt = {
      __sql: sql,
      bind(...a: unknown[]) {
        // 型変換はしない。D1 が受け付けない値（undefined・boolean）は node:sqlite に
        // そのまま投げさせて、テストで落とす。
        args = a as SqlValue[]
        return stmt
      },
      async first<T>(): Promise<T | null> {
        return (sqlite.prepare(sql).get(...args) ?? null) as T | null
      },
      async all<T>() {
        return { success: true as const, results: sqlite.prepare(sql).all(...args) as T[] }
      },
      async run() {
        const r = sqlite.prepare(sql).run(...args)
        return { success: true as const, results: [], meta: { changes: Number(r.changes) } }
      },
      async __exec() {
        return isRead(sql) ? await stmt.all() : await stmt.run()
      },
    }
    return stmt
  }

  type Stmt = ReturnType<typeof makeStmt>

  const db = {
    prepare: (sql: string) => makeStmt(sql),
    async batch(stmts: Stmt[]) {
      const out: unknown[] = []
      for (const s of stmts) out.push(await s.__exec())
      return out
    },
  } as unknown as D1Database

  return {
    db,
    rows: <T>(sql: string, ...args: SqlValue[]) => sqlite.prepare(sql).all(...args) as T[],
    row: <T>(sql: string, ...args: SqlValue[]) =>
      (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    close: () => sqlite.close(),
  }
}
