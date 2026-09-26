import type { DialogAnswer, GlossaryEntry } from '../schema'
import { publicTextOf, withPublicText } from './index'

/**
 * 用語集の「対話」（一問一答で項目を育てる・11-glossary-dialog.md）の**純データと純ロジック**。
 * 質問セットの正本はここ（付録 A と同内容）。React・UI を import しない。
 *
 * - 共通 4 問（名前・読み・別名・公開情報）は既存の欄へ入り、`dialog` には持たない（D-DLG-STORE）。
 * - 深掘りの答えは `GlossaryEntry.dialog[key]`。追い質問の鍵は `親__子`、種類は `kind`。
 * - 画面（GlossaryView の対話ペイン）と MCP（upsert_glossary_entry の dialog）が同じ規則を使う
 *   ＝ `applyDialogPatch` を共用し、鍵の検証・公開の既定・固定の扱いを一か所に置く（§5.5）。
 */

/** 質問セットの版。質問を足したり消したりしたら上げ、旧データの答えは鍵で残す（§2）。 */
export const DIALOG_VERSION = 2

/**
 * 旧版の質問セットにあった鍵の見出し（§2）。v1 の人物にあり、v2 で消した・畳んだもの。
 * 答えは消さない。読み出しで今の問いに畳む（`answerOf`）か、「（旧）」の見出しで表示する
 * （CLAUDE.md「旧形式の読み出しは互換ヘルパで吸収する」「欄の出力先を無くさない」）。
 */
export const LEGACY_LABELS: Readonly<Record<string, string>> = {
  looks_body: '背格好',
  looks_first: '目に留まるところ',
  speech_second: '人の呼び方',
}

/** 今の問いへ畳む旧鍵（`looks`＝見た目の特徴 ← v1 の背格好＋目に留まるところ）。並びは畳んだ文の順。 */
const LEGACY_FOLDS: Readonly<Record<string, readonly string[]>> = {
  looks: ['looks_body', 'looks_first'],
}

/**
 * 鍵の答えを読む。今の鍵が無ければ旧鍵から畳んで返す（遅延移行）。畳んだ答えは
 * 両方が「読者に見せる」のときだけ公開＝片方が作者だけなら作者だけに倒す（安全側）。
 * 今の鍵に書けば（`withDialogAnswer`）旧鍵は消え、新形式に寄る。
 */
export function answerOf(
  dialog: Record<string, DialogAnswer> | undefined,
  key: string,
): DialogAnswer | undefined {
  const a = dialog?.[key]
  if (a !== undefined || !dialog) return a
  const from = LEGACY_FOLDS[key]
  if (!from) return undefined
  const olds = from.map((k) => dialog[k]).filter((x): x is DialogAnswer => x !== undefined)
  if (olds.length === 0) return undefined
  const texts = olds.map((x) => x.text.trim()).filter((t) => t !== '')
  // 旧鍵がスキップのまま（文が無い）＝今の問いもスキップ済みとして扱う（同じことを二度聞かない）。
  if (texts.length === 0) return { text: '', skipped: true }
  return { text: texts.join('\n'), public: olds.every((x) => x.public === true) }
}

/** 今の問いに畳まれて読まれている旧鍵（「残っている答え」の一覧には出さない）。 */
export function foldedLegacyKeys(dialog: Record<string, DialogAnswer> | undefined): Set<string> {
  const out = new Set<string>()
  if (!dialog) return out
  for (const [key, from] of Object.entries(LEGACY_FOLDS)) {
    if (dialog[key] === undefined && from.some((k) => dialog[k] !== undefined)) {
      for (const k of from) out.add(k)
    }
  }
  return out
}

/** 鍵の答えを書くときに一緒に消す旧鍵（畳まれていた答えは今の鍵に移る）。 */
function withoutLegacyOf(record: Record<string, DialogAnswer>, key: string): void {
  for (const k of LEGACY_FOLDS[key] ?? []) delete record[k]
}

/**
 * 公開の既定（D-DLG-VIS）。
 * - public-fixed … 読者に見える欄そのもの（共通 4 問）
 * - switch-public … 最初から「読者に見せる」・作者だけに戻せる（プロフィールのまとまり）
 * - switch … 既定は「作者だけ」・読者に見せるへ切り替えられる（深掘り）
 * - private-fixed … 作者だけ（秘密・今の持ち主）
 */
export type DialogVisibility = 'public-fixed' | 'private-fixed' | 'switch' | 'switch-public'

/** 共通 4 問が書き込む既存の欄。 */
export type DialogField = 'name' | 'reading' | 'aliases' | 'summary'

/** 「もう少し深める」の追い質問（親の鍵と `__` でつなぐ）。向きは「どうしてそうなったのか」だけ（D-DLG-DIG）。 */
export interface DialogDig {
  key: string
  label: string
  q: string
  placeholder?: string
}

export interface DialogQuestion {
  key: string
  /** まとまり（D-DLG-SECTIONS）。切り替わりでボットが案内する。 */
  section: string
  label: string
  /** ボットの言葉。`{名前}` は項目の名前（未入力なら分類ごとの言い換え）に置き換える。 */
  q: string
  vis: DialogVisibility
  /** 共通 4 問だけが持つ。答えは `dialog` ではなくこの欄へ入る。 */
  field?: DialogField
  /** 任意の問い（進み具合に数えない・D-DLG-SKIP）。 */
  optional?: boolean
  placeholder?: string
  /** 選択肢（チップ）。`free` が無ければ選択肢からだけ選ぶ（種類）。 */
  choices?: readonly string[]
  /** 選択肢に加えて自由記述も受ける（性別・血液型）。 */
  free?: boolean
  /** 「種類」の答えがこの中のときだけ聞く枝の問い（D-DLG-KIND）。 */
  only?: readonly string[]
  dig?: readonly DialogDig[]
}

/** 追い質問を、親と同じ公開の扱い・同じまとまりの質問として起こした形。 */
export interface DialogDigQuestion extends DialogQuestion {
  isDig: true
  parentKey: string
}

export type AnyDialogQuestion = DialogQuestion | DialogDigQuestion

/** 対話が質問セットを持つ分類（GLOSSARY_CATEGORIES と同じ 6 つ・同順）。 */
export const DIALOG_CATEGORIES = ['人物', '場所', '組織', '用語', 'アイテム', '生物'] as const

/** 共通 4 問の鍵。`dialog` には入れない（MCP は拒否する）。 */
export const BASE_KEYS: readonly string[] = ['name', 'reading', 'aliases', 'blurb']

// ---- 質問の正本（付録 A・第 9 版）。編集は docs/requirement/11-glossary-dialog.md と揃える。 ----

export const BASE_QUESTIONS: readonly DialogQuestion[] = [
  {
    key: 'name',
    section: '基本',
    label: '名前',
    q: 'まず、名前を教えてください。',
    vis: 'public-fixed',
    field: 'name',
    placeholder: '例：セト',
  },
  {
    key: 'reading',
    section: '基本',
    label: '読み',
    q: '読みがなはありますか。なければスキップで構いません。',
    vis: 'public-fixed',
    field: 'reading',
    placeholder: 'ひらがなで',
  },
  {
    key: 'aliases',
    section: '基本',
    label: '別名',
    q: '本文で使う別の呼び方はありますか。あだ名や肩書きなど、読点で区切ってください。',
    vis: 'public-fixed',
    field: 'aliases',
    placeholder: '例：部長、ミノさん',
  },
  {
    key: 'blurb',
    section: '基本',
    label: '公開情報',
    q: '読者に向けて、一言で紹介してください。「公開情報」の欄に入ります。',
    vis: 'public-fixed',
    field: 'summary',
    placeholder: 'この欄はコトノハ-grove- に出ます',
  },
]

