import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const RESEND_COOLDOWN = 60

type Mode = 'email' | 'code'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendMessage, setResendMessage] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const sendRequest = async (emailValue: string) => {
    await apiFetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: emailValue }),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await sendRequest(email.trim())
      setMode('code')
      startCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setResendMessage('')
    setError('')
    try {
      await sendRequest(email.trim())
      setResendMessage('A new code and link have been sent.')
      startCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend')
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await apiFetch<{ token: string }>('/auth/verify-reset-code', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code }),
      })
      navigate(`/reset-password?token=${data.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-6 border border-gray-800">
        {mode === 'email' ? (
          <>
            <div>
              <h1 className="text-2xl font-bold text-white">Forgot password?</h1>
              <p className="text-gray-400 text-sm mt-1">
                Enter your email and we'll send you a reset link and a 6-digit code.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                autoComplete="email"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>

            <div className="text-center">
              <Link
                to="/login"
                className="text-sm text-gray-400 hover:text-indigo-300 transition-colors"
              >
                ← Back to sign in
              </Link>
            </div>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold text-white">Check your inbox</h1>
              <p className="text-gray-400 text-sm mt-2">
                If <span className="text-white">{email}</span> is registered, we've sent a
                reset link and a 6-digit code. Both expire in 1 hour.
              </p>
            </div>

            <form onSubmit={handleVerifyCode} className="space-y-4">
              <p className="text-gray-400 text-sm">Enter the 6-digit code from your email:</p>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-widest placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {resendMessage && <p className="text-green-400 text-sm">{resendMessage}</p>}
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
              >
                {loading ? 'Verifying...' : 'Continue'}
              </button>
            </form>

            <div className="space-y-3 text-center">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-sm text-indigo-400 hover:text-indigo-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
              <p className="text-gray-600 text-xs">
                You can also click the link in the email directly.
              </p>
              <button
                type="button"
                onClick={() => { setMode('email'); setCode(''); setError(''); setResendMessage('') }}
                className="block w-full text-sm text-gray-500 hover:text-indigo-300 transition-colors"
              >
                ← Try a different email
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
