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
 * CLI 系 AI（Claude Code / Cursor / Gemini CLI など）にそのまま貼れる「設定おまかせプロンプト」。
 * {{URL}} と {{TOKEN}} を実値に置換して使う。ChatGPT アプリ等の会話専用クライアントは対象外
 * （このアプリで動作確認できているのは Claude コネクタ・Genspark コネクタ・CLI の3系統）。
 */
const CLI_SETUP_PROMPT = `これから「リモート MCP」を設定します。私の小説アプリ（Novel Studio / コトノハ）にあなたがつながり、私の作品を読み書きできるようになります。あなたのツール（Claude Code / Cursor / Gemini CLI など）の正式な書式で、下記の url＋header 形式のリモート MCP サーバーを追加してください。

・MCP サーバー URL：{{URL}}
・認証：HTTP ヘッダーに「Authorization: Bearer {{TOKEN}}」を付与
・通信方式：Streamable HTTP（JSON-RPC 2.0）

参考の設定形式（あなたのツールの正式書式に合わせて調整してください）：
{"mcpServers":{"novel-studio":{"url":"{{URL}}","headers":{"Authorization":"Bearer {{TOKEN}}"}}}}

設定を保存し、必要なら再読み込み（再起動）してください。トークンは作品を読み書きできる鍵です。平文でファイルに残さず、可能なら環境変数などで扱ってください。最後に list_works ツールを1回呼び、私の作品一覧（タイトルと話数）が出れば成功です。`

type ClientTab = 'claude' | 'genspark' | 'cli'
const TABS: { id: ClientTab; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'genspark', label: 'Genspark' },
  { id: 'cli', label: 'CLI' },
]

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

/** 値＋コピーボタンの 1 行（トークン・URL・ヘッダー・コマンド用）。 */
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

/** 番号付き手順リスト。 */
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="ml-4 list-decimal space-y-1 font-sans text-on-surface text-sm leading-relaxed">
      {items.map((it, i) => (
        // 手順は静的な並びなので index キーで問題ない。
        // biome-ignore lint/suspicious/noArrayIndexKey: static list
        <li key={i}>{it}</li>
      ))}
    </ol>
  )
}

/** トークンが今は見えない（再接続時）ことの案内。 */
function TokenHint() {
  return (
    <p className="rounded-md bg-surface-container-highest p-2 font-sans text-on-surface-variant text-xs leading-relaxed">
      アクセストークンは<strong>発行時にしか表示されません</strong>
      。下の「トークンを再発行」で設定情報を出し直せます。
    </p>
  )
}

