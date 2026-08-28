import { describe, expect, it } from 'vitest'
import {
  addBeat,
  addSection,
  beatsInStoryOrder,
  beatsOfSection,
  countOpenForeshadows,
  countUnrevealedSecrets,
  createPlotFromTemplate,
  emptyPlot,
  foreshadowStatus,
  foreshadowsOfBeat,
  isTrivialPlot,
  linesOfBeat,
  moveBeat,
  nextBeatStatus,
  normalizePlot,
  type Plot,
  type PlotBeat,
  PlotSchema,
  pickPrimaryPlot,
  removeBeat,
  removeLine,
  removeSecret,
  removeSection,
  removeWorldNote,
  secretStatus,
  secretsHiddenAt,
  sectionOfBeat,
  sectionTargetTotal,
  setWorldNote,
  singletonPlotId,
  updateBeat,
  upsertForeshadow,
  upsertSecret,
  WORLD_SLOTS,
  worldNoteLabel,
  worldNotesInOrder,
} from './index'

const beat = (id: string, extra: Partial<PlotBeat> = {}): PlotBeat => ({
  id,
  title: id,
  castRefs: [],
  placeRefs: [],
  lineRefs: [],
  status: 'idea',
  ...extra,
})

/** 幕1つ＋ビート2つの最小プロット。 */
function fixture() {
  let p = emptyPlot('p1', 'w1', 100)
  p = addSection(p, { id: 'sec1', title: '第一幕', beatIds: [] })
  p = addBeat(p, 'sec1', beat('b1'))
  p = addBeat(p, 'sec1', beat('b2'))
  return p
}

