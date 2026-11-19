// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  audioHash,
  NARRATION_AUDIO_MAX_BYTES,
  NARRATION_STORAGE_LIMIT,
} from '../../src/core/narration/backup'
import { cleanNarrationStorage } from '../../workers/narration/storage-cleanup'
import { encryptPart, importKey } from './_lib/crypto'
import { indexLegacyNarration } from './_lib/narration-storage'
import { makeRealD1 } from './board/real-d1'

const access = vi.hoisted(() => ({ userId: 'alice', isMember: true, canRestore: true }))
vi.mock('./_lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib/auth')>()),
  verifyBackupAccess: async () => access,
  verifyMember: async () => access,
}))

import {
  onRequestGet as getBackup,
  onRequestDelete as removeBackup,
  onRequestPost as saveBackup,
} from './backup'
import { onRequest } from './narration-assets'
import { onRequestPut as syncWork } from './sync/work'

afterEach(() => {
  Object.assign(access, { userId: 'alice', isMember: true, canRestore: true })
})
function setup() {
  const sql = makeRealD1()
  for (const file of ['0002_sync_works.sql', '0003_trash_sync.sql', '0015_narration_storage.sql']) {
    sql.exec(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8'))
  }
  const batch = sql.db.batch.bind(sql.db)
  sql.db.batch = async (statements) => {
    sql.exec('BEGIN')
    try {
      const result = await batch(statements)
      sql.exec('COMMIT')
      return result
    } catch (error) {
      sql.exec('ROLLBACK')
      throw error
    }
  }
  const objects = new Map<string, Uint8Array>()
  const metadata = new Map<string, Record<string, string>>()
  const put = vi.fn(async (key: string, data: Uint8Array | ArrayBuffer, opts?: R2PutOptions) => {
    objects.set(key, new Uint8Array(data))
    if (opts?.customMetadata) metadata.set(key, opts.customMetadata)
  })
  const object = (key: string) => ({
    key,
    size: objects.get(key)?.length,
    etag: key,
    customMetadata: metadata.get(key),
  })
  const env = {
    DB: sql.db,
    MEDIA: {
      put,
      get: async (key: string) => {
        const bytes = objects.get(key)
        return bytes ? { ...object(key), arrayBuffer: async () => bytes.buffer } : null
      },
      head: async (key: string) => (objects.has(key) ? object(key) : null),
      list: async ({ prefix }: R2ListOptions) => ({
        objects: [...objects.keys()].filter((key) => key.startsWith(prefix ?? '')).map(object),
        truncated: false,
      }),
      delete: async (keys: string | string[]) => {
        for (const key of [keys].flat()) {
          objects.delete(key)
          metadata.delete(key)
        }
      },
    },
    ENCRYPTION_KEY: btoa('x'.repeat(32)),
  }
  const request = async (method: string, hash?: string, bytes?: Uint8Array) =>
    onRequest({
      request: new Request(
        'https://leaf.test/api/narration-assets' + (hash ? '?hash=' + hash : ''),
        { method, ...(bytes ? { body: bytes as Uint8Array<ArrayBuffer> } : {}) },
      ),
      env,
    } as unknown as Parameters<typeof onRequest>[0])
  const call = (
    handler: PagesFunction<never>,
    path: string,
    method: string,
    body?: string,
    base = '',
  ) =>
    handler({
      request: new Request('https://leaf.test/api/' + path, {
        method,
        body,
        headers: { 'x-base-hash': base, 'x-updated-at': String(Date.now()) },
      }),
      env,
      waitUntil: () => {},
    } as never) as Promise<Response>
  return { sql, objects, put, request, call, env }
}
describe('耐久音声保管API', () => {
  it('暗号化して一度だけ保存し、本人だけが復号できる。生成枠を操作しない', async () => {
    const { sql, objects, put, request } = setup()
    try {
      const bytes = new TextEncoder().encode('mp3 audio')
      const hash = await audioHash(bytes)
      expect((await request('PUT', hash, bytes)).status).toBe(200)
      expect((await request('PUT', hash, bytes)).status).toBe(200)
      expect(put).toHaveBeenCalledTimes(1)
      expect(new TextDecoder().decode([...objects.values()][0])).not.toContain('mp3 audio')
      expect(await (await request('GET', hash)).text()).toBe('mp3 audio')
      expect((await request('HEAD', hash)).status).toBe(200)
      access.userId = 'bob'
      expect((await request('GET', hash)).status).toBe(404)
      expect((await request('HEAD', hash)).status).toBe(404)
    } finally {
      sql.close()
    }
  })
  it('容量はDBで原子的に制限し、同じhashの再送を二重計上しない', async () => {
    const { sql, request } = setup()
    try {
      for (let i = 0; i < NARRATION_STORAGE_LIMIT / NARRATION_AUDIO_MAX_BYTES; i++)
        sql.insert('narration_assets', {
          user_id: 'alice',
          hash: String(i),
          size: NARRATION_AUDIO_MAX_BYTES,
          ready: 1,
          created_at: 1,
          storage_version: 'fixture-' + i,
        })
      const bytes = new TextEncoder().encode('over limit')
      expect((await request('PUT', await audioHash(bytes), bytes)).status).toBe(409)
      expect(await (await request('GET')).json()).toMatchObject({ used: 0 })
      await sql.db
        .prepare(
          'INSERT OR IGNORE INTO narration_assets(user_id,hash,size,created_at) VALUES(?,?,?,?)',
        )
        .bind('alice', '0', NARRATION_AUDIO_MAX_BYTES, 1)
        .run()
      expect(await (await request('GET')).json()).toMatchObject({ used: 0 })
    } finally {
      sql.close()
    }
  })
  it('アップロード失敗は未完了扱いで、再送で同じ予約を完了できる', async () => {
    const { sql, put, request } = setup()
    try {
      const bytes = new TextEncoder().encode('retry')
      const hash = await audioHash(bytes)
      put.mockRejectedValueOnce(new Error('network'))
      await expect(request('PUT', hash, bytes)).rejects.toThrow()
      expect((await request('HEAD', hash)).status).toBe(404)
      expect((await request('PUT', hash, bytes)).status).toBe(200)
      expect(await (await request('GET')).json()).toMatchObject({ used: 0 })
    } finally {
      sql.close()
    }
  })
  it('hash改ざんと上限超過を拒否し、解約猶予では復元だけ許可する', async () => {
    const { sql, request } = setup()
    try {
      const bytes = new TextEncoder().encode('audio')
      expect((await request('PUT', 'a'.repeat(64), bytes)).status).toBe(400)
      const hash = await audioHash(bytes)
      await request('PUT', hash, bytes)
      access.isMember = false
      expect((await request('GET', hash)).status).toBe(200)
      expect((await request('PUT', hash, bytes)).status).toBe(402)
      access.canRestore = false
      expect((await request('GET', hash)).status).toBe(402)
    } finally {
      sql.close()
    }
  })
})

it('現在の朗読から外した直後に容量が空き、旧バックアップを復元できる', async () => {
  const { sql, request, call, env } = setup()
  try {
    const mp3 = new TextEncoder().encode('audio kept by one archive')
    const hash = await audioHash(mp3)
    expect((await request('PUT', hash, mp3)).status).toBe(200)
    const entry = { audio: { take: hash } }
    const current = await call(
      syncWork as PagesFunction<never>,
      'sync/work?id=narration:w',
      'PUT',
      JSON.stringify(entry),
    )
    expect(current.status).toBe(200)
    expect(await (await request('GET')).json()).toMatchObject({ used: mp3.length })
    const backup = await call(
      saveBackup as PagesFunction<never>,
      'backup',
      'POST',
      JSON.stringify({ narrations: [entry] }),
    )
    expect(backup.status).toBe(200)
    const { id } = (await backup.json()) as { id: string }
    const { docHash } = (await current.json()) as { docHash: string }
    expect(
      (
        await call(
          syncWork as PagesFunction<never>,
          'sync/work?id=narration:w',
          'PUT',
          '{"audio":{}}',
          docHash,
        )
      ).status,
    ).toBe(200)
    expect(await (await request('GET')).json()).toMatchObject({ used: 0 })
    await cleanNarrationStorage(
      env as unknown as Parameters<typeof cleanNarrationStorage>[0],
      Date.now() + 2 * 86400_000,
    )
    const old = await call(getBackup as PagesFunction<never>, 'backup?id=' + id, 'GET')
    expect(await old.json()).toEqual({ narrations: [entry] })
    expect(await (await request('GET', hash)).text()).toBe('audio kept by one archive')
    expect(
      (await call(removeBackup as PagesFunction<never>, 'backup?id=' + id, 'DELETE')).status,
    ).toBe(200)
    await cleanNarrationStorage(
      env as unknown as Parameters<typeof cleanNarrationStorage>[0],
      Date.now() + 4 * 86400_000,
    )
    expect((await request('GET', hash)).status).toBe(404)
  } finally {
    sql.close()
  }
})

it('現在の音声だけを共有5GB枠に数え、上限超過の同期は元の版を保持する', async () => {
  const { sql, request, call } = setup()
  try {
    const large = Array.from(
      { length: NARRATION_STORAGE_LIMIT / NARRATION_AUDIO_MAX_BYTES },
      (_, index) => {
        const hash = index.toString(16).padStart(64, '0')
        sql.insert('narration_assets', {
          user_id: 'alice',
          hash,
          size: NARRATION_AUDIO_MAX_BYTES,
          ready: 1,
          created_at: 1,
        })
        return hash
      },
    )
    const payload = JSON.stringify({
      audio: Object.fromEntries(large.map((hash, index) => [index, hash])),
    })
    const a = await call(
      syncWork as PagesFunction<never>,
      'sync/work?id=narration:a',
      'PUT',
      payload,
    )
    const b = await call(
      syncWork as PagesFunction<never>,
      'sync/work?id=narration:b',
      'PUT',
      '{"audio":{}}',
    )
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    const sameAudio = JSON.stringify({ audio: { take: large[0] } })
    const { docHash } = (await b.json()) as { docHash: string }
    const dedup = await call(
      syncWork as PagesFunction<never>,
      'sync/work?id=narration:b',
      'PUT',
      sameAudio,
      docHash,
    )
    expect(dedup.status).toBe(200)
    expect(await (await request('GET')).json()).toMatchObject({ used: NARRATION_STORAGE_LIMIT })

    const bytes = new TextEncoder().encode('additional audio')
    const hash = await audioHash(bytes)
    expect((await request('PUT', hash, bytes)).status).toBe(200)
    const sameHash = ((await dedup.json()) as { docHash: string }).docHash
    expect(
      (
        await call(
          syncWork as PagesFunction<never>,
          'sync/work?id=narration:b',
          'PUT',
          JSON.stringify({ audio: { take: hash } }),
          sameHash,
        )
      ).status,
    ).toBe(507)
    expect(sql.row("SELECT doc_hash FROM works WHERE work_id='narration:b'")).toMatchObject({
      doc_hash: sameHash,
    })
    expect(await (await request('GET')).json()).toMatchObject({ used: NARRATION_STORAGE_LIMIT })
  } finally {
    sql.close()
  }
})

it('索引のない旧世代は移行前も移行後も音声を復元できる', async () => {
  const { sql, request, env, objects, put } = setup()
  const typedEnv = env as unknown as Parameters<typeof indexLegacyNarration>[0]
  try {
    const mp3 = new TextEncoder().encode('old-format archived audio')
    const hash = await audioHash(mp3)
    expect((await request('PUT', hash, mp3)).status).toBe(200)
    const key = 'alice/narration-library/' + hash
    const versioned = [...objects.keys()].find((path) => path.startsWith(key + '/'))!
    objects.set(key, objects.get(versioned)!)
    objects.delete(versioned)
    sql.exec('UPDATE narration_assets SET storage_version=NULL,touched_at=0')
    const plaintext = JSON.stringify({ narrations: [{ audio: { take: hash } }] })
    const encrypted = await encryptPart(
      plaintext,
      await importKey(env.ENCRYPTION_KEY),
      'alice:backup:1-old',
    )
    await put('alice/backups/1-old', encrypted)
    await cleanNarrationStorage(typedEnv, Date.now() + 2 * 86400_000)
    expect((await request('GET', hash)).status).toBe(200)
    await indexLegacyNarration(typedEnv, 'alice')
    expect(sql.row('SELECT user_id FROM narration_storage_indexed')).toMatchObject({
      user_id: 'alice',
    })
    await cleanNarrationStorage(typedEnv, Date.now() + 3 * 86400_000)
    expect(await (await request('GET', hash)).text()).toBe('old-format archived audio')
    expect(await (await request('GET')).json()).toMatchObject({ used: 0 })
  } finally {
    sql.close()
  }
})
