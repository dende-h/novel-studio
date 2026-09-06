/**
 * 組み込みのテンプレ立ち絵（シルエット調・6種）。presets.ts（テンプレ背景）と同じ思想——
 * 手続き的な SVG で「気配」を出し、運営が管理ページから入れた本画像は目録（templates.ts）
 * 経由で同じキーに重なる（キー設計が契約、絵は中身・D-GAME-TEMPLATE-CMS）。
 * 影絵ふうの単色シルエットなので、どのテンプレ背景・持ち込み背景の上でも浮かない。
 *
 * 割り当ての実体は UserGameAsset（kind 'sprite'・`preset` にこのキー・id は `tpl-` 前置）で、
 * **持ち込み枚数にもクラウド保管の枚数にも数えない**（無料プランでも使える。D-GAME-PRICE v2）。
 */

export interface PresetSprite {
  /** アセットではなくテンプレの識別子（UserGameAsset.preset が指す） */
  key: string
  /** zip 内のファイル名に使う識別子 */
  slug: string
  label: string
}

const DEFS: Array<{ slug: string; label: string }> = [
  { slug: 'silhouette-woman', label: 'シルエット（女性）' },
  { slug: 'silhouette-man', label: 'シルエット（男性）' },
  { slug: 'silhouette-girl', label: 'シルエット（少女）' },
  { slug: 'silhouette-boy', label: 'シルエット（少年）' },
  { slug: 'silhouette-elder', label: 'シルエット（老人）' },
  { slug: 'silhouette-hood', label: 'シルエット（フードの人）' },
]

export const PRESET_SPRITES: PresetSprite[] = DEFS.map((d) => ({
  key: `preset:sprite/${d.slug}`,
  slug: d.slug,
  label: d.label,
}))

export function presetSprite(key: string): PresetSprite | undefined {
  return PRESET_SPRITES.find((p) => p.key === key)
}

/** 共有カード等のスキーマ統一用（立ち絵では未使用）。シルエットの色味に合わせる。 */
export const PRESET_SPRITE_TONE: [string, string, string] = ['#2E3850', '#222A3E', '#161C2B']

/**
 * 各シルエットの形（viewBox 480×960・足元 y=960 に接地）。fill は呼び出し側の <g> が持つ。
 * 同色で塗るので、**外側の輪郭がすべて**——頭のふくらみ・首のくびれ・肩の張りを
 * 一筆書きのパスに含める（形を重ねて作ると輪郭からくびれが消える）。
 */
function figureOf(slug: string): string {
  switch (slug) {
    case 'silhouette-woman':
      return (
        // 頭 → 頬 → 肩へ流れるロングヘア → 腰のくびれ → 裾へ広がるロングスカート
        '<path d="M240,60 C200,60 172,94 170,146 C168,178 176,204 186,222 C176,240 160,262 148,296 C136,336 134,384 142,432 C150,470 158,498 156,530 C120,650 96,800 88,960 L392,960 C384,800 360,650 324,530 C322,498 330,470 338,432 C346,384 344,336 332,296 C320,262 304,240 294,222 C304,204 312,178 310,146 C308,94 280,60 240,60 Z"/>'
      )
    case 'silhouette-man':
      return (
        // 頭 → 首のくびれ → 張った肩 → まっすぐな胴
        '<path d="M240,68 C206,68 182,98 182,148 C182,192 200,226 216,242 C216,252 214,258 208,262 C158,274 130,300 124,350 C118,404 120,470 124,540 C128,690 132,830 136,960 L344,960 C348,830 352,690 356,540 C360,470 362,404 356,350 C350,300 322,274 272,262 C266,258 264,252 264,242 C280,226 298,192 298,148 C298,98 274,68 240,68 Z"/>'
      )
    case 'silhouette-girl':
      return (
        // 小柄。頬 → 肩に落ちる髪（ツインテール）→ 短めの胴とスカート
        '<path d="M240,258 C206,258 182,286 180,330 C179,358 186,380 194,394 C186,410 172,428 164,456 C156,490 156,528 162,564 C166,592 170,616 168,640 C144,740 128,850 122,960 L358,960 C352,850 336,740 312,640 C310,616 314,592 318,564 C324,528 324,490 316,456 C308,428 294,410 286,394 C294,380 301,358 300,330 C298,286 274,258 240,258 Z"/>'
      )
    case 'silhouette-boy':
      return (
        // 小柄・細身。首のくびれと小さめの肩
        '<path d="M240,248 C210,248 190,274 190,316 C190,352 204,378 216,390 C216,398 214,404 208,408 C172,418 152,440 148,480 C144,530 146,590 150,650 C154,760 158,860 160,960 L320,960 C322,860 326,760 330,650 C334,590 336,530 332,480 C328,440 308,418 272,408 C266,404 264,398 264,390 C276,378 290,352 290,316 C290,274 270,248 240,248 Z"/>'
      )
    case 'silhouette-elder':
      return (
        // 前かがみ（背中側がふくらむ非対称の輪郭）＋ 手元から立てた杖
        '<path d="M216,238 C188,240 170,264 170,302 C170,334 182,356 194,368 C194,376 192,382 186,386 C152,398 132,424 126,470 C120,530 122,620 126,700 C130,800 132,890 134,960 L330,960 C334,880 336,800 338,720 C342,600 338,500 322,428 C310,376 282,350 246,344 C254,330 260,312 258,292 C256,258 240,236 216,238 Z"/>' +
        '<path d="M300,560 C310,554 322,554 328,560 L346,950 L320,954 Z"/>'
      )
    case 'silhouette-hood':
      return (
        // フードつきの外套（正体不明の人物）。頭頂のわずかな尖りごとひとつの輪郭
        '<path d="M240,62 C264,68 284,92 294,128 C306,144 314,162 318,184 C346,322 370,600 382,960 L98,960 C110,600 134,322 162,184 C166,162 174,144 186,128 C196,92 216,68 240,62 Z"/>'
      )
    default:
      return '<circle cx="240" cy="200" r="60"/><path d="M240,270 C320,280 350,330 356,420 L360,960 L120,960 L124,420 C130,330 160,280 240,270 Z"/>'
  }
}

/**
 * テンプレ立ち絵の実体（SVG 文字列）。決定的（同じキーなら常に同じバイト列）。
 * 背景と違い透過で、輪郭をわずかにぼかして影絵の柔らかさを出す。
 */
export function presetSpriteSvg(p: PresetSprite): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 960">
<defs>
<linearGradient id="sil" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#303A54"/><stop offset=".6" stop-color="#232B40"/><stop offset="1" stop-color="#151B2A"/>
</linearGradient>
<filter id="edge" x="-8%" y="-4%" width="116%" height="108%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>
<g fill="url(#sil)" opacity=".96" filter="url(#edge)">
${figureOf(p.slug)}
</g>
</svg>
`
}

/**
 * SVG を base64 の data URL にする（UserGameAsset.dataUrl と同じ流儀＝
 * 書き出し時の decodeDataUrl・プレビューの <img src> がそのまま使える）。
 * SVG は ASCII のみで書いてあるので btoa（ブラウザ／Node／Workers 共通）で足りる。
 */
export function presetSpriteDataUrl(p: PresetSprite): string {
  return `data:image/svg+xml;base64,${btoa(presetSpriteSvg(p))}`
}
