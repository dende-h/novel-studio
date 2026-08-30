import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfileDialog, type ProfileSubmitResult } from './profile-dialog'

/**
 * プロフィール（＝アカウントのペンネーム）を変える唯一の画面。
 *
 * 固定したいのは 3 つ。
 *   1. **サインイン中は名前の使われ道を言い切る**（掲示板の表示名にもなる・過去の書き込みも変わる）。
 *   2. **掲示板と同じ判定**（`validateDisplayName`）で、保存できたのに掲示板で弾かれる名前を作らない。
 *   3. **保存に失敗したら閉じない・入力も消さない**（重複は往復して初めて分かる）。
 */

const ok = async (): Promise<ProfileSubmitResult> => ({ ok: true })

function open(
  onSubmit: (v: { penName: string; avatar: string }) => Promise<ProfileSubmitResult> = ok,
  props: { signedIn?: boolean; penName?: string; onOpenChange?: (o: boolean) => void } = {},
) {
  return render(
    <ProfileDialog
      open
      onOpenChange={props.onOpenChange ?? (() => {})}
      initial={{ penName: props.penName ?? '', avatar: '' }}
      signedIn={props.signedIn ?? false}
      onSubmit={onSubmit}
    />,
  )
}

describe('ProfileDialog', () => {
  it('サインイン中は、名前がどこに出るか・どこには出ないかを言う', () => {
    open(ok, { signedIn: true })
    // 出る場所（作品の著者・掲示板）と、変えたときの及ぶ範囲（過去の書き込みも）。
    expect(screen.getByText(/掲示板の表示名になります/)).toBeInTheDocument()
    expect(screen.getByText(/これまでの書き込みも新しい名前で表示されます/)).toBeInTheDocument()
    // **出ない場所**も言う。公開サイトの作者名は別に持っているので、ここを変えても動かない。
    // これを書かないと「知らないうちに公開済みの作品の著者名が変わった」と読まれる。
    expect(
      screen.getByText(/公開サイトの作者名は別の設定なので、ここでは変わりません/),
    ).toBeInTheDocument()
  })

  it('未サインインでは掲示板の話をしない（まだ関係がない）', () => {
    open(ok, { signedIn: false })
    expect(screen.queryByText(/掲示板/)).toBeNull()
  })

  it('掲示板と同じ判定で弾く。理由を出し、保存は押せない', () => {
    const onSubmit = vi.fn(ok)
    open(onSubmit, { signedIn: true })

    fireEvent.change(screen.getByLabelText('ペンネーム'), { target: { value: '運営' } })
    expect(screen.getByRole('alert')).toHaveTextContent('この名前は使えません')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('文字数は保存される形（正規化後）で数える', () => {
    open(ok, { signedIn: true })
    // 前後の空白は保存前に落ちるので数に入れない。
    fireEvent.change(screen.getByLabelText('ペンネーム'), { target: { value: '  夜半  ' } })
    expect(screen.getByText('2/24')).toBeInTheDocument()
  })

  it('空欄は咎めない（未設定に戻すのは正当な操作）', () => {
    open(ok, { signedIn: true, penName: '夜半' })
    fireEvent.change(screen.getByLabelText('ペンネーム'), { target: { value: '' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('保存に失敗したら閉じない。理由を出し、入力は消さない', async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn(async () => ({
      ok: false as const,
      message: 'この表示名は、すでに使われています。ほかの名前でお試しください',
    }))
    open(onSubmit, { signedIn: true, onOpenChange })

    fireEvent.change(screen.getByLabelText('ペンネーム'), { target: { value: '夜半' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('すでに使われています')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('ペンネーム')).toHaveValue('夜半')
  })

  it('通信が投げても入力を巻き上げない（書きかけのアバターごと消さない）', async () => {
    const onOpenChange = vi.fn()
    open(
      async () => {
        throw new Error('boom')
      },
      { signedIn: true, onOpenChange },
    )

    fireEvent.change(screen.getByLabelText('ペンネーム'), { target: { value: '夜半' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('通信できませんでした')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('保存できたら、前後の空白を落とした名前を渡して閉じる', async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn(ok)
    open(onSubmit, { signedIn: true, onOpenChange })

    fireEvent.change(screen.getByLabelText('ペンネーム'), { target: { value: '  夜半  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSubmit).toHaveBeenCalledWith({ penName: '夜半', avatar: '' })
  })
})
