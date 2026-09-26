import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '../schema'
import { activeDeepQuestionsFor, nextQuestion } from './dialog'
import {
  beginSession,
  type DialogMessage,
  type DialogSession,
  markSaved,
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
  s.log.filter((m): m is DialogMessage & { role: 'bot' } => m.role === 'bot').map((m) => m.text)
const lastBot = (s: DialogSession) => botTexts(s).at(-1) ?? ''
const lastChips = (s: DialogSession) => {
  const m = s.log.at(-1)
  return m?.role === 'chips' ? m.chips : []
}
const pendingKey = (s: DialogSession) =>
  s.pending?.kind === 'question' ? s.pending.key : undefined

/** 名前の無い新しい項目の会話（登録前）。 */
const newSession = (e: GlossaryEntry) => beginSession(e, { askBase: true, unsaved: true })

describe('新しい項目（名前を答えると登録される）', () => {
  it('最初に決まった質問だけをすると名乗り、分類を聞く', () => {
    const s = newSession(entry({ name: '' }))
    expect(botTexts(s)[0]).toMatch(/決まった質問/)
    expect(botTexts(s)[0]).toMatch(/名前を答えた時点で用語集に登録/)
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
    const { session: s, entry: e } = runChip(
      newSession(entry({ name: '' })),
      entry({ name: '' }),
      'category',
      '人物',
    )
    expect(e.category).toBe('人物')
    expect(s.log.some((m) => m.role === 'chips')).toBe(false)
    expect(botTexts(s)).toContainEqual(expect.stringMatching(/^人物 ですね。質問は \d+ 問です/))
    expect(botTexts(s)).toContainEqual('ここから「基本」について 4 問です。')
    expect(pendingKey(s)).toBe('name')
  })

  it('フォームで先に分類を選んであれば、分類を聞き直さず最初の問いから', () => {
    const e = entry({ name: '', category: '人物' })
    const s = newSession(e)
    expect(pendingKey(s)).toBe('name')
    expect(botTexts(s).some((t) => t.includes('どの分類'))).toBe(false)
  })

  it('知らない分類は受け付けず、チップを出し直す', () => {
    const s0 = newSession(entry({ name: '' }))
    const { session: s, entry: e } = submitAnswer(s0, entry({ name: '' }), '地名')
    expect(e.category).toBeUndefined()
    expect(s.pending).toEqual({ kind: 'category' })
    expect(lastChips(s).map((c) => c.value)).toContain('人物')
  })

  it('名前の重複はその場で断り、同じ問いを待つ。名前を答えると登録の一言を添えて読みへ', () => {
    const others = [entry({ id: 'x', name: 'セト', category: '人物' })]
    let step: SessionStep = runChip(
      newSession(entry({ name: '' })),
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
    expect(botTexts(step.session)).toContainEqual(
      '「ユキ」を用語集に登録しました。ここからは答えるたびに保存されます。',
    )
    expect(pendingKey(step.session)).toBe('reading')
    // 登録された項目で同じ会話を続ける
    const saved = markSaved(step.session)
    expect(saved.unsaved).toBe(false)
    expect(saved.askBase).toBe(true)
    expect(pendingKey(saved)).toBe('reading')
  })

  it('名前は飛ばせない（登録に要る）', () => {
    let step: SessionStep = runChip(
      newSession(entry({ name: '' })),
      entry({ name: '' }),
      'category',
      '人物',
    )
    step = skipQuestion(step.session, step.entry)
    expect(lastBot(step.session)).toMatch(/飛ばせません/)
    expect(pendingKey(step.session)).toBe('name')
  })

  it('共通 4 問のスキップは印だけで欄を変えず、深掘りへ進む', () => {
    let step: SessionStep = runChip(
      newSession(entry({ name: '' })),
      entry({ name: '' }),
      'category',
      '人物',
    )
    step = submitAnswer(step.session, step.entry, 'ユキ')
    step = skipQuestion(step.session, step.entry) // reading
    step = skipQuestion(step.session, step.entry) // aliases
    step = skipQuestion(step.session, step.entry) // blurb
    expect(step.entry.reading).toBeUndefined()
    expect(step.entry.aliases).toEqual([])
    expect(step.entry.dialog).toEqual({
      reading: { text: '', skipped: true },
      aliases: { text: '', skipped: true },
      blurb: { text: '', skipped: true },
    })
    expect(pendingKey(step.session)).toBe('title')
    expect(botTexts(step.session)).toContainEqual(
      expect.stringMatching(/ここから「プロフィール」について/),
    )
  })

  it('別名に区切りだけを書いても答えにせず、書き方を伝えて同じ問いを待つ（ループしない）', () => {
    const e = entry({ name: 'ユキ', category: '人物' })
    let step: SessionStep = { session: beginSession(e, { askBase: true }), entry: e }
    expect(pendingKey(step.session)).toBe('reading')
    step = skipQuestion(step.session, step.entry) // reading
    expect(pendingKey(step.session)).toBe('aliases')
    step = submitAnswer(step.session, step.entry, '、')
    expect(step.entry.aliases).toEqual([])
    expect(lastBot(step.session)).toMatch(/読点/)
    expect(pendingKey(step.session)).toBe('aliases')
    step = submitAnswer(step.session, step.entry, 'ゆき、雪')
    expect(step.entry.aliases).toEqual(['ゆき', '雪'])
    expect(pendingKey(step.session)).toBe('blurb')
  })

  it('別名の重複もその場で断る', () => {
    const others = [entry({ id: 'x', name: 'アリス', category: '人物' })]
    const e = entry({ name: 'セト', category: '人物' })
    let step: SessionStep = { session: beginSession(e, { askBase: true }), entry: e }
    step = skipQuestion(step.session, step.entry) // reading
    step = submitAnswer(step.session, step.entry, '部長、アリス', { entries: others })
    expect(step.entry.aliases).toEqual([])
    expect(lastBot(step.session)).toMatch(/「アリス」は用語集にもうあります/)
    expect(pendingKey(step.session)).toBe('aliases')
  })

  it('名前だけで作った項目（未解決の [[用語]] から）は登録の一言から始め、読みから聞く。まとまりの案内は残りで言う', () => {
    const e = entry({ name: 'ミア', category: '人物' })
    const s = beginSession(e, { askBase: true, created: true })
    expect(s.unsaved).toBe(false)
    expect(botTexts(s)[0]).toMatch(/「ミア」を用語集に登録しました/)
    expect(pendingKey(s)).toBe('reading')
    expect(botTexts(s)).toContainEqual('ここから「基本」について 残り 3 問です。')
    const ids = s.log.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('名前だけで作った項目で分類が無ければ、まず分類を聞く', () => {
    const s = beginSession(entry({ name: 'ミア' }), { askBase: true })
    expect(s.pending).toEqual({ kind: 'category' })
  })
})

describe('深掘りの本流', () => {
  const seto = () => entry({ name: 'セト', category: '人物' })
  const begin = (e: GlossaryEntry) => beginSession(e, { askBase: false })

  it('既存の項目は「フォームの情報」のカードを出して深掘りから聞く', () => {
    const s = begin(seto())
    expect(s.log[0]?.role).toBe('card-base')
    expect(botTexts(s)).toContainEqual(expect.stringMatching(/質問は 31 問です/))
    expect(botTexts(s)).toContainEqual('ここから「プロフィール」について 9 問です。')
    expect(lastBot(s)).toMatch(/^セトの役職や肩書き/)
    expect(pendingKey(s)).toBe('title')
  })

  it('答えは dialog に入り、既定の公開扱いで保存され、次の問いへ', () => {
    const step = submitAnswer(begin(seto()), seto(), '案内人')
    expect(step.entry.dialog?.title).toEqual({ text: '案内人', public: true })
    expect(pendingKey(step.session)).toBe('age')
    const user = step.session.log.find((m) => m.role === 'user')
    expect(user).toMatchObject({ key: 'title', label: '役職・肩書き', text: '案内人' })
  })

  it('選択肢だけの問いは選択肢以外を断り、自由記述も可の問いは受ける', () => {
    let e = entry({ name: '街', category: '場所' })
    let s = begin(e)
    expect(pendingKey(s)).toBe('kind')
    let step = submitAnswer(s, e, '惑星')
    expect(step.entry.dialog?.kind).toBeUndefined()
    expect(lastBot(step.session)).toMatch(/から選んでください/)
    step = runChip(step.session, step.entry, 'choice', '乗り物・道中')
    expect(step.entry.dialog?.kind?.text).toBe('乗り物・道中')
    expect(activeDeepQuestionsFor(step.entry).map((q) => q.key)).toContain('route')
    e = seto()
    s = begin(e)
    let st = submitAnswer(s, e, '案内人')
    st = submitAnswer(st.session, st.entry, '二十歳')
    expect(pendingKey(st.session)).toBe('gender')
    st = submitAnswer(st.session, st.entry, '女性寄り') // free
    expect(st.entry.dialog?.gender?.text).toBe('女性寄り')
  })

  /** skill の問いまでスキップで進める。 */
  const toSkill = () => {
    let e = seto()
    let s = begin(e)
    while (pendingKey(s) !== 'skill') {
      const st = skipQuestion(s, e)
      s = st.session
      e = st.entry
    }
    return { s, e }
  }

  it('追い質問のある問いに答えると「もう少し深める／次へ」を出し、深めると ↳ で聞く', () => {
    const { s, e } = toSkill()
    let step = submitAnswer(s, e, '道を一度で覚える')
    expect(step.session.pending).toEqual({ kind: 'dig-offer', key: 'skill' })
    expect(lastChips(step.session).map((c) => c.action)).toEqual(['dig', 'digskip'])
    expect(pendingHint(step.session)).toMatch(/深める/)
    step = runChip(step.session, step.entry, 'dig', 'skill')
    expect(pendingKey(step.session)).toBe('skill__why')
    expect(lastBot(step.session)).toBe('↳ どうしてそれが得意になったのですか。')
    step = submitAnswer(step.session, step.entry, '迷えば帰れない場所で育ったから')
    expect(step.entry.dialog?.skill__why).toEqual({
      text: '迷えば帰れない場所で育ったから',
      public: true,
    })
    expect(pendingKey(step.session)).toBe('looks')
    expect(botTexts(step.session)).toContainEqual(
      expect.stringMatching(/ここから「見た目」について/),
    )
  })

  it('「次へ」で追い質問を飛ばし、選び直しの一覧から「深める」として辿れる', () => {
    const { s, e } = toSkill()
    let step = submitAnswer(s, e, '料理')
    step = runChip(step.session, step.entry, 'digskip')
    expect(pendingKey(step.session)).toBe('looks')
    expect(step.entry.dialog?.skill__why).toBeUndefined()
    let guard = 0
    while (step.session.pending?.kind === 'question' && guard++ < 100) {
      step = skipQuestion(step.session, step.entry)
    }
    step = runChip(step.session, step.entry, 'reopen')
    const dig = lastChips(step.session).find((c) => c.value === 'skill__why')
    expect(dig).toMatchObject({ action: 'pick', note: '深める' })
    step = runChip(step.session, step.entry, 'pick', 'skill__why')
    expect(pendingKey(step.session)).toBe('skill__why')
    expect(step.session.promptId).toBeGreaterThan(0)
  })

  it('ひと通り答えるとまとめのカードと「答えを直す／フォームで確かめる」', () => {
    let e = seto()
    let s = begin(e)
    let guard = 0
    while (s.pending?.kind === 'question' && guard++ < 100) {
      const st = skipQuestion(s, e)
      s = st.session
      e = st.entry
    }
    expect(nextQuestion(e)).toBeUndefined()
    expect(lastBot(s)).toMatch(/^ひと通り聞きました。まとめはこちらです/)
    expect(s.log.some((m) => m.role === 'card')).toBe(true)
    expect(lastChips(s).map((c) => c.action)).toEqual(['reopen', 'toform'])
    expect(s.pending).toEqual({ kind: 'pick' })
    expect(runChip(s, e, 'toform').effect).toBe('toform')
  })

  it('旧データの「あとで」は、まとめのあとに未回答として並べる', () => {
    const e = entry({
      name: 'セト',
      category: '人物',
      dialog: { skill: { text: '道を覚える' }, skill__why: { text: '', later: true } },
    })
    let s = begin(e)
    let cur = e
    let guard = 0
    while (s.pending?.kind === 'question' && guard++ < 100) {
      const st = skipQuestion(s, cur)
      s = st.session
      cur = st.entry
    }
    expect(lastBot(s)).toMatch(/答えていない問いが 1 つあります/)
    expect(lastChips(s)[0]).toMatchObject({ action: 'pick', value: 'skill__why', note: '未回答' })
  })
})

describe('再開・直す', () => {
  const begin = (e: GlossaryEntry) => beginSession(e, { askBase: false })
  const inProgress = () =>
    entry({
      name: 'セト',
      category: '人物',
      dialog: { title: { text: '案内人' }, age: { text: '', skipped: true } },
    })

  it('途中の項目は答え済みを並べ直してから続きを聞く', () => {
    const s = begin(inProgress())
    expect(botTexts(s)[0]).toMatch(/対話をつづけます/)
    const users = s.log.filter((m) => m.role === 'user')
    expect(users.map((m) => (m.role === 'user' ? m.key : ''))).toEqual(['title', 'age'])
    expect(pendingKey(s)).toBe('gender')
  })

  it('「直す」はその問いだけ聞き直し、答えると本流（次の未回答）へ戻る（D-DLG-EDIT）', () => {
    const e = inProgress()
    let step = pickQuestion(begin(e), e, 'title')
    expect(step.session.editingKey).toBe('title')
    expect(botTexts(step.session).at(-2)).toMatch(/「役職・肩書き」は今こうなっています。\n案内人/)
    expect(pendingKey(step.session)).toBe('title')
    step = submitAnswer(step.session, step.entry, '境の街の案内人')
    expect(step.entry.dialog?.title?.text).toBe('境の街の案内人')
    expect(step.session.log.filter((m) => m.role === 'user' && m.key === 'title')).toHaveLength(1)
    expect(step.session.editingKey).toBeNull()
    expect(botTexts(step.session)).toContainEqual('直しました。つづきを聞きます。')
    expect(pendingKey(step.session)).toBe('gender')
  })

  it('「直す」中のスキップは「そのままにします」＝答えを消さない', () => {
    const e = entry({
      name: 'セト',
      category: '人物',
      dialog: { title: { text: '案内人', public: true } },
    })
    let step = pickQuestion(begin(e), e, 'title')
    step = skipQuestion(step.session, step.entry)
    expect(step.entry.dialog?.title).toEqual({ text: '案内人', public: true })
    expect(botTexts(step.session)).toContainEqual('そのままにします。')
    expect(botTexts(step.session)).not.toContainEqual('直しました。つづきを聞きます。')
    expect(step.session.editingKey).toBeNull()
    expect(pendingKey(step.session)).toBe('age')
  })

  it('直すときは追い質問の誘いを出さない', () => {
    const e = entry({ name: 'セト', category: '人物', dialog: { skill: { text: '料理' } } })
    let step = pickQuestion(begin(e), e, 'skill')
    step = submitAnswer(step.session, step.entry, '道を覚える')
    expect(step.session.pending?.kind).toBe('question')
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
    const s = begin(e)
    expect(botTexts(s)[0]).toMatch(/全部の質問に答えてあります/)
    expect(s.pending).toEqual({ kind: 'pick' })
    const chips = lastChips(s)
    expect(chips.map((c) => c.value)).toContain('habitat')
    expect(chips.map((c) => c.value)).not.toContain('name')
    expect(chips.at(-1)).toMatchObject({ action: 'toform', primary: true })
    let step = runChip(s, e, 'pick', 'habitat')
    step = submitAnswer(step.session, step.entry, '山の裏')
    expect(lastBot(step.session)).toBe('ほかに変えますか。')
    expect(step.session.pending).toEqual({ kind: 'pick' })
  })

  it('登録後に名前を「直す」と改名の一言（登録しましたとは言わない）', () => {
    const e = entry({ name: 'セト', category: '人物' })
    const s = markSaved(beginSession(e, { askBase: true, unsaved: true }))
    const step = submitAnswer(pickQuestion(s, e, 'name').session, e, 'セツ')
    expect(step.entry.name).toBe('セツ')
    expect(botTexts(step.session).some((t) => t.startsWith('名前を「セツ」に直しました'))).toBe(
      true,
    )
    expect(botTexts(step.session).join('')).not.toContain('「セツ」を用語集に登録しました')
  })

  it('登録後に共通 4 問を聞く会話では、名前だけ選び直しに出さない', () => {
    const e = entry({ name: 'ユキ', category: '人物', reading: 'ゆき' })
    let s = beginSession(e, { askBase: true })
    let cur = e
    let guard = 0
    while (s.pending?.kind === 'question' && guard++ < 100) {
      const st = skipQuestion(s, cur)
      s = st.session
      cur = st.entry
    }
    const step = runChip(s, cur, 'reopen')
    const values = lastChips(step.session).map((c) => c.value)
    expect(values).toContain('reading')
    expect(values).not.toContain('name')
  })

  it('分類が無い・質問の無い分類の既存項目は、まず分類を聞く。残っていた答えは分類を選んだあと並べ直す', () => {
    const e = entry({ name: '王都', category: '地名', dialog: { where: { text: '北の果て' } } })
    const s = begin(e)
    expect(s.pending).toEqual({ kind: 'category' })
    const step = runChip(s, e, 'category', '場所')
    expect(step.entry.category).toBe('場所')
    expect(step.session.log.some((m) => m.role === 'user' && m.key === 'where')).toBe(true)
    expect(pendingKey(step.session)).toBe('kind')
  })

  it('共通 4 問のスキップの印は項目に残る＝分類を変えて始め直しても、開き直しても聞き直さない', () => {
    const e = entry({
      name: 'ユキ',
      category: '組織',
      dialog: { reading: { text: '', skipped: true }, aliases: { text: '', skipped: true } },
    })
    const s = beginSession(e, { askBase: true })
    expect(pendingKey(s)).toBe('blurb')
  })

  it('既存の項目でも共通の欄に空きがあれば、そこから聞く（登録しましたとは言わない）', () => {
    const e = entry({ name: 'ミア', category: '人物', reading: 'みあ' })
    const s = beginSession(e, { askBase: true })
    expect(botTexts(s)[0]).toMatch(/^ミア の読み・別名・公開情報に空いている欄があるので/)
    expect(pendingKey(s)).toBe('aliases')
    // 質問セットの無い分類なら、分類から
    const t = beginSession(entry({ name: '王都', category: '地名' }), { askBase: true })
    expect(lastBot(t)).toMatch(/王都 の分類を選ぶと/)
  })

  it('「どれを変えますか」で保存に失敗しても、選び直しのチップを出し直す（行き止まりにしない）', () => {
    let e = entry({ name: '竜', category: '生物', dialog: { kind: { text: '植物' } } })
    for (const q of activeDeepQuestionsFor(e)) {
      if (!e.dialog?.[q.key])
        e = { ...e, dialog: { ...(e.dialog ?? {}), [q.key]: { text: '', skipped: true } } }
    }
    const s = begin(e)
    expect(s.pending).toEqual({ kind: 'pick' })
    const rejected = rejectAnswer(s, '「竜」は既存の項目と重複しています', e)
    expect(lastBot(rejected)).toBe('「竜」は既存の項目と重複しています')
    expect(lastChips(rejected).map((c) => c.action)).toContain('pick')
    expect(rejected.pending).toEqual({ kind: 'pick' })
  })

  it('「つづきの質問へ」でつづきが無くなっていれば選び直しへ（行き止まりにしない）', () => {
    let e = entry({ name: '竜', category: '生物' })
    const s0 = begin(e)
    for (const q of activeDeepQuestionsFor(e)) {
      e = { ...e, dialog: { ...(e.dialog ?? {}), [q.key]: { text: '', skipped: true } } }
    }
    const step = runChip(s0, e, 'resume')
    expect(step.session.pending).toEqual({ kind: 'pick' })
    expect(lastChips(step.session).length).toBeGreaterThan(0)
  })

  it('rejectAnswer は問いを待ったまま一言添える／pendingQuestion は待っている問い', () => {
    const e = entry({ name: 'セト', category: '人物' })
    const s = rejectAnswer(begin(e), '保存に失敗しました', e)
    expect(lastBot(s)).toBe('保存に失敗しました')
    expect(pendingQuestion(s, e)?.key).toBe('title')
  })
})
