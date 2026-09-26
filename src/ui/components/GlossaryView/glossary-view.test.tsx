import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Appearances } from '@/core/glossary'
import type { DialogAnswer, GlossaryEntry } from '@/core/schema'
import type { GlossaryFormValues } from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { GlossaryView } from './glossary-view'

// 立ち絵欄が目録を読みに行く（fetch）のを止める（happy-dom は実ネットワークへ出ようとする）
vi.mock('@/ui/_api/game-templates', () => ({
  fetchTemplateManifest: async () => null,
  fetchTemplateBytes: async () => null,
}))

function entry(p: Partial<GlossaryEntry> & { id: string; name: string }): GlossaryEntry {
  return {
    id: p.id,
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

/** 鍵ごとのパッチを record に重ねる（store の updateGlossaryEntry と同じ規則）。 */
function mergeDialog(
  cur: Record<string, DialogAnswer>,
  patch: Record<string, DialogAnswer | null>,
): Record<string, DialogAnswer> {
  const out = { ...cur }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = v
  }
  return out
}

/** 対話の答えの欄に書いて Enter で決定する（IME 変換中でない Enter）。 */
const answer = (text: string) => {
  const box = screen.getByLabelText('答え')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
/** 対話ペインの中の分類・選択肢チップ（左の絞り込みチップと同名なので区画で絞る）。 */
const dialogChip = (name: string) =>
  within(screen.getByRole('region', { name: '対話' })).getByRole('button', { name })
/** 見出し横の「対話 n/m」タブ（対話ノート区画の「対話で深める」とは別）。 */
const dialogTab = () => screen.getByRole('button', { name: /^対話 (–|\d+\/\d+)$/ })
const lastBot = () => {
  const pane = screen.getByRole('region', { name: '対話' })
  const bubbles = pane.querySelectorAll('.rounded-bl-md')
  return bubbles[bubbles.length - 1]?.textContent ?? ''
}

const ENTRIES: GlossaryEntry[] = [
  entry({
    id: 'a',
    name: 'アリス',
    reading: 'ありす',
    category: '人物',
    summary: '主人公。[[ボブ]]の幼なじみ。',
    aliases: ['Alice'],
  }),
  entry({ id: 'b', name: 'ボブ', category: '人物' }),
  entry({ id: 't', name: '王都', category: '地名', summary: '概要のみ', body: '旧・詳細の文' }),
]

const appearances: Record<string, Appearances> = {
  a: { episodeIds: ['e1', 'e2'], refCount: 5 },
  b: { episodeIds: [], refCount: 0 },
  t: { episodeIds: ['e1'], refCount: 1 },
}

/**
 * 適用結果が次の描画に反映される **stateful** なハーネス。
 * onApply を受け取るだけのモックだと「作成した項目がその場で選ばれる」「改名が一覧へ出る」
 * を検証できない（world-view.test で学んだ形）。
 */
function setup(initial: GlossaryEntry[] = ENTRIES) {
  const calls = {
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onUpdateDialog: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  }
  function Harness() {
    const [entries, setEntries] = useState(initial)
    return (
      <GlossaryView
        entries={entries}
        getAppearances={(e) => appearances[e.id] ?? { episodeIds: [], refCount: 0 }}
        onCreate={async (input) => {
          calls.onCreate(input)
          if (entries.some((e) => e.name === input.name))
            throw new Error(`「${input.name}」は既存の項目と重複しています`)
          const id = `new-${input.name}`
          setEntries((cur) => [
            ...cur,
            entry({
              id,
              name: input.name,
              aliases: input.aliases,
              category: input.category,
              reading: input.reading,
              summary: input.summary,
              authorNote: input.authorNote,
              dialog: input.dialog,
              dialogVersion: input.dialogVersion,
            }),
          ])
          return id
        }}
        onUpdate={async (id, values: GlossaryFormValues) => {
          calls.onUpdate(id, values)
          setEntries((cur) =>
            cur.map((e) =>
              e.id === id
                ? {
                    ...e,
                    aliases: values.aliases,
                    category: values.category || undefined,
                    reading: values.reading || undefined,
                    summary: values.summary || undefined,
                    body: undefined,
                    authorNote: values.authorNote || undefined,
                  }
                : e,
            ),
          )
        }}
        onUpdateDialog={async (id, patch) => {
          calls.onUpdateDialog(id, patch)
          setEntries((cur) =>
            cur.map((e) =>
              e.id === id
                ? {
                    ...e,
                    ...(patch.dialogPatch !== undefined
                      ? {
                          dialog: mergeDialog(e.dialog ?? {}, patch.dialogPatch),
                          dialogVersion: patch.dialogVersion,
                        }
                      : {}),
                    ...('category' in patch ? { category: patch.category || undefined } : {}),
                    ...('reading' in patch ? { reading: patch.reading || undefined } : {}),
                    ...(patch.aliases !== undefined ? { aliases: patch.aliases } : {}),
                    ...(patch.summary !== undefined
                      ? { summary: patch.summary || undefined, body: undefined }
                      : {}),
                  }
                : e,
            ),
          )
        }}
        onRename={async (id, newName, opts) => {
          calls.onRename(id, newName, opts)
          if (newName === '重複名') throw new Error('「重複名」は既存の項目と重複しています')
          setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, name: newName } : e)))
        }}
        onDelete={(id) => {
          calls.onDelete(id)
          setEntries((cur) => cur.filter((e) => e.id !== id))
        }}
      />
    )
  }
  const view = render(<Harness />)
  return { ...calls, unmount: view.unmount, rerender: () => view.rerender(<Harness />) }
}