export const DEEP_QUESTIONS: Readonly<Record<string, readonly DialogQuestion[]>> = {
  人物: [
    {
      key: 'title',
      section: 'プロフィール',
      label: '役職・肩書き',
      q: '{名前}の役職や肩書き、立場を教えてください。',
      vis: 'switch-public',
    },
    {
      key: 'age',
      section: 'プロフィール',
      label: '年齢',
      q: '{名前}の年齢か、年の頃を教えてください。',
      vis: 'switch-public',
    },
    {
      key: 'gender',
      section: 'プロフィール',
      label: '性別',
      q: '{名前}の性別を教えてください。',
      vis: 'switch-public',
      optional: true,
      choices: ['男', '女', 'その他'],
      free: true,
    },
    {
      key: 'birthday',
      section: 'プロフィール',
      label: '誕生日',
      q: '{名前}の誕生日はいつですか。',
      vis: 'switch-public',
      optional: true,
    },
    {
      key: 'blood',
      section: 'プロフィール',
      label: '血液型',
      q: '{名前}の血液型は。',
      vis: 'switch-public',
      optional: true,
      choices: ['A', 'B', 'O', 'AB', '不明'],
      free: true,
    },
    {
      key: 'origin',
      section: 'プロフィール',
      label: '出身',
      q: '{名前}はどこの出身ですか。',
      vis: 'switch-public',
      optional: true,
    },
    {
      key: 'history',
      section: 'プロフィール',
      label: '生い立ち・経歴',
      q: '{名前}の生い立ちや、これまでの経歴を教えてください。',
      vis: 'switch-public',
    },
    {
      key: 'personality',
      section: 'プロフィール',
      label: '個性',
      q: '{名前}の性格や個性を、一言で言うとどんな人ですか。',
      vis: 'switch-public',
    },
    {
      key: 'skill',
      section: 'プロフィール',
      label: '特技',
      q: '{名前}の特技や、得意なことはありますか。',
      vis: 'switch-public',
      dig: [
        { key: 'why', label: 'どうして身についたか', q: 'どうしてそれが得意になったのですか。' },
      ],
    },
    {
      key: 'looks',
      section: '見た目',
      label: '見た目の特徴',
      q: '{名前}の見た目の特徴を教えてください。体格、髪色や瞳、目に留まるところなど。',
      vis: 'switch',
      placeholder: '例：小柄で日に焼けている。左手の手袋を夏でも外さない',
    },
    {
      key: 'looks_wear',
      section: '見た目',
      label: '服装・持ち物',
      q: '{名前}のいつもの服装や、持ち歩いているものを教えてください。',
      vis: 'switch',
      placeholder: '例：制服のポケットに、いつも飴',
    },
    {
      key: 'habit',
      section: '見た目',
      label: '癖',
      q: '{名前}の表情や行動、身体の動作に出る癖などはありますか。',
      vis: 'switch',
      placeholder: '例：考えるとき、爪を噛む',
      dig: [{ key: 'why', label: 'どうして癖がついたか', q: 'どうしてその癖がついたのですか。' }],
    },
    {
      key: 'speech_first',
      section: '話し方',
      label: '一人称',
      q: '{名前}の一人称は何ですか。相手によって変わるなら、それも教えてください。',
      vis: 'switch',
      placeholder: '例：「俺」。母の前でだけ「僕」',
    },
    {
      key: 'speech_tone',
      section: '話し方',
      label: '語尾・口癖',
      q: '{名前}の語尾や口癖、敬語の使い方を教えてください。',
      vis: 'switch',
      placeholder: '例：語尾を切る。「……で、どうする」',
    },
    {
      key: 'speech_sample',
      section: '話し方',
      label: '台詞の見本',
      q: '{名前}らしい台詞を、ひとつ書いてください。',
      vis: 'switch',
      placeholder: '例：「先に行って。追いつくから」',
    },
    {
      key: 'value',
      section: '心の中',
      label: '譲れないもの',
      q: '{名前}の信条、こだわり、流儀など、譲れないものはありますか。',
      vis: 'switch',
      dig: [
        {
          key: 'why',
          label: 'きっかけ・理由',
          q: 'それを大切にするようになった、きっかけや理由はありますか。',
        },
      ],
    },
    {
      key: 'like',
      section: '心の中',
      label: '好きなこと',
      q: '{名前}の好きなこと、好きなものを教えてください。',
      vis: 'switch',
      dig: [{ key: 'why', label: 'どうして好きに', q: 'どうしてそれが好きになったのですか。' }],
    },
    {
      key: 'dislike',
      section: '心の中',
      label: '嫌いなこと',
      q: '{名前}の嫌いなこと、苦手なものを教えてください。',
      vis: 'switch',
      dig: [{ key: 'why', label: 'どうして嫌いに', q: 'どうしてそれが嫌いになったのですか。' }],
    },
    {
      key: 'fear',
      section: '心の中',
      label: '怖いもの',
      q: '{名前}がいちばん怖いものは何ですか。',
      vis: 'switch',
      dig: [{ key: 'why', label: 'どうして怖いのか', q: 'どうしてそれが怖くなったのですか。' }],
    },
    {
      key: 'flaw',
      section: '心の中',
      label: '欠点',
      q: '{名前}の欠点や、つい繰り返してしまう失敗はありますか。',
      vis: 'switch',
    },
    {
      key: 'gap',
      section: '心の中',
      label: 'ギャップ',
      q: '{名前}の見た目や評判と、中身が違うところはありますか。',
      vis: 'switch',
    },
    {
      key: 'pride',
      section: '心の中',
      label: '誇り',
      q: '{名前}が自分で誇りに思っていることは何ですか。',
      vis: 'switch',
      optional: true,
    },
    {
      key: 'daily',
      section: '暮らし',
      label: 'ふだんの一日',
      q: '{名前}のふだんの一日は、どんなふうに過ぎますか。',
      vis: 'switch',
    },
    {
      key: 'work',
      section: '暮らし',
      label: '仕事・役目の中身',
      q: '{名前}は何をして暮らしていますか。仕事や役目の中身を、具体的にひとつ。',
      vis: 'switch',
    },
    {
      key: 'trust',
      section: '関係',
      label: '信頼している相手',
      q: '{名前}が信頼している相手は誰ですか。[[名前]] と書くと用語集につながります。',
      vis: 'switch',
      placeholder: '例：[[神々廻 澪]]。妹だが、頭が上がらない',
    },
    {
      key: 'enemy',
      section: '関係',
      label: '敵対している相手',
      q: '{名前}と敵対している相手はいますか。[[名前]] で人物につながります。',
      vis: 'switch',
    },
    {
      key: 'rival',
      section: '関係',
      label: 'ライバル',
      q: '{名前}のライバルや、張り合う相手はいますか。',
      vis: 'switch',
    },
    {
      key: 'love',
      section: '関係',
      label: '恋愛',
      q: '{名前}が恋をしている相手や、恋人はいますか。[[名前]] で人物につながります。',
      vis: 'switch',
      optional: true,
    },
    {
      key: 'family',
      section: '関係',
      label: '家族',
      q: '{名前}に家族はいますか。どんな関係ですか。',
      vis: 'switch',
      optional: true,
    },
    {
      key: 'secret',
      section: '秘密',
      label: '秘密',
      q: '{名前}には、誰にも言えない秘密がありますか。',
      vis: 'private-fixed',
    },
    {
      key: 'memo',
      section: 'ほかに',
      label: 'ほかに',
      q: 'ほかに書き留めておきたい情報があれば、自由に記述してください。',
      vis: 'switch',
      optional: true,
    },
  ],
  場所: [
    {
      key: 'kind',
      section: 'プロフィール',
      label: '種類',
      q: '{名前}はどんな種類の場所ですか。',
      vis: 'switch-public',
      choices: ['街・町', '建物・部屋', '学校・職場', '自然', '国・地方', '乗り物・道中'],
    },
    {
      key: 'where',
      section: 'プロフィール',
      label: '所在',
      q: '{名前}はどこにあって、どうやって行きますか。',
      vis: 'switch-public',
    },
    {
      key: 'route',
      section: 'プロフィール',
      label: 'どこからどこへ',
      q: '{名前}はどこからどこへ向かいますか。',
      vis: 'switch-public',
      only: ['乗り物・道中'],
    },
    {
      key: 'founding',
      section: 'プロフィール',
      label: '成り立ち',
      q: '{名前}はどのようにしてできた場所ですか。いつ、誰が、なぜ。',
      vis: 'switch-public',
    },
    {
      key: 'name_origin',
      section: 'プロフィール',
      label: '名前の由来',
      q: '{名前}という名前の由来はありますか。',
      vis: 'switch-public',
      optional: true,
    },
    {
      key: 'looks',
      section: '姿',
      label: '外観・特徴',
      q: '{名前}の外観や特徴、規模、まわりの風景などを簡単に教えてください。',
      vis: 'switch',
    },
    {
      key: 'people',
      section: '人と決まり',
      label: '治安・雰囲気・人々',
      q: '{名前}の治安や雰囲気、そこにいる人々の過ごし方を教えてください。[[名前]] で人物につながります。',
      vis: 'switch',
    },
    {
      key: 'rule',
      section: '人と決まり',
      label: '決まり',
      q: '{名前}だけの決まり、戒律、法律、ルール、タブー、マナーなどはありますか。',
      vis: 'switch',
    },
    {
      key: 'secret',
      section: '秘密',
      label: '秘密',
      q: '{名前}について、読者に伏せていることはありますか。',
      vis: 'private-fixed',
    },
    {
      key: 'memo',
      section: 'ほかに',
      label: 'ほかに',
      q: 'ほかに書き留めておきたい情報があれば、自由に記述してください。',
      vis: 'switch',
      optional: true,
    },
  ],
  組織: [
    {
      key: 'kind',
      section: 'プロフィール',
      label: '種類',
      q: '{名前}はどんな種類の集まりですか。',
      vis: 'switch-public',
      choices: [
        '会社・店',
        '学校・部活・サークル',
        '役所・国・軍',
        '宗教・団体',
        '家族・仲間内',
        '裏の組織',
      ],
    },
    {
      key: 'purpose',
      section: 'プロフィール',
      label: '目的と始まり',
      q: '{名前}は何のための集まりで、どのように始まりましたか。',
      vis: 'switch-public',
    },
    {
      key: 'name_origin',
      section: 'プロフィール',
      label: '名前の由来',
      q: '{名前}という名前の由来はありますか。',
      vis: 'switch-public',
      optional: true,
    },
    {
      key: 'overview',
      section: 'プロフィール',
      label: '概要',
      q: '簡単に{名前}の概要を教えてください。',
      vis: 'switch-public',
    },
    {
      key: 'ranks',
      section: '顔ぶれ',
      label: '序列・役職',
      q: '{名前}に序列や役職などはありますか。',
      vis: 'switch',
    },
    {
      key: 'join',
      section: '顔ぶれ',
      label: '入り方・抜け方',
      q: '{名前}にはどうすれば入れますか。抜けるとどうなりますか。',
      vis: 'switch',
      optional: true,
    },
    {
      key: 'rule',
      section: '決まりと関係',
      label: '決まり',
      q: '{名前}の決まり、戒律、ルール、タブーなどはありますか。破ると何が起きますか。',
      vis: 'switch',
    },
    {
      key: 'relation',
      section: '決まりと関係',
      label: '対立と味方',
      q: '{名前}と対立している相手や、味方・後ろ盾はいますか。',
      vis: 'switch',
    },
    {
      key: 'reputation',
      section: '決まりと関係',
      label: '世間の見え方',
      q: '{名前}は世間からどう見られていますか。',
      vis: 'switch',
    },
    {
      key: 'teaching',
      section: '信じるもの',
      label: '教えと儀式',
      q: '{名前}の主な教えと、日々の行いや儀式を教えてください。',
      vis: 'switch',
      only: ['宗教・団体'],
    },
    {
      key: 'politics',
      section: '政治',
      label: '統治のしくみ',
      q: '{名前}の政治のしくみを教えてください。誰が、どうやって治めていますか。',
      vis: 'switch',
      only: ['役所・国・軍'],
    },
    {
      key: 'institution',
      section: '政治',
      label: '制度',
      q: '{名前}の法律、税、軍、身分などの制度はありますか。',
      vis: 'switch',
      only: ['役所・国・軍'],
    },
    {
      key: 'secret',
      section: '秘密',
      label: '秘密',
      q: '{名前}について、読者に伏せていることや、内側の火種はありますか。',
      vis: 'private-fixed',
    },
    {
      key: 'memo',
      section: 'ほかに',
      label: 'ほかに',
      q: 'ほかに書き留めておきたい情報があれば、自由に記述してください。',
      vis: 'switch',
      optional: true,
    },
  ],
  用語: [
    {
      key: 'kind',
      section: 'プロフィール',
      label: '種類',
      q: '{名前}はどんな種類の言葉ですか。',
      vis: 'switch-public',
      choices: [
        '言い回し・スラング',
        '制度・決まり',
        '技術・仕組み',
        '出来事・歴史',
        '物・素材',
        '概念・考え方',
      ],
    },
    {
      key: 'notation',
      section: 'プロフィール',
      label: '表記と読み',
      q: '{名前}の表記や読みに決まりはありますか。ルビを振りますか。略しますか。',
      vis: 'switch-public',
      placeholder: '例：初出だけルビ。以後は「帳」',
    },
    {
      key: 'meaning',
      section: 'プロフィール',
      label: '意味と例文',
      q: '{名前}は何を指す言葉ですか。厳密な範囲と、使い方の例文を教えてください。',
      vis: 'switch-public',
    },
    {
      key: 'who',
      section: '使われ方',
      label: '使う人と場面',
      q: '{名前}は誰が、どんな場面で使う言葉ですか。口にしてはいけない相手や場面があれば、それも。',
      vis: 'switch',
    },
    {
      key: 'origin',
      section: '使われ方',
      label: '由来と近い言葉',
      q: '{名前}の由来や、似た言葉・反対の言葉があれば教えてください。[[名前]] で用語につながります。',
      vis: 'switch',
      optional: true,
    },
    {
      key: 'effect',
      section: '仕組み',
      label: 'できること・できないこと',
      q: '{名前}で何ができて、何ができませんか。代償や条件があれば、それも。',
      vis: 'switch',
      only: ['技術・仕組み'],
    },
    {
      key: 'when',
      section: '出来事',
      label: 'いつ・どこで・誰が',
      q: '{名前}はいつ、どこで、誰が関わって起きましたか。作中の時間で。[[名前]] で場所や人物につながります。',
      vis: 'switch',
      placeholder: '例：物語の三十年前の冬、[[霧の湊]] で',
      only: ['出来事・歴史'],
    },
    {
      key: 'cause',
      section: '出来事',
      label: 'きっかけ',
      q: '{名前}のきっかけは何でしたか。',
      vis: 'switch',
      only: ['出来事・歴史'],
    },
    {
      key: 'what1',
      section: '出来事',
      label: 'まず',
      q: 'まず何が起きましたか。',
      vis: 'switch',
      only: ['出来事・歴史'],
    },
    {
      key: 'what2',
      section: '出来事',
      label: 'それから',
      q: 'それで、どうなりましたか。',
      vis: 'switch',
      only: ['出来事・歴史'],
    },
    {
      key: 'what3',
      section: '出来事',
      label: '最後に',
      q: '最後に、どう終わりましたか。',
      vis: 'switch',
      only: ['出来事・歴史'],
    },
    {
      key: 'told',
      section: '出来事',
      label: '語られ方',
      q: '{名前}は人々に、どう語り継がれていますか。',
      vis: 'switch',
      only: ['出来事・歴史'],
    },
    {
      key: 'misread',
      section: 'ずれ',
      label: 'よくある誤解',
      q: '{名前}について、よくある誤解や、作中でのずれはありますか。',
      vis: 'switch',
    },
    {
      key: 'secret',
      section: '秘密',
      label: '秘密',
      q: '{名前}について、読者に伏せていることはありますか。',
      vis: 'private-fixed',
    },
    {
      key: 'memo',
      section: 'ほかに',
      label: 'ほかに',
      q: 'ほかに書き留めておきたい情報があれば、自由に記述してください。',
      vis: 'switch',
      optional: true,
    },
  ],
  アイテム: [
    {
      key: 'kind',
      section: 'プロフィール',
      label: '種類',
      q: '{名前}はどんな種類の物ですか。',
      vis: 'switch-public',
      choices: [
        '道具・機械',
        '衣服・装身具',
        '書類・記録・データ',
        '食べ物・薬',
        '武器',
        '贈り物・形見',
      ],
    },
    {
      key: 'looks',
      section: 'プロフィール',
      label: '見た目と素材',
      q: '{名前}の見た目や素材、手触り、傷や銘などを簡単に教えてください。',
      vis: 'switch-public',
    },
    {
      key: 'content',
      section: 'プロフィール',
      label: '書いてあること',
      q: '{名前}には何が書いてありますか。誰が読めますか。',
      vis: 'switch-public',
      only: ['書類・記録・データ'],
    },
    {
      key: 'name_origin',
      section: 'プロフィール',
      label: '名前の由来',
      q: '{名前}という名前の由来はありますか。',
      vis: 'switch-public',
      optional: true,
    },
    {
      key: 'power',
      section: '力',
      label: 'できること・できないこと',
      q: '{名前}で何ができて、何ができませんか。使うための条件や代償があれば、それも。',
      vis: 'switch',
    },
    {
      key: 'origin',
      section: '来歴',
      label: '由来と持ち主の変遷',
      q: '{名前}は誰が、なぜ作り、これまで誰の手を渡ってきましたか。',
      vis: 'switch',
    },
    {
      key: 'gift',
      section: '来歴',
      label: '誰から誰へ',
      q: '{名前}は誰から誰へ渡されたものですか。どんな場面で。',
      vis: 'switch',
      only: ['贈り物・形見'],
    },
    {
      key: 'holder',
      section: '来歴',
      label: '今の持ち主',
      q: '{名前}はいま誰が持っていますか。欲しがっている人がいれば、それも。',
      vis: 'private-fixed',
      placeholder: '例：[[ユキ]] の鞄の底。本人は気づいていない',
    },
    {
      key: 'secret',
      section: '秘密',
      label: '秘密',
      q: '{名前}について、読者に伏せていることはありますか。',
      vis: 'private-fixed',
    },
    {
      key: 'memo',
      section: 'ほかに',
      label: 'ほかに',
      q: 'ほかに書き留めておきたい情報があれば、自由に記述してください。',
      vis: 'switch',
      optional: true,
    },
  ],
  生物: [
    {
      key: 'kind',
      section: 'プロフィール',
      label: '種類',
      q: '{名前}はどんな種類の生き物ですか。',
      vis: 'switch-public',
      choices: ['動物・ペット', '架空の生き物', '植物', '言葉を話す種族'],
    },
    {
      key: 'looks',
      section: 'プロフィール',
      label: '見た目と大きさ',
      q: '{名前}の見た目や大きさ、動きや声などを簡単に教えてください。',
      vis: 'switch-public',
    },
    {
      key: 'name_origin',
      section: 'プロフィール',
      label: '名前の由来',
      q: '{名前}という名前の由来はありますか。',
      vis: 'switch-public',
      optional: true,
    },
    {
      key: 'habitat',
      section: '生態',
      label: '棲みかと習性',
      q: '{名前}はどこに棲み、何を食べ、どう暮らしていますか。数や寿命も分かれば。',
      vis: 'switch',
    },
    {
      key: 'ability',
      section: '力と弱点',
      label: '人と違うところ・弱点',
      q: '{名前}の人と違う力や危ないところ、弱点はありますか。',
      vis: 'switch',
    },
    {
      key: 'encounter',
      section: '力と弱点',
      label: '出会うと',
      q: '{名前}に出会った人はどうなりますか。',
      vis: 'switch',
      only: ['架空の生き物'],
    },
    {
      key: 'human',
      section: '人との関わり',
      label: '人との関わり',
      q: '{名前}は人とどう関わっていますか。言い伝えや迷信があれば、それも。',
      vis: 'switch',
      only: ['動物・ペット', '架空の生き物', '植物'],
    },
    {
      key: 'life',
      section: '種族の暮らし',
      label: '暮らしと価値観',
      q: '{名前}はどこでどう暮らし、何を大切にしていますか。',
      vis: 'switch',
      only: ['言葉を話す種族'],
    },
    {
      key: 'relation',
      section: '種族の暮らし',
      label: '人との関係',
      q: '{名前}は人や、ほかの種族とどう付き合っていますか。',
      vis: 'switch',
      only: ['言葉を話す種族'],
    },
    {
      key: 'naming',
      section: '種族の暮らし',
      label: '言葉と名前',
      q: '{名前}の言葉や、名前の付け方に特徴はありますか。',
      vis: 'switch',
      optional: true,
      only: ['言葉を話す種族'],
    },
    {
      key: 'secret',
      section: '秘密',
      label: '秘密',
      q: '{名前}について、読者に伏せていることはありますか。',
      vis: 'private-fixed',
    },
    {
      key: 'memo',
      section: 'ほかに',
      label: 'ほかに',
      q: 'ほかに書き留めておきたい情報があれば、自由に記述してください。',
      vis: 'switch',
      optional: true,
    },
  ],
}

