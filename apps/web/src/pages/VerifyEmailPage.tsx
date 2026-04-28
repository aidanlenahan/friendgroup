import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuthStore } from '../stores/authStore'

type VerifyResponse = {
  token: string
  user: {
    id: string
    email: string
    name: string
    username?: string | null
    avatarUrl?: string | null
    theme?: string | null
  }
}

const RESEND_COOLDOWN = 60

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const userId = searchParams.get('userId') ?? ''

  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendMessage, setResendMessage] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { login } = useAuthStore()
  const navigate = useNavigate()

  // Redirect to register if no userId
  useEffect(() => {
    if (!userId) navigate('/register', { replace: true })
  }, [userId, navigate])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN)
    intervalRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your email')
      return
    }
    setLoading(true)
    try {
      const data = await apiFetch<VerifyResponse>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ userId, code }),
      })
      login(data.token, {
        ...data.user,
        avatarUrl: data.user.avatarUrl ?? undefined,
      })
      navigate('/groups')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setResendMessage('')
    setError('')
    try {
      await apiFetch('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      })
      setResendMessage('A new code has been sent to your email.')
      startCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code')
    }
  }

  return (
    <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-6 border border-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-white">Verify your email</h1>
          <p className="text-gray-400 text-sm mt-1">
            Enter the 6-digit code we sent to your email address.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-widest placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {resendMessage && <p className="text-green-400 text-sm">{resendMessage}</p>}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            {loading ? 'Verifying...' : 'Verify email'}
          </button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0}
            className="text-sm text-indigo-400 hover:text-indigo-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : 'Resend code'}
          </button>
        </div>
      </div>
    </div>
  )
}
