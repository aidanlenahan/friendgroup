import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

interface PageToolbarProps {
  onReload?: () => void
  backTo?: string
}

export default function PageToolbar({ onReload, backTo }: PageToolbarProps) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [spinning, setSpinning] = useState(false)

  const handleReload = () => {
    if (spinning) return
    setSpinning(true)
    setTimeout(() => setSpinning(false), 700)
    if (onReload) {
      onReload()
    } else {
      // Invalidate all queries so React Query refetches fresh data without a full page reload
      qc.invalidateQueries()
    }
  }

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        onClick={() => backTo ? navigate(backTo) : navigate(-1)}
        title="Go back"
        aria-label="Go back"
        className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleReload}
        title="Reload page"
        aria-label="Reload page"
        className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 transition-transform ${spinning ? 'animate-spin' : ''}`}
          style={spinning ? { animationDuration: '0.6s', animationTimingFunction: 'ease-in-out' } : undefined}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  )
}
