export const POSTING_PROFILES = {
  narou: {
    label: '小説家になろう',
    ruby: 'angle',
    limits: [10, 10],
    dots: 'ruby',
    auto: true,
    parens: 'wide',
    image: 'narou',
  },
  kakuyomu: {
    label: 'カクヨム',
    ruby: 'angle',
    limits: [20, 50],
    dots: 'angle',
    auto: true,
    escape: true,
  },
  novelup: {
    label: 'ノベルアップ＋',
    ruby: 'angle',
    limits: [50, 50],
    dots: 'ruby',
    parens: 'wide',
  },
  alphapolis: { label: 'アルファポリス', ruby: 'hash', dots: 'plain' },
  pixiv: { label: 'pixiv小説', ruby: 'pixiv', dots: 'pixiv', image: 'pixiv' },
  estar: { label: 'エブリスタ', ruby: 'angle', limits: [20, 50], dots: 'angle', auto: true },
  hameln: {
    label: 'ハーメルン',
    ruby: 'angle',
    limits: [20, 20],
    asciiLimit: 60,
    dots: 'angle',
    dotsLimit: 100,
    image: 'hameln',
  },
  noichigo: { label: '野いちご（Web）', ruby: 'angle', dots: 'plain', txt: true },
  berrys: { label: 'ベリーズカフェ（Web）', ruby: 'angle', dots: 'plain', txt: true },
  novema: { label: 'ノベマ！（Web）', ruby: 'angle', dots: 'plain', txt: true, maxBytes: 500_000 },
  teller: { label: 'テラーノベル（Web・新エディター）', ruby: 'angle', dots: 'plain' },
  tales: { label: 'TALES（テイルズ）', ruby: 'angle', dots: 'angle', parens: 'ascii' },
  solispia: { label: 'ソリスピア', ruby: 'angle', dots: 'angle', txt: true, guideChars: 20_000 },
  noveldays: {
    label: 'NOVEL DAYS（保存用）',
    ruby: 'angle',
    limits: [20, 50],
    dots: 'plain',
    escape: true,
    auto: true,
  },
  akatsuki: {
    label: 'アカツキ',
    ruby: 'angle',
    dots: 'angle',
    txt: true,
    maxEpisodes: 100,
    image: 'akatsuki',
  },
} as const satisfies Record<
  string,
  {
    label: string
    ruby: 'angle' | 'hash' | 'pixiv'
    limits?: readonly [number, number]
    asciiLimit?: number
    dots: 'angle' | 'ruby' | 'plain' | 'pixiv'
    dotsLimit?: number
    auto?: boolean
    escape?: boolean
    parens?: 'wide' | 'ascii'
    image?: string
    txt?: boolean
    maxBytes?: number
    guideChars?: number
    maxEpisodes?: number
  }
>

export type PostingSiteId = keyof typeof POSTING_PROFILES
export type SourceNotation = 'auto' | 'literal' | PostingSiteId
type PostingProfile = (typeof POSTING_PROFILES)[PostingSiteId]

export function postingProfile(site: PostingSiteId): PostingProfile & {
  limits?: readonly [number, number]
  asciiLimit?: number
  dotsLimit?: number
  auto?: boolean
  escape?: boolean
  parens?: 'wide' | 'ascii'
  image?: string
  txt?: boolean
  maxBytes?: number
  guideChars?: number
  maxEpisodes?: number
} {
  return POSTING_PROFILES[site]
}
