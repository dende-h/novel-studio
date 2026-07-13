/** カード／リスト共通の作品操作ハンドラ。 */
export interface ProjectActionHandlers {
  onWrite: () => void
  onExport: () => void
  /** 作品メタ（タイトル・著者・あらすじ・表紙）を編集 */
  onEditMeta: () => void
  onDelete: () => void
}
