import {
  Bot,
  Check,
  ChevronRight,
  Copy,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Unplug,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  generateMcpToken,
  getMcpTokenStatus,
  type McpTokenStatus,
  revokeMcpToken,
} from '@/ui/_api/mcp'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

/**
 * 非エンジニアの作者が自分の AI に貼るだけで設定できる「設定おまかせプロンプト」。
 * AI 自身に A（自分で設定できる開発者向けツール）/ B（会話だけのアプリ→手順を案内）を判断させ、
 * 静的 Bearer 非対応の AI では正直に「つなげない」と言わせる（過剰約束を避ける）。
 * {{URL}} と {{TOKEN}} を実値に置換して使う。
 */
const SETUP_PROMPT_TEMPLATE = `あなたは、パソコンや AI の設定が苦手な小説作者（私）をサポートする、とても親切なアシスタントです。専門用語やターミナル、JSON は私にはわかりません。むずかしい言葉は使わず、私がつまずいている一点だけを、一度に一つずつ、やさしい日本語で案内してください。

これから私は、自分が書いた小説を「あなた（この AI）に読んでもらえるようにする設定」をしたいです。これは「リモート MCP」というしくみで、私の小説アプリにあなたがつながり、作品を【読むだけ】できるようになるものです。書き換え・削除・投稿は一切できません。うまくいかなくても私のデータが壊れることはないので、安心して進めてください。

━━━━━━━━━━━━━━━━
■ 接続に使う情報（この2つを使います）
・接続先アドレス（MCP サーバー URL）：{{URL}}
・あいことば（アクセストークン）：{{TOKEN}}
　（このトークンは私の作品を読める「鍵」です。他人に見せたり、SNS やチャットに貼り直させたりしないでください。画面やログに繰り返し表示しないでください。）

■ 技術メモ（あなた＝AI 向け）
・通信方式は「Streamable HTTP（JSON-RPC 2.0）」。認証は HTTP ヘッダーに「Authorization: Bearer {{TOKEN}}」を1行付けるだけです。
・使える読み取りツールは3つだけ：list_works（作品一覧）／ get_work（作品の本文）／ get_glossary（作品の設定資料・図鑑）。これ以外（書き込み等）はできない仕様です。
━━━━━━━━━━━━━━━━

■ まず、あなた自身がどちらのタイプか、あなた自身で判断してください

【A：自分で設定できるタイプ】＝私のパソコンでコマンドを実行したり、設定ファイルを自分で編集できる（例：Claude Code、Cursor、Gemini CLI など）
　→ あなたのツールの正しい書式で、このリモート MCP を自分で追加してください。参考までに url＋headers 形式なら次が使えます（そのまま使わず、あなたのツールの正式な書式に合わせて調整してください）：
　{"mcpServers":{"novel-studio":{"url":"{{URL}}","headers":{"Authorization":"Bearer {{TOKEN}}"}}}}
　設定を保存して、必要なら再読み込み（再起動）してください。可能なら、トークンはファイルに平文で残さず環境変数などで扱ってください。

【B：会話で答えるだけのタイプ】＝私のパソコンのファイルやコマンドは直接いじれない（例：ChatGPT、Gemini アプリ、Claude のアプリ／ブラウザ版、Grok など）
　→ あなた自身のアプリで「外部のコネクター（MCP）を追加する」設定画面までの行き方を、実際のメニュー名・ボタン名で、1メッセージにつき手順1〜2個までで案内してください。私が「できました」と言ってから次へ進んでください。入力欄が出たら、上の「URL」を URL 欄へ、「Authorization: Bearer {{TOKEN}}」を認証（ヘッダー／API キー）欄へ、どこに何を貼るかまで指定してください。「Bearer」のうしろの半角スペースを消さない、URL の前後に余計な空白を入れない、といったハマりやすい点も先回りで教えてください。

どちらか迷う場合は、勝手に両方やらず、私に「あなたは○○というアプリですか？」と一つだけ質問して確かめてから進めてください。

■ とても大切なお願い（正直に教えてください）
お使いの AI によっては、この「あいことば（Bearer トークン）」方式での接続に対応しておらず、つなげないことがあります（例：ChatGPT アプリや個人向け Gemini アプリは、この形式のトークンに未対応の場合があります）。もしあなたがこの方式に対応していない、または接続できない場合は、無理に進めず「このアプリではこの方法では直接つなげません」と正直に教えてください。そのうえで、対応している別の AI（Claude Code / Cursor / Claude デスクトップ など）で同じ設定をする場合の貼り方も、上の URL とヘッダーを使う形で用意してください。

■ 最後に、必ず動作確認してください
設定できたら、いきなり本文を読む前に、まず「list_works」ツールを1回だけ呼んで、私の作品一覧（タイトルと話数）を出してください。ここに私の作品名が並べば接続成功です。「接続できました。あなたの作品◯件が読めます」のように、私がわかる一言でまとめてください（トークン全体を再表示する必要はありません）。並ばない・エラーになるときは、原因（トークンの貼り間違い・URL 違い・そのアプリが未対応、など）を私にわかる言葉で説明し、直し方を教えてください。

それでは、あなたが A と B のどちらとして進めるかを一言で宣言してから、案内を始めてください。`

