import { describe, expect, it } from 'vitest'
import type { Profile } from '../profile'
import type { PullResult, PushPayload } from './engine'
import type { LocalSyncMeta, ManifestEntry } from './manifest'
import { PROFILE_WORK_ID } from './manifest'
import { joinProfile, pushProfileChange, runProfileSync, splitProfile } from './profile-sync'

// 決定論ハッシュ（canonicalize 相当は使わず、構造差だけ見られればよい）。
const fakeHash = (v: unknown) => JSON.stringify(v)

function digestOf(p: Profile) {
  const { doc, media } = splitProfile(p)
  return { docHash: fakeHash(doc), mediaHash: media === null ? '' : fakeHash(media) }
}

function remoteEntryOf(
  p: Profile,
  updatedAt: number,
  opts: { deleted?: boolean } = {},
): ManifestEntry {
  const deleted = opts.deleted ?? false
  const d = digestOf(p)
  return {
    workId: PROFILE_WORK_ID,
    updatedAt,
    deleted,
    docHash: deleted ? '' : d.docHash,
    mediaHash: deleted ? '' : d.mediaHash,
    size: 1,
  }
}

interface Calls {
  pushed: Array<{ parts: PushPayload['parts']; doc: unknown; media: unknown; updatedAt: number }>
  pulled: number
  saved: Profile[]
}

function makeDeps(opts: {
  local: Profile
  remoteEntry?: ManifestEntry | null
  remoteData?: PullResult | null
  meta?: LocalSyncMeta | null
}) {
  const meta = opts.meta ?? null
  const calls: Calls = { pushed: [], pulled: 0, saved: [] }
  // サーバが既に持っているハッシュ（against）。ログインは remote マニフェスト、変更時はメタ由来。
  const liveRemote = opts.remoteEntry && !opts.remoteEntry.deleted ? opts.remoteEntry : null
  let serverDoc = liveRemote?.docHash ?? meta?.docHash ?? ''
  let serverMedia = liveRemote?.mediaHash ?? meta?.mediaHash ?? ''
  let lastSetMeta: LocalSyncMeta | null = null

  const deps = {
    async getRemoteEntry() {
      return opts.remoteEntry ?? null
    },
    async pullProfile() {
      calls.pulled++
      return opts.remoteData ?? null
    },
    async pushProfile(payload: PushPayload) {
      calls.pushed.push({
        parts: payload.parts,
        doc: payload.doc,
        media: payload.media,
        updatedAt: payload.updatedAt,
      })
      if (payload.parts.includes('doc')) serverDoc = fakeHash(payload.doc)
      if (payload.parts.includes('media')) {
        serverMedia = payload.media === null ? '' : fakeHash(payload.media)
      }
      return { docHash: serverDoc, mediaHash: serverMedia, size: 1 }
    },
    async loadLocalProfile() {
      return structuredClone(opts.local)
    },
    async saveLocalProfile(p: Profile) {
      calls.saved.push(structuredClone(p))
    },
    async getMeta() {
      return meta
    },
    async setMeta(m: LocalSyncMeta) {
      lastSetMeta = structuredClone(m)
    },
    async hashPart(v: unknown) {
      return fakeHash(v)
    },
    now() {
      return 9999
    },
  }

  return { deps, calls, getLastMeta: () => lastSetMeta }
}

describe('splitProfile / joinProfile', () => {
  it('penName は doc、avatar は media に分かれ、ロスレスに往復する', () => {
    const p: Profile = { penName: '織斗', avatar: 'data:image/jpeg;base64,AAAA', updatedAt: 5 }
    const { doc, media } = splitProfile(p)
    expect(doc).toEqual({ penName: '織斗' })
    expect(media).toEqual({ avatar: 'data:image/jpeg;base64,AAAA' })
    // updatedAt は part に含めない（PushPayload.updatedAt として別送）。
    expect(joinProfile(doc, media)).toEqual({
      penName: '織斗',
      avatar: 'data:image/jpeg;base64,AAAA',
    })
  })

  it('avatar が無ければ media は null', () => {
    expect(splitProfile({ penName: 'A' }).media).toBeNull()
    expect(joinProfile({ penName: 'A' }, null)).toEqual({ penName: 'A' })
  })
})

