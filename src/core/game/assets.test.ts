import { describe, expect, it } from 'vitest'
import {
  FREE_IMPORT_LIMIT,
  HOSTED_ASSET_LIMIT,
  HOSTED_ASSET_MAX_BYTES,
  hostedAssetVerdict,
  importVerdict,
  isTemplateAssetId,
  isUserAssetKey,
  pickSprite,
  spriteExpressionsOf,
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

describe('game/assets — 立ち絵の選定（pickSprite / spriteExpressionsOf）', () => {
  const sprite = (id: string, character: string, expression?: string, createdAt = 1) => ({
    id,
    kind: 'sprite',
    character,
    expression,
    createdAt,
  })
  const assets = [
    { id: 'bg1', kind: 'bg', createdAt: 0 }, // 背景は候補に入らない
    sprite('a-smile', '灯', '笑顔', 2),
    sprite('a-normal', '灯', '通常', 1),
    sprite('b-1', '影', undefined, 3), // 表情省略＝「通常」扱い
  ]

  it('話者の立ち絵から表情で選ぶ（省略・無指定は「通常」）', () => {
    expect(pickSprite(assets, '灯')?.id).toBe('a-normal')
    expect(pickSprite(assets, '灯', '笑顔')?.id).toBe('a-smile')
    expect(pickSprite(assets, '影')?.id).toBe('b-1')
  })

  it('無い表情は「通常」→最初の1枚へ倒す（選べる限り必ず出す）', () => {
    expect(pickSprite(assets, '灯', '泣き')?.id).toBe('a-normal')
    const noNormal = [sprite('x-2', '灯', '笑顔', 2), sprite('x-1', '灯', '怒り', 1)]
    expect(pickSprite(noNormal, '灯', '泣き')?.id).toBe('x-1') // 登録の古い順の先頭
  })

  it('立ち絵の無い話者は undefined', () => {
    expect(pickSprite(assets, '誰か')).toBeUndefined()
  })

  it('spriteExpressionsOf は重複なし・登録の古い順', () => {
    expect(spriteExpressionsOf(assets, '灯')).toEqual(['通常', '笑顔'])
    expect(spriteExpressionsOf(assets, '影')).toEqual(['通常'])
    expect(spriteExpressionsOf(assets, '誰か')).toEqual([])
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

  it('テンプレ由来（tpl-）は枚数に数えない（保存も既存カウントも）', () => {
    expect(isTemplateAssetId('tpl-abc')).toBe(true)
    expect(isTemplateAssetId('abc')).toBe(false)
    // 上限いっぱいでもテンプレは保存できる
    expect(hostedAssetVerdict(asset('tpl-new'), ids(HOSTED_ASSET_LIMIT))).toBe('ok')
    // 既存にテンプレが混ざっていても、数えるのは持ち込み分だけ
    const withTemplates = [...ids(HOSTED_ASSET_LIMIT - 1), 'tpl-a', 'tpl-b']
    expect(hostedAssetVerdict(asset('new'), withTemplates)).toBe('ok')
  })
})

describe('game/assets — 持ち込みの無料枠（importVerdict）', () => {
  it('無料は FREE_IMPORT_LIMIT 枚まで、会員は無制限', () => {
    expect(importVerdict(FREE_IMPORT_LIMIT - 1, false)).toBe('ok')
    expect(importVerdict(FREE_IMPORT_LIMIT, false)).toBe('free_limit')
    expect(importVerdict(FREE_IMPORT_LIMIT * 10, true)).toBe('ok')
  })
})
