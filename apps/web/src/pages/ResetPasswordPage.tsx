import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const PASSWORD_RULES = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-4 border border-gray-800">
          <h1 className="text-2xl font-bold text-white">Invalid link</h1>
          <p className="text-gray-400 text-sm">
            This password reset link is missing a token. Please request a new one.
          </p>
          <Link
            to="/forgot-password"
            className="block text-center text-sm text-indigo-400 hover:text-indigo-300"
          >
            Request new link
          </Link>
        </div>
      </div>
    )
  }

  const validate = (): boolean => {
    if (password.length < 8) {
      setFieldError('Password must be at least 8 characters')
      return false
    }
    if (password.length > 32) {
      setFieldError('Password must be at most 32 characters')
      return false
    }
    if (!PASSWORD_RULES.test(password)) {
      setFieldError('Password must contain uppercase, lowercase, and a number')
      return false
    }
    if (password !== confirmPassword) {
      setFieldError('Passwords do not match')
      return false
    }
    setFieldError('')
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate()) return

    setLoading(true)
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reset failed'
      // Surface invalid/expired token clearly
      if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')) {
        setError('This reset link is invalid or has expired. Please request a new one.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-4 border border-gray-800 text-center">
          <h1 className="text-2xl font-bold text-white">Password updated</h1>
          <p className="text-gray-400 text-sm">
            Your password has been reset. Redirecting you to sign in…
          </p>
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300 text-sm">
            Sign in now →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-6 border border-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-white">Set new password</h1>
          <p className="text-gray-400 text-sm mt-1">
            Choose a new password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value.slice(0, 32))}
              placeholder="New password (8–32 chars)"
              maxLength={32}
              required
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value.slice(0, 32))}
              placeholder="Confirm new password"
              maxLength={32}
              required
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {fieldError && <p className="text-red-400 text-sm">{fieldError}</p>}
          {error && (
            <div className="space-y-1">
              <p className="text-red-400 text-sm">{error}</p>
              <Link to="/forgot-password" className="text-indigo-400 hover:text-indigo-300 text-sm">
                Request a new link →
              </Link>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            {loading ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
