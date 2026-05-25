import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDemoStore } from '../stores/demoStore'
import { apiFetch } from '../lib/api'

export default function DemoBanner() {
  const navigate = useNavigate()
  const { demoExpiresAt } = useDemoStore()
  const [secondsLeft, setSecondsLeft] = useState<number>(0)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (!demoExpiresAt) return

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((demoExpiresAt - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) {
        handleExpiry()
      }
    }

    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoExpiresAt])

  const handleExpiry = async () => {
    try { await apiFetch('/demo/end', { method: 'POST' }) } catch { /* ignore */ }
    navigate('/demo?done=1&expired=1', { replace: true })
  }

  const handleExit = async () => {
    if (exiting) return
    setExiting(true)
    try { await apiFetch('/demo/end', { method: 'POST' }) } catch { /* ignore */ }
    navigate('/demo?done=1', { replace: true })
  }

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`

  const isUrgent = secondsLeft <= 60 && secondsLeft > 0

  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm border-b ${
      isUrgent
        ? 'bg-red-950/80 border-red-800 text-red-100'
        : 'bg-indigo-950/80 border-indigo-800 text-indigo-100'
    }`}>
      {/* Timer icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`w-4 h-4 shrink-0 ${isUrgent ? 'text-red-400' : 'text-indigo-400'}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>

      <span className="flex-1 text-xs">
        <strong className={`font-mono text-sm ${isUrgent ? 'text-red-200' : 'text-white'}`}>{timeStr}</strong>
        {' '}demo remaining — data is deleted when the session ends
      </span>

      <button
        onClick={handleExit}
        disabled={exiting}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
          isUrgent
            ? 'bg-red-800 hover:bg-red-700 text-white'
            : 'bg-indigo-700 hover:bg-indigo-600 text-white'
        }`}
      >
        {exiting ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        )}
        Exit Demo
      </button>
    </div>
  )
}