/** 「種類」の選択肢（分類ごと）。各分類の `kind` の問いから引く＝正本は DEEP_QUESTIONS ひとつ。 */
export const DIALOG_KINDS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(DEEP_QUESTIONS).flatMap(([cat, qs]) => {
    const kind = qs.find((q) => q.key === 'kind')
    return kind?.choices ? [[cat, kind.choices]] : []
  }),
)

export const NAME_FALLBACK: Readonly<Record<string, string>> = {
  人物: 'その人物',
  場所: 'その場所',
  組織: 'その集まり',
  用語: 'その言葉',
  アイテム: 'その物',
  生物: 'その生き物',
}

// ---- 質問の取り出し ----

/** 深掘りの問い（分類ごと）。分類が無い・知らない分類なら空。 */
export function deepQuestionsFor(category: string | undefined): readonly DialogQuestion[] {
  return DEEP_QUESTIONS[category?.trim() ?? ''] ?? []
}

/** 共通 4 問＋深掘り（枝の条件は解かない＝鍵の検証・一覧用）。 */
export function allQuestionsFor(category: string | undefined): readonly DialogQuestion[] {
  return [...BASE_QUESTIONS, ...deepQuestionsFor(category)]
}

/** 分類が対話の質問セットを持つか（旧データの自由入力分類や未分類は持たない）。 */
export function hasDialogQuestions(category: string | undefined): boolean {
  return deepQuestionsFor(category).length > 0
}

