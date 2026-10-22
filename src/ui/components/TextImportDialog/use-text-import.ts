import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyEdits,
  baseName,
  DEFAULT_SPLIT_OPTIONS,
  decodeTextFile,
  EMPTY_EDITS,
  type EpisodeKey,
  type ImportSource,
  MAX_IMPORT_BYTES,
  type SplitEdits,
  type SplitEpisode,
  type SplitOptions,
  sortSourcesNatural,
  splitEpisodes,
  type TextEncodingName,
  textBytes,
} from '@/core/importer'

export type SourceKind = 'file' | 'paste'

/** 読み込んだファイル 1 件の状態。失敗した行も一覧に残して、他のファイルに影響させない。 */
export type FileEntry =
  | { name: string; state: 'loading'; bytes: number }
  | {
      name: string
      state: 'ok'
      bytes: number
      text: string
      encoding: TextEncodingName
      chars: number
    }
  | { name: string; state: 'error'; bytes: 0; message: string }

export const MESSAGES = {
  notTxt: '.txt のテキストファイルを選んでください',
  duplicate: '同じ名前のファイルはすでにあります',
  tooLarge: '合計 20MB までのテキストを取り込めます',
  unreadable: (name: string) =>
    `「${name}」は読み込めませんでした。UTF-8 か Shift_JIS のテキストファイルを選んでください`,
  workTooLarge: '本文が大きすぎます。ファイルを分けて取り込んでください',
  noHeading: '見出しが見つからなかったので、1話にまとめました',
  emptyPreview: 'テキストを読み込むと、ここに話の分かれ方が出ます',
  defaultWorkTitle: '取り込んだ作品',
} as const

export const isTxtFile = (name: string) => /\.txt$/i.test(name)

const PASTE_DEBOUNCE_MS = 300

/** 本文の字数（改行を除く）。プレビューの「M 字」表示用。 */
export const countChars = (body: string) => [...body.replace(/\n/g, '')].length

export interface TextImportState {
  kind: SourceKind
  files: FileEntry[]
  paste: string
  options: SplitOptions
  edits: SplitEdits
  /** 利用者が入れた作品タイトル。null なら既定値（先頭ファイル名／「取り込んだ作品」）。 */
  titleOverride: string | null
  author: string
  /** 全体のエラー（容量超過・拡張子・同名・作成時のサイズ超過）。フッター左に出す。 */
  error: string | null
}

export interface TextImportPreview {
  sources: ImportSource[]
  episodes: SplitEpisode[]
  headingFound: boolean
  totalChars: number
  /** 読み込み済みテキストの合計バイト数（入力側の足切りの進み具合）。 */
  rawBytes: number
}

const initialState = (author: string): TextImportState => ({
  kind: 'file',
  files: [],
  paste: '',
  options: DEFAULT_SPLIT_OPTIONS,
  edits: EMPTY_EDITS,
  titleOverride: null,
  author,
  error: null,
})

/**
 * 取り込みダイアログの状態。入力（ファイル／貼り付け・分け方・手直し）を持ち、プレビューは
 * `useMemo` で導出する。File の読み取り（arrayBuffer → decodeTextFile）はここで行い、core は純関数のまま。
 */
