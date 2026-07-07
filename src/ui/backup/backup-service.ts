import { type BackupState, deserializeBackup, serializeBackup } from '@/core/backup'
import { ProfileRepository } from '@/core/profile'
import { IdbStore } from '@/core/storage/idbStore'
import { WorkRepository } from '@/core/storage/workRepository'
import {
  createBackup as apiCreate,
  deleteBackup as apiDelete,
  getBackup as apiGet,
  listBackups as apiList,
  type BackupSummary,
} from '@/ui/_api/backup'

export type { BackupSummary }

/** バックアップ・サービスが必要とする I/O（テスト時に差し替え可能）。 */
export interface BackupDeps {
  gather(): Promise<BackupState>
  /** 全置換で現在のローカル状態を上書きする（不可逆・呼び出し前に安全退避済み）。 */
  replaceAll(state: BackupState): Promise<void>
  createRemote(plaintext: string): Promise<{ id: string; createdAt: number } | null>
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
      await deps.replaceAll({ works: backup.works, trash: backup.trash, profile: backup.profile })
      return true
    },
    remove: (id) => deps.deleteRemote(id),
  }
}

/** 本番用：IndexedDB('novel-studio') 上の Repository と `/api/backup` を結線する。 */
export function createDefaultBackupService(getToken: () => Promise<string | null>): BackupService {
  const store = new IdbStore('novel-studio')
  const repo = new WorkRepository(store)
  const profileRepo = new ProfileRepository(store)
  return createBackupService({
    gather: async () => ({
      works: await repo.listWorksFull(),
      trash: await repo.listTrashFull(),
      profile: await profileRepo.get(),
    }),
    replaceAll: async (state) => {
      await repo.replaceAll(state.works, state.trash)
      await profileRepo.save(state.profile)
    },
    createRemote: (plaintext) => apiCreate(getToken, plaintext),
    listRemote: () => apiList(getToken),
    getRemote: (id) => apiGet(getToken, id),
    deleteRemote: (id) => apiDelete(getToken, id),
    now: () => Date.now(),
  })
}
