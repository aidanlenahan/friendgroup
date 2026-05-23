import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

function BetaCodeInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-white">Invite Code</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white transition-colors mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">
          GEM is currently in beta and requires an invite code to create an account. Codes can be shared by existing members or issued by the team.
        </p>
        <p className="text-sm text-gray-300 leading-relaxed">
          Don't have a code? Email us at{' '}
          <a href="mailto:help@gem.aidanlenahan.com" className="text-indigo-400 hover:text-indigo-300 underline">
            help@gem.aidanlenahan.com
          </a>{' '}
          to request one.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

type RegisterResponse = {
  message: string
  userId: string
  emailSent: boolean
}

const PASSWORD_RULES = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/

export default function RegisterPage() {
  useEffect(() => {
    document.title = 'Sign Up — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('ref') ?? ''

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [betaCode, setBetaCode] = useState('')
  const [showBetaCodeInfo, setShowBetaCodeInfo] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const maxBirthdate = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 13)
    return d.toISOString().split('T')[0]
  })()

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!firstName.trim()) errs.firstName = 'First name is required'
    if (!lastName.trim()) errs.lastName = 'Last name is required'
    if (!email.trim()) errs.email = 'Email is required'
    if (email !== confirmEmail) errs.confirmEmail = 'Emails do not match'
    if (password.length < 8) errs.password = 'Password must be at least 8 characters'
    if (password.length > 32) errs.password = 'Password must be at most 32 characters'
    if (password.length >= 8 && !PASSWORD_RULES.test(password)) {
      errs.password = 'Password must contain uppercase, lowercase, and a number'
    }
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match'
    if (!birthdate) {
      errs.birthdate = 'Date of birth is required'
    } else if (birthdate > maxBirthdate) {
      errs.birthdate = 'You must be at least 13 years old to create an account'
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate()) return

    setLoading(true)
    try {
      const body: Record<string, string | boolean> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        birthdate,
      }
      if (inviteToken) {
        body.inviteToken = inviteToken
      } else if (betaCode.trim()) {
        body.betaCode = betaCode.trim()
      }

      const data = await apiFetch<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      navigate(`/verify-email?userId=${data.userId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-xl p-8 space-y-6 border border-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-white">Create account</h1>
          <p className="text-gray-400 text-sm mt-1">Join GEM</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value.slice(0, 15))}
                placeholder="Jane"
                maxLength={15}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {fieldErrors.firstName && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.firstName}</p>
              )}
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value.slice(0, 15))}
                placeholder="Smith"
                maxLength={15}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {fieldErrors.lastName && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.lastName}</p>
              )}
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.slice(0, 30))}
              placeholder="jane@example.com"
              maxLength={30}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.email && <p className="text-red-400 text-xs mt-1">{fieldErrors.email}</p>}
          </div>

          {/* Confirm email */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Confirm Email</label>
            <input
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value.slice(0, 30))}
              placeholder="jane@example.com"
              maxLength={30}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.confirmEmail && (
              <p className="text-red-400 text-xs mt-1">{fieldErrors.confirmEmail}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value.slice(0, 32))}
              placeholder="Min 8 chars, uppercase, lowercase, number"
              maxLength={32}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.password && (
              <p className="text-red-400 text-xs mt-1">{fieldErrors.password}</p>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value.slice(0, 32))}
              placeholder="Re-enter your password"
              maxLength={32}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.confirmPassword && (
              <p className="text-red-400 text-xs mt-1">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          {/* Date of birth */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Date of Birth</label>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              max={maxBirthdate}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-gray-500 text-xs mt-1">You must be at least 13 years old to join.</p>
            {fieldErrors.birthdate && (
              <p className="text-red-400 text-xs mt-1">{fieldErrors.birthdate}</p>
            )}
          </div>

          {/* Invite code / invite link */}
          {inviteToken ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-emerald-950/50 border border-emerald-800 rounded-xl">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-emerald-300">Invite link applied</span>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-medium text-gray-400">Invite Code</label>
                <button
                  type="button"
                  onClick={() => setShowBetaCodeInfo(true)}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                  aria-label="About invite codes"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
              <input
                type="text"
                value={betaCode}
                onChange={(e) =>
                  setBetaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))
                }
                placeholder="12-character access code"
                maxLength={12}
                spellCheck={false}
                autoComplete="off"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-wider uppercase"
              />
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300">
            Sign in
          </Link>
        </p>
      </div>

      {showBetaCodeInfo && <BetaCodeInfoModal onClose={() => setShowBetaCodeInfo(false)} />}
    </div>
  )
}
