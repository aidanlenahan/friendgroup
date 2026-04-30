import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import Avatar from './Avatar'

export default function MarketingLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const { token, user, logout } = useAuthStore()
  const navigate = useNavigate()

  const navLinks = [
    { to: '/home', label: 'Home', end: true },
    { to: '/help', label: 'Help', end: false },
    { to: '/contact', label: 'Contact', end: false },
  ]

  // Close user dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link to="/home" className="flex items-center gap-2 shrink-0">
            <span className="text-xl font-bold tracking-tight text-indigo-400">GEM</span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-indigo-400 bg-indigo-950/60'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Right side — authenticated or not */}
          <div className="hidden md:flex items-center gap-2">
            {token && user ? (
              <>
                {/* App button */}
                <button
                  onClick={() => navigate('/groups')}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-300 hover:text-gray-100 bg-gray-800/60 hover:bg-gray-800 border border-gray-700/60 transition-colors"
                >
                  App
                </button>

                {/* User dropdown */}
                <div
                  ref={userMenuRef}
                  className="relative"
                  onMouseEnter={() => setUserMenuOpen(true)}
                  onMouseLeave={() => setUserMenuOpen(false)}
                >
                  <button
                    onClick={() => setUserMenuOpen((v) => !v)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800/60 transition-colors"
                  >
                    <Avatar name={user.name ?? ''} avatarUrl={user.avatarUrl} size="sm" />
                    <span className="max-w-[120px] truncate">
                      {user.username ? `@${user.username}` : user.name}
                    </span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`w-3.5 h-3.5 text-gray-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {userMenuOpen && (
                    <div className="absolute top-full right-0 mt-1 w-44 bg-gray-800 border border-gray-700 rounded-xl py-1 shadow-xl z-50">
                      <NavLink
                        to="/profile"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Profile
                      </NavLink>
                      <NavLink
                        to="/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Settings
                      </NavLink>
                      <div className="my-1 border-t border-gray-700" />
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden p-1.5 text-gray-400 hover:text-gray-100 rounded-lg hover:bg-gray-800/60 transition-colors"
            aria-label="Toggle menu"
          >
            {menuOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-gray-800/60 bg-gray-950/95 backdrop-blur-md px-4 py-3 flex flex-col gap-1">
            {navLinks.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-indigo-400 bg-indigo-950/60'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}

            <div className="mt-2 pt-2 border-t border-gray-800 flex flex-col gap-1">
              {token && user ? (
                <>
                  {/* User info row */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Avatar name={user.name ?? ''} avatarUrl={user.avatarUrl} size="sm" />
                    <span className="text-sm text-gray-300 truncate">
                      {user.username ? `@${user.username}` : user.name}
                    </span>
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/groups') }}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors text-left"
                  >
                    Open App
                  </button>
                  <NavLink
                    to="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors"
                  >
                    Profile
                  </NavLink>
                  <NavLink
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors"
                  >
                    Settings
                  </NavLink>
                  <button
                    onClick={() => { setMenuOpen(false); handleLogout() }}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-gray-800/60 transition-colors text-left"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={() => setMenuOpen(false)}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setMenuOpen(false)}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/60 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <span className="font-semibold text-indigo-400">GEM</span>
          <div className="flex gap-5">
            <Link to="/help" className="hover:text-gray-300 transition-colors">Help</Link>
            <Link to="/contact" className="hover:text-gray-300 transition-colors">Contact</Link>
            {!token && <Link to="/login" className="hover:text-gray-300 transition-colors">Log in</Link>}
          </div>
          <span>© {new Date().getFullYear()} GEM — Group Event Manager. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
