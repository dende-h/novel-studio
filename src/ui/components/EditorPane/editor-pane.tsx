interface EditorPaneProps {
  value: string
  onChange: (value: string) => void
}

/** 本文エディタ（素の textarea＋自前パーサ方式 A1。WYSIWYG は IME 問題ゆえ不採用）。 */
export function EditorPane({ value, onChange }: EditorPaneProps) {
  return (
    <textarea
      aria-label="本文"
      className="h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-sm leading-7 outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="ここに本文を書く。ルビ｜親文字《よみ》・傍点《《テキスト》》・シーン区切り ＊"
      spellCheck={false}
    />
  )
}
