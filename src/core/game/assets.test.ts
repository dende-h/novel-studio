import { describe, expect, it } from 'vitest'
import {
  HOSTED_ASSET_LIMIT,
  HOSTED_ASSET_MAX_BYTES,
  hostedAssetVerdict,
  isUserAssetKey,
  UserGameAssetSchema,
  userAssetKey,
} from './assets'

describe('game/assets — キーとスキーマ', () => {
  it('userAssetKey / isUserAssetKey が対応する', () => {
    expect(userAssetKey('abc')).toBe('user:abc')
    expect(isUserAssetKey('user:abc')).toBe(true)
    expect(isUserAssetKey('preset:bg/room-day')).toBe(false)
  })

  it('UserGameAssetSchema は data URL 以外の dataUrl を弾く', () => {
    const base = {
      id: 'a1',
      kind: 'bg',
      name: '海辺',
      tone: ['#111111', '#222222', '#333333'],
      createdAt: 1,
    }
    expect(
      UserGameAssetSchema.safeParse({ ...base, dataUrl: 'data:image/webp;base64,SGk=' }).success,
    ).toBe(true)
    expect(UserGameAssetSchema.safeParse({ ...base, dataUrl: 'https://evil/x.png' }).success).toBe(
      false,
    )
  })
})

describe('game/assets — クラウド保管の判定（hostedAssetVerdict）', () => {
  const asset = (id: string, size = 100) => ({ id, dataUrl: 'x'.repeat(size) })
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

  it('空きがあれば ok', () => {
    expect(hostedAssetVerdict(asset('new'), ids(0))).toBe('ok')
    expect(hostedAssetVerdict(asset('new'), ids(HOSTED_ASSET_LIMIT - 1))).toBe('ok')
  })

  it('上限に達していたら limit_reached', () => {
    expect(hostedAssetVerdict(asset('new'), ids(HOSTED_ASSET_LIMIT))).toBe('limit_reached')
  })

  it('同じ id の置き換えは上限でも ok（枚数に数えない）', () => {
    expect(hostedAssetVerdict(asset('id-0'), ids(HOSTED_ASSET_LIMIT))).toBe('ok')
  })

  it('大きすぎる素材は too_large（上限判定より優先）', () => {
    expect(hostedAssetVerdict(asset('new', HOSTED_ASSET_MAX_BYTES + 1), ids(0))).toBe('too_large')
    expect(hostedAssetVerdict(asset('new', HOSTED_ASSET_MAX_BYTES), ids(0))).toBe('ok')
  })
})
