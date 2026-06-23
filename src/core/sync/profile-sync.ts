/**
 * プロフィール同期の純ロジック（Phase 2 拡張）。
 *
 * 作者プロフィール（ペンネーム＝doc／アバター＝media）を、通常の Work と同じ同期パイプライン
 * （manifest/work API・暗号化 R2）に予約 workId `__profile__` で相乗りさせる。サーバ側は doc/media を
 * 不透明オブジェクトとして扱う（workId の形式検証なし）ため、サーバ変更ゼロで成立する。
 *
 * Work エンジン（engine.ts）と分けてあるのは、(1) 保存先が WorkRepository ではなく ProfileRepository、
 * (2) doc/media の形が Work と違う、(3) ライブラリ一覧に出さない、(4) 設定なので敗者スナップショット退避を
 * しない、ため。LWW（updatedAt 比較）と変更パートだけ push する方針は Work と同じ。I/O は全て注入。
 */

import type { Profile } from '../profile'
import type { PullResult, PushPayload, PushResult } from './engine'
import { resolvePush } from './lww'
import type { LocalSyncMeta, ManifestEntry } from './manifest'
import { PROFILE_WORK_ID } from './manifest'

/** doc パート（本文相当＝ペンネーム）。 */
export interface ProfileDoc {
  penName?: string
}

/** media パート（画像相当＝アバター data URL）。 */
export interface ProfileMedia {
  avatar: string
}

/** エンジンが必要とする I/O 一式（アダプタが実装を注入する）。 */
export interface ProfileSyncDeps {
  /** マニフェストから `__profile__` のエントリを取得（無ければ null）。 */
  getRemoteEntry(): Promise<ManifestEntry | null>
  /** `__profile__` を pull（平文 part を復号・展開済みで受け取る）。 */
  pullProfile(): Promise<PullResult | null>
  /** `__profile__` を push（変わった part のみ）。 */
  pushProfile(payload: PushPayload): Promise<PushResult | null>
  loadLocalProfile(): Promise<Profile>
  saveLocalProfile(profile: Profile): Promise<void>
  getMeta(): Promise<LocalSyncMeta | null>
  setMeta(meta: LocalSyncMeta): Promise<void>
  /** canonicalize → SHA-256(hex)。クライアント・サーバで同一であること。 */
  hashPart(value: unknown): Promise<string>
  now(): number
}

interface ProfileDigest {
  doc: ProfileDoc
  media: ProfileMedia | null
  docHash: string
  mediaHash: string
}

/** Profile を doc（penName）と media（avatar）に分割する。画像が無ければ media は null。 */
export function splitProfile(profile: Profile): { doc: ProfileDoc; media: ProfileMedia | null } {
  const doc: ProfileDoc = {}
  if (profile.penName !== undefined) doc.penName = profile.penName
  const media = profile.avatar !== undefined ? { avatar: profile.avatar } : null
  return { doc, media }
}

/** doc/media から Profile を復元する（splitProfile の逆・updatedAt は呼び出し側で補う）。 */
export function joinProfile(doc: ProfileDoc, media: ProfileMedia | null): Profile {
  const profile: Profile = {}
  if (doc.penName !== undefined) profile.penName = doc.penName
  if (media?.avatar !== undefined) profile.avatar = media.avatar
  return profile
}

/** ペンネームもアバターも無い＝同期する中身が無い。 */
function isEmpty(p: Profile): boolean {
  return !p.penName && !p.avatar
}

function metaOf(docHash: string, mediaHash: string, syncedAt: number): LocalSyncMeta {
  return { workId: PROFILE_WORK_ID, docHash, mediaHash, syncedAt }
}

async function digestProfile(deps: ProfileSyncDeps, profile: Profile): Promise<ProfileDigest> {
  const { doc, media } = splitProfile(profile)
  const docHash = await deps.hashPart(doc)
  const mediaHash = media === null ? '' : await deps.hashPart(media)
  return { doc, media, docHash, mediaHash }
}

/**
 * 変わった part だけを push する。`against` は「サーバが既に持っているはずのハッシュ」
 * （ログイン時は remote マニフェスト、変更時はローカル同期メタ）。null は未アップロード。
 * 既に一致していれば push せずメタだけ最新化する。
 */
async function pushChanged(
  deps: ProfileSyncDeps,
  local: Profile,
  digest: ProfileDigest,
  against: { docHash: string; mediaHash: string } | null,
): Promise<void> {
  const parts = resolvePush({ docHash: digest.docHash, mediaHash: digest.mediaHash }, against)
  const partList: Array<'doc' | 'media'> = []
  if (parts.doc) partList.push('doc')
  if (parts.media) partList.push('media')
  if (partList.length === 0) {
    await deps.setMeta(metaOf(digest.docHash, digest.mediaHash, deps.now()))
    return
  }

  const res = await deps.pushProfile({
    updatedAt: local.updatedAt ?? deps.now(),
    parts: partList,
    // media を null で送ると、サーバはその part を削除する（アバター削除）。
    doc: parts.doc ? digest.doc : undefined,
    media: parts.media ? digest.media : undefined,
  })
  if (!res) return
  await deps.setMeta(metaOf(res.docHash, res.mediaHash, deps.now()))
}

/**
 * ログイン時：プロフィールを双方向同期する。
 * remote が新しく内容が違えば pull（設定なのでスナップショット退避はしない）、
 * そうでなければ（remote 無し・ローカルが新しい）ローカルを push する。
 */
export async function runProfileSync(deps: ProfileSyncDeps): Promise<void> {
  const entry = await deps.getRemoteEntry()
  const remote = entry && entry.deleted === false ? entry : null
  const local = await deps.loadLocalProfile()

  // 双方とも空＝何もしない（空の `__profile__` を作らない）。
  if (!remote && isEmpty(local)) return

  const digest = await digestProfile(deps, local)

  if (remote) {
    const same = remote.docHash === digest.docHash && remote.mediaHash === digest.mediaHash
    if (same) {
      await deps.setMeta(metaOf(remote.docHash, remote.mediaHash, deps.now()))
      return
    }
    if (remote.updatedAt > (local.updatedAt ?? 0)) {
      const pulled = await deps.pullProfile()
      if (!pulled) return // 失敗時は次回ログインで再試行（古いローカルで上書きしない）。
      const next = joinProfile(pulled.doc as ProfileDoc, pulled.media as ProfileMedia | null)
      next.updatedAt = pulled.updatedAt
      await deps.saveLocalProfile(next)
      await deps.setMeta(metaOf(remote.docHash, remote.mediaHash, deps.now()))
      return
    }
  }

  await pushChanged(deps, local, digest, remote)
}

/**
 * プロフィール変更時：直近同期メタと比べて変わった part だけを push する（pull はしない）。
 * 一度も同期していない空プロフィールは push しない（空の `__profile__` を作らない）。
 */
export async function pushProfileChange(deps: ProfileSyncDeps): Promise<void> {
  const local = await deps.loadLocalProfile()
  const meta = await deps.getMeta()
  if (!meta && isEmpty(local)) return
  const digest = await digestProfile(deps, local)
  await pushChanged(
    deps,
    local,
    digest,
    meta ? { docHash: meta.docHash, mediaHash: meta.mediaHash } : null,
  )
}