export function useTextImport(defaultAuthor: string) {
  const [state, setState] = useState<TextImportState>(() => initialState(defaultAuthor))
  const [debouncedPaste, setDebouncedPaste] = useState('')

  // 貼り付けは入力が止まってから 300ms でプレビューへ
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPaste(state.paste), PASTE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [state.paste])

  const okFiles = useMemo(
    () =>
      sortSourcesNatural(
        state.files.filter((f): f is Extract<FileEntry, { state: 'ok' }> => f.state === 'ok'),
      ),
    [state.files],
  )

  const defaultTitle = useMemo(() => {
    if (state.kind === 'file') return okFiles[0] ? baseName(okFiles[0].name) : ''
    return MESSAGES.defaultWorkTitle
  }, [state.kind, okFiles])

  const workTitle = state.titleOverride ?? defaultTitle

  const preview = useMemo<TextImportPreview>(() => {
    const sources: ImportSource[] =
      state.kind === 'file'
        ? okFiles.map((f) => ({ name: f.name, text: f.text }))
        : debouncedPaste.trim() === ''
          ? []
          : [{ name: '', text: debouncedPaste }]
    const split = splitEpisodes(sources, state.options, workTitle)
    const episodes = applyEdits(split.episodes, state.edits, state.options)
    const rawBytes =
      state.kind === 'file'
        ? state.files.reduce((n, f) => n + f.bytes, 0)
        : textBytes(debouncedPaste)
    return {
      sources,
      episodes,
      headingFound: split.headingFound,
      totalChars: episodes.reduce((n, e) => n + countChars(e.body), 0),
      rawBytes,
    }
  }, [state.kind, state.files, state.options, state.edits, okFiles, debouncedPaste, workTitle])

  const setKind = useCallback((kind: SourceKind) => {
    setState((s) => ({
      ...s,
      kind,
      edits: EMPTY_EDITS,
      error: null,
      // 貼り付けでは「ファイルごとに1話」は選べない
      options:
        kind === 'paste' && s.options.mode === 'file'
          ? { ...s.options, mode: 'heading' }
          : s.options,
    }))
  }, [])

  const addFiles = useCallback((picked: readonly File[]) => {
    const accepted: File[] = []
    setState((s) => {
      let error: string | null = null
      const names = new Set(s.files.map((f) => f.name))
      let total = s.files.reduce((n, f) => n + f.bytes, 0)
      for (const file of picked) {
        if (!isTxtFile(file.name)) {
          error ??= MESSAGES.notTxt
          continue
        }
        if (names.has(file.name)) {
          error ??= MESSAGES.duplicate
          continue
        }
        if (total + file.size > MAX_IMPORT_BYTES) {
          error ??= MESSAGES.tooLarge
          continue
        }
        names.add(file.name)
        total += file.size
        accepted.push(file)
      }
      const loading: FileEntry[] = accepted.map((f) => ({
        name: f.name,
        state: 'loading',
        bytes: f.size,
      }))
      return { ...s, files: [...s.files, ...loading], edits: EMPTY_EDITS, error }
    })
    for (const file of accepted) {
      void file.arrayBuffer().then((buf) => {
        const decoded = decodeTextFile(new Uint8Array(buf))
        setState((s) => ({
          ...s,
          files: s.files.map((f) => {
            if (f.name !== file.name || f.state !== 'loading') return f
            if (!decoded) {
              return {
                name: f.name,
                state: 'error',
                bytes: 0,
                message: MESSAGES.unreadable(f.name),
              }
            }
            return {
              name: f.name,
              state: 'ok',
              bytes: f.bytes,
              text: decoded.text,
              encoding: decoded.encoding,
              chars: countChars(decoded.text),
            }
          }),
        }))
      })
    }
  }, [])

  const removeFile = useCallback((name: string) => {
    setState((s) => ({
      ...s,
      files: s.files.filter((f) => f.name !== name),
      edits: EMPTY_EDITS,
      error: null,
    }))
  }, [])

  const setPaste = useCallback((value: string) => {
    setState((s) => {
      if (textBytes(value) > MAX_IMPORT_BYTES) return { ...s, error: MESSAGES.tooLarge }
      return { ...s, paste: value, edits: EMPTY_EDITS, error: null }
    })
  }, [])

  const setOptions = useCallback((patch: Partial<SplitOptions>) => {
    // 分け方が変わると分割結果を作り直すので、手直しは解除する
    setState((s) => ({ ...s, options: { ...s.options, ...patch }, edits: EMPTY_EDITS }))
  }, [])

  const setEpisodeTitle = useCallback((key: EpisodeKey, title: string) => {
    setState((s) => ({ ...s, edits: { ...s.edits, titles: { ...s.edits.titles, [key]: title } } }))
  }, [])

  const mergeInto = useCallback((key: EpisodeKey) => {
    setState((s) => ({
      ...s,
      edits: { ...s.edits, mergedInto: [...s.edits.mergedInto, key] },
    }))
  }, [])

  const setWorkTitle = useCallback((title: string) => {
    setState((s) => ({ ...s, titleOverride: title }))
  }, [])

  const setAuthor = useCallback((author: string) => {
    setState((s) => ({ ...s, author }))
  }, [])

  const setError = useCallback((error: string | null) => {
    setState((s) => ({ ...s, error }))
  }, [])

  const reset = useCallback(() => {
    setState(initialState(defaultAuthor))
    setDebouncedPaste('')
  }, [defaultAuthor])

  const loading = state.files.some((f) => f.state === 'loading')

  return {
    state,
    preview,
    workTitle,
    loading,
    actions: {
      setKind,
      addFiles,
      removeFile,
      setPaste,
      setOptions,
      setEpisodeTitle,
      mergeInto,
      setWorkTitle,
      setAuthor,
      setError,
      reset,
    },
  }
}

export type TextImportActions = ReturnType<typeof useTextImport>['actions']
