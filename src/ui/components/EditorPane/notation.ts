/** ボタン表示とキー処理で共用する記法一覧。 */
export type NotationKind =
  | 'ruby'
  | 'dots'
  | 'ref'
  | 'slug'
  | 'direction'
  | 'undirection'
  | 'transition'
  | 'dialogue'
  | 'ellipsis'
  | 'dash'

export type NotationSurface = 'pc' | 'mobile'

export const NOTATIONS: {
  kind: NotationKind
  label: string
  hint: string
  /** PC のショートカットキー。無いものはボタン（スマホ）か Tab 系の操作だけで入れる。 */
  key?: string
  alt?: boolean
  scriptOnly?: boolean
  /** スマホの記法バーだけに出す（PC は Tab / Shift+Tab で同じ操作ができる）。 */
  mobileOnly?: boolean
}[] = [
  { kind: 'ruby', label: 'ルビ', hint: '｜漢字《かんじ》', key: 'i' },
  { kind: 'dots', label: '傍点', hint: '《《強調》》', key: 'b' },
  { kind: 'ref', label: '用語引用', hint: '[[用語]]', key: 'k' },
  {
    kind: 'direction',
    label: 'ト書き',
    hint: '行頭を全角3字下げ',
    scriptOnly: true,
    mobileOnly: true,
  },
  {
    kind: 'undirection',
    label: 'ト書き解除',
    hint: '行頭の字下げを外す',
    scriptOnly: true,
    mobileOnly: true,
  },
  {
    kind: 'transition',
    label: '場面転換',
    hint: '独立した *** 行',
    key: 's',
    alt: true,
    scriptOnly: true,
  },
  { kind: 'slug', label: '柱', hint: '○場所（時間）', key: 'h', alt: true, scriptOnly: true },
  { kind: 'dialogue', label: 'セリフ', hint: '「セリフ」', key: 'd', alt: true },
  // 三点リーダーとダッシュは2つ重ねて2マス分使うのが作法。1つずつ打つと半端になるので型で入れる。
  { kind: 'ellipsis', label: '三点リーダー', hint: '……（2マス）', key: 'e', alt: true },
  { kind: 'dash', label: 'ダッシュ', hint: '――（2マス）', key: 'm', alt: true },
]

export const notationItems = (scriptMode = false, surface: NotationSurface = 'pc') =>
  NOTATIONS.filter((n) => (scriptMode || !n.scriptOnly) && (surface === 'mobile' || !n.mobileOnly))

export function notationShortcut(item: (typeof NOTATIONS)[number]): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const modifier = item.alt ? (mac ? 'Ctrl+Option' : 'Ctrl+Alt') : mac ? '⌘' : 'Ctrl'
  return item.key ? `${modifier}+${item.key.toUpperCase()}` : ''
}

export function notationForKey(
  event: {
    key: string
    code?: string
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
    altKey: boolean
  },
  scriptMode: boolean,
): NotationKind | undefined {
  if (event.shiftKey) return undefined
  // Option+英字が別の文字になる配列でも、ボタンに表示した英字キーで操作できる。
  // Windows の AltGr 付き配列は Ctrl+Alt を AltGraph として報告するので、AltGraph では弾かない。
  const key =
    event.altKey && event.code?.startsWith('Key')
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase()
  return notationItems(scriptMode).find((item) => {
    const modifier = item.alt ? event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey
    return Boolean(item.key) && modifier && Boolean(item.alt) === event.altKey && item.key === key
  })?.kind
}
