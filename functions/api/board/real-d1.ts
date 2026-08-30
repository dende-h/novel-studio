/// <reference types="@cloudflare/workers-types" />
/**
 * 掲示板の SQL を**本物の SQLite に当てる**テスト用ハーネス（Node 22 の `node:sqlite`）。
 *
 * `board-test-util.ts` の D1 フェイクは SQL 文字列の部分一致で分岐して固定の行を返すだけで、
 * SQL を解釈しない。だから構文エラー・曖昧な列名・型の不一致は**永久に検出できない**。
 * 実際、`readThreadDetail` の `ambiguous column name: url_key`（board_post_links と
 * board_links の両方に url_key がある）はフェイクを素通りして STG で 500 になった。
 * このハーネスは `migrations/0008_board.sql` をそのまま流し込んだ実 SQLite に対して
 * store の SQL を発行する＝**SQL が本当に通るか**を機械が確かめる。
 *
 * D1 との差分で気をつけること:
 *   * `batch()` は実 D1 と同じく **SELECT でも `results` を返す**（`run()` の結果ではない）。
 *     `readThreadDetail` は 1 回の batch で 6 本読むので、ここを間違えると詳細が空になる。
 *   * `run()` は `meta.changes` を返す（store の `changesOf` が読む）。
 *   * `node:sqlite` は起動時に ExperimentalWarning を出す。動作には影響しない。
 *   * D1 と同じく bind に `undefined` / boolean は渡せない（`node:sqlite` が投げる）。
 *     黙って NULL に落とさない＝「消したのに消えない」類のバグをテストで露出させる。
 */

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type {
  LikeRow,
  LinkRow,
  PollRow,
  PostLinkRow,
  PostRow,
  ProfileRow,
  ReportRow,
  ThreadRow,
  VoteRow,
} from '../_lib/board-store'
import { fakeLink, fakePost, fakeProfile, fakeThread } from './board-test-util'

// ---------------------------------------------------------------------------
// node:sqlite の最小の型（@types/node を入れていないので自前で置く）
// ---------------------------------------------------------------------------

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

/** D1 の `run()` / `all()` が返す形（store が読むのは `results` と `meta.changes` だけ）。 */
export interface RealD1Result<T = unknown> {
  success: true
  results: T[]
  meta: { changes: number }
}

/** 掲示板のマイグレーション（このハーネスが唯一読み込む DDL）。 */
const BOARD_MIGRATION = new URL('../../../migrations/0008_board.sql', import.meta.url)

// ---------------------------------------------------------------------------
// シード用の既定値（board-test-util の fake* に無いテーブルの分だけ足す）
// ---------------------------------------------------------------------------

export function realPoll(over: Partial<PollRow> = {}): PollRow {
  return {
    thread_id: 't1',
    question: 'どっちがいい？',
    options: JSON.stringify(['A', 'B']),
    multiple: 0,
    closes_at: 9_000_000,
    created_at: 1000,
    ...over,
  }
}

export function realVote(over: Partial<VoteRow> = {}): VoteRow {
  return {
    thread_id: 't1',
    user_id: 'user_1',
    choices: JSON.stringify([0]),
    created_at: 1000,
    ...over,
  }
}

export function realLike(over: Partial<LikeRow> = {}): LikeRow {
  return { thread_id: 't1', user_id: 'user_1', created_at: 1000, ...over }
}

export function realReport(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 'r1',
    post_id: 'p1',
    user_id: 'user_1',
    reason: '荒らし',
    created_at: 1000,
    handled_at: 0,
    ...over,
  }
}

export function realPostLink(over: Partial<PostLinkRow> = {}): PostLinkRow {
  return { post_id: 'p1', url_key: 'k1', ord: 0, ...over }
}

// ---------------------------------------------------------------------------
// ハーネス本体
// ---------------------------------------------------------------------------

