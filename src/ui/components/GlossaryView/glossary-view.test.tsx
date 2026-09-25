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
function setup(initial: GlossaryEntry[] = ENTRIES, opts: { draftKey?: string } = {}) {
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
                    ...(patch.category !== undefined
                      ? { category: patch.category || undefined }
                      : {}),
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
        draftKey={opts.draftKey}
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

  it('「新しく登録」は対話で開き、フォームに切り替えて名前だけでも登録できる（登録するまで保存しない）', async () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    // 対話タブで開き、最初に分類を聞く
    expect(screen.getByRole('button', { name: '対話 –' })).toHaveAttribute('aria-pressed', 'true')
    expect(dialogChip('人物')).toBeInTheDocument()
    // フォームに切り替えて名前を入れる。この時点では onCreate は呼ばれない
    fireEvent.click(screen.getByRole('button', { name: 'フォーム' }))
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: 'キャロル' } })
    fireEvent.blur(name)
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '用語集に登録' }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'キャロル' })),
    )
    // 作成した項目が選ばれ、編集面で続きを書ける（一覧にも出る）
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('キャロル'))
    expect(screen.getByRole('button', { name: '「キャロル」を編集' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '用語集に登録' })).toBeNull()
  })

  it('登録が重複で reject されるとエラーを表示し、下書きを保つ', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(screen.getByRole('button', { name: 'フォーム' }))
    const name = screen.getByLabelText('名前')
    fireEvent.change(name, { target: { value: 'アリス' } })
    fireEvent.blur(name)
    fireEvent.click(screen.getByRole('button', { name: '用語集に登録' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('重複')
    expect(screen.getByLabelText('名前')).toHaveValue('アリス')
    expect(screen.getByRole('button', { name: '用語集に登録' })).toBeInTheDocument()
  })

  it('対話で新規：分類→名前→…と一問ずつ答え、「用語集に登録する」で答えごと作られる', async () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    expect(lastBot()).toBe('まず、名前を教えてください。')
    // 名前の重複はその場で断られ、同じ問いを待つ
    answer('アリス')
    expect(lastBot()).toMatch(/もうあります/)
    answer('キャロル')
    expect(lastBot()).toBe('読みがなはありますか。なければスキップで構いません。')
    // 見出し（名前）も下書きに追いつく
    expect(screen.getByRole('heading', { name: /用語集/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'スキップ' })) // reading
    fireEvent.click(screen.getByRole('button', { name: 'スキップ' })) // aliases
    answer('主人公の友人。') // blurb
    expect(lastBot()).toBe('キャロルの役職や肩書き、立場を教えてください。')
    answer('図書委員')
    // 答えの吹き出しに公開の印（プロフィール＝読者に見せるが既定）と「直す」
    expect(
      screen.getByRole('button', { name: '読者に見せる（押すと作者だけに戻す）' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '「役職・肩書き」の答えを直す' })).toBeInTheDocument()
    // 残りは全部あとでにして、まとめまで進む
    let guard = 0
    while (screen.queryByRole('button', { name: 'あとで答える' }) && guard++ < 60) {
      fireEvent.click(screen.getByRole('button', { name: 'あとで答える' }))
      const dig = screen.queryByRole('button', { name: '次へ' })
      if (dig) fireEvent.click(dig)
    }
    expect(lastBot()).toMatch(/ひと通り聞きました/)
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '用語集に登録する' }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'キャロル',
          category: '人物',
          summary: '主人公の友人。',
          dialog: expect.objectContaining({ title: { text: '図書委員', public: true } }),
        }),
      ),
    )
    // 登録後はその項目のフォームが開く
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('キャロル'))
    expect(screen.getByRole('button', { name: 'フォーム' })).toHaveAttribute('aria-pressed', 'true')
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
        dialogVersion: 1,
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
        dialog: { title: { text: '図書委員' }, age: { text: '', later: true } },
      }),
    ])
    openEntry('キャロル')
    expect(screen.getByRole('button', { name: '「キャロル」を編集' })).toHaveTextContent(
      /対話 1\/\d+・あとで 1/,
    )
    fireEvent.click(screen.getByRole('button', { name: '対話をつづける' }))
    expect(lastBot()).toBe('キャロルの性別を教えてください。（任意）')
    // 選択肢と自由記述の両方が出る
    expect(screen.getByRole('button', { name: '男' })).toBeInTheDocument()
    expect(screen.getByLabelText('答え')).toBeInTheDocument()
  })

  it('書きかけの下書きは画面を離れて戻っても残る（同じ作品の鍵）', () => {
    const first = setup(ENTRIES, { draftKey: 'work-1' })
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    answer('キャロル')
    first.unmount()
    setup(ENTRIES, { draftKey: 'work-1' })
    // 対話タブで開き、下書きの名前が見出しに残っている
    expect(screen.getByLabelText('名前')).toHaveValue('キャロル')
    expect(dialogTab()).toHaveAttribute('aria-pressed', 'true')
  })

  it('チラ見の「この項目を編集」で下書きを捨てる確認をキャンセルすると、チラ見も下書きも残る', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    answer('キャロル')
    answer('きゃろる') // 読み
    fireEvent.click(screen.getByRole('button', { name: 'スキップ' })) // 別名
    answer('[[アリス]]の友人。') // 公開情報＝吹き出しの [[アリス]] がリンクになる
    fireEvent.click(await screen.findByRole('link', { name: 'アリス' }))
    const peek = await screen.findByRole('complementary', { name: '用語のチラ見' })
    fireEvent.click(within(peek).getByRole('button', { name: 'この項目を編集' }))
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }))
    expect(screen.getByRole('complementary', { name: '用語のチラ見' })).toBeInTheDocument()
    expect(screen.getByLabelText('名前')).toHaveValue('キャロル')
  })

  it('書きかけの下書きから別の項目へ移るときは確認し、捨てると一覧の項目が開く', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '新しく登録' }))
    fireEvent.click(dialogChip('人物'))
    answer('キャロル')
    openEntry('アリス')
    fireEvent.click(await screen.findByRole('button', { name: '捨てる' }))
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('アリス'))
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
