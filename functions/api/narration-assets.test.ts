// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  audioHash,
  NARRATION_AUDIO_MAX_BYTES,
  NARRATION_STORAGE_LIMIT,
} from '../../src/core/narration/backup'
import { makeRealD1 } from './board/real-d1'

const access = vi.hoisted(() => ({ userId: 'alice', isMember: true, canRestore: true }))
vi.mock('./_lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib/auth')>()),
  verifyBackupAccess: async () => access,
}))

import { onRequest } from './narration-assets'

afterEach(() => {
  Object.assign(access, { userId: 'alice', isMember: true, canRestore: true })
})
function setup() {
  const sql = makeRealD1()
  const objects = new Map<string, Uint8Array>()
  const put = vi.fn(async (key: string, bytes: Uint8Array) => {
    objects.set(key, bytes)
  })
  const env = {
    DB: sql.db,
    MEDIA: {
      put,
      get: async (key: string) => {
        const bytes = objects.get(key)
        return bytes ? { arrayBuffer: async () => bytes.buffer } : null
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
  return { sql, objects, put, request }
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
        })
      const bytes = new TextEncoder().encode('over limit')
      expect((await request('PUT', await audioHash(bytes), bytes)).status).toBe(409)
      expect(await (await request('GET')).json()).toMatchObject({ used: NARRATION_STORAGE_LIMIT })
      await sql.db
        .prepare(
          'INSERT OR IGNORE INTO narration_assets(user_id,hash,size,created_at) VALUES(?,?,?,?)',
        )
        .bind('alice', '0', NARRATION_AUDIO_MAX_BYTES, 1)
        .run()
      expect(await (await request('GET')).json()).toMatchObject({ used: NARRATION_STORAGE_LIMIT })
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
      expect(await (await request('GET')).json()).toMatchObject({ used: bytes.length })
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
