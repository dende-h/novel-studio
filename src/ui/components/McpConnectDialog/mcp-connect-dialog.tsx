import { Bot, Check, Copy, LoaderCircle, RefreshCw, TriangleAlert, Unplug } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  generateMcpToken,
  getMcpTokenStatus,
  type McpTokenStatus,
  revokeMcpToken,
} from '@/ui/_api/mcp'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'

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

  const mcpUrl = `${window.location.origin}/api/mcp`
  // 各 AI クライアントに合わせて貼れる設定（実トークンを埋め込む。平文が無い＝再表示不可）。
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
            リモート MCP に対応する AI（Claude / ChatGPT / Gemini / Grok など）が、あなたの作品を
            <strong>読む</strong>ためのアクセスを発行します。AI は<strong>読み取り専用</strong>
            で、書き込み・削除はできません。
          </DialogDescription>
        </DialogHeader>

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

        {/* 発行直後だけ設定を表示（トークン平文は再表示できない）。各 AI にコピペで貼れる形で並べる。 */}
        {plaintext && (
          <div className="min-w-0 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="font-sans text-on-surface text-xs">
              <strong>接続情報を発行しました。</strong>
              この画面を閉じると<strong>二度と表示できません</strong>
              。今すぐコピーして、お使いの AI に設定してください。
            </p>
            <CopyRow label="① アクセストークン" value={plaintext} />
            <CopyRow label="② MCP サーバー URL" value={mcpUrl} />
            <CopyRow
              label="③ Authorization ヘッダー（ヘッダー欄がある AI 用）"
              value={authHeader}
            />
            <CopyRow
              label="設定 JSON（url＋headers 形式：Claude Desktop / Cursor など）"
              value={jsonConfig}
            />
            <CopyRow label="Claude Code（CLI・コマンド一発）" value={cliCommand} />
            <p className="font-sans text-on-surface-variant text-xs leading-relaxed">
              お使いの AI に合わせて貼り付けます。<strong>ChatGPT / Gemini / Grok</strong> などは「②
              URL」と「③ Authorization ヘッダー」を、設定ファイルに書く場合は「設定 JSON」を、
              Claude Code はコマンドをそのまま使えます。
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
      </DialogContent>
    </Dialog>
  )
}
