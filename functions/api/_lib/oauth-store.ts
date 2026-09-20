/// <reference types="@cloudflare/workers-types" />
/**
 * 自前の認可サーバーの SQL（migration 0010）。判断は持たず、読み書きだけを担う
 *（判断は `oauth-server.ts`、HTTP は `functions/api/oauth/[[path]].ts`）。掲示板と同じ分け方。
 *
 * 秘密は**平文で受け取らない**。呼び出し側がハッシュにしてから渡す（この層に平文を通さない）。
 */

import type { OAuthClient } from './oauth-server'

interface ClientRow {
  client_id: string
  client_name: string | null
  client_uri: string | null
  redirect_uris: string
}

const toClient = (row: ClientRow): OAuthClient => ({
  clientId: row.client_id,
  clientName: row.client_name,
  clientUri: row.client_uri,
  // 壊れた JSON でも一覧ごと落とさない（照合で外れるだけ＝安全側に倒れる）。
  redirectUris: safeParseUris(row.redirect_uris),
})

function safeParseUris(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** クライアントを 1 件読む。未登録なら null。 */
export async function readClient(db: D1Database, clientId: string): Promise<OAuthClient | null> {
  const row = await db
    .prepare(
      'SELECT client_id, client_name, client_uri, redirect_uris FROM oauth_clients WHERE client_id = ?',
    )
    .bind(clientId)
    .first<ClientRow>()
  return row ? toClient(row) : null
}

/** クライアントを登録する。 */
export async function insertClient(
  db: D1Database,
  client: OAuthClient,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_clients (client_id, client_name, client_uri, redirect_uris, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      client.clientId,
      client.clientName,
      client.clientUri,
      JSON.stringify(client.redirectUris),
      now,
    )
    .run()
}

export interface StoredRequest {
  rid: string
  clientId: string
  redirectUri: string
  state: string | null
  scope: string
  resource: string | null
  codeChallenge: string
}

/** 同意画面へ渡す一時レコードを置く。 */
export async function insertRequest(
  db: D1Database,
  req: StoredRequest,
  now: number,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_requests
         (rid, client_id, redirect_uri, state, scope, resource, code_challenge, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      req.rid,
      req.clientId,
      req.redirectUri,
      req.state,
      req.scope,
      req.resource,
      req.codeChallenge,
      now,
      expiresAt,
    )
    .run()
}

/** 一時レコードを読む（期限切れは無いものとして扱う）。 */
export async function readRequest(
  db: D1Database,
  rid: string,
  now: number,
): Promise<StoredRequest | null> {
  const row = await db
    .prepare(
      `SELECT rid, client_id, redirect_uri, state, scope, resource, code_challenge
         FROM oauth_requests WHERE rid = ? AND expires_at > ?`,
    )
    .bind(rid, now)
    .first<{
      rid: string
      client_id: string
      redirect_uri: string
      state: string | null
      scope: string
      resource: string | null
      code_challenge: string
    }>()
  if (!row) return null
  return {
    rid: row.rid,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    state: row.state,
    scope: row.scope,
    resource: row.resource,
    codeChallenge: row.code_challenge,
  }
}

/** 一時レコードを消す（承認・拒否のどちらでも 1 回で使い切る）。 */
export async function deleteRequest(db: D1Database, rid: string): Promise<void> {
  await db.prepare('DELETE FROM oauth_requests WHERE rid = ?').bind(rid).run()
}

export interface StoredCode {
  userId: string
  clientId: string
  redirectUri: string
  scope: string
  resource: string | null
  codeChallenge: string
}

/** 認可コードを置く（平文は呼び出し側が一度だけ返す）。 */
export async function insertCode(
  db: D1Database,
  codeHash: string,
  code: StoredCode,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_codes
         (code_hash, user_id, client_id, redirect_uri, scope, resource, code_challenge, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      codeHash,
      code.userId,
      code.clientId,
      code.redirectUri,
      code.scope,
      code.resource,
      code.codeChallenge,
      expiresAt,
    )
    .run()
}

/**
 * 認可コードを**取り出して消す**（1 回限り）。期限切れは null。
 * 読んだ直後に消すので、同じコードでの二重交換は 2 本目が null になる。
 */
export async function takeCode(
  db: D1Database,
  codeHash: string,
  now: number,
): Promise<StoredCode | null> {
  const row = await db
    .prepare(
      `SELECT user_id, client_id, redirect_uri, scope, resource, code_challenge, expires_at
         FROM oauth_codes WHERE code_hash = ?`,
    )
    .bind(codeHash)
    .first<{
      user_id: string
      client_id: string
      redirect_uri: string
      scope: string
      resource: string | null
      code_challenge: string
      expires_at: number
    }>()
  await db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(codeHash).run()
  if (!row || row.expires_at <= now) return null
  return {
    userId: row.user_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    resource: row.resource,
    codeChallenge: row.code_challenge,
  }
}

export interface StoredToken {
  userId: string
  clientId: string
  scope: string
  resource: string | null
}

/** アクセス／リフレッシュトークンを置く。 */
export async function insertToken(
  db: D1Database,
  tokenHash: string,
  kind: 'access' | 'refresh',
  token: StoredToken,
  now: number,
  expiresAt: number,
  parentHash: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_tokens
         (token_hash, kind, user_id, client_id, scope, resource, created_at, expires_at, parent_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenHash,
      kind,
      token.userId,
      token.clientId,
      token.scope,
      token.resource,
      now,
      expiresAt,
      parentHash,
    )
    .run()
}

/** 生きているトークンを引く。期限切れ・種別違いは null。 */
export async function readToken(
  db: D1Database,
  tokenHash: string,
  kind: 'access' | 'refresh',
  now: number,
): Promise<StoredToken | null> {
  const row = await db
    .prepare(
      `SELECT user_id, client_id, scope, resource FROM oauth_tokens
         WHERE token_hash = ? AND kind = ? AND expires_at > ?`,
    )
    .bind(tokenHash, kind, now)
    .first<{ user_id: string; client_id: string; scope: string; resource: string | null }>()
  if (!row) return null
  return {
    userId: row.user_id,
    clientId: row.client_id,
    scope: row.scope,
    resource: row.resource,
  }
}

/** トークンを 1 本消す（回転で使い終わった側・revoke）。 */
export async function deleteToken(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').bind(tokenHash).run()
}

/**
 * その利用者へ出した自前トークンを**全部失効させる**。
 * 画面の「接続を解除」と、アカウント削除（purge）から呼ぶ——
 * 解除できると画面に書く以上、実際に切れなければ嘘になる。
 */
export async function deleteUserTokens(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').bind(userId).run()
}

/**
 * 期限切れの掃除。cron を増やさず、**トークンを発行するついでに**まとめて消す。
 * 取りこぼしても害は無い（読み出しが期限で弾く）ので、失敗しても呼び出し側は止まらない。
 */
export async function sweepExpired(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM oauth_tokens WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM oauth_codes WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM oauth_requests WHERE expires_at <= ?').bind(now),
  ])
}
