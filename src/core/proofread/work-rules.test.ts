import { describe, expect, it } from 'vitest'
import type { ProofreadDecision, ProofreadRecord } from './decisions'
import type { Finding } from './types'
import {
  addException,
  applyExceptions,
  decline,
  ProofreadRulesSchema,
  removeRule,
  ruleRows,
  setPreference,
  suggestionText,
  suggestRule,
  undecline,
} from './work-rules'

const finding = (over: Partial<Finding>): Finding => ({
  blockId: 'b1',
  blockIndex: 0,
  code: 'ra-nuki',
  start: 0,
  end: 3,
  text: '見れる',
  anchor: 'contains',
  message: '',
  ...over,
})
const miru = finding({ rule: { key: 'ra-nuki:見れる', label: '見れる' } })
const miruNeg = finding({ text: '見れ', rule: { key: 'ra-nuki:見れる', label: '見れる' } })
const kodomoDict = (form: string, text = form) =>
  finding({
    code: 'variant',
    text,
    rule: { key: 'variant:dict:kodomo', label: '子ども・子供' },
    variant: { group: 'dict:kodomo', form, forms: ['子ども', '子供'] },
  })
const autoKodomo = (form: string, forms = ['子ども', '子供']) =>
  finding({
    code: 'variant',
    text: form,
    rule: { key: `variant:auto:${[...forms].sort().join('|')}`, label: forms.join('・') },
    variant: { group: `auto:${[...forms].sort().join('|')}`, form, forms },
  })

const decision = (
  code: string,
  text: string,
  verdict: string,
  decidedAt = 1,
): ProofreadDecision => ({
  blockId: 'b',
  code,
  text,
  nth: 0,
  anchor: 'contains',
  verdict,
  decidedAt,
})
const record = (episodeId: string, decisions: ProofreadDecision[]): ProofreadRecord => ({
  workId: 'w',
  episodeId,
  decisions,
  updatedAt: 1,
})

describe('スキーマ', () => {
  it('配列の欄が無い記録は空で読み、updatedAt が無い記録は読めない', () => {
    expect(ProofreadRulesSchema.parse({ workId: 'w', updatedAt: 1 })).toEqual({
      workId: 'w',
      exceptions: [],
      preferences: [],
      declined: [],
      updatedAt: 1,
    })
    expect(ProofreadRulesSchema.safeParse({ workId: 'w' }).success).toBe(false)
  })
})

describe('例外（FR-1）', () => {
  it('例外を足し、同じ言葉は重ねない。活用違いの指摘にも当たる', () => {
    const r = addException(undefined, 'w', miru, 10)
    expect(r.exceptions).toEqual([{ key: 'ra-nuki:見れる', label: '見れる', at: 10 }])
    expect(addException(r, 'w', miruNeg, 20)).toBe(r)
    expect(applyExceptions([miru, miruNeg, finding({ text: '食べれる' })], r.exceptions)).toEqual([
      finding({ text: '食べれる' }),
    ])
  })

  it('キーの無い指摘からは例外を作らない', () => {
    const indent = finding({ code: 'indent', rule: undefined })
    expect(addException(undefined, 'w', indent, 1).exceptions).toEqual([])
  })

  it('自動の組は、組のキーが変わっても書き方の集合で当たる', () => {
    const r = addException(undefined, 'w', autoKodomo('子供'), 1)
    const grown = autoKodomo('子供', ['こども', '子ども', '子供'])
    expect(
      applyExceptions([grown, autoKodomo('こども', ['こども', '子ども', '子供'])], r.exceptions),
    ).toEqual([autoKodomo('こども', ['こども', '子ども', '子供'])])
  })
})