export interface RealD1 {
  /** store にそのまま渡せる D1 互換のハンドル。 */
  db: D1Database
  /** 検証用の素の SELECT（store を経由せずテーブルの中身を覗く）。 */
  rows<T>(sql: string, ...args: SqlValue[]): T[]
  /** 検証用の素の 1 行 SELECT。 */
  row<T>(sql: string, ...args: SqlValue[]): T | null
  /** 任意の DDL/DML をそのまま流す（追加の索引を張るなど）。 */
  exec(sql: string): void
  /** 行を 1 件入れて、入れた行をそのまま返す（シードの土台）。 */
  insert<T extends Record<string, SqlValue>>(table: string, row: T): T
  seed: {
    profile(over?: Partial<ProfileRow>): ProfileRow
    thread(over?: Partial<ThreadRow>): ThreadRow
    post(over?: Partial<PostRow>): PostRow
    like(over?: Partial<LikeRow>): LikeRow
    poll(over?: Partial<PollRow>): PollRow
    vote(over?: Partial<VoteRow>): VoteRow
    report(over?: Partial<ReportRow>): ReportRow
    link(over?: Partial<LinkRow>): LinkRow
    postLink(over?: Partial<PostLinkRow>): PostLinkRow
  }
  close(): void
}

/**
 * in-memory の SQLite に `migrations/0008_board.sql` を流し、D1 の形に被せて返す。
 * テストごとに作り直す（`beforeEach`）＝ 1 本のテストが次のテストに影響しない。
 */
export function makeRealD1(): RealD1 {
  const sqlite = new DatabaseSync(':memory:') as unknown as RawDatabase
  sqlite.exec(readFileSync(BOARD_MIGRATION, 'utf8'))

  // SELECT / WITH は結果を返す文。batch() の出し分けに使う（実 D1 と同じ振る舞い）。
  const isRead = (sql: string): boolean => /^\s*(SELECT|WITH)/i.test(sql)

  function makeStmt(sql: string) {
    let args: SqlValue[] = []
    const stmt = {
      __sql: sql,
      bind(...a: unknown[]) {
        // 型変換はしない。D1 が受け付けない値（undefined・boolean）は
        // node:sqlite にそのまま投げさせて、テストで落とす。
        args = a as SqlValue[]
        return stmt
      },
      async first<T>(): Promise<T | null> {
        return (sqlite.prepare(sql).get(...args) ?? null) as T | null
      },
      async all<T>(): Promise<RealD1Result<T>> {
        return {
          success: true,
          results: sqlite.prepare(sql).all(...args) as T[],
          meta: { changes: 0 },
        }
      },
      async run(): Promise<RealD1Result<never>> {
        const r = sqlite.prepare(sql).run(...args)
        return { success: true, results: [], meta: { changes: Number(r.changes) } }
      },
      /** batch() 用。SELECT なら all()、それ以外は run() の結果を返す。 */
      async __exec(): Promise<RealD1Result<unknown>> {
        return isRead(sql) ? await stmt.all() : await stmt.run()
      },
    }
    return stmt
  }

  type Stmt = ReturnType<typeof makeStmt>

  const db = {
    prepare: (sql: string) => makeStmt(sql),
    async batch(stmts: Stmt[]) {
      const out: RealD1Result<unknown>[] = []
      // D1 の batch は順に実行する。前の文の結果を次の文が読む（seq 採番 → 集計）ので
      // 並列にしてはいけない。
      for (const s of stmts) out.push(await s.__exec())
      return out
    },
  } as unknown as D1Database

  const insert = <T extends Record<string, SqlValue>>(table: string, row: T): T => {
    const cols = Object.keys(row)
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    sqlite.prepare(sql).run(...cols.map((c) => row[c] as SqlValue))
    return row
  }

  return {
    db,
    rows: <T>(sql: string, ...args: SqlValue[]) => sqlite.prepare(sql).all(...args) as T[],
    row: <T>(sql: string, ...args: SqlValue[]) =>
      (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    exec: (sql: string) => sqlite.exec(sql),
    insert,
    seed: {
      profile: (over = {}) => insert('board_profiles', fakeProfile(over)),
      thread: (over = {}) => insert('board_threads', fakeThread(over)),
      post: (over = {}) => insert('board_posts', fakePost(over)),
      like: (over = {}) => insert('board_likes', realLike(over)),
      poll: (over = {}) => insert('board_polls', realPoll(over)),
      vote: (over = {}) => insert('board_votes', realVote(over)),
      report: (over = {}) => insert('board_reports', realReport(over)),
      link: (over = {}) => insert('board_links', fakeLink(over)),
      postLink: (over = {}) => insert('board_post_links', realPostLink(over)),
    },
    close: () => sqlite.close(),
  }
}
