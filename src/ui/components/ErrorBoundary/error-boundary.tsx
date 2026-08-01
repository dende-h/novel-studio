import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 捕捉時に描くもの。retry を呼ぶと境界を張り直して children を再マウントする。 */
  fallback: (retry: () => void, error: Error) => ReactNode
  /** 捕捉の通知（記録・代替経路の起動用）。描画中に呼ばれるので副作用は最小限に。 */
  onError?: (error: Error) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 描画中の例外を受け止める境界。
 *
 * これが無いと、チャンクの取得失敗のような一過性の事故でもツリーごと消えて
 * 画面が白いまま何も起きない（利用者からはリロードするしか手が無い）状態になる。
 * React では境界はクラスでしか作れないため、ここだけクラスコンポーネント。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 収集基盤は持たないので、せめて原因が追えるようコンソールへ残す。
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.props.onError?.(error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return this.props.fallback(() => this.setState({ error: null }), error)
  }
}
