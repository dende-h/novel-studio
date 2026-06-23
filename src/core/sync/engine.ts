/**
 * 同期オーケストレーション（Phase 2）。plan/lww/split の純ロジックを束ね、I/O は
 * すべて注入された関数（deps）で行う。これ自体は React/fetch/crypto/IndexedDB を直接触らない
 * （core 境界準拠・テスト容易）。実 I/O の結線は src/ui/sync/sync-controller.ts。
 */

import type { Work } from '../schema'
import { resolvePush } from './lww'
import type { LocalSyncMeta, ManifestEntry } from './manifest'
import { type LocalEntry, planAutosavePush, planLoginSync } from './plan'
import { joinWork, splitWork, type WorkDoc, type WorkMedia } from './split'

/** push の本文（平文 part を含む）。media を null で送ると削除。 */
export interface PushPayload {
  updatedAt: number
  parts: Array<'doc' | 'media'>
  doc?: unknown
  media?: unknown
}

/** push 成功時にサーバが返すハッシュとサイズ。 */
export interface PushResult {
  docHash: string
  mediaHash: string
  size: number
}

/** pull で得る平文 part。 */
export interface PullResult {
  doc: unknown
  media: unknown
  updatedAt: number
}

/** エンジンが必要とする I/O 一式（アダプタが実装を注入する）。 */
export interface SyncDeps {
  getManifest(): Promise<ManifestEntry[]>
  pullWork(workId: string): Promise<PullResult | null>
  pushWork(workId: string, payload: PushPayload): Promise<PushResult | null>
  listLocalWorks(): Promise<Work[]>
  loadLocalWork(workId: string): Promise<Work | null>
  saveLocalWork(work: Work): Promise<void>
  trashLocalWork(workId: string): Promise<void>
  /** 上書き前の敗者保全（スナップショット履歴へ退避）。 */
  snapshotLocal(work: Work): Promise<void>
  getSyncMeta(workId: string): Promise<LocalSyncMeta | null>
  setSyncMeta(meta: LocalSyncMeta): Promise<void>
  /** canonicalize → SHA-256(hex)。クライアント・サーバで同一であること。 */
  hashPart(value: unknown): Promise<string>
  now(): number
}

export interface LoginSyncResult {
  pulled: string[]
  pushed: string[]
  trashed: string[]
}

interface Digest {
  doc: WorkDoc
  media: WorkMedia | null
  docHash: string
  mediaHash: string
}

async function digestWork(deps: SyncDeps, work: Work): Promise<Digest> {
  const { doc, media } = splitWork(work)
  const docHash = await deps.hashPart(doc)
  const mediaHash = media === null ? '' : await deps.hashPart(media)
  return { doc, media, docHash, mediaHash }
}

async function pushOne(
  deps: SyncDeps,
  work: Work,
  digest: Digest,
  remote: ManifestEntry | undefined,
): Promise<boolean> {
  const parts = resolvePush(
    { docHash: digest.docHash, mediaHash: digest.mediaHash },
    remote ? { docHash: remote.docHash, mediaHash: remote.mediaHash } : null,
  )
  const partList: Array<'doc' | 'media'> = []
  if (parts.doc) partList.push('doc')
  if (parts.media) partList.push('media')
  if (partList.length === 0) return false

  const res = await deps.pushWork(work.id, {
    updatedAt: work.updatedAt ?? deps.now(),
    parts: partList,
    doc: parts.doc ? digest.doc : undefined,
    media: parts.media ? digest.media : undefined,
  })
  if (!res) return false
  await deps.setSyncMeta({
    workId: work.id,
    docHash: res.docHash,
    mediaHash: res.mediaHash,
    syncedAt: deps.now(),
  })
  return true
}

/** ログイン時の全双方向同期。 */
export async function runLoginSync(deps: SyncDeps): Promise<LoginSyncResult> {
  const remote = await deps.getManifest()
  const remoteMap = new Map(remote.map((e) => [e.workId, e]))
  const locals = await deps.listLocalWorks()

  const digests = new Map<string, Digest>()
  const localEntries: LocalEntry[] = []
  for (const work of locals) {
    const d = await digestWork(deps, work)
    digests.set(work.id, d)
    localEntries.push({
      workId: work.id,
      updatedAt: work.updatedAt ?? 0,
      docHash: d.docHash,
      mediaHash: d.mediaHash,
    })
  }

  const plan = planLoginSync(localEntries, remote)
  const result: LoginSyncResult = { pulled: [], pushed: [], trashed: [] }

  // pull の前に敗者をスナップショット退避。
  for (const id of plan.snapshotBeforePull) {
    const work = await deps.loadLocalWork(id)
    if (work) await deps.snapshotLocal(work)
  }

  for (const id of plan.toPull) {
    const pulled = await deps.pullWork(id)
    if (!pulled) continue
    const work = joinWork(pulled.doc as WorkDoc, pulled.media as WorkMedia | null)
    work.updatedAt = pulled.updatedAt
    await deps.saveLocalWork(work)
    const r = remoteMap.get(id)
    await deps.setSyncMeta({
      workId: id,
      docHash: r?.docHash ?? '',
      mediaHash: r?.mediaHash ?? '',
      syncedAt: deps.now(),
    })
    result.pulled.push(id)
  }

  for (const id of plan.toPush) {
    const work = await deps.loadLocalWork(id)
    if (!work) continue
    const digest = digests.get(id) ?? (await digestWork(deps, work))
    if (await pushOne(deps, work, digest, remoteMap.get(id))) {
      result.pushed.push(id)
    }
  }

  for (const id of plan.toTrashLocal) {
    await deps.trashLocalWork(id)
    result.trashed.push(id)
  }

  return result
}

/** autosave 時、編集中 1 Work の変わったパートだけを push する（pull はしない）。 */
export async function runAutosavePush(deps: SyncDeps, workId: string): Promise<boolean> {
  const work = await deps.loadLocalWork(workId)
  if (!work) return false

  const digest = await digestWork(deps, work)
  const meta = await deps.getSyncMeta(workId)
  const plan = planAutosavePush(
    { docHash: digest.docHash, mediaHash: digest.mediaHash },
    meta ? { docHash: meta.docHash, mediaHash: meta.mediaHash } : null,
  )
  if (!plan.shouldPush) return false

  const res = await deps.pushWork(workId, {
    updatedAt: work.updatedAt ?? deps.now(),
    parts: plan.parts,
    doc: plan.parts.includes('doc') ? digest.doc : undefined,
    media: plan.parts.includes('media') ? digest.media : undefined,
  })
  if (!res) return false
  await deps.setSyncMeta({
    workId,
    docHash: res.docHash,
    mediaHash: res.mediaHash,
    syncedAt: deps.now(),
  })
  return true
}