interface McpConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Clerk JWT を取得（API 認証）。 */
  getToken: () => Promise<string | null>
  /** 接続直後に最新状態をライブスナップショットへ送る（初回の空読みを防ぐ）。 */
  pushLive: () => Promise<void>
  /** 接続状態の変化を親へ通知（ライブ push の有効/無効を切り替える）。 */
  onConnectedChange: (connected: boolean) => void
  /** 完了通知（トースト）。 */
  onNotify: (message: string) => void
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

/** 値＋コピーボタンの 1 行（トークン・URL・設定コマンド用）。 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* クリップボード不可の環境では選択コピーに任せる */
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <p className="font-sans text-on-surface-variant text-xs">{label}</p>
      <div className="flex min-w-0 items-stretch gap-2">
        {/* URL/トークン/コマンドは長い1トークンになりがち。break-all で必ず折り返し、grid 列が
            max-content まで広がってダイアログをはみ出すのを防ぐ（max-h＋スクロールで縦も抑制）。 */}
        <code className="max-h-24 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-surface-container-highest px-2 py-1.5 font-mono text-on-surface text-xs">
          {value}
        </code>
        <Button
          size="icon"
          variant="outline"
          onClick={copy}
          aria-label={`${label}をコピー`}
          className="shrink-0"
        >
          {copied ? (
            <Check className="size-4 text-primary" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  )
}

/** 目立つ全幅コピー・ボタン（長い設定プロンプト用。中身は行内に出さず「コピー」に集約）。 */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* クリップボード不可の環境では下の「中身を見る」から手動選択に任せる */
    }
  }
  return (
    <Button onClick={copy} className="h-auto w-full gap-2 whitespace-normal py-3 text-center">
      {copied ? (
        <Check className="size-4 shrink-0" aria-hidden />
      ) : (
        <Sparkles className="size-4 shrink-0" aria-hidden />
      )}
      {copied ? 'コピーしました' : label}
    </Button>
  )
}

/**
 * AI・MCP アクセス（read-only リモート MCP）の接続管理（会員のみ）。
 * トークンを発行して AI クライアント（Claude Code/Desktop 等）に貼れば、AI が作品を「読む」だけできる。
 * 書き込みは無い。トークンは作品を読める鍵なので共有しない／漏れたら失効させる。平文表示は発行時の一度きり。
 */
