import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useDemoStore } from '../stores/demoStore'
import { useAuthStore } from '../stores/authStore'
import { apiFetch } from '../lib/api'

type DemoStartResponse =
  | { status: 'active'; sessionId: string; expiresAt: number; user: { id: string; name: string; username: string; email: string; isDemo: boolean } }
  | { status: 'queued'; position: number }

type DemoStatusResponse =
  | { status: 'active'; sessionId: string; expiresAt: number }
  | { status: 'queued'; position: number }
  | { status: 'slot_ready' }
  | { status: 'none' }

export default function DemoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isDone = searchParams.get('done') === '1'
  const isExpired = searchParams.get('expired') === '1'
  const { isDemoMode, demoExpiresAt, getOrCreateDeviceId, startDemo, setQueuePosition, queuePosition, endDemo } = useDemoStore()
  const { login, logout, user } = useAuthStore()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // When landing here after exit/expiry, clear demo + auth state now that
  // we're safely on a public route.
  useEffect(() => {
    if (isDone) {
      endDemo()
      logout()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone])

  // If already in demo and not expired, go to app (skip when finishing demo)
  useEffect(() => {
    if (!isDone && isDemoMode && demoExpiresAt && demoExpiresAt > Date.now() && user?.isDemo) {
      navigate('/groups', { replace: true })
    }
  }, [isDone, isDemoMode, demoExpiresAt, user, navigate])

  // If logged in as normal user, go to app
  useEffect(() => {
    if (!isDone && user && !user.isDemo) {
      navigate('/groups', { replace: true })
    }
  }, [isDone, user, navigate])

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const activateSession = async (sessionId: string, expiresAt: number, demoUser: { id: string; name: string; username: string; email: string; isDemo: boolean }) => {
    startDemo(sessionId, expiresAt)
    login({ ...demoUser, isDemo: true })
    stopPolling()
    navigate('/groups', { replace: true })
  }

  const startDemoSession = async () => {
    setLoading(true)
    setError(null)
    const deviceId = getOrCreateDeviceId()

    try {
      const data = await apiFetch<DemoStartResponse>('/demo/start', {
        method: 'POST',
        body: JSON.stringify({ deviceId }),
      })

      if (data.status === 'active') {
        await activateSession(data.sessionId, data.expiresAt, data.user)
      } else if (data.status === 'queued') {
        setQueuePosition(data.position)
        startPolling(deviceId)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start demo. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const startPolling = (deviceId: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const status = await apiFetch<DemoStatusResponse>(`/demo/status/${deviceId}`)

        if (status.status === 'slot_ready') {
          // Claim the slot
          stopPolling()
          const data = await apiFetch<DemoStartResponse>('/demo/start', {
            method: 'POST',
            body: JSON.stringify({ deviceId }),
          })
          if (data.status === 'active') {
            await activateSession(data.sessionId, data.expiresAt, data.user)
          } else if (data.status === 'queued') {
            setQueuePosition(data.position)
            startPolling(deviceId)
          }
        } else if (status.status === 'queued') {
          setQueuePosition(status.position)
        } else if (status.status === 'active') {
          // Session was activated externally (shouldn't happen, but handle gracefully)
          stopPolling()
          navigate('/groups', { replace: true })
        } else {
          // 'none' — no longer in queue and no slot; just stop
          stopPolling()
          setQueuePosition(null)
        }
      } catch {
        // Polling errors are silent — keep retrying
      }
    }, 2000)
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  const isQueued = queuePosition !== null

  if (isDone) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center gap-2 mb-6">
              <img src="/favicon.png" alt="" className="w-8 h-8 rounded-lg" />
              <span className="text-xl font-bold text-indigo-400">GEM Demo</span>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">
              {isExpired ? 'Your demo has ended' : 'Thanks for trying GEM'}
            </h1>
            <p className="text-gray-400 text-sm mb-8">
              {isExpired
                ? 'Your 5-minute session expired and all demo data has been deleted.'
                : 'Your session has been closed and all demo data deleted.'}
            </p>

            <div className="space-y-3 mb-8">
              <Link
                to="/register"
                className="block w-full py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white text-center transition-colors"
              >
                Create an account
              </Link>
              <Link
                to="/login"
                className="block w-full py-2.5 rounded-xl text-sm font-medium text-gray-300 border border-gray-700 hover:border-gray-600 hover:text-white text-center transition-colors"
              >
                Sign in
              </Link>
              <Link
                to="/demo"
                className="block w-full py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-400 text-center transition-colors"
              >
                Run another demo
              </Link>
            </div>

            <div className="pt-5 border-t border-gray-800 text-center">
              <p className="text-xs text-gray-500 leading-relaxed">
                Feedback or want an account creation code?
              </p>
              <a
                href="mailto:help@gem.aidanlenahan.com"
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                help@gem.aidanlenahan.com
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full">
        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-6">
            <img src="/favicon.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className="text-xl font-bold text-indigo-400">GEM Demo</span>
          </div>

          {isQueued ? (
            /* Queue waiting state */
            <>
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <h2 className="text-lg font-semibold text-white">You're in line</h2>
                </div>
                <p className="text-gray-400 text-sm">
                  All 5 demo slots are currently in use. You're{' '}
                  <span className="text-white font-semibold">#{queuePosition}</span> in the queue.
                  A slot will open automatically.
                </p>
              </div>

              {/* Queue indicator */}
              <div className="flex items-center gap-2 mb-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex-1 h-1.5 rounded-full bg-indigo-600" />
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-8">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Checking for open slots every 2 seconds…
              </div>

              <button
                onClick={() => { stopPolling(); setQueuePosition(null) }}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300 transition-colors"
              >
                Leave queue
              </button>
            </>
          ) : (
            /* Default start state */
            <>
              <h1 className="text-2xl font-bold text-white mb-2">Try GEM free</h1>
              <p className="text-gray-400 text-sm mb-6">
                Get a 5-minute sandbox to explore groups, events, and channels — no account needed.
              </p>

              {/* Feature list */}
              <ul className="space-y-2.5 mb-8">
                {[
                  'Create a group and invite link',
                  'Schedule events and RSVP',
                  'Create channels and send messages',
                  'Full group management tools',
                ].map((feat) => (
                  <li key={feat} className="flex items-center gap-2 text-sm text-gray-300">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {feat}
                  </li>
                ))}
                <li className="flex items-center gap-2 text-sm text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Media uploads (not available in demo)
                </li>
              </ul>

              <div className="flex items-center gap-2 p-3 mb-6 rounded-lg bg-gray-800/60 border border-gray-700/60">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs text-gray-400">
                  Demo lasts <strong className="text-gray-300">5 minutes</strong>. All data is deleted when it ends.
                </span>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={startDemoSession}
                disabled={loading}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Starting…
                  </>
                ) : (
                  'Start 5-Minute Demo'
                )}
              </button>

              <p className="mt-4 text-center text-xs text-gray-600">
                Up to 5 demos run simultaneously. If all slots are taken, you'll be queued.
              </p>
            </>
          )}
        </div>

        {/* Sign up nudge */}
        <p className="mt-5 text-center text-sm text-gray-500">
          Want a real account?{' '}
          <a href="/register" className="text-indigo-400 hover:text-indigo-300 font-medium">
            Sign up free
          </a>
        </p>

      </div>
    </div>
  )
}
