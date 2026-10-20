import { z } from 'zod'
import { type DailyActivity, DailyActivitySchema } from '../activity'
import { type Staging, StagingSchema } from '../game'
import { type UserGameAsset, UserGameAssetSchema } from '../game/assets'
import { type IdeaNote, IdeaNoteSchema } from '../idea'
import { type Plot, PlotSchema } from '../plot'
import { type Profile, ProfileSchema } from '../profile'
import { type ProofreadRecord, ProofreadRecordSchema } from '../proofread/decisions'
import { type NameDismissals, NameDismissalsSchema } from '../proofread/name-dismissals'
import { type ProofreadRules, ProofreadRulesSchema } from '../proofread/work-rules'
import { type Work, WorkSchema } from '../schema'
import { type Structure, StructureSchema } from '../structure'

/**
 * クラウド全体バックアップ（Phase 2 改・バックアップ/復元モデル）。
 *
 * ローカルの全状態（全作品 active＋ゴミ箱＋プロフィール＋執筆活動＋ネタ帳＋構造レイヤー）を 1 つの時刻付きスナップショットに
 * 直列化する。これを gzip→暗号化して R2 に保存し、復元時は時点を選んでローカル全体を置換する
 * （自動 pull・双方向マージは廃止）。version＋スキーマで検証し、壊れた/古い形は弾く。
 */

export const CLOUD_BACKUP_VERSION = 1

const TrashedEntrySchema = z.object({ work: WorkSchema, trashedAt: z.number() })
export type TrashedEntry = z.infer<typeof TrashedEntrySchema>

const CloudBackupSchema = z.object({
  version: z.literal(CLOUD_BACKUP_VERSION),
  /** バックアップを取った時刻（epoch ms）。一覧の並び・表示に使う。 */
  createdAt: z.number(),
  works: z.array(WorkSchema),
  trash: z.array(TrashedEntrySchema),
  profile: ProfileSchema,
  /** 執筆活動（草・ストリーク）。version 1 の旧バックアップには無いので既定 []（後方互換）。 */
  activity: z.array(DailyActivitySchema).optional().default([]),
  /** ネタ帳（アイデアの受け皿）。旧バックアップには無いので既定 []（後方互換）。 */
  ideas: z.array(IdeaNoteSchema).optional().default([]),
  /** 構造レイヤー（アウトライン／相関図／マインドマップ）。旧バックアップには無いので既定 []。 */
  structures: z.array(StructureSchema).optional().default([]),
  /** プロット（幕×ビートの物語設計）。旧バックアップには無いので既定 []。 */
  plots: z.array(PlotSchema).optional().default([]),
  /** 演出譜（サウンドノベルの Staging）。旧バックアップには無いので既定 []。 */
  stagings: z.array(StagingSchema).optional().default([]),
  /** 推敲の判断（直す／このまま・話ごと）。旧バックアップには無いので既定 []。 */
  proofreads: z.array(ProofreadRecordSchema).optional().default([]),
  /**
   * 推敲で候補から外した語（COT-59・作品ごと）。旧バックアップには無いので既定 []。
   * 壊れた要素は null にして捨てる（1件の不正でバックアップ全体の復元を止めない）。
   * null は deserializeBackup で取り除く。
   */
  nameDismissals: z.array(NameDismissalsSchema.nullable().catch(null)).optional().default([]),
  /**
   * 推敲の作品の決まり（COT-62・作品ごと・例外／表記の好み／提案しない言葉）。旧バックアップには
   * 無いので既定 []。壊れた要素は外した語と同じく null にして deserializeBackup で捨てる。
   */
  proofreadRules: z.array(ProofreadRulesSchema.nullable().catch(null)).optional().default([]),
  /** 持ち込みのゲーム素材（背景画像）。旧バックアップには無いので既定 []。 */
  gameAssets: z.array(UserGameAssetSchema).optional().default([]),
})
/** 検証後の全体バックアップ。外した語・作品の決まりは壊れた要素（null）を取り除いた後の形。 */
export type CloudBackup = Omit<
  z.infer<typeof CloudBackupSchema>,
  'nameDismissals' | 'proofreadRules'
> & {
  nameDismissals: NameDismissals[]
  proofreadRules: ProofreadRules[]
}

/** バックアップ対象のローカル全状態。 */
export interface BackupState {
  works: Work[]
  trash: TrashedEntry[]
  profile: Profile
  activity: DailyActivity[]
  ideas: IdeaNote[]
  structures: Structure[]
  plots: Plot[]
  stagings: Staging[]
  proofreads: ProofreadRecord[]
  nameDismissals: NameDismissals[]
  proofreadRules: ProofreadRules[]
  gameAssets: UserGameAsset[]
}

/** 全状態を 1 つのバックアップ JSON に直列化する（暗号化前の平文）。 */
export function serializeBackup(state: BackupState, createdAt: number): string {
  const backup: CloudBackup = { version: CLOUD_BACKUP_VERSION, createdAt, ...state }
  return JSON.stringify(backup)
}

/** バックアップ JSON を検証して復元用の全状態に戻す（version/スキーマ不正は throw）。 */
export function deserializeBackup(json: string): CloudBackup {
  const parsed = CloudBackupSchema.parse(JSON.parse(json))
  return {
    ...parsed,
    nameDismissals: parsed.nameDismissals.filter((r): r is NameDismissals => r !== null),
    proofreadRules: parsed.proofreadRules.filter((r): r is ProofreadRules => r !== null),
  }
}

/**
 * JSON がクラウド全体バックアップ形式か（createdAt を持つか）を軽く判定する。
 * 取り込み時に、作品バンドル（version＋works のみで createdAt を持たない）と区別するために使う。
 */
export function isBackupJson(json: string): boolean {
  try {
    const raw: unknown = JSON.parse(json)
    return (
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { createdAt?: unknown }).createdAt === 'number'
    )
  } catch {
    return false
  }
}