export function isDigQuestion(q: AnyDialogQuestion): q is DialogDigQuestion {
  return (q as DialogDigQuestion).isDig === true
}

/** 親の追い質問を、親と同じ公開の扱い・まとまりの質問として返す（鍵は `親__子`）。 */
export function digQuestionsOf(parent: DialogQuestion): DialogDigQuestion[] {
  return (parent.dig ?? []).map((d) => ({
    key: `${parent.key}__${d.key}`,
    section: parent.section,
    label: d.label,
    q: d.q,
    vis: parent.vis,
    ...(d.placeholder ? { placeholder: d.placeholder } : {}),
    isDig: true,
    parentKey: parent.key,
  }))
}

/** 鍵から問いを引く（追い質問も含む）。無ければ undefined。 */
const questionIndexCache = new Map<string, Map<string, AnyDialogQuestion>>()

/** 分類ごとの「鍵 → 問い」の索引（追い質問も含む）。質問セットは不変なので分類ごとに 1 回だけ作る。 */
export function questionIndexFor(category: string | undefined): Map<string, AnyDialogQuestion> {
  const cat = category?.trim() ?? ''
  const hit = questionIndexCache.get(cat)
  if (hit) return hit
  const index = new Map<string, AnyDialogQuestion>()
  for (const q of allQuestionsFor(cat)) {
    index.set(q.key, q)
    for (const d of digQuestionsOf(q)) index.set(d.key, d)
  }
  questionIndexCache.set(cat, index)
  return index
}

