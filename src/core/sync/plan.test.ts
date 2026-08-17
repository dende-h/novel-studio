// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planReconcile } from './plan'
import type { PlanInput, RemoteWorkMeta, SyncBase } from './types'

/**
 * planReconcile の仕様マトリクス（#1〜#18）を 1 ケース最低 1 テストで網羅する。
 * ケース番号はコメントで対応づける（docs 側仕様 §B のマトリクス）。
 */

const NOW = 10_000

const remote = (workId: string, over: Partial<RemoteWorkMeta> = {}): RemoteWorkMeta => ({
  workId,
  updatedAt: 100,
  trashedAt: 0,
  deleted: 0,
  docHash: 'h-remote',
  docSize: 10,
  syncedAt: 50,
  ...over,
})

const base = (workId: string, baseHash: string, remoteUpdatedAt = 100): SyncBase => ({
  workId,
  baseHash,
  remoteUpdatedAt,
  syncedAt: 50,
})

const plan = (partial: Partial<PlanInput>) =>
  planReconcile({ now: NOW, localWorks: [], localTrash: [], bases: [], remote: [], ...partial })

describe('planReconcile: ローカルのみ（R 無し）', () => {
  it("#1 L・B無 → 新規 push（base:''・trashedAt:0）", () => {
    const r = plan({ localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h1' }] })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: '', updatedAt: 500, trashedAt: 0 },
    ])
    expect(r.conflicts).toEqual([])
  })

  it('#2 L・B有 → データ保全バイアスで push（conflicts に入れない）', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h1' }],
      bases: [base('w1', 'h1')],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: '', updatedAt: 500, trashedAt: 0 },
    ])
    expect(r.conflicts).toEqual([])
  })

  it('#3 T・B無 → 共有ゴミ箱へ push（updatedAt は cL＝max(updatedAt, trashedAt)）', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 300, trashedAt: 700, hash: 'h1' }],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: '', updatedAt: 700, trashedAt: 700 },
    ])
    expect(r.conflicts).toEqual([])
  })

  it('#4 T・B有 → #3 と同じ保全バイアスの push', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 800, trashedAt: 600, hash: 'h1' }],
      bases: [base('w1', 'h1')],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: '', updatedAt: 800, trashedAt: 600 },
    ])
    expect(r.conflicts).toEqual([])
  })
})

describe('planReconcile: リモートのみ（L/T 無し）', () => {
  it('#5 R live active・B無 → pullContent(null)（他端末の新規）', () => {
    const r = plan({ remote: [remote('w1')] })
    expect(r.ops).toEqual([{ op: 'pullContent', workId: 'w1', toTrashedAt: null }])
  })

  it('#6 R live active・B有 → purgeRemote＋dropBase（この端末で purge 済み）', () => {
    const r = plan({ remote: [remote('w1')], bases: [base('w1', 'h-remote')] })
    expect(r.ops).toEqual([
      { op: 'purgeRemote', workId: 'w1', at: NOW },
      { op: 'dropBase', workId: 'w1' },
    ])
  })

  it('#7 R trashed・B無 → pullContent(R.trashedAt)（共有ゴミ箱を新端末にも）', () => {
    const r = plan({ remote: [remote('w1', { trashedAt: 900 })] })
    expect(r.ops).toEqual([{ op: 'pullContent', workId: 'w1', toTrashedAt: 900 }])
  })

  it('#8 R trashed・B有 → purgeRemote＋dropBase', () => {
    const r = plan({
      remote: [remote('w1', { trashedAt: 900 })],
      bases: [base('w1', 'h-remote')],
    })
    expect(r.ops).toEqual([
      { op: 'purgeRemote', workId: 'w1', at: NOW },
      { op: 'dropBase', workId: 'w1' },
    ])
  })

  it("#6' R live active・B有・リモートが base から前進 → purge せず pull で取り戻す（編集勝ち）", () => {
    const r = plan({
      remote: [remote('w1', { docHash: 'h-newer', updatedAt: 900 })],
      bases: [base('w1', 'h-remote')],
    })
    expect(r.ops).toEqual([{ op: 'pullContent', workId: 'w1', toTrashedAt: null }])
  })

  it("#8' R trashed・B有・リモートが base から前進 → purge せず共有ゴミ箱へ pull", () => {
    const r = plan({
      remote: [remote('w1', { trashedAt: 900, docHash: 'h-newer', updatedAt: 900 })],
      bases: [base('w1', 'h-remote')],
    })
    expect(r.ops).toEqual([{ op: 'pullContent', workId: 'w1', toTrashedAt: 900 }])
  })

  it('#9 R tombstone・B有 → dropBase のみ', () => {
    const r = plan({
      remote: [remote('w1', { deleted: 1, docHash: '' })],
      bases: [base('w1', 'h-old')],
    })
    expect(r.ops).toEqual([{ op: 'dropBase', workId: 'w1' }])
  })

  it('#9 R tombstone・B無 → 何もしない', () => {
    const r = plan({ remote: [remote('w1', { deleted: 1, docHash: '' })] })
    expect(r.ops).toEqual([])
    expect(r.conflicts).toEqual([])
  })
})

