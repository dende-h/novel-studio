import { LoaderCircle, UserPen } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { type AuthorStatus, PEN_NAME_MAX, registerAuthor } from '@/ui/_api/author'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { Textarea } from '@/ui/components/ui/textarea'

interface AuthorRegisterCardProps {
  /** 公開サイト側の現在の状態（初期ペンネームに使う）。取れていなければ null。 */
  status: AuthorStatus | null
  getToken: () => Promise<string | null>
  /** 登録できたら、公開ページ側の状態を更新して投稿へ進めるようにする。 */
  onRegistered: (penName: string) => void
}

/**
 * 作者登録カード。
 *
 * 公開サイトへの投稿には作者登録が要る。それを「公開ボタンを押した瞬間に別サイトへ飛ばされる」
 * 形で知らせると、書き終えたところで手が止まる。ここで名前を決めて、そのまま公開まで進める。
 *
 * ガイドライン同意は公開サイトのモーダルと同じ条件（既定オフ・チェックしないと押せない）。
 */
export function AuthorRegisterCard({ status, getToken, onRegistered }: AuthorRegisterCardProps) {
  const uid = useId()
  // 状態が先に分かっていれば初期値から入れる（あとから届いたときは下の effect が拾う）
  const [penName, setPenName] = useState(() => status?.penName ?? '')
  const [bio, setBio] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 公開サイトの表示名を初期値にする（読者としての名前をそのまま使う人が多いため）。
  // 作者が手を入れたあとは上書きしない。
  useEffect(() => {
    if (status?.penName) setPenName((prev) => (prev === '' ? status.penName : prev))
  }, [status?.penName])

  const name = penName.trim()
  const canSubmit = name !== '' && name.length <= PEN_NAME_MAX && agreed && !pending

  const submit = async () => {
    if (!canSubmit) return
    setPending(true)
    setError(null)
    const res = await registerAuthor(getToken, { penName: name, authorBio: bio })
    setPending(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    onRegistered(res.penName)
  }

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <h2 className="flex items-center gap-2 font-semibold font-serif text-[17px] text-primary">
        <UserPen className="size-[18px]" aria-hidden />
        公開の前に、作者登録
      </h2>
      <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
        公開サイトへ出すのは初めてですね。最初の1回だけ、作者としてのお名前を決めてください。
        ここで登録すれば、そのままこのページから公開できます。
      </p>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${uid}-pen`}>
            ペンネーム <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${uid}-pen`}
            value={penName}
            onChange={(e) => setPenName(e.target.value)}
            maxLength={PEN_NAME_MAX}
            placeholder="霜月 夜半"
          />
          <p className="text-[11px] text-on-surface-variant/70">
            公開サイトでの表示名になります。あとからいつでも変更できます（{PEN_NAME_MAX}字まで）。
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-bio`}>
            作者の自己紹介 <span className="font-normal text-on-surface-variant">（任意）</span>
          </Label>
          <Textarea
            id={`${uid}-bio`}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            placeholder="読者に見せるひとこと。あとで書いても大丈夫です。"
            className="max-h-24"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2 font-sans text-[13px] text-on-surface">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          {/* 文は1つの要素にまとめる。flex 直下にテキストを置くと語ごとに項目化して折り返しが崩れる */}
          <span>
            公開サイトの<strong>投稿ガイドライン</strong>
            に同意します。要点は「全年齢向けであること」「自分自身の一次創作であること」の2つです。
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="gap-2"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            作者登録する
          </Button>
        </div>
      </div>
    </section>
  )
}