/** 鍵から問いを引く（追い質問も含む）。無ければ undefined。 */
export function questionByKey(
  category: string | undefined,
  key: string,
): AnyDialogQuestion | undefined {
  return questionIndexFor(category).get(key)
}

type EntryLike = Pick<
  GlossaryEntry,
  'name' | 'reading' | 'aliases' | 'summary' | 'body' | 'category' | 'dialog'
>

/**
 * 既存の欄＋対話ノートを、答えの形にそろえて見る。共通 4 問は欄から起こす（読者に見える欄＝public）。
 * 欄が空なら鍵ごと無い＝未回答。
 */
export function answersOf(entry: EntryLike): Record<string, DialogAnswer> {
  const a: Record<string, DialogAnswer> = { ...(entry.dialog ?? {}) }
  for (const key of Object.keys(LEGACY_FOLDS)) {
    const folded = answerOf(entry.dialog, key)
    if (folded !== undefined) a[key] = folded
  }
  if (entry.name.trim() !== '') a.name = { text: entry.name, public: true }
  if (entry.reading?.trim()) a.reading = { text: entry.reading, public: true }
  if (entry.aliases.length > 0) a.aliases = { text: entry.aliases.join('、'), public: true }
  const pub = publicTextOf(entry)
  if (pub !== '') a.blurb = { text: pub, public: true }
  return a
}

/** 選択肢だけの問い（種類）で、答えが今の選択肢に無い（分類を変えたあとの持ち越し）。 */
export function answerOutOfChoices(
  q: Pick<AnyDialogQuestion, 'choices' | 'free'>,
  a: Pick<DialogAnswer, 'text'> | undefined,
): boolean {
  if (!q.choices || q.free || !a) return false
  const t = a.text.trim()
  return t !== '' && !q.choices.includes(t)
}

/**
 * 「種類」の答え（枝の条件に使う）。分類を変えて持ち越した、今の分類の選択肢に無い答えは
 * 無いものとして扱う＝種類を聞き直し、枝の問いが埋もれない。
 */
export function kindOf(entry: Pick<GlossaryEntry, 'dialog' | 'category'>): string | undefined {
  const t = entry.dialog?.kind?.text?.trim()
  if (!t) return undefined
  const choices = DIALOG_KINDS[entry.category?.trim() ?? '']
  return choices?.includes(t) ? t : undefined
}

/** 種類の枝を解いた、いま有効な問いの列（共通 4 問を含む）。 */
export function activeQuestionsFor(entry: EntryLike): DialogQuestion[] {
  const kind = kindOf(entry)
  return allQuestionsFor(entry.category).filter(
    (q) => !q.only || (kind !== undefined && q.only.includes(kind)),
  )
}

/** いま有効な深掘りの問い（共通 4 問を除く）。 */
export function activeDeepQuestionsFor(entry: EntryLike): DialogQuestion[] {
  return activeQuestionsFor(entry).filter((q) => q.field === undefined)
}

/**
 * 新規の下書きで共通 4 問を「スキップ／あとで」にした印。答えが欄に入らないので `dialog` では
 * 表せない。登録するまでの一時的な状態で、保存はしない。既存の項目では使わない。
 */
export type BaseMarks = Readonly<Record<string, 'skipped' | 'later' | undefined>>

export interface AnsweredOptions {
  /**
   * 共通 4 問（名前・読み・別名・公開情報）も対話で聞くか。新しく作った項目では聞き、
   * 既存の項目は聞かない（D-DLG-EXISTING）＝答え済みとして扱う。
   */
  askBase?: boolean
  baseMarks?: BaseMarks
}

/** 答え済みか（スキップも「済み」。あとでは未回答）。 */
export function isAnswered(
  entry: EntryLike,
  q: AnyDialogQuestion,
  opts: AnsweredOptions = {},
): boolean {
  if (q.field !== undefined) {
    if (!opts.askBase) return true
    if (answersOf(entry)[q.key] !== undefined) return true
    return opts.baseMarks?.[q.key] === 'skipped'
  }
  const a = answerOf(entry.dialog, q.key)
  if (a === undefined) return false
  if (a.skipped === true) return true
  return a.text.trim() !== '' && !answerOutOfChoices(q, a)
}