export function McpConnectDialog({
  open,
  onOpenChange,
  getToken,
  pushLive,
  onConnectedChange,
  onNotify,
}: McpConnectDialogProps) {
  const [status, setStatus] = useState<McpTokenStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [plaintext, setPlaintext] = useState<string | null>(null) // 発行直後のみ表示
  const [reissue, setReissue] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false) // 設定プロンプトの中身プレビュー
  const [showAdvanced, setShowAdvanced] = useState(false) // 詳しい人向け（URL/JSON 等）

  const mcpUrl = `${window.location.origin}/api/mcp`
  // 各 AI クライアントに合わせて貼れる設定（実トークンを埋め込む。平文が無い＝再表示不可）。
  const setupPrompt = plaintext
    ? SETUP_PROMPT_TEMPLATE.replaceAll('{{URL}}', mcpUrl).replaceAll('{{TOKEN}}', plaintext)
    : ''
  const authHeader = plaintext ? `Bearer ${plaintext}` : ''
  const jsonConfig = plaintext
    ? JSON.stringify(
        {
          mcpServers: {
            'novel-studio': { url: mcpUrl, headers: { Authorization: `Bearer ${plaintext}` } },
          },
        },
        null,
        2,
      )
    : ''
  const cliCommand = plaintext
    ? `claude mcp add --transport http novel-studio ${mcpUrl} --header "Authorization: Bearer ${plaintext}"`
    : ''

  const load = useCallback(async () => {
    const s = await getMcpTokenStatus(getToken)
    setStatus(s)
    onConnectedChange(s.hasToken)
  }, [getToken, onConnectedChange])

  // 「開いた瞬間」だけリセット＆読込する。開いている間の再レンダー（親が毎回新しい getToken を
  // 渡す等で load の識別子が変わる）で発行直後の平文トークンが消えないようにするための防御。
  const prevOpen = useRef(false)
  useEffect(() => {
    const justOpened = open && !prevOpen.current
    prevOpen.current = open
    if (!justOpened) return
    setPlaintext(null)
    setAgreed(false)
    setReissue(false)
    setShowPrompt(false)
    setShowAdvanced(false)
    setStatus(null)
    void load()
  }, [open, load])

  const generate = async () => {
    setBusy(true)
    try {
      const token = await generateMcpToken(getToken)
      if (!token) {
        onNotify('トークンの発行に失敗しました')
        return
      }
      setPlaintext(token)
      setReissue(false)
      await pushLive() // 接続直後に最新を上げておく（AI の初回読みが空にならないように）
      await load()
      onNotify('AI に接続しました')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    try {
      const ok = await revokeMcpToken(getToken)
      if (ok) {
        setPlaintext(null)
        onConnectedChange(false)
        await load()
        onNotify('接続を解除しました（トークンを失効）')
      } else {
        onNotify('解除に失敗しました')
      }
    } finally {
      setBusy(false)
    }
  }

  const connected = status?.hasToken === true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-primary">
            <Bot className="size-5" aria-hidden />
            AI に接続（MCP）
          </DialogTitle>
          <DialogDescription>
            お使いの AI（Claude Code・Cursor・Gemini CLI など）に、あなたの作品を
            <strong>読むだけ</strong>させる設定です。発行後の
            <strong>プロンプトを AI に貼るだけ</strong>
            。むずかしい言葉やターミナルの知識はいりません。AI
            は読み取り専用で、書き込み・削除はできません。
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {/* 情報の流れと漏えいリスクの明示（オプトイン） */}
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
              接続すると、編集した内容がクラウドに保存され AI
              が読めるようになります。トークンは作品を読める
              <strong>鍵</strong>
              です。第三者に共有せず、漏れたと思ったら「接続を解除」で失効させてください。
            </p>
          </div>

          {/* 発行直後だけ設定を表示（トークン平文は再表示できない）。主役は「AIに貼るだけ」プロンプト。 */}
          {plaintext && (
            <div className="min-w-0 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="font-sans text-on-surface text-xs">
                <strong>接続情報を発行しました。</strong>
                この画面を閉じると<strong>二度と表示できません</strong>。今すぐ設定してください。
              </p>

              {/* 主役：AI に貼るだけの設定プロンプト */}
              <div className="space-y-2">
                <p className="font-sans text-on-surface text-sm leading-relaxed">
                  下のボタンでコピーして、お使いの AI（ChatGPT・Gemini・Claude・Grok・Cursor
                  など）に貼って送ってください。あとは AI が設定を手伝ってくれます。
                </p>
                <CopyButton label="設定おまかせプロンプトをコピー" value={setupPrompt} />
                <button
                  type="button"
                  onClick={() => setShowPrompt((v) => !v)}
                  className="font-sans text-on-surface-variant text-xs underline underline-offset-2"
                >
                  {showPrompt ? 'プロンプトの中身を隠す' : 'プロンプトの中身を見る'}
                </button>
                {showPrompt && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container-highest p-2 font-sans text-on-surface-variant text-xs leading-relaxed">
                    {setupPrompt}
                  </pre>
                )}
              </div>

              {/* 補助：詳しい人向け（URL・トークンを自分で設定） */}
              <div className="border-outline-variant/30 border-t pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1 font-sans text-on-surface-variant text-xs"
                >
                  <ChevronRight
                    className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-90')}
                    aria-hidden
                  />
                  詳しい人向け（URL・トークンを自分で設定）
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-2">
                    <CopyRow label="アクセストークン" value={plaintext} />
                    <CopyRow label="MCP サーバー URL" value={mcpUrl} />
                    <CopyRow label="Authorization ヘッダー" value={authHeader} />
                    <CopyRow
                      label="設定 JSON（Cursor など url＋headers 形式）"
                      value={jsonConfig}
                    />
                    <CopyRow label="Claude Code（CLI）" value={cliCommand} />
                  </div>
                )}
              </div>

              <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
                ※ 静的トークンで確実につながるのは <strong>Claude Code・Cursor・Gemini CLI</strong>{' '}
                など。ChatGPT アプリや個人向け Gemini
                アプリなどは対応しておらず、つながらないことがあります（その場合はプロンプトが正直に案内します）。
              </p>
            </div>
          )}

          {status === null ? (
            <p className="py-4 text-center text-on-surface-variant text-sm">読み込み中…</p>
          ) : connected ? (
            <div className="min-w-0 space-y-3">
              <p className="font-sans text-on-surface text-sm">
                接続中
                {status.createdAt != null && (
                  <span className="text-on-surface-variant"> ・ 発行 {fmt(status.createdAt)}</span>
                )}
              </p>

              {/* 再接続時（平文が無い）は URL のみ表示。偽トークン入りのコマンドは出さない。 */}
              {!plaintext && (
                <>
                  <CopyRow label="MCP サーバー URL" value={mcpUrl} />
                  <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
                    アクセストークンは<strong>発行時にしか表示されません</strong>
                    。分からなくなった／設定をやり直す場合は「トークンを再発行」してください（設定情報がまとめて再表示されます）。
                  </p>
                </>
              )}

              <div className="flex gap-2 pt-1">
                {reissue ? (
                  <>
                    <span className="flex-1 self-center text-destructive text-xs">
                      再発行すると今のトークンは無効になります。
                    </span>
                    <Button size="sm" onClick={generate} disabled={busy}>
                      再発行する
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setReissue(false)}
                      disabled={busy}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={() => setReissue(true)}
                      disabled={busy}
                    >
                      <RefreshCw className="size-4" aria-hidden />
                      トークンを再発行
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 gap-2 text-destructive hover:text-destructive"
                      onClick={revoke}
                      disabled={busy}
                    >
                      <Unplug className="size-4" aria-hidden />
                      接続を解除
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-2 font-sans text-on-surface-variant text-xs">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                読み取り専用であることを理解し、作品をクラウド経由で AI に読ませることに同意します。
              </label>
              <Button onClick={generate} disabled={busy || !agreed} className="w-full gap-2">
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Bot className="size-4" aria-hidden />
                )}
                接続する（トークンを発行）
              </Button>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
