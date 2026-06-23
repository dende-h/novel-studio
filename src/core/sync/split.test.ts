import { describe, expect, it } from 'vitest'
import type { GlossaryEntry, Work } from '../schema'
import { joinWork, splitWork } from './split'

const DATA_URL = 'data:image/jpeg;base64,AAAA'
const COVER_URL = 'data:image/png;base64,BBBB'

const entry = (over: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  id: 'g1',
  name: '勇者',
  aliases: [],
  createdAt: 1,
  updatedAt: 2,
  ...over,
})

const baseWork = (over: Partial<Work> = {}): Work => ({
  id: 'w1',
  title: '物語',
  episodes: [
    {
      id: 'e1',
      title: '第一話',
      blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ type: 'text', text: 'あ' }] }],
    },
  ],
  ...over,
})

describe('splitWork / joinWork（doc・media 分割のロスレス往復）', () => {
  it('coverImage を media へ分離し、doc には残さない', () => {
    const work = baseWork({ coverImage: COVER_URL })
    const { doc, media } = splitWork(work)
    expect('coverImage' in doc).toBe(false)
    expect(media).toEqual({ coverImage: COVER_URL, thumbnails: {} })
    expect(joinWork(doc, media)).toEqual(work)
  })

  it('glossary[].thumbnail を media.thumbnails へ entry id で集約する', () => {
    const work = baseWork({
      glossary: [entry({ id: 'g1', thumbnail: DATA_URL }), entry({ id: 'g2', name: '魔王' })],
    })
    const { doc, media } = splitWork(work)
    expect(doc.glossary?.every((g) => !('thumbnail' in g))).toBe(true)
    expect(media).toEqual({ thumbnails: { g1: DATA_URL } })
    expect(joinWork(doc, media)).toEqual(work)
  })

  it('画像が無ければ media は null（R2 に media を作らない）', () => {
    const work = baseWork({ glossary: [entry()] })
    const { media } = splitWork(work)
    expect(media).toBeNull()
    expect(joinWork(splitWork(work).doc, null)).toEqual(work)
  })

  it('glossary キーが無い Work は doc にも glossary キーを作らない', () => {
    const work = baseWork()
    const { doc } = splitWork(work)
    expect('glossary' in doc).toBe(false)
    expect(joinWork(doc, null)).toEqual(work)
  })

  it('空の glossary 配列は doc 側でも空配列のまま保たれる', () => {
    const work = baseWork({ glossary: [] })
    const { doc, media } = splitWork(work)
    expect(doc.glossary).toEqual([])
    expect(media).toBeNull()
    expect(joinWork(doc, media)).toEqual(work)
  })

  it('coverImage と thumbnail を両方持つ Work も完全に往復する', () => {
    const work = baseWork({
      coverImage: COVER_URL,
      author: '作者',
      description: 'あらすじ',
      updatedAt: 999,
      glossary: [entry({ id: 'g1', thumbnail: DATA_URL }), entry({ id: 'g2', name: '姫' })],
    })
    const { doc, media } = splitWork(work)
    expect(joinWork(doc, media)).toEqual(work)
  })
})