/** 「あとで答える」にしたままか。 */
export function isLater(
  entry: EntryLike,
  q: AnyDialogQuestion,
  opts: AnsweredOptions = {},
): boolean {
  if (q.field !== undefined) return opts.askBase === true && opts.baseMarks?.[q.key] === 'later'
  const a = answerOf(entry.dialog, q.key)
  return a !== undefined && a.later === true && a.text.trim() === ''
}

/** 次に聞く問い（未回答で、あとでにもしていない最初の問い）。無ければ undefined。 */
export function nextQuestion(
  entry: EntryLike,
  opts: AnsweredOptions = {},
): DialogQuestion | undefined {
  return activeQuestionsFor(entry).find(
    (q) => !isAnswered(entry, q, opts) && !isLater(entry, q, opts),
  )
}

export type DialogStatus = 'none' | 'inProgress' | 'done'

export interface DialogProgress {
  /** 基本の問いのうち答え済み（スキップ含む）。 */
  done: number
  /** 基本の問いの数（任意は数えない・D-DLG-SKIP）。 */
  total: number
  /** 「あとで」のままの問いの数（任意も数える）。 */
  later: number
}

export interface DialogSummary {
  status: DialogStatus
  progress: DialogProgress
}

/**
 * 一覧・見出し・対話ノートが使う状態と進み具合を 1 回の走査で返す（項目ごとに何度も歩かない）。
 * progress は深掘りの基本の問いだけで数える（共通 4 問・任意の問いは数に入れない・D-DLG-SKIP）。
 * status（D-DLG-LIST）：none＝手を付けていない、または分類に質問セットが無い（未分類・旧データの
 * 自由入力。答えが残っていても分類を選び直せば戻る）／inProgress＝途中／done＝ひと通り答えた
 * （任意の問いも答えるかスキップしてあり、あとでも残っていない）。
 */
export function dialogSummaryOf(entry: EntryLike): DialogSummary {
  const deep = activeDeepQuestionsFor(entry)
  let done = 0
  let total = 0
  let later = 0
  let pending = false
  for (const q of deep) {
    const answered = isAnswered(entry, q)
    const isLaterQ = !answered && isLater(entry, q)
    if (isLaterQ) later += 1
    if (!answered && !isLaterQ) pending = true
    if (!q.optional) {
      total += 1
      if (answered) done += 1
    }
    // 追い質問の「あとで」も数える（本流には無いので、ここで拾わないと取り残される）。
    for (const d of digQuestionsOf(q)) if (isLater(entry, d)) later += 1
  }
  const progress = { done, total, later }
  if (!dialogStarted(entry) || !hasDialogQuestions(entry.category)) {
    return { status: 'none', progress }
  }
  return { status: !pending && later === 0 ? 'done' : 'inProgress', progress }
}

/**
 * 「あとで答える」のままの問い（本流の問いと、答えた親の追い質問）。まとめ・選び直し・再開で
 * 一覧にする。追い質問は本流に無いので、ここで拾わないと二度と聞かれない。
 */
export function laterQuestionsOf(
  entry: EntryLike,
  opts: AnsweredOptions = {},
): AnyDialogQuestion[] {
  const out: AnyDialogQuestion[] = []
  for (const q of activeQuestionsFor(entry)) {
    if (isLater(entry, q, opts)) out.push(q)
    for (const d of digQuestionsOf(q)) if (isLater(entry, d, opts)) out.push(d)
  }
  return out
}

/** 対話を始めているか（対話ノートに何か入っている）。 */
export function dialogStarted(entry: Pick<GlossaryEntry, 'dialog'>): boolean {
  return Object.keys(entry.dialog ?? {}).length > 0
}

/** ボットが呼びかける名前。未入力なら分類ごとの言い換え（D-DLG-NAME）。 */
export function resolveName(entry: Pick<GlossaryEntry, 'name' | 'category'>): string {
  const n = entry.name.trim()
  if (n !== '') return n
  return NAME_FALLBACK[entry.category?.trim() ?? ''] ?? 'それ'
}

/** ボットの言葉（名前を差し込み、任意の問いには「（任意）」を添える）。 */
export function questionText(
  q: AnyDialogQuestion,
  entry: Pick<GlossaryEntry, 'name' | 'category'>,
): string {
  const text = q.q.replace(/\{名前\}/g, resolveName(entry))
  return q.optional ? `${text}（任意）` : text
}

/** 公開の既定（D-DLG-VIS）。 */
export function defaultPublic(q: Pick<AnyDialogQuestion, 'vis'>): boolean {
  return q.vis === 'public-fixed' || q.vis === 'switch-public'
}

/** 切り替えられない（共通 4 問・秘密）。 */
export function isFixedVisibility(q: Pick<AnyDialogQuestion, 'vis'>): boolean {
  return q.vis === 'public-fixed' || q.vis === 'private-fixed'
}

/** この答えを読者に見せるか（固定なら固定値・省略なら既定）。 */
export function answerPublic(
  q: Pick<AnyDialogQuestion, 'vis'>,
  a: Pick<DialogAnswer, 'public'> | undefined,
): boolean {
  if (isFixedVisibility(q)) return q.vis === 'public-fixed'
  return a?.public ?? defaultPublic(q)
}

/** 別名入力（カンマ／読点／改行区切り）を配列へ。trim・空除去・重複除去（画面の parseAliases と同じ規則）。 */
export function parseAliasInput(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,、\n]/)) {
    const a = part.trim()
    if (a !== '' && !out.includes(a)) out.push(a)
  }
  return out
}

/** 対話ノートを 1 鍵ぶん書き換えた項目を返す（`dialogVersion` を現在の版に揃える）。空の record は持たない。 */
function withDialogRecord(
  entry: GlossaryEntry,
  dialog: Record<string, DialogAnswer>,
): GlossaryEntry {
  const { dialog: _d, dialogVersion: _v, ...rest } = entry
  if (Object.keys(dialog).length === 0) return rest
  return { ...rest, dialog, dialogVersion: DIALOG_VERSION }
}

/** 固定の公開扱いなら `public` を持たせない（読み出しは answerPublic が固定値にする）。 */
function normalizeAnswer(q: Pick<AnyDialogQuestion, 'vis'>, a: DialogAnswer): DialogAnswer {
  const out: DialogAnswer = { text: a.text }
  if (!isFixedVisibility(q) && a.public !== undefined) out.public = a.public
  if (a.skipped) out.skipped = true
  if (a.later) out.later = true
  return out
}

/**
 * 1 問の答えを項目へ入れる（画面の対話ペインが使う）。共通 4 問は既存の欄へ、深掘りは `dialog` へ。
 * 共通 4 問のスキップ／あとでは欄を変えない（印は BaseMarks の責務）。
 */
