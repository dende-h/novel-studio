import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '../schema'
import { activeDeepQuestionsFor, nextQuestion, questionByKey } from './dialog'
import {
  beginSession,
  type DialogMessage,
  type DialogSession,
  pendingHint,
  pendingQuestion,
  pickQuestion,
  rejectAnswer,
  runChip,
  type SessionStep,
  skipQuestion,
  submitAnswer,
} from './dialogSession'

function entry(p: Partial<GlossaryEntry> & { name: string }): GlossaryEntry {
  return {
    id: p.id ?? 'g1',
    name: p.name,
    aliases: p.aliases ?? [],
    category: p.category,
    reading: p.reading,
    summary: p.summary,
    dialog: p.dialog,
    dialogVersion: p.dialogVersion,
    createdAt: 0,
    updatedAt: 0,
  }
}

const botTexts = (s: DialogSession) =>
  s.log
    .filter((m): m is Extract<DialogMessage, { role: 'bot' }> => m.role === 'bot')
    .map((m) => m.text)
const lastBot = (s: DialogSession) => botTexts(s).at(-1) ?? ''
const lastChips = (s: DialogSession) => {
  const m = s.log.at(-1)
  return m?.role === 'chips' ? m.chips : []
}
const pendingKey = (s: DialogSession) =>
  s.pending?.kind === 'question' ? s.pending.key : undefined

describe('新規の下書き', () => {
  it('最初に決まった質問だけをすると名乗り、分類を聞く', () => {
    const s = beginSession(entry({ name: '' }), { draft: true })
    expect(botTexts(s)[0]).toMatch(/決まった質問/)
    expect(s.pending).toEqual({ kind: 'category' })
    expect(lastChips(s).map((c) => c.value)).toEqual([
      '人物',
      '場所',
      '組織',
      '用語',
      'アイテム',
      '生物',
    ])
    expect(pendingHint(s)).toMatch(/分類/)
  })

  it('分類を選ぶと問数を案内し、名前から順に聞く。チップは消える', () => {
    const s0 = beginSession(entry({ name: '' }), { draft: true })
    const { session: s, entry: e } = runChip(s0, entry({ name: '' }), 'category', '人物')
    expect(e.category).toBe('人物')
    expect(s.log.some((m) => m.role === 'chips')).toBe(false)
    expect(botTexts(s)).toContainEqual(
      expect.stringMatching(/^人物 ですね。基本の質問は \d+ 問です/),
    )
    expect(botTexts(s)).toContainEqual('ここから「基本」について 4 問です。')
    expect(pendingKey(s)).toBe('name')
  })

  it('フォームで先に分類を選んだ下書きは、分類を聞き直さず最初の問いから', () => {
    const e = entry({ name: 'ユキ', category: '人物' })
    const s = beginSession(e, { draft: true })
    expect(s.pending).toEqual({ kind: 'question', key: 'reading' })
    expect(botTexts(s).some((t) => t.includes('どの分類'))).toBe(false)
  })

  it('知らない分類は受け付けない', () => {
    const s0 = beginSession(entry({ name: '' }), { draft: true })
    const { session: s, entry: e } = submitAnswer(s0, entry({ name: '' }), '地名')
    expect(e.category).toBeUndefined()
    expect(s.pending).toEqual({ kind: 'category' })
  })

  it('名前の重複はその場で断り、同じ問いを待つ', () => {
    const others = [entry({ id: 'x', name: 'セト', category: '人物' })]
    let step: SessionStep = runChip(
      beginSession(entry({ name: '' }), { draft: true }),
      entry({ name: '' }),
      'category',
      '人物',
    )
    step = submitAnswer(step.session, step.entry, 'セト', { entries: others })
    expect(step.entry.name).toBe('')
    expect(lastBot(step.session)).toMatch(/もうあります/)
    expect(pendingKey(step.session)).toBe('name')
    step = submitAnswer(step.session, step.entry, 'ユキ', { entries: others })
    expect(step.entry.name).toBe('ユキ')
    expect(pendingKey(step.session)).toBe('reading')
  })

  it('共通 4 問のスキップは印だけで欄を変えず、深掘りへ進む', () => {
    let step: SessionStep = runChip(
      beginSession(entry({ name: '' }), { draft: true }),
      entry({ name: '' }),
      'category',
      '人物',
    )
    step = submitAnswer(step.session, step.entry, 'ユキ')
    step = skipQuestion(step.session, step.entry, false) // reading
    step = skipQuestion(step.session, step.entry, true) // aliases あとで
    step = skipQuestion(step.session, step.entry, false) // blurb
    expect(step.entry.reading).toBeUndefined()
    expect(step.entry.aliases).toEqual([])
    expect(step.session.baseMarks).toEqual({
      reading: 'skipped',
      aliases: 'later',
      blurb: 'skipped',
    })
    expect(pendingKey(step.session)).toBe('title')
    expect(botTexts(step.session)).toContainEqual(
      expect.stringMatching(/ここから「プロフィール」について/),
    )
  })

  it('別名に区切りだけを書いても答えにせず、書き方を伝えて同じ問いを待つ（ループしない）', () => {
    let step: SessionStep = runChip(
      beginSession(entry({ name: 'ユキ' }), { draft: true }),
      entry({ name: 'ユキ' }),
      'category',
      '人物',
    )
    step = skipQuestion(step.session, step.entry, false) // reading
    expect(pendingKey(step.session)).toBe('aliases')
    step = submitAnswer(step.session, step.entry, '、')
    expect(step.entry.aliases).toEqual([])
    expect(lastBot(step.session)).toMatch(/読点/)
    expect(pendingKey(step.session)).toBe('aliases')
    expect(step.session.log.filter((m) => m.role === 'user')).toHaveLength(2) // 分類とスキップだけ
    step = submitAnswer(step.session, step.entry, 'ゆき、雪')
    expect(step.entry.aliases).toEqual(['ゆき', '雪'])
    expect(pendingKey(step.session)).toBe('blurb')
  })

  it('名前が先に入っている下書き（未解決の [[用語]] から）は名前を聞かない', () => {
    const step = runChip(
      beginSession(entry({ name: 'ミア' }), { draft: true }),
      entry({ name: 'ミア' }),
      'category',
      '人物',
    )
    expect(pendingKey(step.session)).toBe('reading')
  })
})

