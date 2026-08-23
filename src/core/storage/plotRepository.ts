import { createPlotFromTemplate, normalizePlot, type Plot, type PlotTemplate } from '../plot'
import type { KeyValueStore } from './types'

/**
 * プロットの永続化。KeyValueStore に `plot:<id>` で 1 プロット 1 レコードを持つ。純ローカル。
 * replaceAll はクラウド／ローカル両バックアップの全置換復元で使う（structureRepository と同型）。
 */
const PREFIX = 'plot:'
const keyOf = (id: string) => `${PREFIX}${id}`

export class PlotRepository {
  constructor(
    private store: KeyValueStore,
    private genId: () => string = () => crypto.randomUUID(),
    private now: () => number = () => Date.now(),
  ) {}

  /**
   * ID で1件取得。読み出しは normalizePlot を通す＝後から足した項目の欠落を入り口で埋める
   * （store.get はキャストするだけで検証しないため、古いレコードは型どおりの形をしていない）。
   */
  async get(id: string): Promise<Plot | undefined> {
    const raw = await this.store.get<Plot>(keyOf(id))
    return raw ? normalizePlot(raw) : undefined
  }

  /**
   * テンプレートからプロットを作成して保存する。
   * 既定プロットは id に singletonPlotId(workId) を渡す＝複数端末が同時に作っても
   * 同じレコードに収束し、同期レースで空プロットが増殖しない。省略時はランダム id。
   */
  async create(workId: string, template: PlotTemplate, title?: string, id?: string): Promise<Plot> {
    const p = createPlotFromTemplate(
      id ?? this.genId(),
      workId,
      this.now(),
      template,
      this.genId,
      title,
    )
    await this.store.set(keyOf(p.id), p)
    return p
  }

  /** プロットを保存する（updatedAt を現在時刻に更新して上書き）。 */
  async save(plot: Plot): Promise<Plot> {
    const next: Plot = { ...plot, updatedAt: this.now() }
    await this.store.set(keyOf(next.id), next)
    return next
  }

  /**
   * 同期 pull 用の素通し保存。updatedAt を**刻印しない**（他端末の時刻をそのまま保つ）。
   * save() を使うと pull のたびに時計が進み、LWW で常にこちらが勝ってしまうため分ける。
   */
  async put(plot: Plot): Promise<void> {
    await this.store.set(keyOf(plot.id), plot)
  }

  /** 指定作品のプロットを updatedAt の新しい順で返す。 */
  async listByWork(workId: string): Promise<Plot[]> {
    const all = await this.list()
    return all.filter((p) => p.workId === workId).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** プロットを削除する。 */
  async remove(id: string): Promise<void> {
    await this.store.delete(keyOf(id))
  }

  /** 指定作品のプロットをまとめて削除する（作品削除時などに使う）。 */
  async removeByWork(workId: string): Promise<void> {
    const all = await this.list()
    await Promise.all(all.filter((p) => p.workId === workId).map((p) => this.remove(p.id)))
  }

  /** 全プロット（バックアップ用）。 */
  async list(): Promise<Plot[]> {
    const keys = await this.store.keys(PREFIX)
    const rows = await Promise.all(keys.map((k) => this.store.get<Plot>(k)))
    return rows.filter((r): r is Plot => r != null).map(normalizePlot)
  }

  /** 全置換する（クラウド復元用・既存を消してから書き込む）。 */
  async replaceAll(plots: Plot[]): Promise<void> {
    const existing = await this.store.keys(PREFIX)
    await Promise.all(existing.map((k) => this.store.delete(k)))
    await Promise.all(plots.map((p) => this.store.set(keyOf(p.id), p)))
  }
}