export function withDialogAnswer(
  entry: GlossaryEntry,
  q: AnyDialogQuestion,
  answer: DialogAnswer,
): GlossaryEntry {
  if (q.field !== undefined) {
    if (answer.skipped || answer.later) return entry
    const text = answer.text.trim()
    switch (q.field) {
      case 'name':
        return { ...entry, name: text }
      case 'reading':
        return text === '' ? omit(entry, 'reading') : { ...entry, reading: text }
      case 'aliases':
        return { ...entry, aliases: parseAliasInput(text) }
      case 'summary':
        // 公開情報は 1 欄（D-GLOS-PUBLIC-ONE）＝旧・詳細は畳む。
        return withPublicText(entry, text)
    }
  }
  const record = { ...(entry.dialog ?? {}), [q.key]: normalizeAnswer(q, answer) }
  withoutLegacyOf(record, q.key)
  return withDialogRecord(entry, record)
}

/** 鍵の答えを消す（畳んで読んでいた旧鍵も一緒に消す）。無ければ同じ参照。 */
export function withoutDialogAnswer(entry: GlossaryEntry, key: string): GlossaryEntry {
  if (answerOf(entry.dialog, key) === undefined) return entry
  const record = { ...(entry.dialog ?? {}) }
  delete record[key]
  withoutLegacyOf(record, key)
  return withDialogRecord(entry, record)
}

function omit<K extends keyof GlossaryEntry>(entry: GlossaryEntry, key: K): GlossaryEntry {
  const { [key]: _drop, ...rest } = entry
  return rest as GlossaryEntry
}

/** 答えの「読者に見せる／作者だけ」を切り替える（固定の問いや未回答は何もしない）。 */
export function toggleAnswerPublic(entry: GlossaryEntry, key: string): GlossaryEntry {
  const q = questionByKey(entry.category, key)
  const a = answerOf(entry.dialog, key)
  if (!q || !a || isFixedVisibility(q) || a.text.trim() === '') return entry
  const record = { ...(entry.dialog ?? {}), [key]: { ...a, public: !answerPublic(q, a) } }
  withoutLegacyOf(record, key)
  return withDialogRecord(entry, record)
}

/**
 * 「読者に見せる」の答えから公開情報の下書きを作る（D-DLG-PUBLISH）。
 * 今の公開情報を先頭に、見出し：答え を 1 行ずつ。追い質問は親の直後に「↳」で。
 */
export function draftSummaryFromDialog(entry: EntryLike): string {
  const parts: string[] = []
  const pub = publicTextOf(entry)
  if (pub !== '') parts.push(pub)
  // 一度入れた答えはもう公開情報にある＝二度目の下書きで同じ答え（複数行でも）を重ねない。
  for (const q of activeDeepQuestionsFor(entry)) {
    for (const x of [q, ...digQuestionsOf(q)]) {
      const a = answerOf(entry.dialog, x.key)
      if (!a || a.text.trim() === '' || !answerPublic(x, a) || answerOutOfChoices(x, a)) continue
      const line = `${isDigQuestion(x) ? '↳ ' : ''}${x.label}：${a.text.trim()}`
      if (!pub.includes(line)) parts.push(line)
    }
  }
  return parts.join('\n')
}

/**
 * 対話ノートの鍵ごとの差分（変わった鍵だけ。消えた鍵は null）。画面の対話ペインが「答えた鍵だけ」を
 * 保存するために使う＝store が最新の record に重ねる（同期や MCP で増えた他の鍵を巻き込まない）。
 */
export function dialogRecordDiff(
  prev: Record<string, DialogAnswer> | undefined,
  next: Record<string, DialogAnswer> | undefined,
): Record<string, DialogAnswer | null> {
  const before = prev ?? {}
  const after = next ?? {}
  const out: Record<string, DialogAnswer | null> = {}
  for (const [key, a] of Object.entries(after)) {
    const b = before[key]
    if (
      !b ||
      b.text !== a.text ||
      b.public !== a.public ||
      b.skipped !== a.skipped ||
      b.later !== a.later
    ) {
      out[key] = a
    }
  }
  for (const key of Object.keys(before)) if (!(key in after)) out[key] = null
  return out
}

// ---- MCP と画面が共用するパッチ規則（§5.2） ----

export class DialogPatchError extends Error {}

/** 鍵ごとの値。文字列＝答え（空文字は削除）／object＝答えと公開の扱い。 */
export type DialogPatchValue = string | { text: string; public?: boolean }
export type DialogPatch = Record<string, DialogPatchValue>

/**
 * 対話ノートのパッチ（渡した鍵だけ書き換える。省略＝据え置き・空文字＝削除）。
 * - 未知の鍵・共通 4 問の鍵はエラー（誤字で答えが迷子にならないため）。
 * - `kind` は分類の選択肢のいずれか。それ以外はエラー。
 * - `public` を省略した新規の答えは既定、既存の答えは据え置き。固定の問いでは無視する（エラーにしない）。
 * - 分類が質問セットを持たなければエラー（先に category を付ける）。
 */
export function applyDialogPatch(entry: GlossaryEntry, patch: DialogPatch): GlossaryEntry {
  const keys = Object.keys(patch)
  if (keys.length === 0) return entry
  const category = entry.category?.trim() ?? ''
  const hasQuestions = hasDialogQuestions(category)
  const textOf = (v: DialogPatchValue | undefined) =>
    typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : undefined
  const next: Record<string, DialogAnswer> = { ...(entry.dialog ?? {}) }
  for (const key of keys) {
    // 削除（空文字）。残っている鍵は旧鍵・枝から外れた鍵でも消せる（分類に質問セットが無くても）。
    // 無い鍵を消すときだけ、誤字と共通 4 問の鍵を検める（消したつもりで残る事故を防ぐ）。
    if (textOf(patch[key])?.trim() === '') {
      if (key in next) {
        delete next[key]
        continue
      }
      if (BASE_KEYS.includes(key)) {
        throw new DialogPatchError(
          `dialog の鍵「${key}」は使えません。名前・読み・別名・公開情報は name／reading／aliases／summary で渡してください`,
        )
      }
      if (hasQuestions && !questionByKey(category, key)) {
        throw new DialogPatchError(
          `dialog の鍵「${key}」は分類「${category}」にありません。有効な鍵は get_glossary_questions で確認してください`,
        )
      }
      continue
    }
    if (!hasQuestions) {
      throw new DialogPatchError(
        `分類「${category || '未分類'}」には対話の質問がありません。category を ${DIALOG_CATEGORIES.join('／')} のいずれかにしてください`,
      )
    }
    if (BASE_KEYS.includes(key)) {
      throw new DialogPatchError(
        `dialog の鍵「${key}」は使えません。名前・読み・別名・公開情報は name／reading／aliases／summary で渡してください`,
      )
    }
    const q = questionByKey(category, key)
    if (!q) {
      throw new DialogPatchError(
        `dialog の鍵「${key}」は分類「${category}」にありません。有効な鍵は get_glossary_questions で確認してください`,
      )
    }
    const raw = patch[key]
    const value = typeof raw === 'string' ? { text: raw } : raw
    if (value === undefined || typeof value.text !== 'string') {
      throw new DialogPatchError(`dialog の「${key}」は文字列か { text, public } で渡してください`)
    }
    const text = value.text.trim()
    if (q.choices && !q.free && !q.choices.includes(text)) {
      throw new DialogPatchError(
        `「${q.label}」（${key}）は ${q.choices.join('／')} のいずれかです（「${text}」は選べません）`,
      )
    }
    const prev = next[key]
    const pub = value.public ?? prev?.public
    next[key] = normalizeAnswer(q, { text, ...(pub !== undefined ? { public: pub } : {}) })
  }
  return withDialogRecord(entry, next)
}

