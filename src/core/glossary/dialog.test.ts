import { describe, expect, it } from 'vitest'
import { type GlossaryEntry, GlossaryEntrySchema } from '../schema'
import {
  activeDeepQuestionsFor,
  activeQuestionsFor,
  allQuestionsFor,
  answerPublic,
  answersOf,
  applyDialogPatch,
  BASE_QUESTIONS,
  DEEP_QUESTIONS,
  DIALOG_CATEGORIES,
  DIALOG_KINDS,
  DIALOG_VERSION,
  DialogPatchError,
  dialogRecordDiff,
  dialogSummaryOf,
  dialogToPlainText,
  digQuestionsOf,
  draftSummaryFromDialog,
  isAnswered,
  isLater,
  kindOf,
  laterQuestionsOf,
  nextQuestion,
  questionByKey,
  questionsToPlainText,
  questionText,
  resolveName,
  toggleAnswerPublic,
  withDialogAnswer,
} from './dialog'

function entry(p: Partial<GlossaryEntry> & { name: string }): GlossaryEntry {
  return {
    id: p.id ?? 'g1',
    name: p.name,
    aliases: p.aliases ?? [],
    category: p.category,
    reading: p.reading,
    summary: p.summary,
    body: p.body,
    authorNote: p.authorNote,
    dialog: p.dialog,
    dialogVersion: p.dialogVersion,
    createdAt: 0,
    updatedAt: 0,
  }
}

const baseQ = (key: string) => {
  const q = BASE_QUESTIONS.find((x) => x.key === key)
  if (!q) throw new Error(`共通の問い ${key} が無い`)
  return q
}

