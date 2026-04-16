import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-6 border border-gray-800">
        {submitted ? (
          <>
            <div>
              <h1 className="text-2xl font-bold text-white">Check your inbox</h1>
              <p className="text-gray-400 text-sm mt-2">
                If <span className="text-white">{email}</span> is registered, we've sent a
                password reset link. It expires in 1 hour.
              </p>
            </div>
            <p className="text-gray-500 text-sm">
              Didn't get it? Check your spam folder or{' '}
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="text-indigo-400 hover:text-indigo-300"
              >
                try again
              </button>
              .
            </p>
            <Link
              to="/login"
              className="block text-center text-sm text-gray-400 hover:text-indigo-300 transition-colors"
            >
              ← Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold text-white">Forgot password?</h1>
              <p className="text-gray-400 text-sm mt-1">
                Enter your email and we'll send you a reset link.
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
        )}
      </div>
    </div>
  )
}