// ---- 平文（MCP の get_glossary / get_glossary_questions） ----

const VIS_LABEL: Record<DialogVisibility, string> = {
  'public-fixed': '読者に見える欄（固定）',
  'switch-public': '読者に見せる（既定）→ 作者だけに戻せる',
  switch: '作者だけ（既定）→ 読者に見せるへ切り替え可',
  'private-fixed': '作者だけ（固定）',
}

/**
 * 1 項目の対話ノートを平文にする（get_glossary の出力・§5.1）。対話を始めていなければ空文字。
 * 鍵・見出し・公開の扱い・答えを 1 行ずつ。スキップ／あとでの鍵は末尾にまとめる。
 * 質問セットから消えた鍵の答えは「（旧）」として残す（§2）。
 */
export function dialogToPlainText(entry: EntryLike & Pick<GlossaryEntry, 'dialogVersion'>): string {
  const dialog = entry.dialog
  if (!dialog || Object.keys(dialog).length === 0) return ''
  // 見出しに「非公開」を添える＝作者メモと同じく、コピーした先で公開の器と混ざらない。
  const lines: string[] = [`対話ノート（非公開・v${entry.dialogVersion ?? '?'}）:`]
  if (!hasDialogQuestions(entry.category)) {
    // 分類に質問セットが無い（未分類・旧データの自由入力）。答えは残っているが、鍵の意味は
    // 分類を付けるまで引けない＝旧鍵と混同させない案内を先頭に置く。
    lines.push(
      `  （分類「${entry.category?.trim() || '未分類'}」には質問セットがありません。category を ${DIALOG_CATEGORIES.join('／')} のいずれかにすると、答えが問いに結びつきます）`,
    )
    for (const [key, a] of Object.entries(dialog)) {
      if (a.text.trim() === '') continue
      // 公開の既定は問いごとに決まる＝分類が無いあいだは「既定」としか言えない。
      const vis =
        a.public === undefined
          ? '公開の既定（分類を付けてから決まる）'
          : a.public
            ? '読者に見せる'
            : '作者だけ'
      lines.push(`  ${key} [${vis}]: ${a.text.trim()}`)
    }
    return lines.join('\n')
  }
  const seen = new Set<string>()
  const skipped: string[] = []
  const later: string[] = []
  const line = (q: AnyDialogQuestion, a: DialogAnswer) => {
    seen.add(q.key)
    if (a.text.trim() === '') {
      if (a.later) later.push(q.key)
      else if (a.skipped) skipped.push(q.key)
      return
    }
    const vis = isFixedVisibility(q)
      ? `${answerPublic(q, a) ? '読者に見せる' : '作者だけ'}・固定`
      : answerPublic(q, a)
        ? '読者に見せる'
        : '作者だけ'
    lines.push(`  ${q.key} ${isDigQuestion(q) ? '↳' : ''}${q.label} [${vis}]: ${a.text.trim()}`)
  }
  for (const q of activeDeepQuestionsFor(entry)) {
    for (const x of [q, ...digQuestionsOf(q)]) {
      const a = answerOf(dialog, x.key)
      if (a && !answerOutOfChoices(x, a)) line(x, a)
    }
  }
  // 今の問いに畳んで出した旧鍵は、もう出さない。
  for (const k of foldedLegacyKeys(dialog)) seen.add(k)
  // いま有効な問いに無い答え：種類を変えて枝から外れたもの（今の種類では聞かない）と、
  // 質問セットから消えた鍵（旧）。どちらも現役の答えと区別できる印を付ける。
  for (const [key, a] of Object.entries(dialog)) {
    if (seen.has(key)) continue
    if (a.text.trim() === '') {
      // 枝から外れた問いのスキップ／あとでも印として残す（画面の「あとで」の数と食い違わない）。
      if (a.later) later.push(key)
      else if (a.skipped) skipped.push(key)
      continue
    }
    const q = questionByKey(entry.category, key)
    const label = !q
      ? `${LEGACY_LABELS[key] ?? ''}（旧・今の質問セットに無い鍵）`
      : answerOutOfChoices(q, a)
        ? `${q.label}（今の分類の選択肢に無い答え・聞き直す）`
        : `${q.label}（今の種類では聞かない問い）`
    const vis = q ? (answerPublic(q, a) ? '読者に見せる' : '作者だけ') : '作者だけ'
    lines.push(`  ${key} ${label} [${vis}]: ${a.text.trim()}`)
  }
  const tail: string[] = []
  if (skipped.length > 0) tail.push(`スキップ: ${skipped.join(', ')}`)
  if (later.length > 0) tail.push(`あとで: ${later.join(', ')}`)
  if (tail.length > 0) lines.push(`  （${tail.join(' ／ ')}）`)
  return lines.join('\n')
}

/**
 * 質問セットの平文（get_glossary_questions・§5.4）。分類を省略すると全分類。
 * LLM はこれを読んでから upsert_glossary_entry の dialog を組む。名前は「（名前）」の印のまま。
 */
export function questionsToPlainText(category?: string): string {
  const cats = category ? [category.trim()] : [...DIALOG_CATEGORIES]
  const out: string[] = [
    `# 用語集の対話の質問（v${DIALOG_VERSION}）`,
    '共通 4 問（名前・読み・別名・公開情報）は upsert_glossary_entry の name／reading／aliases／summary で渡す。深掘りの答えは dialog の鍵ごとに渡す（文字列＝答え・空文字＝削除・{ text, public } で公開の扱いも指定）。',
    '「種類」（kind）の答えでだけ出る枝の問いがある。世界全体の決め事（税制・宗教の全体像など、名前のない設定）は用語集ではなく set_world_note へ。',
  ]
  for (const cat of cats) {
    const qs = deepQuestionsFor(cat)
    if (qs.length === 0) {
      out.push(
        `\n## ${cat}\n（この分類には対話の質問がありません。分類は ${DIALOG_CATEGORIES.join('／')}）`,
      )
      continue
    }
    const lines: string[] = [`\n## ${cat}`]
    let section = ''
    for (const q of qs) {
      if (q.section !== section) {
        section = q.section
        lines.push(`### ${section}`)
      }
      const meta = [
        q.optional ? '任意' : '基本',
        VIS_LABEL[q.vis],
        q.choices
          ? `選択肢: ${q.choices.join('／')}${q.free ? '（自由記述も可）' : ''}`
          : '自由記述',
        q.only ? `条件: kind が ${q.only.join('／')} のとき` : '',
      ].filter(Boolean)
      lines.push(
        `- ${q.key}｜${q.label}｜${q.q.replace(/\{名前\}/g, '（名前）')}｜${meta.join('・')}`,
      )
      for (const d of digQuestionsOf(q)) {
        lines.push(`  - ${d.key}｜↳${d.label}｜${d.q}｜追い質問（公開の扱いは親と同じ）`)
      }
    }
    out.push(lines.join('\n'))
  }
  return out.join('\n')
}
