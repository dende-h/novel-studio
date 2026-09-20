import { Bot, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { type ConsentInfo, decideConsent, fetchConsent } from '@/ui/_api/oauth'
import { useAuth } from '@/ui/auth/auth-context'
import { PageLayout } from '@/ui/components/PageLayout/page-layout'
import { Button } from '@/ui/components/ui/button'

/**
 * AI（MCP クライアント）からの接続要求に、許可を出す画面。`#/connect?rid=…`。
 *
 * `/api/oauth/authorize` がここへ 302 で送り、押した結果を `/api/oauth/consent` が
 * 認可コードに変えて飛び先の URL を返す（画面は URL を組み立てない）。
 * ログインは既存の Clerk モーダルを使う——**ページの URL が変わらないので戻り先の受け渡しが要らない**。
 */

/** 画面が出す状態。読み込み中と、失敗の理由を分けて持つ。 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; info: ConsentInfo }
  | { kind: 'signin' }
  | { kind: 'expired' }
  | { kind: 'plan' }
  | { kind: 'failed' }

/** `#/connect?rid=…` から rid を取り出す（ハッシュルーティングなので自前で切る）。 */
function ridFromHash(): string {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('rid') ?? ''
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-outline-variant/20 border-b py-3 last:border-b-0">
      <span className="shrink-0 text-[13px] text-on-surface-variant">{label}</span>
      <span className="break-all text-right font-medium text-[14px] text-on-surface">{value}</span>
    </div>
  )
}

export function OAuthConsentPage() {
  const auth = useAuth()
  const [rid] = useState(ridFromHash)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!rid) {
      setPhase({ kind: 'expired' })
      return
    }
    const result = await fetchConsent(auth.getToken, rid)
    if (result.ok) setPhase({ kind: 'ready', info: result.info })
    else if (result.error === 'unauthorized') setPhase({ kind: 'signin' })
    else if (result.error === 'expired') setPhase({ kind: 'expired' })
    else setPhase({ kind: 'failed' })
  }, [auth.getToken, rid])

  // 認証の状態が定まってから読む（loading の間に走らせると必ず未ログイン扱いになる）。
  useEffect(() => {
    if (auth.status === 'loading') return
    void load()
  }, [auth.status, load])

  const decide = async (approve: boolean) => {
    setBusy(true)
    try {
      const result = await decideConsent(auth.getToken, rid, approve)
      if (result.ok) {
        // 飛び先は AI 側の URL。戻れない前提なので replace で置き換える。
        window.location.replace(result.redirect)
        return
      }
      if (result.error === 'subscription_required') setPhase({ kind: 'plan' })
      else if (result.error === 'unauthorized') setPhase({ kind: 'signin' })
      else if (result.error === 'expired') setPhase({ kind: 'expired' })
      else setPhase({ kind: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageLayout
      title="AI からの接続"
      description="この AI に、作品の読み書きを許可するかを決めます"
    >
      {phase.kind === 'loading' && (
        <p className="flex items-center gap-2 text-[13px] text-on-surface-variant">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          確認しています…
        </p>
      )}

      {phase.kind === 'signin' && (
        <div className="space-y-4">
          <p className="text-[14px] text-on-surface leading-relaxed">
            許可するには、コトノハ-leaf- にログインしてください。
          </p>
          <Button type="button" onClick={() => auth.openSignIn()}>
            ログイン
          </Button>
        </div>
      )}

      {phase.kind === 'expired' && (
        <p className="text-[14px] text-on-surface leading-relaxed">
          この接続の要求は期限が切れています。AI の画面から、もう一度接続をやり直してください。
        </p>
      )}

      {phase.kind === 'failed' && (
        <div className="space-y-4">
          <p className="text-[14px] text-on-surface leading-relaxed">
            接続の確認に失敗しました。時間をおいて、AI の画面からやり直してください。
          </p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            もう一度試す
          </Button>
        </div>
      )}

      {phase.kind === 'plan' && (
        <div className="space-y-4">
          <p className="text-[14px] text-on-surface leading-relaxed">
            AI との接続は、クラウド版の機能です。プランに入ると、AI
            から作品を読み書きできるようになります。
          </p>
          <Button type="button" onClick={() => window.location.assign('#/plan')}>
            プランを見る
          </Button>
        </div>
      )}

      {phase.kind === 'ready' && (
        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-lg bg-surface-container-highest p-4">
            <Bot className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p className="text-[14px] text-on-surface leading-relaxed">
              <strong>{phase.info.clientName ?? '名前のない AI'}</strong> が、あなたの作品への
              アクセスを求めています。
            </p>
          </div>

          <div>
            {phase.info.redirectHost && <Row label="接続先" value={phase.info.redirectHost} />}
            <Row label="許可する範囲" value="作品の読み取りと書き換え" />
            <Row label="有効期間" value="許可を取り消すまで" />
          </div>

          <div className="space-y-2 text-[13px] text-on-surface-variant leading-relaxed">
            <p>
              許可すると、この AI は作品の一覧・本文・用語集・世界観設定・プロットを読み、
              書き換えられます。クラウドバックアップの作成と復元もできます。
            </p>
            <p>
              AI が書き換えた内容はクラウドに入り、アプリの「AIの変更を取り込む」を押すまで、
              この端末の原稿は変わりません。
            </p>
            <p>許可はあとから「AI に接続（MCP）」の画面で取り消せます。</p>
          </div>

          <div className="flex gap-3">
            <Button type="button" onClick={() => void decide(true)} disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : '許可する'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void decide(false)}
              disabled={busy}
            >
              許可しない
            </Button>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