describe('深掘りの本流', () => {
  const seto = () => entry({ name: 'セト', category: '人物' })

  it('既存の項目は「フォームの情報」のカードを出して深掘りから聞く', () => {
    const s = beginSession(seto(), { draft: false })
    expect(s.log[0]?.role).toBe('card-base')
    // 問数は進み具合と同じ「基本の問い」で言い、まとまりの案内も基本と任意を分ける
    expect(botTexts(s)).toContainEqual(expect.stringMatching(/基本の質問は 25 問です/))
    expect(botTexts(s)).toContainEqual(
      'ここから「プロフィール」について 5 問です（ほかに任意が 4 問）。',
    )
    expect(lastBot(s)).toMatch(/^セトの役職や肩書き/)
    expect(pendingKey(s)).toBe('title')
  })

  it('答えは dialog に入り、既定の公開扱いで保存され、次の問いへ', () => {
    const step = submitAnswer(beginSession(seto(), { draft: false }), seto(), '案内人')
    expect(step.entry.dialog?.title).toEqual({ text: '案内人', public: true })
    expect(pendingKey(step.session)).toBe('age')
    const user = step.session.log.find((m) => m.role === 'user')
    expect(user).toMatchObject({ key: 'title', label: '役職・肩書き', text: '案内人' })
  })

  it('選択肢だけの問いは選択肢以外を断り、自由記述も可の問いは受ける', () => {
    let e = entry({ name: '街', category: '場所' })
    let s = beginSession(e, { draft: false })
    expect(pendingKey(s)).toBe('kind')
    let step = submitAnswer(s, e, '惑星')
    expect(step.entry.dialog?.kind).toBeUndefined()
    expect(lastBot(step.session)).toMatch(/から選んでください/)
    step = runChip(step.session, step.entry, 'choice', '乗り物・道中')
    expect(step.entry.dialog?.kind?.text).toBe('乗り物・道中')
    // 種類の枝（route）が本流に入る
    expect(activeDeepQuestionsFor(step.entry).map((q) => q.key)).toContain('route')
    e = seto()
    s = beginSession(e, { draft: false })
    let st = submitAnswer(s, e, '案内人')
    st = submitAnswer(st.session, st.entry, '二十歳')
    expect(pendingKey(st.session)).toBe('gender')
    st = submitAnswer(st.session, st.entry, '女性寄り') // free
    expect(st.entry.dialog?.gender?.text).toBe('女性寄り')
  })

  it('追い質問のある問いに答えると「もう少し深める／次へ」を出し、深めると ↳ で聞く', () => {
    let e = seto()
    const skill = questionByKey('人物', 'skill')
    if (!skill) throw new Error('質問が見つからない')
    // skill まで飛ぶ：title/age をスキップ、任意も含めてスキップ
    let s = beginSession(e, { draft: false })
    while (pendingKey(s) !== 'skill') {
      const st = skipQuestion(s, e, false)
      s = st.session
      e = st.entry
    }
    let step = submitAnswer(s, e, '道を一度で覚える')
    expect(step.session.pending).toEqual({ kind: 'dig-offer', key: 'skill' })
    expect(lastChips(step.session).map((c) => c.action)).toEqual(['dig', 'digskip'])
    expect(pendingHint(step.session)).toMatch(/深める/)
    step = runChip(step.session, step.entry, 'dig', 'skill')
    expect(pendingKey(step.session)).toBe('skill__why')
    expect(lastBot(step.session)).toBe('↳ どうしてそれが得意になったのですか。')
    step = submitAnswer(step.session, step.entry, '迷えば帰れない場所で育ったから')
    // 親と同じ公開の扱い（プロフィール＝読者に見せる）
    expect(step.entry.dialog?.skill__why).toEqual({
      text: '迷えば帰れない場所で育ったから',
      public: true,
    })
    expect(pendingKey(step.session)).toBe('looks_first')
    expect(botTexts(step.session)).toContainEqual(
      expect.stringMatching(/ここから「見た目」について/),
    )
  })

  it('追い質問を「あとで」にすると、まとめと選び直しにその追い質問が並ぶ', () => {
    let e = seto()
    let s = beginSession(e, { draft: false })
    while (pendingKey(s) !== 'skill') {
      const st = skipQuestion(s, e, false)
      s = st.session
      e = st.entry
    }
    let step = submitAnswer(s, e, '道を覚える')
    step = runChip(step.session, step.entry, 'dig', 'skill')
    step = skipQuestion(step.session, step.entry, true) // 追い質問をあとで
    expect(step.entry.dialog?.skill__why).toEqual({ text: '', later: true })
    let guard = 0
    while (step.session.pending?.kind === 'question' && guard++ < 100) {
      step = skipQuestion(step.session, step.entry, false)
    }
    expect(lastBot(step.session)).toMatch(/「あとで」にした答えが 1 つあります/)
    expect(lastChips(step.session)[0]).toMatchObject({ action: 'pick', value: 'skill__why' })
    // 選ぶとその追い質問を聞く
    step = runChip(step.session, step.entry, 'pick', 'skill__why')
    expect(pendingKey(step.session)).toBe('skill__why')
  })

  it('「次へ」で追い質問を飛ばす', () => {
    let e = seto()
    let s = beginSession(e, { draft: false })
    while (pendingKey(s) !== 'skill') {
      const st = skipQuestion(s, e, false)
      s = st.session
      e = st.entry
    }
    let step = submitAnswer(s, e, '料理')
    step = runChip(step.session, step.entry, 'digskip')
    expect(pendingKey(step.session)).toBe('looks_first')
    expect(step.entry.dialog?.skill__why).toBeUndefined()
  })

  it('ひと通り答えるとまとめのカードと「答えを直す／フォームで確かめる」', () => {
    let e = seto()
    let s = beginSession(e, { draft: false })
    let guard = 0
    while (s.pending?.kind === 'question' && guard++ < 100) {
      const st = skipQuestion(s, e, false)
      s = st.session
      e = st.entry
    }
    expect(nextQuestion(e)).toBeUndefined()
    expect(lastBot(s)).toBe('ひと通り聞きました。まとめはこちらです。')
    expect(s.log.some((m) => m.role === 'card')).toBe(true)
    expect(lastChips(s).map((c) => c.action)).toEqual(['reopen', 'toform'])
    expect(s.pending).toEqual({ kind: 'pick' })
    // 「フォームで確かめる」は画面への指示
    expect(runChip(s, e, 'toform').effect).toBe('toform')
  })

  it('あとでにした答えがあれば、まとめのあとにその一覧を出す', () => {
    let e = seto()
    let s = beginSession(e, { draft: false })
    let first = true
    let guard = 0
    while (s.pending?.kind === 'question' && guard++ < 100) {
      const st = skipQuestion(s, e, first)
      first = false
      s = st.session
      e = st.entry
    }
    expect(lastBot(s)).toMatch(/「あとで」にした答えが 1 つあります/)
    expect(lastChips(s)[0]).toMatchObject({ action: 'pick', value: 'title', note: 'あとで' })
  })
})

