/**
 * ネタ帳（アイデアの受け皿）の1メモ。まだどの作品にも属さない断片を保持する純ローカルの型。
 * text はプレーンテキスト（複数行可）、createdAt/updatedAt はエポックミリ秒。
 */
export interface IdeaNote {
  id: string
  text: string
  createdAt: number
  updatedAt: number
}

/** 入力テキストを1メモぶんに正規化する。前後の空白を除き、空なら null（＝追加・更新しない）。 */
export function normalizeIdeaText(text: string): string | null {
  const t = text.trim()
  return t === '' ? null : t
}

/** 新しい順（作成日時の降順、同時刻は id 降順で安定）に並べ替える。 */
export function sortIdeasByNewest(notes: IdeaNote[]): IdeaNote[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
}
