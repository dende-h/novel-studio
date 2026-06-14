interface EditorPaneProps {
  value: string
  onChange: (value: string) => void
}

/** 本文エディタ（素の textarea＋自前パーサ方式 A1。WYSIWYG は IME 問題ゆえ不採用）。 */
export function EditorPane({ value, onChange }: EditorPaneProps) {
  const lines = value === '' ? 0 : value.split('\n').length
  const chars = value.length

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-surface">
      {/* ツールバー */}
      <div className="flex h-12 shrink-0 items-center justify-between border-outline-variant/10 border-b bg-surface-container-lowest/50 px-6">
        <div className="flex items-center gap-4 font-sans text-on-surface-variant text-xs">
          <span className="text-on-surface-variant/60">記法</span>
          <span className="font-medium text-primary">A1記法</span>
        </div>
      </div>

      {/* 本文 */}
      <textarea
        aria-label="本文"
        className="min-h-0 flex-1 resize-none border-none bg-transparent p-10 font-serif text-[18px] text-on-surface leading-[1.8] outline-none placeholder:text-on-surface-variant/40 lg:p-14"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ここに本文を書く。ルビ｜親文字《よみ》・傍点《《テキスト》》・シーン区切り ＊"
        spellCheck={false}
      />

      {/* 文字数チップ */}
      <div className="pointer-events-none absolute right-8 bottom-6 flex items-center gap-3 rounded-md border border-outline-variant/10 bg-surface/80 px-3 py-1.5 font-sans text-[11px] text-on-surface-variant/70 uppercase tracking-widest backdrop-blur-sm">
        <span>{lines}行</span>
        <span className="size-1 rounded-full bg-outline-variant/40" />
        <span>{chars}文字</span>
      </div>
    </div>
  )
}