describe('runProfileSync（ログイン時の双方向）', () => {
  it('リモートのみ（新しい）→ pull してローカル保存（スナップショットしない）', async () => {
    const remote: Profile = { penName: 'リモート名' }
    const { deps, calls, getLastMeta } = makeDeps({
      local: {},
      remoteEntry: remoteEntryOf(remote, 200),
      remoteData: { doc: { penName: 'リモート名' }, media: null, updatedAt: 200 },
    })
    await runProfileSync(deps)

    expect(calls.pulled).toBe(1)
    expect(calls.pushed).toEqual([])
    expect(calls.saved).toEqual([{ penName: 'リモート名', updatedAt: 200 }])
    expect(getLastMeta()?.workId).toBe(PROFILE_WORK_ID)
  })

  it('ローカルのみ（リモート無し）→ doc を push する', async () => {
    const { deps, calls, getLastMeta } = makeDeps({
      local: { penName: 'ローカル名', updatedAt: 100 },
      remoteEntry: null,
    })
    await runProfileSync(deps)

    expect(calls.pulled).toBe(0)
    expect(calls.pushed).toEqual([
      { parts: ['doc'], doc: { penName: 'ローカル名' }, media: undefined, updatedAt: 100 },
    ])
    expect(getLastMeta()?.docHash).toBe(fakeHash({ penName: 'ローカル名' }))
  })

  it('アバター付きローカルのみ → doc と media を push する', async () => {
    const { deps, calls } = makeDeps({
      local: { penName: 'A', avatar: 'data:image/jpeg;base64,ZZ', updatedAt: 100 },
      remoteEntry: null,
    })
    await runProfileSync(deps)
    expect(calls.pushed[0]?.parts).toEqual(['doc', 'media'])
    expect(calls.pushed[0]?.media).toEqual({ avatar: 'data:image/jpeg;base64,ZZ' })
  })

  it('両方あり・リモートが新しく内容が違う → pull で上書き', async () => {
    const remote: Profile = { penName: 'リモート' }
    const { deps, calls } = makeDeps({
      local: { penName: 'ローカル', updatedAt: 100 },
      remoteEntry: remoteEntryOf(remote, 300),
      remoteData: { doc: { penName: 'リモート' }, media: null, updatedAt: 300 },
    })
    await runProfileSync(deps)

    expect(calls.pulled).toBe(1)
    expect(calls.pushed).toEqual([])
    expect(calls.saved[0]).toEqual({ penName: 'リモート', updatedAt: 300 })
  })

  it('両方あり・ローカルが新しい → push（pull しない）', async () => {
    const remote: Profile = { penName: 'リモート' }
    const { deps, calls } = makeDeps({
      local: { penName: 'ローカル', updatedAt: 500 },
      remoteEntry: remoteEntryOf(remote, 100),
      remoteData: { doc: { penName: 'リモート' }, media: null, updatedAt: 100 },
    })
    await runProfileSync(deps)

    expect(calls.pulled).toBe(0)
    expect(calls.pushed[0]?.parts).toEqual(['doc'])
    expect(calls.pushed[0]?.doc).toEqual({ penName: 'ローカル' })
  })

  it('両方あり・内容一致 → pull も push もしない（メタだけ更新）', async () => {
    const same: Profile = { penName: '同じ', updatedAt: 100 }
    const { deps, calls, getLastMeta } = makeDeps({
      local: same,
      remoteEntry: remoteEntryOf(same, 100),
    })
    await runProfileSync(deps)

    expect(calls.pulled).toBe(0)
    expect(calls.pushed).toEqual([])
    expect(getLastMeta()?.syncedAt).toBe(9999)
  })

  it('双方とも空 → 何もしない（空の __profile__ を作らない）', async () => {
    const { deps, calls } = makeDeps({ local: {}, remoteEntry: null })
    await runProfileSync(deps)
    expect(calls.pushed).toEqual([])
    expect(calls.pulled).toBe(0)
    expect(calls.saved).toEqual([])
  })

  it('リモート削除済み・ローカルが新しい → push で復活', async () => {
    const { deps, calls } = makeDeps({
      local: { penName: 'ローカル', updatedAt: 300 },
      remoteEntry: remoteEntryOf({ penName: '古' }, 100, { deleted: true }),
    })
    await runProfileSync(deps)
    expect(calls.pushed[0]?.parts).toEqual(['doc'])
  })

  it('pull が失敗したら古いローカルで上書き push しない', async () => {
    const remote: Profile = { penName: 'リモート' }
    const { deps, calls } = makeDeps({
      local: { penName: 'ローカル', updatedAt: 100 },
      remoteEntry: remoteEntryOf(remote, 300),
      remoteData: null, // pull 失敗
    })
    await runProfileSync(deps)
    expect(calls.pulled).toBe(1)
    expect(calls.pushed).toEqual([])
    expect(calls.saved).toEqual([])
  })
})

describe('pushProfileChange（変更時の差分 push）', () => {
  it('penName が変わっていれば doc だけ push する', async () => {
    const { deps, calls } = makeDeps({
      local: { penName: '新名', updatedAt: 200 },
      meta: { workId: PROFILE_WORK_ID, docHash: 'stale', mediaHash: '', syncedAt: 1 },
    })
    await pushProfileChange(deps)
    expect(calls.pushed).toEqual([
      { parts: ['doc'], doc: { penName: '新名' }, media: undefined, updatedAt: 200 },
    ])
  })

  it('変化が無ければ push しない', async () => {
    const local: Profile = { penName: '同じ', updatedAt: 100 }
    const d = digestOf(local)
    const { deps, calls } = makeDeps({
      local,
      meta: { workId: PROFILE_WORK_ID, docHash: d.docHash, mediaHash: d.mediaHash, syncedAt: 1 },
    })
    await pushProfileChange(deps)
    expect(calls.pushed).toEqual([])
  })

  it('アバター削除（メタに media あり・ローカルに無し）→ media を null で push', async () => {
    const { deps, calls } = makeDeps({
      local: { penName: 'A', updatedAt: 300 },
      meta: {
        workId: PROFILE_WORK_ID,
        docHash: fakeHash({ penName: 'A' }),
        mediaHash: fakeHash({ avatar: 'data:image/jpeg;base64,OLD' }),
        syncedAt: 1,
      },
    })
    await pushProfileChange(deps)
    expect(calls.pushed).toEqual([
      { parts: ['media'], doc: undefined, media: null, updatedAt: 300 },
    ])
  })

  it('未同期（メタ無し）かつ空プロフィール → push しない', async () => {
    const { deps, calls } = makeDeps({ local: {}, meta: null })
    await pushProfileChange(deps)
    expect(calls.pushed).toEqual([])
  })
})
