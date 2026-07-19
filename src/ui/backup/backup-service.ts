import { type BackupState, deserializeBackup, serializeBackup } from '@/core/backup'
import { ProfileRepository } from '@/core/profile'
import { ActivityRepository } from '@/core/storage/activityRepository'
import { IdbStore } from '@/core/storage/idbStore'
import { IdeaRepository } from '@/core/storage/ideaRepository'
import { StructureRepository } from '@/core/storage/structureRepository'
import { WorkRepository } from '@/core/storage/workRepository'
import {
  createBackup as apiCreate,
  deleteBackup as apiDelete,
  getBackup as apiGet,
  listBackups as apiList,
  putLiveBackup as apiPutLive,
  type BackupSummary,
} from '@/ui/_api/backup'

export type { BackupSummary }

/** バックアップ・サービスが必要とする I/O（テスト時に差し替え可能）。 */
export interface BackupDeps {
  gather(): Promise<BackupState>
  /** 全置換で現在のローカル状態を上書きする（不可逆・呼び出し前に安全退避済み）。 */
  replaceAll(state: BackupState): Promise<void>
  createRemote(plaintext: string): Promise<{ id: string; createdAt: number } | null>
  /** MCP 用ライブスナップショットを上書き保存（版は作らない）。 */
  putLiveRemote(plaintext: string): Promise<boolean>
  listRemote(): Promise<BackupSummary[]>
  getRemote(id: string): Promise<string | null>
  deleteRemote(id: string): Promise<boolean>
  now(): number
}

export interface BackupService {
  /** 現在の全状態をクラウドへ手動バックアップ。成功で要約、失敗/未ログインで null。 */
  backupNow(): Promise<BackupSummary | null>
  /** バックアップ一覧（新しい順）。 */
  list(): Promise<BackupSummary[]>
  /**
   * 指定バックアップでローカル全体を置換（復元）。成功で true。
   * `backupCurrent: true` のときだけ、置換前に現在の状態をクラウドへ安全退避する（任意）。
   */
  restore(id: string, opts?: { backupCurrent?: boolean }): Promise<boolean>
  /** バックアップ 1 件を削除。 */
  remove(id: string): Promise<boolean>
  /** MCP 用ライブスナップショットを現在の全状態で上書き（AI に最新を読ませる）。 */
  pushLive(): Promise<void>
}

/** 純ロジック（直列化）と注入 I/O を束ねる。破壊的処理（restore の replaceAll）の単一経路。 */
export function createBackupService(deps: BackupDeps): BackupService {
  return {
    async backupNow() {
      const plaintext = serializeBackup(await deps.gather(), deps.now())
      const res = await deps.createRemote(plaintext)
      return res ? { ...res, size: plaintext.length } : null
    },
    list: () => deps.listRemote(),
    async restore(id, opts = {}) {
      // 任意の安全網：希望時だけ、全置換の前に現在のローカル状態をクラウドへ退避する
      // （常に退避するとバックアップが増え続けるため、ユーザーが選べるようにした）。
      if (opts.backupCurrent) {
        await deps.createRemote(serializeBackup(await deps.gather(), deps.now()))
      }
      const json = await deps.getRemote(id)
      if (!json) return false
      const backup = deserializeBackup(json) // version/スキーマ検証。壊れていれば throw して置換しない。
      await deps.replaceAll({
        works: backup.works,
        trash: backup.trash,
        profile: backup.profile,
        activity: backup.activity,
        ideas: backup.ideas,
        structures: backup.structures,
      })
      return true
    },
    remove: (id) => deps.deleteRemote(id),
    async pushLive() {
      await deps.putLiveRemote(serializeBackup(await deps.gather(), deps.now()))
    },
  }
}

/**
 * 課金に依存しないローカル I/O（gather＝全状態収集 / replaceAll＝全置換）。
 * IndexedDB('novel-studio') 上の Repository を束ねる。ローカル・クラウド双方の土台。
 */
export function createLocalBackupIO(): Pick<BackupDeps, 'gather' | 'replaceAll'> {
  const store = new IdbStore('novel-studio')
  const repo = new WorkRepository(store)
  const profileRepo = new ProfileRepository(store)
  const activityRepo = new ActivityRepository(store)
  const ideaRepo = new IdeaRepository(store)
  const structureRepo = new StructureRepository(store)
  return {
    gather: async () => ({
      works: await repo.listWorksFull(),
      trash: await repo.listTrashFull(),
      profile: await profileRepo.get(),
      activity: await activityRepo.list(),
      ideas: await ideaRepo.list(),
      structures: await structureRepo.list(),
    }),
    replaceAll: async (state) => {
      await repo.replaceAll(state.works, state.trash)
      await profileRepo.save(state.profile)
      await activityRepo.replaceAll(state.activity)
      await ideaRepo.replaceAll(state.ideas)
      await structureRepo.replaceAll(state.structures)
    },
  }
}

/** 本番用：ローカル I/O と `/api/backup` を結線する（クラウドバックアップ・要ログイン）。 */
export function createDefaultBackupService(getToken: () => Promise<string | null>): BackupService {
  const io = createLocalBackupIO()
  return createBackupService({
    gather: io.gather,
    replaceAll: io.replaceAll,
    createRemote: (plaintext) => apiCreate(getToken, plaintext),
    putLiveRemote: (plaintext) => apiPutLive(getToken, plaintext),
    listRemote: () => apiList(getToken),
    getRemote: (id) => apiGet(getToken, id),
    deleteRemote: (id) => apiDelete(getToken, id),
    now: () => Date.now(),
  })
}

/** ローカル（ファイル）バックアップ。課金非依存で全状態を平文 JSON 化／全置換で復元する。 */
export interface LocalBackupService {
  /** 現在の全状態を平文 JSON（CloudBackup 形式）で書き出す。 */
  exportPlaintext(): Promise<string>
  /** バックアップ JSON でローカル全体を置換（復元）。不可逆。壊れた JSON は throw。 */
  restorePlaintext(json: string): Promise<void>
}

/**
 * 本番用：ローカル I/O だけで完結するファイルバックアップ（誰でも使える）。
 * io/now はテスト時に注入可能。
 */
export function createLocalBackupService(
  io: Pick<BackupDeps, 'gather' | 'replaceAll'> = createLocalBackupIO(),
  now: () => number = () => Date.now(),
): LocalBackupService {
  return {
    exportPlaintext: async () => serializeBackup(await io.gather(), now()),
    restorePlaintext: async (json) => {
      await io.replaceAll(deserializeBackup(json))
    },
  }
}
