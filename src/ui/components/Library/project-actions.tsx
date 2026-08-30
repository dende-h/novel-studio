/** カード／リスト共通の作品操作ハンドラ。 */
export interface ProjectActionHandlers {
  onWrite: () => void
  onExport: () => void
  /** 作品メタ（タイトル・著者・あらすじ・表紙）を編集 */
  onEditMeta: () => void
  onDelete: () => void
  /** コトノハ-grove- へ投稿。投稿先が未設定なら undefined＝メニューに出さない。 */
  onPublish?: () => void
  /** 投稿済み作品の公開／下書きを切り替える。未投稿なら undefined＝メニューに出さない。 */
  onTogglePublish?: () => void
  /** 切り替えの通信中。多重送信を防ぐため、その間はメニュー項目を無効化する。 */
  publishBusy?: boolean
}