/**
 * AI・MCP アクセス（リモート MCP）の接続管理（会員のみ）。
 * 動作確認済みは Claude コネクタ（OAuth）／Genspark コネクタ（Bearer ヘッダー）／CLI（Claude Code・
 * Cursor・Gemini CLI 等）の3系統。AI は作品の読み取りに加え編集・図鑑・構造・バックアップ操作もできる
 * （AI の編集は「AIの変更を取り込む」で反映するまでローカルには影響しない）。
 * トークンは作品を読み書きできる鍵なので共有しない／漏れたら失効。平文表示は発行時の一度きり。
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
  const [client, setClient] = useState<ClientTab>('claude') // 設定手順のタブ
  const [showPrompt, setShowPrompt] = useState(false) // CLI プロンプトの中身プレビュー
  const [showAdvanced, setShowAdvanced] = useState(false) // CLI: JSON/コマンド

  const mcpUrl = `${window.location.origin}/api/mcp`
  const gensparkHeader = plaintext
    ? JSON.stringify({ 'Content-Type': 'application/json', Authorization: `Bearer ${plaintext}` })
    : ''
  const cliPrompt = plaintext
    ? CLI_SETUP_PROMPT.replaceAll('{{URL}}', mcpUrl).replaceAll('{{TOKEN}}', plaintext)
    : ''
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
    setClient('claude')
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
            お使いの AI に、あなたの作品を<strong>読み書き</strong>させる設定です。動作確認済みは{' '}
            <strong>Claude</strong>・<strong>Genspark</strong>・
            <strong>CLI（Claude Code / Cursor 等）</strong>の3つ。
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {/* 情報の流れとリスクの明示（読み書き対応） */}
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
              接続すると編集内容がクラウドに保存され、AI が作品を<strong>読み取り・編集</strong>
              できます（バックアップの作成・復元も）。AI
              の編集は「AIの変更を取り込む」で反映するまで
              <strong>ローカルには影響しません</strong>
              。トークンは作品の<strong>鍵</strong>。共有せず、漏れたら「接続を解除」で失効を。
            </p>
          </div>

          {/* 発行直後だけの注意（トークン平文は再表示できない） */}
          {plaintext && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 font-sans text-on-surface text-xs leading-relaxed">
              <strong>接続情報を発行しました。</strong>この画面を閉じるとトークンは
              <strong>二度と表示できません</strong>。下の手順で今すぐ設定してください。
            </p>
          )}

          {status === null ? (
            <p className="py-4 text-center text-on-surface-variant text-sm">読み込み中…</p>
          ) : connected || plaintext ? (
            <div className="min-w-0 space-y-3">
              {connected && status?.createdAt != null && (
                <p className="font-sans text-on-surface text-sm">
                  接続中
                  <span className="text-on-surface-variant"> ・ 発行 {fmt(status.createdAt)}</span>
                </p>
              )}

              {/* クライアント別の設定手順タブ */}
              <div className="flex gap-1 rounded-lg bg-surface-container p-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setClient(t.id)}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 font-sans text-xs transition-colors',
                      client === t.id
                        ? 'bg-surface text-on-surface shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {client === 'claude' && (
                <div className="space-y-2">
                  <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
                    Claude（デスクトップ / ブラウザ）にカスタムコネクタとして追加します。
                    <strong>トークンは不要</strong>（ログインで認証）。
                  </p>
                  <Steps
                    items={[
                      <>
                        設定 →「コネクタ」→<strong>「カスタムコネクタを追加」</strong>
                      </>,
                      <>「リモート MCP サーバーの URL」に下記を貼って追加</>,
                      <>
                        「接続」→ 表示されるログイン画面で<strong>許可</strong>
                        （あなたの Novel Studio アカウント）
                      </>,
                    ]}
                  />
                  <CopyRow label="MCP サーバー URL" value={mcpUrl} />
                </div>
              )}

              {client === 'genspark' && (
                <div className="space-y-2">
                  <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
                    Genspark の<strong>「新しい MCP サーバーを追加」</strong>で設定します。
                  </p>
                  <Steps
                    items={[
                      <>
                        サーバータイプ：<strong>StreamableHttp</strong> を選択
                      </>,
                      <>サーバー URL：下記を貼る</>,
                      <>リクエストヘッダー：下記 JSON を貼る</>,
                      <>「サーバーを追加」</>,
                    ]}
                  />
                  <CopyRow label="サーバー URL" value={mcpUrl} />
                  {plaintext ? (
                    <CopyRow label="リクエストヘッダー" value={gensparkHeader} />
                  ) : (
                    <TokenHint />
                  )}
                </div>
              )}

              {client === 'cli' && (
                <div className="space-y-2">
                  <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
                    Claude Code・Cursor・Gemini CLI など、自分で設定できる AI 向け。下の
                    <strong>プロンプトを AI に貼る</strong>と設定してくれます。
                  </p>
                  {plaintext ? (
                    <>
                      <CopyButton label="CLI 設定プロンプトをコピー" value={cliPrompt} />
                      <button
                        type="button"
                        onClick={() => setShowPrompt((v) => !v)}
                        className="font-sans text-on-surface-variant text-xs underline underline-offset-2"
                      >
                        {showPrompt ? 'プロンプトの中身を隠す' : 'プロンプトの中身を見る'}
                      </button>
                      {showPrompt && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-container-highest p-2 font-sans text-on-surface-variant text-xs leading-relaxed">
                          {cliPrompt}
                        </pre>
                      )}
                      <div className="border-outline-variant/30 border-t pt-2">
                        <button
                          type="button"
                          onClick={() => setShowAdvanced((v) => !v)}
                          className="flex items-center gap-1 font-sans text-on-surface-variant text-xs"
                        >
                          <ChevronRight
                            className={cn(
                              'size-3.5 transition-transform',
                              showAdvanced && 'rotate-90',
                            )}
                            aria-hidden
                          />
                          手動で設定する（URL・JSON・コマンド）
                        </button>
                        {showAdvanced && (
                          <div className="mt-2 space-y-2">
                            <CopyRow label="MCP サーバー URL" value={mcpUrl} />
                            <CopyRow label="アクセストークン" value={plaintext} />
                            <CopyRow
                              label="設定 JSON（Cursor など url＋headers 形式）"
                              value={jsonConfig}
                            />
                            <CopyRow label="Claude Code（CLI）コマンド" value={cliCommand} />
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <TokenHint />
                  )}
                </div>
              )}

              {/* 接続中の管理（再発行・解除） */}
              {connected && (
                <div className="flex gap-2 border-outline-variant/30 border-t pt-3">
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
              )}
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
                作品をクラウド経由で AI に読み書きさせることを理解し、同意します。
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
