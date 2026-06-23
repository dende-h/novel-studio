import { describe, expect, it } from 'vitest'
import { resolvePull, resolvePush } from './lww'

const side = (updatedAt: number, docHash: string, mediaHash = '') => ({
  updatedAt,
  docHash,
  mediaHash,
})

describe('resolvePull（pull 時の LWW 判定）', () => {
  it('ローカルに無ければ無条件に取得（退避不要）', () => {
    expect(resolvePull(null, side(10, 'r'))).toEqual({
      action: 'take-remote',
      snapshotLocal: false,
    })
  })

  it('ハッシュ一致なら何もしない', () => {
    expect(resolvePull(side(10, 'same', 'm'), side(99, 'same', 'm'))).toEqual({
      action: 'noop',
      snapshotLocal: false,
    })
  })

  it('remote が新しく内容が違えば取得し、上書き前にローカルを退避する', () => {
    expect(resolvePull(side(10, 'local'), side(20, 'remote'))).toEqual({
      action: 'take-remote',
      snapshotLocal: true,
    })
  })

  it('ローカルの方が新しければローカルを残す（後で push）', () => {
    expect(resolvePull(side(30, 'local'), side(20, 'remote'))).toEqual({
      action: 'keep-local',
      snapshotLocal: false,
    })
  })

  it('更新時刻が同じで内容が違えばローカルを残す（タイはローカル優先）', () => {
    expect(resolvePull(side(10, 'local'), side(10, 'remote'))).toEqual({
      action: 'keep-local',
      snapshotLocal: false,
    })
  })
})

describe('resolvePush（変わったパートだけ push）', () => {
  it('未アップロード（against=null）・media 有り → doc と media を送る', () => {
    expect(resolvePush({ docHash: 'd', mediaHash: 'm' }, null)).toEqual({ doc: true, media: true })
  })

  it('未アップロード・media 無し → doc だけ送る', () => {
    expect(resolvePush({ docHash: 'd', mediaHash: '' }, null)).toEqual({ doc: true, media: false })
  })

  it('両方一致 → 何も送らない', () => {
    const h = { docHash: 'd', mediaHash: 'm' }
    expect(resolvePush(h, h)).toEqual({ doc: false, media: false })
  })

  it('doc だけ変わった → doc だけ送る', () => {
    expect(
      resolvePush({ docHash: 'd2', mediaHash: 'm' }, { docHash: 'd1', mediaHash: 'm' }),
    ).toEqual({
      doc: true,
      media: false,
    })
  })

  it('media だけ変わった（削除含む）→ media だけ送る', () => {
    expect(resolvePush({ docHash: 'd', mediaHash: '' }, { docHash: 'd', mediaHash: 'm' })).toEqual({
      doc: false,
      media: true,
    })
  })
})
