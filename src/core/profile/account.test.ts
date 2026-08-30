import { describe, expect, it } from 'vitest'
import { penNameForAccount } from './account'

/**
 * ペンネームをアカウントのものにする判定。
 *
 * いちばん効かせたいのは**アカウントを切り替えたら前の人の名前が残らない**こと。
 * ここが緩むと、別のアカウントでサインインした人が前の利用者の名前のまま
 * 掲示板に書き込める（記名式の掲示板でいちばん高くつく事故）。
 */
describe('penNameForAccount', () => {
  it('未サインインでは何もしない（ローカルだけで書く人の名前を触らない）', () => {
    expect(
      penNameForAccount({ local: { penName: '夜半' }, userId: null, serverName: '別の名' }),
    ).toEqual({ action: 'keep' })
  })

  it('サーバに名前があれば、それに合わせる（改名も別端末の変更も届く）', () => {
    expect(
      penNameForAccount({
        local: { penName: '古い名', accountId: 'user_1' },
        userId: 'user_1',
        serverName: '新しい名',
      }),
    ).toEqual({ action: 'adopt', penName: '新しい名' })
  })

  it('同じ名前を同じアカウントで持っていれば書き込まない（LWW を無意味に揺らさない）', () => {
    expect(
      penNameForAccount({
        local: { penName: '夜半', accountId: 'user_1' },
        userId: 'user_1',
        serverName: '夜半',
      }),
    ).toEqual({ action: 'keep' })
  })

  it('印の無いローカル名でも、サーバに名前があればそちらを採る', () => {
    // サインイン前に決めた名前より、アカウントに登録済みの名前が優先される。
    expect(
      penNameForAccount({ local: { penName: '仮の名' }, userId: 'user_1', serverName: '夜半' }),
    ).toEqual({ action: 'adopt', penName: '夜半' })
  })

  it('サーバに名前が無く、ローカルの名前が別アカウントのものなら伏せる', () => {
    expect(
      penNameForAccount({
        local: { penName: '前の人', accountId: 'user_1' },
        userId: 'user_2',
        serverName: null,
      }),
    ).toEqual({ action: 'clear' })
  })

  it('サーバに名前が無く、ローカルの名前が誰のものでもなければ残す（勝手に登録しない）', () => {
    // 表示名は全体で一意なので、黙って登録すると同じ名前の別の人が先着で弾かれる。
    expect(
      penNameForAccount({ local: { penName: '仮の名' }, userId: 'user_1', serverName: null }),
    ).toEqual({ action: 'keep' })
    expect(penNameForAccount({ local: {}, userId: 'user_1', serverName: null })).toEqual({
      action: 'keep',
    })
  })

  it('サーバに名前が無く、同じアカウントの印が付いていれば残す', () => {
    expect(
      penNameForAccount({
        local: { penName: '夜半', accountId: 'user_1' },
        userId: 'user_1',
        serverName: null,
      }),
    ).toEqual({ action: 'keep' })
  })

  it('空白だけのサーバ名は「無い」として扱う', () => {
    expect(
      penNameForAccount({
        local: { penName: '前の人', accountId: 'user_1' },
        userId: 'user_2',
        serverName: '   ',
      }),
    ).toEqual({ action: 'clear' })
  })
})
