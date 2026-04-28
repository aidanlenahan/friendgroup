import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { useAuthStore } from '../stores/authStore'

type AuthResponse = {
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

type Mode = 'password' | 'email-code' | 'email-code-verify'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpEmail, setOtpEmail] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  // Email-not-verified inline verification
  const [verifyUserId, setVerifyUserId] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendMessage, setResendMessage] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { login } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startResendCooldown = () => {
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

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setVerifyUserId('')
    setVerifyCode('')
    setResendMessage('')
    setLoading(true)
    try {
      const data = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ emailOrUsername: email, password }),
      })
      login(data.token, { ...data.user, avatarUrl: data.user.avatarUrl ?? undefined })
      navigate('/groups')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        const userId = (err.data?.userId as string) ?? ''
        setVerifyUserId(userId)
        // Automatically send a fresh code; ignore cooldown errors (code already sent)
        try {
          await apiFetch('/auth/resend-verification', {
            method: 'POST',
            body: JSON.stringify({ userId }),
          })
          setResendMessage('A verification code has been sent to your email.')
          startResendCooldown()
        } catch (resendErr) {
          if (resendErr instanceof ApiError && resendErr.code === 'RESEND_COOLDOWN') {
            setResendMessage('A code was recently sent to your email. Check your inbox.')
            const secs = (resendErr.data?.secondsRemaining as number) ?? RESEND_COOLDOWN
            setResendCooldown(secs)
            intervalRef.current = setInterval(() => {
              setResendCooldown((prev) => {
                if (prev <= 1) { clearInterval(intervalRef.current!); return 0 }
                return prev - 1
              })
            }, 1000)
          }
        }
        setError('Email not verified. Enter the 6-digit code sent to your inbox.')
        return
      }
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setVerifyLoading(true)
    try {
      const data = await apiFetch<VerifyResponse>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ userId: verifyUserId, code: verifyCode }),
      })
      login(data.token, { ...data.user, avatarUrl: data.user.avatarUrl ?? undefined })
      navigate('/groups')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifyLoading(false)
    }
  }

  const handleResendVerification = async () => {
    if (resendCooldown > 0) return
    setResendMessage('')
    setError('')
    try {
      await apiFetch('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ userId: verifyUserId }),
      })
      setResendMessage('A new code has been sent to your email.')
      startResendCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code')
    }
  }

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiFetch('/auth/request-login-code', {
        method: 'POST',
        body: JSON.stringify({ email: otpEmail }),
      })
      setInfo('If that email is registered, a sign-in code has been sent.')
      setMode('email-code-verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await apiFetch<AuthResponse>('/auth/verify-login-code', {
        method: 'POST',
        body: JSON.stringify({ email: otpEmail, code: otp }),
      })
      login(data.token, { ...data.user, avatarUrl: data.user.avatarUrl ?? undefined })
      navigate('/groups')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  const switchToEmailCode = () => {
    setError('')
    setInfo('')
    setOtp('')
    setMode('email-code')
  }

  const switchToPassword = () => {
    setError('')
    setInfo('')
    setMode('password')
  }

  return (
    <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-6 border border-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-white">GEM</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your account</p>
        </div>

        {/* Password login */}
        {mode === 'password' && (
          <>
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email or username"
                required
                autoComplete="username"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {!verifyUserId && (
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              )}
            </form>

            {/* Inline email verification after EMAIL_NOT_VERIFIED error */}
            {verifyUserId && (
              <form onSubmit={handleVerifyEmail} className="space-y-3">
                <p className="text-gray-400 text-sm">Enter the 6-digit code from your email:</p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-widest placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {resendMessage && <p className="text-green-400 text-sm">{resendMessage}</p>}
                <button
                  type="submit"
                  disabled={verifyLoading || verifyCode.length !== 6}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
                >
                  {verifyLoading ? 'Verifying...' : 'Verify email'}
                </button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendCooldown > 0}
                    className="text-sm text-indigo-400 hover:text-indigo-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                  >
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}

            {!verifyUserId && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={switchToEmailCode}
                  className="text-sm text-gray-400 hover:text-indigo-300 transition-colors"
                >
                  Other methods →
                </button>
              </div>
            )}
            <div className="text-center">
              <Link to="/forgot-password" className="text-sm text-gray-500 hover:text-indigo-300 transition-colors">
                Forgot password?
              </Link>
            </div>
          </>
        )}

        {/* Email code request */}
        {mode === 'email-code' && (
          <>
            <form onSubmit={handleRequestCode} className="space-y-4">
              <p className="text-gray-400 text-sm">
                We'll send a one-time code to your email address.
              </p>
              <input
                type="email"
                value={otpEmail}
                onChange={(e) => setOtpEmail(e.target.value)}
                placeholder="Email"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
              >
                {loading ? 'Sending...' : 'Send code'}
              </button>
            </form>
            <div className="text-center">
              <button
                type="button"
                onClick={switchToPassword}
                className="text-sm text-gray-400 hover:text-indigo-300 transition-colors"
              >
                ← Back to password
              </button>
            </div>
          </>
        )}

        {/* Email code verify */}
        {mode === 'email-code-verify' && (
          <>
            <div className="space-y-1">
              <p className="text-white font-medium text-sm">Check your email</p>
              <p className="text-gray-400 text-sm">
                We sent a 6-digit sign-in code to <span className="text-white">{otpEmail}</span>. Enter it below — it expires in 10 minutes.
              </p>
            </div>
            <form onSubmit={handleVerifyCode} className="space-y-4">
              {info && <p className="text-green-400 text-sm">{info}</p>}
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                required
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-widest placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
              >
                {loading ? 'Verifying...' : 'Sign in'}
              </button>
            </form>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setMode('email-code')}
                className="text-sm text-gray-400 hover:text-indigo-300 transition-colors"
              >
                ← Resend or change email
              </button>
            </div>
          </>
        )}

        <p className="text-center text-sm text-gray-500">
          Don't have an account?{' '}
          <Link to="/register" className="text-indigo-400 hover:text-indigo-300">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