describe('planReconcile: 双方 active（#10〜#13）', () => {
  it('#10 !dirty・!remoteChanged → 何もしない', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h-remote' }],
      remote: [remote('w1')],
      bases: [base('w1', 'h-remote', 100)],
    })
    expect(r.ops).toEqual([])
    expect(r.conflicts).toEqual([])
  })

  it('#10 内容一致・B無 → adoptBase（base 記録だけ直す）', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h-remote' }],
      remote: [remote('w1')],
    })
    expect(r.ops).toEqual([
      { op: 'adoptBase', workId: 'w1', hash: 'h-remote', remoteUpdatedAt: 100 },
    ])
  })

  it('#10 内容一致・B の remoteUpdatedAt がずれ → adoptBase', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h-remote' }],
      remote: [remote('w1', { updatedAt: 250 })],
      bases: [base('w1', 'h-remote', 100)],
    })
    expect(r.ops).toEqual([
      { op: 'adoptBase', workId: 'w1', hash: 'h-remote', remoteUpdatedAt: 250 },
    ])
  })

  it('#11 !dirty・remoteChanged → pullContent(null)', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h-base' }],
      remote: [remote('w1', { docHash: 'h-remote', updatedAt: 900 })],
      bases: [base('w1', 'h-base', 100)],
    })
    expect(r.ops).toEqual([{ op: 'pullContent', workId: 'w1', toTrashedAt: null }])
    expect(r.conflicts).toEqual([])
  })

  it('#12 dirty・!remoteChanged → push(base: B.baseHash)', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h-local' }],
      remote: [remote('w1', { docHash: 'h-base' })],
      bases: [base('w1', 'h-base', 100)],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: 'h-base', updatedAt: 500, trashedAt: 0 },
    ])
    expect(r.conflicts).toEqual([])
  })

  it('#12 注記: B無で L.hash===R.docHash は push ではなく #10 の adoptBase になる', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 500, hash: 'h-remote' }],
      remote: [remote('w1')],
    })
    expect(r.ops.map((o) => o.op)).toEqual(['adoptBase'])
  })

  it('#13 競合・cL > R.updatedAt → push(base:R.docHash)＋conflicts winner:local', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 900, hash: 'h-local' }],
      remote: [remote('w1', { docHash: 'h-remote', updatedAt: 100 })],
      bases: [base('w1', 'h-base', 50)],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: 'h-remote', updatedAt: 900, trashedAt: 0 },
    ])
    expect(r.conflicts).toEqual([{ workId: 'w1', winner: 'local' }])
  })

  it('#13 競合・cL <= R.updatedAt → pullContent(null)＋conflicts winner:remote', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 100, hash: 'h-local' }],
      remote: [remote('w1', { docHash: 'h-remote', updatedAt: 900 })],
      bases: [base('w1', 'h-base', 50)],
    })
    expect(r.ops).toEqual([{ op: 'pullContent', workId: 'w1', toTrashedAt: null }])
    expect(r.conflicts).toEqual([{ workId: 'w1', winner: 'remote' }])
  })
})