const openEntry = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `「${name}」を編集` }))

describe('GlossaryView（左右2カラム：一覧・検索・その場編集）', () => {
  it('一覧に名前と分類・未使用が出て、選ぶと編集面が開く', () => {
    setup()
    expect(screen.getByRole('button', { name: '「アリス」を編集' })).toBeInTheDocument()
    expect(screen.getByText('人物 ・ 未使用')).toBeInTheDocument() // ボブ
    openEntry('アリス')
    expect(screen.getByLabelText('名前')).toHaveValue('アリス')
    expect(screen.getByLabelText('読み（任意）')).toHaveValue('ありす')
    expect(screen.getByLabelText('別名（読点区切り・任意）')).toHaveValue('Alice')
    expect(screen.getByText(/2話・5回 登場/)).toBeInTheDocument()
  })

  it('検索は name・別名・読みに部分一致', () => {
    setup()
    fireEvent.change(screen.getByLabelText('用語集を検索'), { target: { value: 'ありす' } })
    expect(screen.getByRole('button', { name: '「アリス」を編集' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '「王都」を編集' })).toBeNull()
  })

  it('カテゴリチップで絞り込む', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '地名' }))
    expect(screen.getByRole('button', { name: '「王都」を編集' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '「アリス」を編集' })).toBeNull()
  })

  it('「新しく登録」は対話で開き、フォームで名前を入れた時点で登録されて、その項目が開く', async () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    // 対話タブで開き、最初に分類を聞く
    expect(screen.getByRole('button', { name: '対話 –' })).toHaveAttribute('aria-pressed', 'true')
    expect(dialogChip('人物')).toBeInTheDocument()
    // フォームに切り替えて名前を入れる＝欄を離れた時点で登録（登録ボタンは無い）
    fireEvent.click(screen.getByRole('button', { name: 'フォーム' }))
    expect(screen.queryByRole('button', { name: '用語集に登録' })).toBeNull()
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: 'キャロル' } })
    fireEvent.blur(name)
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'キャロル' })),
    )
    // 作成した項目が選ばれ、フォームのまま続きを書ける（一覧にも出る）
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('キャロル'))
    expect(screen.getByRole('button', { name: '「キャロル」を編集' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'フォーム' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('登録が重複で reject されるとエラーを表示し、名前の無い項目のまま残る', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(screen.getByRole('button', { name: 'フォーム' }))
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: 'アリス' } })
    fireEvent.blur(name)
    expect(await screen.findByRole('alert')).toHaveTextContent('重複')
    expect(screen.getByRole('button', { name: '書きかけを捨てる' })).toBeInTheDocument()
  })

  it('対話で新規：分類→名前で登録され、同じ会話のまま読み・別名・公開情報・深掘りと答えるたびに保存される', async () => {
    const { onCreate, onUpdateDialog } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    expect(lastBot()).toBe('まず、名前を教えてください。')
    // 名前の重複はその場で断られ、同じ問いを待つ
    answer('アリス')
    expect(lastBot()).toMatch(/もうあります/)
    answer('キャロル')
    // 名前を答えた時点で登録され、その項目の対話に会話ごと引き継がれる
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'キャロル', category: '人物' }),
      ),
    )
    expect(screen.getByRole('button', { name: '「キャロル」を編集' })).toBeInTheDocument()
    await waitFor(() =>
      expect(lastBot()).toBe('読みがなはありますか。なければスキップで構いません。'),
    )
    expect(dialogTab()).toHaveAttribute('aria-pressed', 'true')
    answer('きゃろる')
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenCalledWith('new-キャロル', { reading: 'きゃろる' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'スキップ' })) // aliases
    answer('主人公の友人。') // blurb
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenCalledWith('new-キャロル', { summary: '主人公の友人。' }),
    )
    expect(lastBot()).toBe('キャロルの役職や肩書き、立場を教えてください。')
    answer('図書委員')
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenCalledWith('new-キャロル', {
        dialogPatch: { title: { text: '図書委員', public: true } },
        dialogVersion: 2,
      }),
    )
    // 答えの吹き出しに公開の印（プロフィール＝読者に見せるが既定）と「直す」
    expect(
      screen.getByRole('button', { name: '読者に見せる（押すと作者だけに戻す）' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '「役職・肩書き」の答えを直す' })).toBeInTheDocument()
    // 残りは全部スキップして、まとめまで進む
    let guard = 0
    while (screen.queryByRole('button', { name: 'スキップ' }) && guard++ < 60) {
      fireEvent.click(screen.getByRole('button', { name: 'スキップ' }))
      const dig = screen.queryByRole('button', { name: '次へ' })
      if (dig) fireEvent.click(dig)
    }
    expect(lastBot()).toMatch(/ひと通り聞きました/)
    // 「対話を終える」でフォームへ
    fireEvent.click(screen.getByRole('button', { name: '対話を終える' }))
    expect(screen.getByRole('button', { name: 'フォーム' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('名前')).toHaveValue('キャロル')
  })

  it('既存の項目はフォームで開き、「対話」に切り替えると深掘りから聞いて一問ずつ保存される', async () => {
    const { onUpdate, onUpdateDialog } = setup()
    openEntry('ボブ')
    expect(screen.getByRole('button', { name: 'フォーム' })).toHaveAttribute('aria-pressed', 'true')
    // 対話ノート区画（見るだけ）から対話を開ける
    fireEvent.click(screen.getByRole('button', { name: '対話で深める' }))
    expect(lastBot()).toBe('ボブの役職や肩書き、立場を教えてください。')
    answer('灯台守')
    // 対話の保存は変わった欄（対話ノート）だけのパッチ＝フォームの他の欄を巻き込まない
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenCalledWith('b', {
        dialogPatch: { title: { text: '灯台守', public: true } },
        dialogVersion: 2,
      }),
    )
    expect(onUpdate).not.toHaveBeenCalled()
    expect(lastBot()).toBe('ボブの年齢か、年の頃を教えてください。')
    // 一覧に進み具合が出て、「対話の途中」で絞れる
    const row = screen.getByRole('button', { name: '「ボブ」を編集' })
    await waitFor(() => expect(row).toHaveTextContent(/対話 1\/\d+/))
    fireEvent.click(screen.getByRole('button', { name: '対話の途中 1' }))
    expect(screen.queryByRole('button', { name: '「アリス」を編集' })).toBeNull()
    expect(screen.getByRole('button', { name: '「ボブ」を編集' })).toBeInTheDocument()
    // 公開の印を押すと作者だけに戻り、保存される
    fireEvent.click(screen.getByRole('button', { name: '読者に見せる（押すと作者だけに戻す）' }))
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenLastCalledWith(
        'b',
        expect.objectContaining({ dialogPatch: { title: { text: '灯台守', public: false } } }),
      ),
    )
    // 「直す」はその問いだけ聞き直し、答えると本流へ戻る
    fireEvent.click(screen.getByRole('button', { name: '「役職・肩書き」の答えを直す' }))
    expect(lastBot()).toBe('ボブの役職や肩書き、立場を教えてください。')
    answer('元・灯台守')
    expect(lastBot()).toBe('ボブの年齢か、年の頃を教えてください。')
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenLastCalledWith(
        'b',
        expect.objectContaining({ dialogPatch: { title: { text: '元・灯台守', public: false } } }),
      ),
    )
    // フォームに戻ると対話ノートに答えが並ぶ
    fireEvent.click(screen.getByRole('button', { name: 'フォーム' }))
    const note = screen.getByRole('region', { name: '対話ノート' })
    expect(within(note).getByText('元・灯台守')).toBeInTheDocument()
    expect(within(note).getByRole('button', { name: '対話をつづける' })).toBeInTheDocument()
  })

  it('対話で分類を選ぶと分類だけのパッチで保存され、フォームでカテゴリを変えると台本を始め直す', async () => {
    const { onUpdateDialog } = setup([entry({ id: 't', name: '王都', category: '地名' })])
    openEntry('王都')
    fireEvent.click(dialogTab())
    // 質問セットの無い分類＝まず分類を聞く
    expect(lastBot()).toMatch(/分類を選ぶと/)
    fireEvent.click(dialogChip('場所'))
    await waitFor(() => expect(onUpdateDialog).toHaveBeenCalledWith('t', { category: '場所' }))
    expect(lastBot()).toBe('王都はどんな種類の場所ですか。')
    // フォームでカテゴリを変える → 対話に戻ると新しい分類で最初から
    fireEvent.click(screen.getByRole('button', { name: 'フォーム' }))
    fireEvent.change(screen.getByLabelText('カテゴリ'), { target: { value: '組織' } })
    fireEvent.click(dialogTab())
    await waitFor(() => expect(lastBot()).toBe('王都はどんな種類の集まりですか。'))
    expect(screen.getByRole('button', { name: '会社・店' })).toBeInTheDocument()
  })

  it('対話の途中で別の項目を選ぶと会話が消えるが、次に開くと続きから聞く', () => {
    setup([
      entry({
        id: 'c',
        name: 'キャロル',
        category: '人物',
        dialog: { title: { text: '図書委員' }, age: { text: '', skipped: true } },
      }),
    ])
    openEntry('キャロル')
    expect(screen.getByRole('button', { name: '「キャロル」を編集' })).toHaveTextContent(
      /対話 2\/\d+/,
    )
    fireEvent.click(screen.getByRole('button', { name: '対話をつづける' }))
    expect(lastBot()).toBe('キャロルの性別を教えてください。（任意）')
    // 選択肢と自由記述の両方が出る
    expect(screen.getByRole('button', { name: '男' })).toBeInTheDocument()
    expect(screen.getByLabelText('答え')).toBeInTheDocument()
  })

  it('フォームの対話ノートは、質問セットの無い分類でも残っている答えを表示する', () => {
    setup([entry({ id: 'y', name: '妖', category: '妖怪', dialog: { title: { text: '山の主' } } })])
    openEntry('妖')
    const note = screen.getByRole('region', { name: '対話ノート' })
    expect(within(note).getByText('山の主')).toBeInTheDocument()
    expect(within(note).getByText(/カテゴリを選ぶと問いに結びつきます/)).toBeInTheDocument()
  })

  it('フォームの対話ノートは、種類を変えて枝から外れた答えも表示する（データの表示場所を無くさない）', () => {
    setup([
      entry({
        id: 'r',
        name: '街道',
        category: '場所',
        dialog: { kind: { text: '自然' }, route: { text: '北から南へ' } },
      }),
    ])
    openEntry('街道')
    const note = screen.getByRole('region', { name: '対話ノート' })
    expect(within(note).getByText('北から南へ')).toBeInTheDocument()
    expect(within(note).getByText(/今の種類では聞かない答え/)).toBeInTheDocument()
  })

  it('フォームの対話ノートから答えを書き換え・公開の印を切り替えられる（鍵ごとのパッチ）', async () => {
    const { onUpdateDialog } = setup([
      entry({
        id: 'c',
        name: 'キャロル',
        category: '人物',
        dialog: { title: { text: '図書委員' } },
      }),
    ])
    openEntry('キャロル')
    const note = screen.getByRole('region', { name: '対話ノート' })
    // 行を押すと入力欄になる（開くだけでは 30 個の欄を作らない）
    expect(within(note).queryByLabelText('年齢')).toBeNull()
    fireEvent.click(within(note).getByRole('button', { name: '年齢を書く' }))
    const age = within(note).getByLabelText('年齢') as HTMLTextAreaElement
    fireEvent.change(age, { target: { value: '十七' } })
    fireEvent.blur(age)
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenLastCalledWith('c', {
        dialogPatch: { age: { text: '十七', public: true } },
        dialogVersion: 2,
      }),
    )
    // 公開の印を押すと作者だけに
    fireEvent.click(
      within(note).getByRole('button', {
        name: '役職・肩書き：読者に見せる（押すと作者だけに戻す）',
      }),
    )
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenLastCalledWith('c', {
        dialogPatch: { title: { text: '図書委員', public: false } },
        dialogVersion: 2,
      }),
    )
    // 欄を離れると表示に戻る。空にすると答えを消す
    await waitFor(() => expect(within(note).queryByLabelText('年齢')).toBeNull())
    fireEvent.click(within(note).getByRole('button', { name: '年齢を書く' }))
    const age2 = within(note).getByLabelText('年齢') as HTMLTextAreaElement
    fireEvent.change(age2, { target: { value: '' } })
    fireEvent.blur(age2)
    await waitFor(() =>
      expect(onUpdateDialog).toHaveBeenLastCalledWith('c', {
        dialogPatch: { age: null },
        dialogVersion: 2,
      }),
    )
  })

  it('名前の無い新しい項目から別の項目へ移ると、そのまま捨てられる（分類だけなら聞かない）', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    openEntry('アリス')
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('アリス'))
  })

  it('名前の前にフォームへ書いた内容があれば、別の項目へ移る前に捨てるか確認する', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(screen.getByRole('button', { name: 'フォーム' }))
    const memo = screen.getByLabelText('作者メモ')
    fireEvent.change(memo, { target: { value: '正体は王女' } })
    fireEvent.blur(memo)
    openEntry('アリス')
    // まだ移らない
    expect(screen.getByLabelText('作者メモ')).toHaveValue('正体は王女')
    fireEvent.click(await screen.findByRole('button', { name: '捨てる' }))
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('アリス'))
  })

  it('登録された項目の対話で名前を「直す」と改名になる（onRename）', async () => {
    const { onRename } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    answer('キャロル')
    await waitFor(() =>
      expect(lastBot()).toBe('読みがなはありますか。なければスキップで構いません。'),
    )
    fireEvent.click(screen.getByRole('button', { name: '「名前」の答えを直す' }))
    answer('キャロライン')
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith('new-キャロル', 'キャロライン', { rewriteBody: false }),
    )
    const pane = screen.getByRole('region', { name: '対話' })
    expect(pane.textContent).toMatch(/名前を「キャロライン」に直しました/)
    expect(pane.textContent).not.toMatch(/「キャロライン」を用語集に登録しました/)
    expect(screen.getByRole('button', { name: '「キャロライン」を編集' })).toBeInTheDocument()
  })

  it('登録した項目を離れて開き直すと、登録時の会話へは戻らない', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    answer('キャロル')
    await waitFor(() =>
      expect(lastBot()).toBe('読みがなはありますか。なければスキップで構いません。'),
    )
    openEntry('アリス')
    openEntry('キャロル')
    fireEvent.click(dialogTab())
    expect(lastBot()).not.toMatch(/登録しました|読みがな/)
  })

  it('フォームの対話ノートは v1 の人物の答え（背格好・目に留まるところ）を見た目の特徴に畳み、人の呼び方は（旧）で残す', () => {
    setup([
      entry({
        id: 'v',
        name: 'セト',
        category: '人物',
        dialogVersion: 1,
        dialog: {
          looks_body: { text: '小柄' },
          looks_first: { text: '左手の手袋' },
          speech_second: { text: '呼び捨て' },
        },
      }),
    ])
    openEntry('セト')
    const note = screen.getByRole('region', { name: '対話ノート' })
    const looks = within(note).getByRole('button', { name: '見た目の特徴を書く' })
    expect(looks).toHaveTextContent('小柄')
    expect(looks).toHaveTextContent('左手の手袋')
    expect(within(note).getByText('人の呼び方（旧）')).toBeInTheDocument()
    expect(within(note).getByText('呼び捨て')).toBeInTheDocument()
    expect(within(note).queryByText(/looks_first|looks_body|speech_second/)).toBeNull()
  })

  it('公開情報は旧データ（概要＋詳細）を結合して 1 欄で開く', () => {
    setup()
    openEntry('王都')
    // 中身があるので既定はプレビュー＝結合された文が読める
    expect(screen.getByText(/概要のみ/)).toBeInTheDocument()
    expect(screen.getByText(/旧・詳細の文/)).toBeInTheDocument()
  })

  it('公開情報を書いて欄を離れると、結合済みの summary で onUpdate（body は畳む）', async () => {
    const { onUpdate } = setup()
    openEntry('ボブ') // 公開情報が空＝編集モードで開く
    const box = screen.getByLabelText('公開情報')
    fireEvent.change(box, { target: { value: '灯台守。' } })
    fireEvent.blur(box)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('b', expect.objectContaining({ summary: '灯台守。' })),
    )
    // GlossaryFormValues に body は無い＝旧・詳細は保存経路で畳まれる
    expect(onUpdate.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('作者メモも欄を離れるとその場で確定する', async () => {
    const { onUpdate } = setup()
    openEntry('ボブ')
    const note = screen.getByLabelText('作者メモ')
    fireEvent.change(note, { target: { value: '正体は管理AI' } })
    fireEvent.blur(note)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        'b',
        expect.objectContaining({ authorNote: '正体は管理AI' }),
      ),
    )
  })

  it('旧データの項目で別の欄だけ編集しても、公開情報（概要＋詳細）は失われない', async () => {
    // 本番利用者の旧データ保全：無関係な欄の確定が summary/body の中身を落とさないこと。
    const { onUpdate } = setup()
    openEntry('王都') // summary + 旧 body の 2 欄が残る項目
    const note = screen.getByLabelText('作者メモ')
    fireEvent.change(note, { target: { value: '首都の由来はあとで書く' } })
    fireEvent.blur(note)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        't',
        expect.objectContaining({
          summary: '概要のみ\n\n旧・詳細の文',
          authorNote: '首都の由来はあとで書く',
        }),
      ),
    )
  })

  it('名前は blur で onRename され、一覧にも新名が出る', async () => {
    const { onRename } = setup()
    openEntry('アリス')
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: 'アリサ' } })
    fireEvent.blur(name)
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith('a', 'アリサ', { rewriteBody: false }),
    )
    expect(await screen.findByRole('button', { name: '「アリサ」を編集' })).toBeInTheDocument()
  })

  it('改名が重複で reject されるとエラーを表示する', async () => {
    setup()
    openEntry('アリス')
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: '重複名' } })
    fireEvent.blur(name)
    expect(await screen.findByRole('alert')).toHaveTextContent('重複')
  })

  it('カテゴリは固定リストのプルダウン（既存の自由入力値も選択肢に残る）', () => {
    setup()
    openEntry('王都')
    const select = screen.getByLabelText('カテゴリ') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toEqual(['未分類', '人物', '場所', '組織', '用語', 'アイテム', '生物', '地名'])
    expect(select.value).toBe('地名') // 旧・自由入力値が保全される
  })

  it('削除は確認後に onDelete、一覧から消えて選択も解ける', async () => {
    const { onDelete } = setup()
    openEntry('アリス')
    fireEvent.click(screen.getByRole('button', { name: '「アリス」を削除' }))
    fireEvent.click(await screen.findByRole('button', { name: '削除する' }))
    expect(onDelete).toHaveBeenCalledWith('a')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '「アリス」を編集' })).toBeNull(),
    )
    expect(screen.queryByLabelText('名前')).toBeNull()
  })

  it('プレビューの [[用語]] クリックは右のチラ見で開き、編集対象は変わらない', async () => {
    setup()
    openEntry('アリス') // 公開情報に [[ボブ]] が居る＝既定プレビューでリンクになる
    const ref = await screen.findByRole('link', { name: 'ボブ' })
    fireEvent.click(ref)
    // チラ見ドロワーにボブが出るが、編集面はアリスのまま（書いている場所を失わない）
    const peek = await screen.findByRole('complementary', { name: '用語のチラ見' })
    expect(within(peek).getByRole('heading', { name: 'ボブ' })).toBeInTheDocument()
    expect(screen.getByLabelText('名前')).toHaveValue('アリス')
    // 「この項目を編集」で初めて切り替わり、ドロワーは閉じる
    fireEvent.click(within(peek).getByRole('button', { name: 'この項目を編集' }))
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('ボブ'))
    expect(screen.queryByRole('complementary', { name: '用語のチラ見' })).toBeNull()
  })

  it('チラ見は閉じるボタンで消え、編集面はそのまま', async () => {
    setup()
    openEntry('アリス')
    fireEvent.click(await screen.findByRole('link', { name: 'ボブ' }))
    const peek = await screen.findByRole('complementary', { name: '用語のチラ見' })
    fireEvent.click(within(peek).getByRole('button', { name: 'チラ見を閉じる' }))
    expect(screen.queryByRole('complementary', { name: '用語のチラ見' })).toBeNull()
    expect(screen.getByLabelText('名前')).toHaveValue('アリス')
  })

  it('項目が無い時は空状態を表示', () => {
    setup([])
    expect(screen.getByText(/まだ用語集がありません/)).toBeInTheDocument()
  })
})
