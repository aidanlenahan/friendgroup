import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '../lib/reportClientError'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    reportClientError(error.message, error.stack ?? info.componentStack ?? '')
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col items-center justify-center px-4">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-red-950/60 border border-red-800 flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-100">Something went wrong</h1>
            <p className="text-sm text-gray-400">
              An unexpected error occurred. Try refreshing the page — if the problem persists,{' '}
              <a href="/help?contact=1" className="text-indigo-400 hover:text-indigo-300 transition-colors">contact support</a>.
            </p>
            {this.state.error && (
              <p className="text-xs text-gray-600 font-mono break-all">{this.state.error.message}</p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