describe('再開・直す', () => {
  const inProgress = () =>
    entry({
      name: 'セト',
      category: '人物',
      dialog: { title: { text: '案内人' }, age: { text: '', later: true } },
    })

  it('途中の項目は答え済みを並べ直してから続きを聞く', () => {
    const s = beginSession(inProgress(), { draft: false })
    expect(botTexts(s)[0]).toMatch(/対話をつづけます/)
    const users = s.log.filter((m) => m.role === 'user')
    expect(users.map((m) => (m.role === 'user' ? m.key : ''))).toEqual(['title', 'age'])
    expect(pendingKey(s)).toBe('gender') // age は「あとで」なので飛ばす
  })

  it('「直す」はその問いだけ聞き直し、答えると本流（次の未回答）へ戻る（D-DLG-EDIT）', () => {
    const e = inProgress()
    let step = pickQuestion(beginSession(e, { draft: false }), e, 'title')
    expect(step.session.editingKey).toBe('title')
    expect(botTexts(step.session).at(-2)).toMatch(/「役職・肩書き」は今こうなっています。\n案内人/)
    expect(pendingKey(step.session)).toBe('title')
    step = submitAnswer(step.session, step.entry, '境の街の案内人')
    expect(step.entry.dialog?.title?.text).toBe('境の街の案内人')
    // 吹き出しは鍵ごとに 1 つ＝前の答えの吹き出しは消え、最新だけ残る
    expect(step.session.log.filter((m) => m.role === 'user' && m.key === 'title')).toHaveLength(1)
    expect(step.session.editingKey).toBeNull()
    expect(botTexts(step.session)).toContainEqual('直しました。つづきを聞きます。')
    expect(pendingKey(step.session)).toBe('gender')
  })

  it('「直す」中のスキップ・あとでは「そのままにします」＝答えを消さない', () => {
    const e = entry({
      name: 'セト',
      category: '人物',
      dialog: { title: { text: '案内人', public: true } },
    })
    let step = pickQuestion(beginSession(e, { draft: false }), e, 'title')
    step = skipQuestion(step.session, step.entry, false)
    expect(step.entry.dialog?.title).toEqual({ text: '案内人', public: true })
    expect(botTexts(step.session)).toContainEqual('そのままにします。')
    expect(botTexts(step.session)).not.toContainEqual('直しました。つづきを聞きます。')
    expect(step.session.editingKey).toBeNull()
    expect(pendingKey(step.session)).toBe('age') // 本流へ戻る
  })

  it('知らない分類や空の答えはチップを出し直して待つ（行き止まりにしない）', () => {
    const s0 = beginSession(entry({ name: '' }), { draft: true })
    const step = runChip(s0, entry({ name: '' }), 'category', '神器')
    expect(step.session.pending).toEqual({ kind: 'category' })
    expect(lastChips(step.session).map((c) => c.value)).toContain('人物')
  })

  it('直すときは追い質問の誘いを出さない', () => {
    const e = entry({ name: 'セト', category: '人物', dialog: { skill: { text: '料理' } } })
    let step = pickQuestion(beginSession(e, { draft: false }), e, 'skill')
    step = submitAnswer(step.session, step.entry, '道を覚える')
    expect(step.session.pending?.kind).toBe('question')
    expect(step.session.pending).not.toEqual({ kind: 'dig-offer', key: 'skill' })
  })

  it('全問答え済みなら「どれを変えますか」の一覧から選び直せる', () => {
    let e = entry({ name: '竜', category: '生物' })
    for (const q of activeDeepQuestionsFor(e)) {
      e = { ...e, dialog: { ...(e.dialog ?? {}), [q.key]: { text: '', skipped: true } } }
    }
    e = { ...e, dialog: { ...(e.dialog ?? {}), kind: { text: '植物' } } }
    for (const q of activeDeepQuestionsFor(e)) {
      if (!e.dialog?.[q.key])
        e = { ...e, dialog: { ...(e.dialog ?? {}), [q.key]: { text: '', skipped: true } } }
    }
    const s = beginSession(e, { draft: false })
    expect(botTexts(s)[0]).toMatch(/全部の質問に答えてあります/)
    expect(s.pending).toEqual({ kind: 'pick' })
    const chips = lastChips(s)
    expect(chips.map((c) => c.value)).toContain('habitat')
    expect(chips.map((c) => c.value)).not.toContain('name') // 既存は共通 4 問を出さない
    expect(chips.at(-1)).toMatchObject({ action: 'toform', primary: true })
    let step = runChip(s, e, 'pick', 'habitat')
    step = submitAnswer(step.session, step.entry, '山の裏')
    expect(lastBot(step.session)).toBe('ほかに変えますか。')
    expect(step.session.pending).toEqual({ kind: 'pick' })
  })

  it('分類が無い・質問の無い分類の既存項目は、まず分類を聞く', () => {
    const e = entry({ name: '王都', category: '地名' })
    const s = beginSession(e, { draft: false })
    expect(s.pending).toEqual({ kind: 'category' })
    const step = runChip(s, e, 'category', '場所')
    expect(step.entry.category).toBe('場所')
    expect(pendingKey(step.session)).toBe('kind')
  })

  it('「どれを変えますか」で登録に失敗しても、選び直しのチップを出し直す（行き止まりにしない）', () => {
    let e = entry({ name: '竜', category: '生物', dialog: { kind: { text: '植物' } } })
    for (const q of activeDeepQuestionsFor(e)) {
      if (!e.dialog?.[q.key])
        e = { ...e, dialog: { ...(e.dialog ?? {}), [q.key]: { text: '', skipped: true } } }
    }
    const s = beginSession(e, { draft: false })
    expect(s.pending).toEqual({ kind: 'pick' })
    const rejected = rejectAnswer(s, '「竜」は既存の項目と重複しています', e)
    expect(lastBot(rejected)).toBe('「竜」は既存の項目と重複しています')
    expect(lastChips(rejected).map((c) => c.action)).toContain('pick')
    expect(rejected.pending).toEqual({ kind: 'pick' })
  })

  it('下書きは名前が無いと登録できず、「これで登録する」で名前を聞き直す', () => {
    let step: SessionStep = runChip(
      beginSession(entry({ name: '' }), { draft: true }),
      entry({ name: '' }),
      'category',
      '人物',
    )
    step = skipQuestion(step.session, step.entry, false) // name をスキップ
    expect(pendingKey(step.session)).toBe('reading')
    // 途中で「これで登録する」（あとでの一覧などから）
    step = runChip(step.session, step.entry, 'finish')
    expect(step.effect).toBeUndefined()
    expect(botTexts(step.session)).toContainEqual(
      '名前が無いと登録できません。まず名前を教えてください。',
    )
    expect(pendingKey(step.session)).toBe('name')
    expect(step.session.baseMarks.name).toBeUndefined()
    step = submitAnswer(step.session, step.entry, 'ユキ')
    expect(step.entry.name).toBe('ユキ')
    // 直したあとは本流（次の未回答）へ
    expect(pendingKey(step.session)).toBe('reading')
    // 名前があれば登録できる
    expect(runChip(step.session, step.entry, 'finish').effect).toBe('finish')
  })

  it('rejectAnswer は問いを待ったまま一言添える／pendingQuestion は待っている問い', () => {
    const e = entry({ name: 'セト', category: '人物' })
    const s = rejectAnswer(beginSession(e, { draft: false }), '保存に失敗しました', e)
    expect(lastBot(s)).toBe('保存に失敗しました')
    expect(pendingQuestion(s, e)?.key).toBe('title')
  })
})