describe('planReconcile: L と R trashed（#14）', () => {
  it('#14 cL > R.updatedAt → 復活 push(base:R.docHash, trashedAt:0)', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 900, hash: 'h-local' }],
      remote: [remote('w1', { trashedAt: 400, updatedAt: 400 })],
      bases: [base('w1', 'h-remote', 100)],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: 'h-remote', updatedAt: 900, trashedAt: 0 },
    ])
    expect(r.conflicts).toEqual([])
  })

  it('#14 cL <= R.updatedAt・!dirty → trashLocal(R.trashedAt)・conflicts 無し', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 100, hash: 'h-remote' }],
      remote: [remote('w1', { trashedAt: 400, updatedAt: 400 })],
      bases: [base('w1', 'h-remote', 100)],
    })
    expect(r.ops).toEqual([{ op: 'trashLocal', workId: 'w1', trashedAt: 400 }])
    expect(r.conflicts).toEqual([])
  })

  it('#14 cL <= R.updatedAt・dirty → trashLocal＋conflicts winner:remote', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 100, hash: 'h-local' }],
      remote: [remote('w1', { trashedAt: 400, updatedAt: 400 })],
      bases: [base('w1', 'h-base', 100)],
    })
    expect(r.ops).toEqual([{ op: 'trashLocal', workId: 'w1', trashedAt: 400 }])
    expect(r.conflicts).toEqual([{ workId: 'w1', winner: 'remote' }])
  })
})

describe('planReconcile: T と R live active（#15）', () => {
  it('#15 cL > R.updatedAt → patchTrash(T.trashedAt, cL)', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 300, trashedAt: 900, hash: 'h1' }],
      remote: [remote('w1', { updatedAt: 400 })],
    })
    expect(r.ops).toEqual([{ op: 'patchTrash', workId: 'w1', trashedAt: 900, updatedAt: 900 }])
  })

  it('#15 cL <= R.updatedAt・内容不一致 → restoreLocal＋pullContent(null)', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 100, trashedAt: 200, hash: 'h-old' }],
      remote: [remote('w1', { docHash: 'h-remote', updatedAt: 900 })],
    })
    expect(r.ops).toEqual([
      { op: 'restoreLocal', workId: 'w1' },
      { op: 'pullContent', workId: 'w1', toTrashedAt: null },
    ])
  })

  it('#15 cL <= R.updatedAt・内容一致 → restoreLocal＋adoptBase', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 100, trashedAt: 200, hash: 'h-remote' }],
      remote: [remote('w1', { updatedAt: 900 })],
    })
    expect(r.ops).toEqual([
      { op: 'restoreLocal', workId: 'w1' },
      { op: 'adoptBase', workId: 'w1', hash: 'h-remote', remoteUpdatedAt: 900 },
    ])
  })
})

describe('planReconcile: 双方ゴミ箱（#16）', () => {
  it('#16 trashedAt 相違・cL > R.updatedAt → patchTrash', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 100, trashedAt: 900, hash: 'h1' }],
      remote: [remote('w1', { trashedAt: 400, updatedAt: 400 })],
    })
    expect(r.ops).toEqual([{ op: 'patchTrash', workId: 'w1', trashedAt: 900, updatedAt: 900 }])
  })

  it('#16 trashedAt 相違・cL <= R.updatedAt → trashLocal(R.trashedAt)', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 100, trashedAt: 200, hash: 'h1' }],
      remote: [remote('w1', { trashedAt: 800, updatedAt: 800 })],
    })
    expect(r.ops).toEqual([{ op: 'trashLocal', workId: 'w1', trashedAt: 800 }])
  })

  it('#16 trashedAt 同一・B無 → adoptBase のみ', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 100, trashedAt: 500, hash: 'h1' }],
      remote: [remote('w1', { trashedAt: 500, updatedAt: 500, docHash: 'h1' })],
    })
    expect(r.ops).toEqual([{ op: 'adoptBase', workId: 'w1', hash: 'h1', remoteUpdatedAt: 500 }])
  })

  it('#16 trashedAt 同一・B有 → 何もしない', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 100, trashedAt: 500, hash: 'h1' }],
      remote: [remote('w1', { trashedAt: 500, updatedAt: 500, docHash: 'h1' })],
      bases: [base('w1', 'h1', 500)],
    })
    expect(r.ops).toEqual([])
  })
})