describe('質問の正本（付録 A と揃う）', () => {
  it('6 分類すべてに質問セットがあり、鍵は分類内で一意', () => {
    for (const cat of DIALOG_CATEGORIES) {
      const qs = allQuestionsFor(cat)
      expect(qs.length).toBeGreaterThan(BASE_QUESTIONS.length)
      const keys = qs.flatMap((q) => [q.key, ...digQuestionsOf(q).map((d) => d.key)])
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('人物以外は最初に「種類」を聞き、選択肢は DIALOG_KINDS と同じ', () => {
    for (const cat of DIALOG_CATEGORIES) {
      const first = DEEP_QUESTIONS[cat]?.[0]
      if (cat === '人物') {
        expect(first?.key).toBe('title')
        continue
      }
      expect(first?.key).toBe('kind')
      expect(first?.choices).toEqual(DIALOG_KINDS[cat])
      expect(first?.free).toBeUndefined()
    }
  })

  it('追い質問は人物の 6 問だけ（D-DLG-DIG）', () => {
    const withDig = DIALOG_CATEGORIES.flatMap((cat) =>
      (DEEP_QUESTIONS[cat] ?? [])
        .filter((q) => (q.dig ?? []).length > 0)
        .map((q) => `${cat}:${q.key}`),
    )
    expect(withDig).toEqual([
      '人物:skill',
      '人物:habit',
      '人物:value',
      '人物:like',
      '人物:dislike',
      '人物:fear',
    ])
  })

  it('秘密は作者だけ（固定）、プロフィールのまとまりは読者に見せるが既定', () => {
    for (const cat of DIALOG_CATEGORIES) {
      for (const q of DEEP_QUESTIONS[cat] ?? []) {
        if (q.key === 'secret') expect(q.vis).toBe('private-fixed')
        if (q.section === 'プロフィール' && q.vis !== 'private-fixed') {
          expect(q.vis).toBe('switch-public')
        }
      }
    }
    expect(answerPublic({ vis: 'switch-public' }, undefined)).toBe(true)
    expect(answerPublic({ vis: 'switch' }, undefined)).toBe(false)
    expect(answerPublic({ vis: 'switch' }, { public: true })).toBe(true)
    // 固定は保存された public を無視する
    expect(answerPublic({ vis: 'private-fixed' }, { public: true })).toBe(false)
    expect(answerPublic({ vis: 'public-fixed' }, { public: false })).toBe(true)
  })

  it('分類を変えて持ち越した「種類」は今の選択肢に無ければ未回答扱い＝聞き直し、下書き・平文にも載せない', () => {
    const moved = entry({
      name: '王都',
      category: '組織',
      dialog: { kind: { text: '街・町', public: true } },
    })
    expect(kindOf(moved)).toBeUndefined()
    expect(nextQuestion(moved)?.key).toBe('kind')
    expect(dialogSummaryOf(moved).status).toBe('inProgress')
    expect(draftSummaryFromDialog(moved)).toBe('')
    expect(dialogToPlainText({ ...moved, dialogVersion: 1 })).toContain(
      'kind 種類（今の分類の選択肢に無い答え・聞き直す） [読者に見せる]: 街・町',
    )
    const fixed = applyDialogPatch(moved, { kind: '役所・国・軍' })
    expect(kindOf(fixed)).toBe('役所・国・軍')
    expect(activeQuestionsFor(fixed).map((q) => q.key)).toContain('politics')
  })

  it('種類の枝は only で結びつく（組織の政治は 役所・国・軍 のときだけ）', () => {
    const org = entry({ name: '王国', category: '組織' })
    expect(activeQuestionsFor(org).map((q) => q.key)).not.toContain('politics')
    const kingdom = { ...org, dialog: { kind: { text: '役所・国・軍' } } }
    expect(activeQuestionsFor(kingdom).map((q) => q.key)).toContain('politics')
    expect(activeQuestionsFor(kingdom).map((q) => q.key)).not.toContain('teaching')
  })
})

describe('答えの読み書き', () => {
  it('answersOf は既存の欄を共通 4 問の答えとして起こす（旧・詳細も結合）', () => {
    const a = answersOf(
      entry({
        name: 'セト',
        reading: 'せと',
        aliases: ['案内人'],
        summary: '案内人。',
        body: '旧',
      }),
    )
    expect(a.name).toEqual({ text: 'セト', public: true })
    expect(a.reading?.text).toBe('せと')
    expect(a.aliases?.text).toBe('案内人')
    expect(a.blurb?.text).toBe('案内人。\n\n旧')
    expect(answersOf(entry({ name: '' })).name).toBeUndefined()
  })

  it('既存の項目は共通 4 問を答え済みとして扱い、深掘りから始まる（D-DLG-EXISTING）', () => {
    const e = entry({ name: 'セト', category: '人物' })
    expect(nextQuestion(e)?.key).toBe('title')
    // 下書きは名前から
    expect(nextQuestion(e, { draft: true })?.key).toBe('reading')
    expect(nextQuestion(entry({ name: '', category: '人物' }), { draft: true })?.key).toBe('name')
    // 下書きのスキップは印で表す
    expect(
      nextQuestion(entry({ name: '', category: '人物' }), {
        draft: true,
        baseMarks: { name: 'skipped', reading: 'skipped', aliases: 'skipped', blurb: 'later' },
      })?.key,
    ).toBe('title')
  })

  it('withDialogAnswer は共通 4 問を欄へ、深掘りを dialog へ入れ、固定の public は持たない', () => {
    const base = entry({ name: '', category: 'アイテム' })
    const named = withDialogAnswer(base, baseQ('name'), { text: ' 帳 ' })
    expect(named.name).toBe('帳')
    expect(named.dialog).toBeUndefined()
    const aliased = withDialogAnswer(named, baseQ('aliases'), { text: '帳面、ちょう' })
    expect(aliased.aliases).toEqual(['帳面', 'ちょう'])
    const kindQ = questionByKey('アイテム', 'kind')
    const holderQ = questionByKey('アイテム', 'holder')
    if (!kindQ || !holderQ) throw new Error('質問が見つからない')
    const withKind = withDialogAnswer(aliased, kindQ, { text: '道具・機械', public: true })
    expect(withKind.dialog?.kind).toEqual({ text: '道具・機械', public: true })
    expect(withKind.dialogVersion).toBe(DIALOG_VERSION)
    const withHolder = withDialogAnswer(withKind, holderQ, { text: 'ユキ', public: true })
    expect(withHolder.dialog?.holder).toEqual({ text: 'ユキ' }) // 固定＝public を持たない
    expect(answerPublic(holderQ, withHolder.dialog?.holder)).toBe(false)
    // 公開情報の答えは summary へ一本化し、旧 body を畳む
    const withBlurb = withDialogAnswer({ ...withHolder, body: '旧' }, baseQ('blurb'), {
      text: '説明',
    })
    expect(withBlurb.summary).toBe('説明')
    expect(withBlurb.body).toBeUndefined()
  })

  it('スキップ・あとでは text 空で印を持ち、進み具合と next に反映される', () => {
    const e = entry({ name: 'セト', category: '人物' })
    const titleQ = questionByKey('人物', 'title')
    const ageQ = questionByKey('人物', 'age')
    if (!titleQ || !ageQ) throw new Error('質問が見つからない')
    const skipped = withDialogAnswer(e, titleQ, { text: '', skipped: true })
    const later = withDialogAnswer(skipped, ageQ, { text: '', later: true })
    expect(isAnswered(later, titleQ)).toBe(true)
    expect(isAnswered(later, ageQ)).toBe(false)
    expect(isLater(later, ageQ)).toBe(true)
    expect(nextQuestion(later)?.key).toBe('gender')
    const p = dialogSummaryOf(later).progress
    expect(p).toMatchObject({ done: 1, later: 1 })
    // 任意の問いは total に数えない（人物：gender/birthday/blood/origin/pride/love/family/memo）
    expect(p.total).toBe(activeDeepQuestionsFor(later).filter((q) => !q.optional).length)
    expect(dialogSummaryOf(e).status).toBe('none')
    expect(dialogSummaryOf(later).status).toBe('inProgress')
  })

  it('全部答えるかスキップし、あとでが無ければ done', () => {
    let e = entry({ name: '竜', category: '生物' })
    for (const q of activeDeepQuestionsFor(e)) {
      e = withDialogAnswer(
        e,
        q,
        q.key === 'kind' ? { text: '架空の生き物' } : { text: '', skipped: true },
      )
    }
    // 種類を選んだので枝（encounter/human）が増えた＝それも埋める
    for (const q of activeDeepQuestionsFor(e)) {
      if (!isAnswered(e, q)) e = withDialogAnswer(e, q, { text: '', skipped: true })
    }
    expect(nextQuestion(e)).toBeUndefined()
    expect(dialogSummaryOf(e).status).toBe('done')
  })

  it('resolveName は名前か分類ごとの言い換え、questionText は名前を差し込む', () => {
    expect(resolveName(entry({ name: 'セト' }))).toBe('セト')
    expect(resolveName(entry({ name: '', category: '組織' }))).toBe('その集まり')
    expect(resolveName(entry({ name: '' }))).toBe('それ')
    const skill = questionByKey('人物', 'skill')
    if (!skill) throw new Error('質問が見つからない')
    expect(questionText(skill, entry({ name: 'セト' }))).toBe(
      'セトの特技や、得意なことはありますか。',
    )
    const pride = questionByKey('人物', 'pride')
    if (!pride) throw new Error('質問が見つからない')
    expect(questionText(pride, entry({ name: '', category: '人物' }))).toMatch(
      /^その人物.*（任意）$/,
    )
  })

  it('toggleAnswerPublic は切り替えられる問いだけ反転し、固定と未回答は変えない', () => {
    const e = entry({
      name: 'セト',
      category: '人物',
      dialog: {
        value: { text: '約束' },
        secret: { text: '帳' },
        flaw: { text: '', skipped: true },
      },
    })
    expect(toggleAnswerPublic(e, 'value').dialog?.value?.public).toBe(true)
    expect(toggleAnswerPublic(toggleAnswerPublic(e, 'value'), 'value').dialog?.value?.public).toBe(
      false,
    )
    expect(toggleAnswerPublic(e, 'secret')).toBe(e)
    expect(toggleAnswerPublic(e, 'flaw')).toBe(e)
    expect(toggleAnswerPublic(e, 'nope')).toBe(e)
  })

  it('draftSummaryFromDialog は公開情報＋「読者に見せる」の答えだけを並べる', () => {
    const e = entry({
      name: 'セト',
      category: '人物',
      summary: '案内人。',
      dialog: {
        title: { text: '案内人' }, // プロフィール＝既定で公開
        skill: { text: '道を覚える', public: true },
        skill__why: { text: '迷えば帰れない', public: true },
        value: { text: '約束' }, // 既定は作者だけ
        secret: { text: '帳', public: true }, // 固定＝載らない
      },
    })
    expect(draftSummaryFromDialog(e)).toBe(
      '案内人。\n役職・肩書き：案内人\n特技：道を覚える\n↳ どうして身についたか：迷えば帰れない',
    )
    // 下書きを入れたあとにもう一度作っても、同じ行を重ねない（新しい答えだけ足す）
    const applied = { ...e, summary: draftSummaryFromDialog(e) }
    expect(draftSummaryFromDialog(applied)).toBe(applied.summary)
    const more = {
      ...applied,
      dialog: { ...applied.dialog, gap: { text: '実は泣き虫', public: true } },
    }
    expect(draftSummaryFromDialog(more)).toBe(`${applied.summary}\nギャップ：実は泣き虫`)
    // 複数行の答えも、入れたあとの二度目で重ねない
    const multi = entry({
      name: 'x',
      category: '人物',
      dialog: { title: { text: '部長\n二行目' } },
    })
    const once = { ...multi, summary: draftSummaryFromDialog(multi) }
    expect(draftSummaryFromDialog(once)).toBe(once.summary)
  })
})

describe('applyDialogPatch（MCP と画面が共用するパッチ規則）', () => {
  const base = entry({
    name: 'セト',
    category: '人物',
    dialog: { value: { text: '約束', public: true } },
  })

  it('渡した鍵だけ書き換え、空文字は削除、public 省略は新規＝既定・既存＝据え置き', () => {
    const next = applyDialogPatch(base, {
      skill: '道を覚える',
      title: { text: '案内人', public: false },
    })
    expect(next.dialog?.value).toEqual({ text: '約束', public: true }) // 据え置き
    expect(next.dialog?.skill).toEqual({ text: '道を覚える' }) // 既定（作者だけ）
    expect(next.dialog?.title).toEqual({ text: '案内人', public: false })
    expect(next.dialogVersion).toBe(DIALOG_VERSION)
    const kept = applyDialogPatch(next, { value: '約束の値段' })
    expect(kept.dialog?.value).toEqual({ text: '約束の値段', public: true })
    const removed = applyDialogPatch(kept, { value: '' })
    expect(removed.dialog?.value).toBeUndefined()
    expect(removed.dialog?.skill).toBeDefined()
    // 全部消えたら record ごと持たない
    const empty = applyDialogPatch(
      entry({ name: 'x', category: '人物', dialog: { flaw: { text: 'a' } } }),
      {
        flaw: '',
      },
    )
    expect(empty.dialog).toBeUndefined()
    expect(empty.dialogVersion).toBeUndefined()
  })

  it('空のパッチは同じ項目を返す（据え置き）', () => {
    expect(applyDialogPatch(base, {})).toBe(base)
  })

  it('未知の鍵・共通 4 問の鍵・選択肢外の種類・質問の無い分類はエラー', () => {
    expect(() => applyDialogPatch(base, { skil: 'x' })).toThrow(DialogPatchError)
    expect(() => applyDialogPatch(base, { skil: 'x' })).toThrow(/get_glossary_questions/)
    expect(() => applyDialogPatch(base, { name: 'x' })).toThrow(/name／reading／aliases／summary/)
    expect(() => applyDialogPatch(base, { blurb: 'x' })).toThrow(DialogPatchError)
    const place = entry({ name: '街', category: '場所' })
    expect(() => applyDialogPatch(place, { kind: '惑星' })).toThrow(/街・町/)
    expect(applyDialogPatch(place, { kind: '街・町' }).dialog?.kind).toEqual({ text: '街・町' })
    expect(() => applyDialogPatch(entry({ name: 'x' }), { skill: 'y' })).toThrow(/分類/)
    expect(() => applyDialogPatch(entry({ name: 'x', category: '地名' }), { rule: 'y' })).toThrow(
      DialogPatchError,
    )
    // 自由記述も可の選択肢は外れ値を受ける
    expect(applyDialogPatch(base, { gender: '不明' }).dialog?.gender?.text).toBe('不明')
  })

  it('削除（空文字）は残っている鍵なら旧鍵でも通り、更新と混ぜても書ける。無い鍵の誤字と共通 4 問の鍵はエラー', () => {
    const e = entry({ name: 'x', category: '人物', dialog: { old_key: { text: '昔' } } })
    const next = applyDialogPatch(e, { old_key: '', age: '30' })
    expect(next.dialog).toEqual({ age: { text: '30' } })
    expect(() => applyDialogPatch(e, { skil: '' })).toThrow(/get_glossary_questions/)
    expect(() => applyDialogPatch(e, { name: '' })).toThrow(/name／reading/)
    // 無い鍵でも正しい鍵の削除は何もしない（成功）
    expect(applyDialogPatch(e, { skill: '' }).dialog).toEqual(e.dialog)
  })

  it('追い質問の「あとで」も数え、laterQuestionsOf に並ぶ', () => {
    const e = entry({
      name: 'セト',
      category: '人物',
      dialog: { skill: { text: '道を覚える' }, skill__why: { text: '', later: true } },
    })
    expect(dialogSummaryOf(e).progress.later).toBe(1)
    expect(dialogSummaryOf(e).status).toBe('inProgress')
    expect(laterQuestionsOf(e).map((q) => q.key)).toEqual(['skill__why'])
  })

  it('dialogRecordDiff は変わった鍵だけ（消えた鍵は null）', () => {
    const prev = { a: { text: '1' }, b: { text: '2', public: true }, c: { text: '3' } }
    const next = { a: { text: '1' }, b: { text: '2', public: false }, d: { text: '4' } }
    expect(dialogRecordDiff(prev, next)).toEqual({
      b: { text: '2', public: false },
      d: { text: '4' },
      c: null,
    })
    expect(dialogRecordDiff(undefined, undefined)).toEqual({})
  })

  it('削除（空文字）だけなら、質問セットの無い分類でも通る＝古い答えを片づけられる', () => {
    const legacy = entry({
      name: 'x',
      category: '地名',
      dialog: { title: { text: 'a' }, secret: { text: 'b' } },
    })
    const next = applyDialogPatch(legacy, { title: '' })
    expect(next.dialog).toEqual({ secret: { text: 'b' } })
    expect(() => applyDialogPatch(legacy, { title: '', secret: 'c' })).toThrow(/分類/)
  })

  it('固定の問いに public を渡しても無視する（エラーにしない）', () => {
    const next = applyDialogPatch(base, { secret: { text: '帳', public: true } })
    expect(next.dialog?.secret).toEqual({ text: '帳' })
  })

  it('追い質問の鍵（親__子）も受ける', () => {
    const next = applyDialogPatch(base, { skill__why: '迷えば帰れないから' })
    expect(next.dialog?.skill__why?.text).toBe('迷えば帰れないから')
  })
})

describe('平文', () => {
  it('dialogToPlainText は鍵・見出し・公開の扱い・答えを並べ、スキップとあとでは末尾に', () => {
    const e = entry({
      name: 'セト',
      category: '人物',
      dialogVersion: 1,
      dialog: {
        title: { text: '案内人' },
        skill: { text: '道を覚える', public: true },
        skill__why: { text: '迷えば帰れない', public: true },
        value: { text: '約束' },
        secret: { text: '帳' },
        birthday: { text: '', skipped: true },
        rival: { text: '', later: true },
        old_key: { text: '昔の答え' },
      },
    })
    const text = dialogToPlainText(e)
    expect(text).toContain('対話ノート（非公開・v1）')
    expect(text).toContain('title 役職・肩書き [読者に見せる]: 案内人')
    expect(text).toContain('skill__why ↳どうして身についたか [読者に見せる]: 迷えば帰れない')
    expect(text).toContain('value 譲れないもの [作者だけ]: 約束')
    expect(text).toContain('secret 秘密 [作者だけ・固定]: 帳')
    expect(text).toContain('old_key （旧・今の質問セットに無い鍵） [作者だけ]: 昔の答え')
    // 種類を変えて枝から外れた答えは、現役の答えと区別できる印で残す
    const place = entry({
      name: '街道',
      category: '場所',
      dialogVersion: 1,
      dialog: { kind: { text: '自然' }, route: { text: '北から南へ' } },
    })
    expect(dialogToPlainText(place)).toContain(
      'route どこからどこへ（今の種類では聞かない問い） [読者に見せる]: 北から南へ',
    )
    // 枝から外れた問いのあとで／スキップも印に残す
    const marks = { ...place, dialog: { kind: { text: '自然' }, route: { text: '', later: true } } }
    expect(dialogToPlainText(marks)).toContain('あとで: route')
    expect(text).toContain('（スキップ: birthday ／ あとで: rival）')
    expect(dialogToPlainText(entry({ name: 'x' }))).toBe('')
    // 質問セットの無い分類：鍵を「旧」扱いにせず、分類を付けるよう案内する
    const uncategorized = dialogToPlainText(
      entry({ name: 'y', dialogVersion: 1, dialog: { title: { text: '案内人', public: true } } }),
    )
    expect(uncategorized).toContain('分類「未分類」には質問セットがありません')
    expect(uncategorized).toContain('  title [読者に見せる]: 案内人')
    expect(
      dialogToPlainText(
        entry({ name: 'z', dialogVersion: 1, dialog: { title: { text: '案内人' } } }),
      ),
    ).toContain('  title [公開の既定（分類を付けてから決まる）]: 案内人')
    expect(uncategorized).not.toContain('旧')
  })

  it('questionsToPlainText は分類ごとに鍵・見出し・問い・既定・条件を出す', () => {
    const all = questionsToPlainText()
    for (const cat of DIALOG_CATEGORIES) expect(all).toContain(`## ${cat}`)
    const org = questionsToPlainText('組織')
    expect(org).toContain('- kind｜種類｜（名前）はどんな種類の集まりですか。')
    expect(org).toContain('選択肢: 会社・店／')
    expect(org).toContain('- politics｜統治のしくみ｜')
    expect(org).toContain('条件: kind が 役所・国・軍 のとき')
    expect(org).not.toContain('## 人物')
    expect(questionsToPlainText('人物')).toContain('  - skill__why｜↳どうして身についたか｜')
    expect(questionsToPlainText('地名')).toContain('この分類には対話の質問がありません')
  })
})

describe('後方互換', () => {
  it('dialog を持つ項目も持たない項目も WorkSchema 系の検証を通り、dialog が落ちない', () => {
    const legacy = { id: 'g', name: 'x', aliases: [], createdAt: 0, updatedAt: 0 }
    expect(GlossaryEntrySchema.parse(legacy)).toEqual(legacy)
    const withDialog = {
      ...legacy,
      dialog: { value: { text: '約束', public: true }, flaw: { text: '', skipped: true } },
      dialogVersion: 1,
    }
    expect(GlossaryEntrySchema.parse(withDialog)).toEqual(withDialog)
    expect(dialogSummaryOf({ ...legacy, category: '人物' }).status).toBe('none')
    // 質問セットの無い分類は、答えが残っていても「手を付けていない」扱い（分類を選び直せば戻る）
    expect(dialogSummaryOf({ ...withDialog, category: '地名' }).status).toBe('none')
    expect(dialogSummaryOf({ ...withDialog, category: '人物' }).status).toBe('inProgress')
  })
})
