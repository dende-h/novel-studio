/** 段落の中の指摘 1 件（品詞を使うルールの戻り値。段落 ID などは index.ts が付ける）。 */
export interface MorphHit {
  start: number
  end: number
  text: string
  message: string
}