describe('planReconcile: R tombstone とローカル実体（#17・#18）', () => {
  it("#17 T・cL > R.updatedAt → 復活 push(base:'', trashedAt:T.trashedAt, updatedAt:cL)", () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 300, trashedAt: 900, hash: 'h1' }],
      remote: [remote('w1', { deleted: 1, docHash: '', updatedAt: 400 })],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: '', updatedAt: 900, trashedAt: 900 },
    ])
  })

  it('#17 T・cL <= R.updatedAt → purgeLocal＋dropBase', () => {
    const r = plan({
      localTrash: [{ workId: 'w1', updatedAt: 100, trashedAt: 200, hash: 'h1' }],
      remote: [remote('w1', { deleted: 1, docHash: '', updatedAt: 900 })],
      bases: [base('w1', 'h1', 100)],
    })
    expect(r.ops).toEqual([
      { op: 'purgeLocal', workId: 'w1' },
      { op: 'dropBase', workId: 'w1' },
    ])
  })

  it("#18 L・cL > R.updatedAt → 復活 push(base:'', trashedAt:0)", () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 900, hash: 'h1' }],
      remote: [remote('w1', { deleted: 1, docHash: '', updatedAt: 400 })],
      bases: [base('w1', 'h1', 100)],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'w1', baseHash: '', updatedAt: 900, trashedAt: 0 },
    ])
    expect(r.conflicts).toEqual([])
  })

  it('#18 L・cL <= R.updatedAt・dirty → purgeLocal＋dropBase＋conflicts winner:remote', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 100, hash: 'h-local' }],
      remote: [remote('w1', { deleted: 1, docHash: '', updatedAt: 900 })],
      bases: [base('w1', 'h-base', 100)],
    })
    expect(r.ops).toEqual([
      { op: 'purgeLocal', workId: 'w1' },
      { op: 'dropBase', workId: 'w1' },
    ])
    expect(r.conflicts).toEqual([{ workId: 'w1', winner: 'remote' }])
  })

  it('#18 L・cL <= R.updatedAt・!dirty → purgeLocal＋dropBase（conflicts 無し）', () => {
    const r = plan({
      localWorks: [{ workId: 'w1', updatedAt: 100, hash: 'h1' }],
      remote: [remote('w1', { deleted: 1, docHash: '', updatedAt: 900 })],
      bases: [base('w1', 'h1', 100)],
    })
    expect(r.ops).toEqual([
      { op: 'purgeLocal', workId: 'w1' },
      { op: 'dropBase', workId: 'w1' },
    ])
    expect(r.conflicts).toEqual([])
  })
})

describe('planReconcile: 決定的順序・複合', () => {
  it('ops は workId 昇順（入力順に依らない）', () => {
    const r = plan({
      localWorks: [
        { workId: 'b', updatedAt: 500, hash: 'hb' },
        { workId: 'a', updatedAt: 500, hash: 'ha' },
      ],
      remote: [remote('c')],
    })
    expect(r.ops.map((o) => o.workId)).toEqual(['a', 'b', 'c'])
  })

  it('同じ入力からは同じ計画（純関数・決定的）', () => {
    const input: PlanInput = {
      now: NOW,
      localWorks: [{ workId: 'w1', updatedAt: 900, hash: 'h-local' }],
      localTrash: [{ workId: 'w2', updatedAt: 100, trashedAt: 200, hash: 'h2' }],
      bases: [base('w1', 'h-base', 50)],
      remote: [
        remote('w1', { docHash: 'h-remote' }),
        remote('w2', { trashedAt: 800, updatedAt: 800 }),
      ],
    }
    expect(planReconcile(input)).toEqual(planReconcile(input))
  })

  it('複数作品が独立に処理される（push と pull の混在）', () => {
    const r = plan({
      localWorks: [{ workId: 'a', updatedAt: 500, hash: 'ha' }],
      remote: [remote('b')],
    })
    expect(r.ops).toEqual([
      { op: 'push', workId: 'a', baseHash: '', updatedAt: 500, trashedAt: 0 },
      { op: 'pullContent', workId: 'b', toTrashedAt: null },
    ])
  })
})