describe('plot（スキーマと純関数）', () => {
  it('emptyPlot は空の器を作り、schema 検証を通る', () => {
    const p = emptyPlot('p1', 'w1', 100)
    expect(PlotSchema.parse(p)).toEqual(p)
    expect(isTrivialPlot(p)).toBe(true)
    expect(singletonPlotId('w1')).toBe('w1:plot')
  })

  it('createPlotFromTemplate はテンプレの幕とガイド付きビートを生成する', () => {
    let n = 0
    const p = createPlotFromTemplate('p1', 'w1', 100, 'kishotenketsu', () => `id${++n}`)
    expect(PlotSchema.parse(p)).toEqual(p)
    expect(p.sections.map((s) => s.title)).toEqual(['起', '承', '転', '結'])
    expect(p.beats).toHaveLength(4)
    expect(p.beats[0]?.guide).toBeTruthy()
    // 幕の beatIds とビート実体が一致している
    for (const s of p.sections) expect(beatsOfSection(p, s.id)).toHaveLength(s.beatIds.length)
    // ビートがあるのでもう trivial ではない
    expect(isTrivialPlot(p)).toBe(false)
  })

  it('custom テンプレは空の幕を1つだけ持つ', () => {
    const p = createPlotFromTemplate('p1', 'w1', 100, 'custom', () => 'sec')
    expect(p.sections).toHaveLength(1)
    expect(p.beats).toHaveLength(0)
    expect(isTrivialPlot(p)).toBe(true) // 幕だけなら自動生成と区別しない
  })

  it('addBeat は index 指定で挿入位置を選べる', () => {
    let p = fixture()
    p = addBeat(p, 'sec1', beat('b0'), 0)
    expect(p.sections[0]?.beatIds).toEqual(['b0', 'b1', 'b2'])
    // 存在しない幕へは no-op
    expect(addBeat(p, 'nope', beat('bx'))).toBe(p)
  })

  it('updateBeat / removeBeat（削除で幕の beatIds からも外れる）', () => {
    let p = fixture()
    p = updateBeat(p, 'b1', { summary: '手紙が届く', status: 'fixed' })
    expect(p.beats.find((b) => b.id === 'b1')).toMatchObject({
      summary: '手紙が届く',
      status: 'fixed',
    })
    p = removeBeat(p, 'b1')
    expect(p.beats.map((b) => b.id)).toEqual(['b2'])
    expect(p.sections[0]?.beatIds).toEqual(['b2'])
  })

  it('moveBeat は幕またぎの移動と同一幕内の並べ替えに使える', () => {
    let p = fixture()
    p = addSection(p, { id: 'sec2', title: '第二幕', beatIds: [] })
    p = moveBeat(p, 'b1', 'sec2', 0)
    expect(p.sections[0]?.beatIds).toEqual(['b2'])
    expect(p.sections[1]?.beatIds).toEqual(['b1'])
    // 同一幕内の並べ替え
    p = moveBeat(p, 'b2', 'sec1', 0)
    expect(p.sections[0]?.beatIds).toEqual(['b2'])
    // 存在しない幕へは no-op
    expect(moveBeat(p, 'b1', 'nope', 0)).toBe(p)
  })

  it('removeSection はビートを隣の幕へ逃がし、最後の1幕は消さない', () => {
    let p = fixture()
    p = addSection(p, { id: 'sec2', title: '第二幕', beatIds: [] })
    p = moveBeat(p, 'b2', 'sec2', 0)
    p = removeSection(p, 'sec2') // 先頭でない幕→前の幕の末尾へ
    expect(p.sections.map((s) => s.id)).toEqual(['sec1'])
    expect(p.sections[0]?.beatIds).toEqual(['b1', 'b2'])
    expect(removeSection(p, 'sec1')).toBe(p) // 最後の1幕は no-op
  })

  it('removeLine はビート側の lineRefs も外す', () => {
    let p = fixture()
    p = { ...p, lines: [{ id: 'l1', title: 'メイン' }] }
    p = updateBeat(p, 'b1', { lineRefs: ['l1'] })
    p = removeLine(p, 'l1')
    expect(p.lines).toHaveLength(0)
    expect(p.beats.find((b) => b.id === 'b1')?.lineRefs).toEqual([])
  })

  it('伏線の状態は導出され、ビート削除で orphan に落ちる', () => {
    let p = fixture()
    const resolved = { id: 'f1', title: '手紙の署名', plantBeatId: 'b1', payoffBeatId: 'b2' }
    p = upsertForeshadow(p, resolved)
    expect(foreshadowStatus(resolved, p)).toBe('resolved')
    expect(countOpenForeshadows(p)).toBe(0)
    p = removeBeat(p, 'b1') // 張ったビートを削除→回収だけ残る＝根なし
    expect(foreshadowStatus(resolved, p)).toBe('orphan')
    expect(countOpenForeshadows(p)).toBe(1)
    const replanted = { id: 'f1', title: '手紙の署名', plantBeatId: 'b2' }
    p = upsertForeshadow(p, replanted)
    expect(foreshadowStatus(replanted, p)).toBe('planted')
  })

  it('sectionTargetTotal は幕の予定文字数を合算する', () => {
    let p = fixture()
    p = updateBeat(p, 'b1', { targetLength: 8000 })
    p = updateBeat(p, 'b2', { targetLength: 4000 })
    expect(sectionTargetTotal(p, 'sec1')).toBe(12000)
  })

  it('beatsInStoryOrder は幕の順→幕内の順で並べ、どの幕にも載っていないビートは出さない', () => {
    let p = fixture()
    p = addSection(p, { id: 'sec2', title: '第二幕', beatIds: [] })
    p = addBeat(p, 'sec2', beat('b3'))
    // 幕の beatIds に載らない「浮いたビート」（同期の取りこぼし等）は並びに入れない。
    p = { ...p, beats: [...p.beats, beat('floating')] }
    expect(beatsInStoryOrder(p).map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('sectionOfBeat はビートの属する幕を引く（浮いたビートは undefined）', () => {
    let p = fixture()
    p = addSection(p, { id: 'sec2', title: '第二幕', beatIds: [] })
    p = moveBeat(p, 'b2', 'sec2', 0)
    expect(sectionOfBeat(p, 'b1')?.title).toBe('第一幕')
    expect(sectionOfBeat(p, 'b2')?.title).toBe('第二幕')
    expect(sectionOfBeat(p, 'nope')).toBeUndefined()
  })

  it('foreshadowsOfBeat は張る側・回収側の両方を返す', () => {
    let p = fixture()
    p = upsertForeshadow(p, { id: 'f1', title: '手紙', plantBeatId: 'b1', payoffBeatId: 'b2' })
    p = upsertForeshadow(p, { id: 'f2', title: '傷跡', plantBeatId: 'b2' })
    expect(foreshadowsOfBeat(p, 'b1').map((f) => f.id)).toEqual(['f1'])
    expect(foreshadowsOfBeat(p, 'b2').map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(foreshadowsOfBeat(p, 'nope')).toEqual([])
  })

  // MCP は lineRefs を配列のまま書けるので、画面が 1 件しか出さないと 2 件目が読めなくなる。
  it('linesOfBeat は lineRefs の順に解決し、消えたラインは落とす', () => {
    let p = fixture()
    p = {
      ...p,
      lines: [
        { id: 'l1', title: 'メイン' },
        { id: 'l2', title: 'ユキ編' },
      ],
    }
    p = updateBeat(p, 'b1', { lineRefs: ['l2', 'l1', 'gone'] })
    const pick = (id: string) => {
      const found = p.beats.find((b) => b.id === id)
      if (!found) throw new Error(`${id} が無い`)
      return found
    }
    expect(linesOfBeat(p, pick('b1')).map((l) => l.title)).toEqual(['ユキ編', 'メイン'])
    expect(linesOfBeat(p, pick('b2'))).toEqual([])
  })

  it('nextBeatStatus は 検討中→確定→執筆中→済→検討中 と循環する', () => {
    expect(nextBeatStatus('idea')).toBe('fixed')
    expect(nextBeatStatus('fixed')).toBe('writing')
    expect(nextBeatStatus('writing')).toBe('done')
    expect(nextBeatStatus('done')).toBe('idea')
  })
})

describe('secret（読者に伏せる情報と開示タイミング）', () => {
  it('開示ビート未設定は unrevealed、設定すると revealed、keepHidden は kept', () => {
    let p = fixture()
    const s = { id: 'sec1', title: 'ユキの正体', truth: '三年前に死んだレンの妹' }
    p = upsertSecret(p, s)
    expect(secretStatus(s, p)).toBe('unrevealed')
    expect(countUnrevealedSecrets(p)).toBe(1)

    const revealed = { ...s, revealBeatId: 'b2' }
    p = upsertSecret(p, revealed)
    expect(secretStatus(revealed, p)).toBe('revealed')
    expect(countUnrevealedSecrets(p)).toBe(0)

    // 最後まで明かさないと決めた秘密は点検対象から外れる
    const kept = { id: 'sec2', title: '語り手の正体', keepHidden: true }
    p = upsertSecret(p, kept)
    expect(secretStatus(kept, p)).toBe('kept')
    expect(countUnrevealedSecrets(p)).toBe(0)
  })

  it('開示ビートを削除すると unrevealed に戻る（黙って回収済みにしない）', () => {
    let p = fixture()
    const s = { id: 'sec1', title: 'ユキの正体', revealBeatId: 'b2' }
    p = upsertSecret(p, s)
    expect(secretStatus(s, p)).toBe('revealed')
    p = removeBeat(p, 'b2')
    expect(secretStatus(s, p)).toBe('unrevealed')
    expect(countUnrevealedSecrets(p)).toBe(1)
  })

  it('secretsHiddenAt はその時点で読者がまだ知らない秘密を返す', () => {
    let p = fixture() // sec1 に b1, b2 の順で並ぶ
    p = upsertSecret(p, { id: 'early', title: '早く明かす', revealBeatId: 'b1' })
    p = upsertSecret(p, { id: 'late', title: '後で明かす', revealBeatId: 'b2' })
    p = upsertSecret(p, { id: 'undecided', title: '開示未定' })
    // b1 の時点：b1 で明かす秘密はもう読者が知っている（＝含めない）
    expect(secretsHiddenAt(p, 'b1').map((s) => s.id)).toEqual(['late', 'undecided'])
    // b2 の時点：後で明かす分が消え、未定だけ残る
    expect(secretsHiddenAt(p, 'b2').map((s) => s.id)).toEqual(['undecided'])
    // 存在しないビートは空
    expect(secretsHiddenAt(p, 'nope')).toEqual([])
  })

  it('removeSecret で削除できる', () => {
    let p = fixture()
    p = upsertSecret(p, { id: 'sec1', title: '秘密' })
    p = removeSecret(p, 'sec1')
    expect(p.secrets).toHaveLength(0)
  })
})

describe('世界観設定（作者専用ノート）', () => {
  const at = 100

  it('定型枠は slot 一致で 1 枠 1 ノートに収束する', () => {
    let p = emptyPlot('p1', 'w1', 1)
    p = setWorldNote(p, { slot: 'rules', body: '死者は生き返らない' }, 'n1', at)
    p = setWorldNote(p, { slot: 'rules', body: '死者は生き返らない。ただし一度だけ' }, 'n2', at + 1)
    expect(p.world).toHaveLength(1)
    expect(p.world[0]?.id).toBe('n1') // 既存 id を保つ＝毎回作り直さない
    expect(p.world[0]?.body).toBe('死者は生き返らない。ただし一度だけ')
    expect(p.world[0]?.updatedAt).toBe(at + 1)
  })

  it('定型枠は本文を空にすると枠ごと削除される（空の器を残さない）', () => {
    let p = emptyPlot('p1', 'w1', 1)
    p = setWorldNote(p, { slot: 'rules', body: 'ルール' }, 'n1', at)
    p = setWorldNote(p, { slot: 'rules', body: '   ' }, 'n2', at + 1)
    expect(p.world).toEqual([])
  })

  // 定型枠は器が常に画面にあるので空なら持たなくてよいが、自由枠は作者が作った器そのもの。
  // 足した直後に何も書かずに離れただけで消えると、作った操作が無かったことになる。
  it('自由枠は見出しがあれば本文が空でも残る', () => {
    let p = emptyPlot('p1', 'w1', 1)
    p = setWorldNote(p, { slot: 'custom', title: '食べ物', body: '' }, 'c1', at)
    expect(p.world).toHaveLength(1)
    expect(p.world[0]).toMatchObject({ slot: 'custom', title: '食べ物', body: '' })
    // 見出しが無ければ従来どおり残さない
    expect(
      setWorldNote(emptyPlot('p2', 'w1', 1), { slot: 'custom', body: '' }, 'c2', at).world,
    ).toEqual([])
  })

  it('もともと無い枠を空で保存しても no-op（同一参照を返す）', () => {
    const p = emptyPlot('p1', 'w1', 1)
    expect(setWorldNote(p, { slot: 'rules', body: '' }, 'n1', at)).toBe(p)
  })

  it('自由枠は id ごとに増え、見出しを持てる', () => {
    let p = emptyPlot('p1', 'w1', 1)
    p = setWorldNote(p, { slot: 'custom', title: '食べ物', body: '麦はあるが姿が違う' }, 'c1', at)
    p = setWorldNote(p, { slot: 'custom', title: '通貨', body: '銀貨が基準' }, 'c2', at)
    expect(p.world).toHaveLength(2)
    expect(worldNoteLabel(p.world[0] as never)).toBe('食べ物')
    // id を渡せば既存の自由枠を更新する
    p = setWorldNote(p, { id: 'c1', slot: 'custom', title: '食べ物', body: '麦と芋' }, 'x', at + 1)
    expect(p.world).toHaveLength(2)
    expect(p.world.find((n) => n.id === 'c1')?.body).toBe('麦と芋')
  })

  it('見出しは定型枠がラベル、自由枠は title（無ければ既定文言）', () => {
    let p = emptyPlot('p1', 'w1', 1)
    p = setWorldNote(p, { slot: 'style', body: '一人称' }, 'n1', at)
    p = setWorldNote(p, { slot: 'custom', body: '見出しなし' }, 'c1', at)
    expect(worldNoteLabel(p.world[0] as never)).toBe('語り手と文体')
    expect(worldNoteLabel(p.world[1] as never)).toBe('無題のメモ')
  })

  it('定義から外れた枠は slot 名を見出しにする（中身を「無題」で見失わせない）', () => {
    let p = emptyPlot('p1', 'w1', 1)
    p = setWorldNote(p, { slot: 'legacy-slot', body: '昔の枠に書いたもの' }, 'n1', at)
    expect(worldNoteLabel(p.world[0] as never)).toBe('legacy-slot')
    // 定型枠ではないので、並びは自由枠と同じく後ろへ回る
    expect(worldNotesInOrder(p).map((n) => n.slot)).toEqual(['legacy-slot'])
  })

  it('並び順は WORLD_SLOTS の順 → 自由枠の保存順', () => {
    let p = emptyPlot('p1', 'w1', 1)
    // わざと定義順と逆に入れる
    p = setWorldNote(p, { slot: 'custom', title: '自由', body: 'x' }, 'c1', at)
    p = setWorldNote(p, { slot: 'forbidden', body: 'y' }, 'n1', at)
    p = setWorldNote(p, { slot: 'rules', body: 'z' }, 'n2', at)
    expect(worldNotesInOrder(p).map((n) => n.slot)).toEqual(['rules', 'forbidden', 'custom'])
    expect(worldNotesInOrder(p)).toHaveLength(3)
  })

  it('removeWorldNote で削除でき、無い id は no-op', () => {
    let p = emptyPlot('p1', 'w1', 1)
    p = setWorldNote(p, { slot: 'rules', body: 'ルール' }, 'n1', at)
    expect(removeWorldNote(p, 'nope')).toBe(p)
    p = removeWorldNote(p, 'n1')
    expect(p.world).toEqual([])
  })

  it('世界観設定だけ書いたプロットは「中身なし」ではない', () => {
    let p = emptyPlot('p1', 'w1', 1)
    expect(isTrivialPlot(p)).toBe(true)
    p = setWorldNote(p, { slot: 'rules', body: 'ルール' }, 'n1', at)
    expect(isTrivialPlot(p)).toBe(false)
  })

  it('旧データ（world 欠落）を読み込むと空配列で埋まる', () => {
    const parsed = PlotSchema.parse({
      id: 'p1',
      workId: 'w1',
      title: '本編プロット',
      sections: [],
      beats: [],
      lines: [],
      foreshadows: [],
      updatedAt: 1,
    })
    expect(parsed.world).toEqual([])
  })

  it('定型枠の key は重複せず、案内文が必ずある', () => {
    const keys = WORLD_SLOTS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain('custom') // 自由枠の予約語と衝突しない
    for (const s of WORLD_SLOTS) expect(s.guide.length).toBeGreaterThan(0)
  })
})

describe('normalizePlot（保存済みレコードの穴埋め）', () => {
  // 永続化層は zod を通さないので、項目を後から足すと「型は必須・実体は undefined」が出る。
  // 実際、world を足した直後にこれで画面が落ちた（プロットを開いてタブを押すと
  // plot.world.filter が TypeError になり、アプリのツリーごと消えた）。
  const legacy = {
    id: 'p1',
    workId: 'w1',
    title: '本編プロット',
    sections: [],
    beats: [],
    lines: [],
    foreshadows: [],
    updatedAt: 1,
  } as unknown as Plot

  it('後から足した配列（secrets・world）を空配列で埋める', () => {
    const p = normalizePlot(legacy)
    expect(p.world).toEqual([])
    expect(p.secrets).toEqual([])
  })

  it('既にある値は触らない', () => {
    const filled = {
      ...legacy,
      secrets: [{ id: 's1', title: '秘密' }],
      world: [{ id: 'n1', slot: 'rules', body: 'ルール', updatedAt: 2 }],
    } as unknown as Plot
    const p = normalizePlot(filled)
    expect(p.secrets).toHaveLength(1)
    expect(p.world).toHaveLength(1)
  })

  it('穴埋めした後は世界観設定の読み書きがそのまま通る', () => {
    const p = setWorldNote(normalizePlot(legacy), { slot: 'rules', body: 'ルール' }, 'n1', 5)
    expect(worldNotesInOrder(p)).toHaveLength(1)
  })

  it('欠落したままでも導出関数は落ちない（Repository を通らない経路の保険）', () => {
    expect(isTrivialPlot(legacy)).toBe(true)
    expect(worldNotesInOrder(legacy)).toEqual([])
    // 複数プロットの選別は比較関数が secrets/world を読む＝ここが最初に踏まれる
    const other = { ...legacy, id: 'p2', updatedAt: 2 } as unknown as Plot
    expect(pickPrimaryPlot([legacy, other])?.id).toBeDefined()
  })
})