describe('表記の好み（FR-2）と置き換え', () => {
  it('好みを決めると同じ組の書き分け（例外）が消え、例外を作ると同じ組の好みが消える', () => {
    const allowed = addException(undefined, 'w', kodomoDict('子供'), 1)
    const pref = setPreference(allowed, 'w', kodomoDict('子供').variant!, '子ども', 2)
    expect(pref.exceptions).toEqual([])
    expect(pref.preferences).toEqual([
      { group: 'dict:kodomo', preferred: '子ども', forms: ['子ども', '子供'], at: 2 },
    ])
    const back = addException(pref, 'w', kodomoDict('子供'), 3)
    expect(back.preferences).toEqual([])
    expect(back.exceptions.map((x) => x.key)).toEqual(['variant:dict:kodomo'])
  })

  it('好みを別の書き方に替えると1件のまま置き換わる。同じなら同じ参照', () => {
    const v = kodomoDict('子供').variant!
    const a = setPreference(undefined, 'w', v, '子ども', 1)
    expect(setPreference(a, 'w', v, '子ども', 2)).toBe(a)
    const b = setPreference(a, 'w', v, '子供', 3)
    expect(b.preferences.map((p) => p.preferred)).toEqual(['子供'])
  })

  it('数の好みは助数詞を持つ', () => {
    const v = { group: 'dict:numeral:人', form: '算用', forms: ['算用', '漢数字'], numeral: '人' }
    expect(setPreference(undefined, 'w', v, '漢数字', 1).preferences[0]).toMatchObject({
      numeral: '人',
      preferred: '漢数字',
    })
  })
})

describe('一覧と戻す（FR-3）', () => {
  it('行の書き方：例外と書き分けは理由つき、好みと数は中身だけ', () => {
    let r = addException(undefined, 'w', miru, 1)
    r = addException(
      r,
      'w',
      finding({
        code: 'successive-word',
        rule: { key: 'successive-word:言った言った', label: '言った言った' },
      }),
      2,
    )
    r = addException(
      r,
      'w',
      finding({
        code: 'variant',
        rule: { key: 'variant:dict:numeral:日', label: '「日」の数' },
        variant: {
          group: 'dict:numeral:日',
          form: '算用',
          forms: ['算用', '漢数字'],
          numeral: '日',
        },
      }),
      3,
    )
    r = setPreference(r, 'w', kodomoDict('子供').variant!, '子ども', 4)
    r = setPreference(
      r,
      'w',
      { group: 'dict:numeral:人', form: '算用', forms: ['算用', '漢数字'], numeral: '人' },
      '漢数字',
      5,
    )
    expect(ruleRows(r)).toEqual([
      { id: 'ra-nuki:見れる', text: '「見れる」', reason: 'ら抜き言葉は指摘しない' },
      {
        id: 'successive-word:言った言った',
        text: '「言った言った」',
        reason: '同じ語の連続は指摘しない',
      },
      { id: 'variant:dict:numeral:日', text: '「「日」の数」', reason: '書き分けを許す' },
      { id: 'pref:dict:kodomo', text: '「子ども」にそろえる（子ども・子供）' },
      { id: 'pref:dict:numeral:人', text: '「人」の数は漢数字にそろえる' },
    ])
  })

  it('戻すと消え、当たらなければ同じ参照', () => {
    const r = setPreference(
      addException(undefined, 'w', miru, 1),
      'w',
      kodomoDict('子供').variant!,
      '子ども',
      2,
    )
    expect(removeRule(r, 'ra-nuki:見れる', 3).exceptions).toEqual([])
    expect(removeRule(r, 'pref:dict:kodomo', 3).preferences).toEqual([])
    expect(removeRule(r, 'nothing', 3)).toBe(r)
  })
})

describe('提案（FR-4）', () => {
  it('同じ言葉の「このまま」が全話で3回になったら例外を提案する（2回では出さない）', () => {
    const two = [
      record('e1', [decision('ra-nuki', '見れる', 'keep'), decision('ra-nuki', '見れる', 'keep')]),
    ]
    expect(
      suggestRule({ last: { finding: miru, verdict: 'keep' }, records: two, rules: undefined }),
    ).toBeNull()
    const three = [...two, record('e2', [decision('ra-nuki', '見れる', 'keep')])]
    const s = suggestRule({
      last: { finding: miru, verdict: 'keep' },
      records: three,
      rules: undefined,
    })
    expect(s).toMatchObject({ kind: 'exception', key: 'ra-nuki:見れる', count: 3 })
    expect(s && suggestionText(s)).toBe(
      '「見れる」を3回このままにしました。この作品では指摘しないようにしますか？',
    )
  })

  it('直前の判断が対象外・「直す」・決まりがある・提案しないなら出さない', () => {
    const three = [
      record(
        'e1',
        [1, 2, 3].map(() => decision('ra-nuki', '見れる', 'keep')),
      ),
    ]
    expect(suggestRule({ last: null, records: three, rules: undefined })).toBeNull()
    expect(
      suggestRule({ last: { finding: miru, verdict: 'fix' }, records: three, rules: undefined }),
    ).toBeNull()
    const indent = finding({ code: 'indent' })
    expect(
      suggestRule({ last: { finding: indent, verdict: 'keep' }, records: three, rules: undefined }),
    ).toBeNull()
    const ruled = addException(undefined, 'w', miru, 1)
    expect(
      suggestRule({ last: { finding: miru, verdict: 'keep' }, records: three, rules: ruled }),
    ).toBeNull()
    const s = suggestRule({
      last: { finding: miru, verdict: 'keep' },
      records: three,
      rules: undefined,
    })
    const declined = decline(undefined, 'w', s!, 1)
    expect(
      suggestRule({ last: { finding: miru, verdict: 'keep' }, records: three, rules: declined }),
    ).toBeNull()
    expect(declined.declined).toEqual([
      { kind: 'exception', key: 'ra-nuki:見れる', label: '見れる', at: 1 },
    ])
    expect(undecline(declined, 'ra-nuki:見れる', 2).declined).toEqual([])
  })

  it('辞書の組は判断の文字列を書き方に当て直して数える（「た事が」「る事に」は同じ「事」）', () => {
    const koto = finding({
      code: 'variant',
      text: 'る事に',
      rule: { key: 'variant:dict:koto', label: '事・こと' },
      variant: { group: 'dict:koto', form: '事', forms: ['事', 'こと'] },
    })
    const records = [
      record('e1', [decision('variant', 'た事が', 'fix')]),
      record('e2', [decision('variant', 'る事に', 'fix')]),
    ]
    const s = suggestRule({ last: { finding: koto, verdict: 'fix' }, records, rules: undefined })
    expect(s).toMatchObject({
      kind: 'preference',
      from: '事',
      to: ['こと'],
      count: 2,
      key: 'dict:koto|事',
    })
    expect(s && suggestionText(s)).toBe(
      '「事」を2回直すと決めました。この作品は「こと」にそろえますか？',
    )
  })

  it('数は「3人」「5人」を同じ「人」の算用数字として数え、数の文言で提案する', () => {
    const three = finding({
      code: 'variant',
      text: '5人',
      rule: { key: 'variant:dict:numeral:人', label: '「人」の数' },
      variant: { group: 'dict:numeral:人', form: '算用', forms: ['算用', '漢数字'], numeral: '人' },
    })
    const records = [
      record('e1', [decision('variant', '3人', 'fix'), decision('variant', '5人', 'fix')]),
    ]
    const s = suggestRule({ last: { finding: three, verdict: 'fix' }, records, rules: undefined })
    expect(s && suggestionText(s)).toBe(
      '算用数字の「人」を2回直すと決めました。この作品の「人」は漢数字にそろえますか？',
    )
  })

  it('自動の組は文字列で数え、好みや書き分けがある組には提案しない', () => {
    const f = autoKodomo('子供')
    const records = [
      record('e1', [decision('variant', '子供', 'fix'), decision('variant', '子供', 'fix')]),
    ]
    expect(
      suggestRule({ last: { finding: f, verdict: 'fix' }, records, rules: undefined }),
    ).toMatchObject({
      kind: 'preference',
      to: ['子ども'],
    })
    const pref = setPreference(undefined, 'w', f.variant!, '子ども', 1)
    expect(suggestRule({ last: { finding: f, verdict: 'fix' }, records, rules: pref })).toBeNull()
    const allowed = addException(undefined, 'w', f, 1)
    expect(
      suggestRule({ last: { finding: f, verdict: 'fix' }, records, rules: allowed }),
    ).toBeNull()
  })

  it('書き方が3つ以上の組は、そろえる先を選ばせる文言', () => {
    const f = autoKodomo('子供', ['こども', '子ども', '子供'])
    const records = [
      record('e1', [decision('variant', '子供', 'fix'), decision('variant', '子供', 'fix')]),
    ]
    const s = suggestRule({ last: { finding: f, verdict: 'fix' }, records, rules: undefined })
    expect(s).toMatchObject({ to: ['こども', '子ども'] })
    expect(s && suggestionText(s)).toBe(
      '「子供」を2回直すと決めました。この作品の表記をそろえますか？',
    )
  })
})
