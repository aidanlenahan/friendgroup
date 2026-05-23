import { useEffect, useRef, useState } from 'react'
import { Outlet, NavLink, useNavigate, useMatch } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useDemoStore } from '../stores/demoStore'
import { useGroups } from '../hooks/useGroups'
import type { GroupSummary } from '../hooks/useGroups'
import { usePwaInstall } from '../hooks/usePwaInstall'
import ToastContainer from './Toast'
import Avatar from './Avatar'
import NotificationBell from './NotificationBell'
import DemoBanner from './DemoBanner'
import { apiFetch } from '../lib/api'

const isPwa =
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true)

export default function Layout() {
  const getIsDesktop = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches

  const { user, logout } = useAuthStore()
  const { isDemoMode, endDemo } = useDemoStore()
  const navigate = useNavigate()
  const isChannelPage = !!useMatch('/groups/:groupId/channels/:channelId')
  const { data: groups } = useGroups()
  const [isDesktop, setIsDesktop] = useState(getIsDesktop)
  const [sidebarOpen, setSidebarOpen] = useState(getIsDesktop)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [showReconnected, setShowReconnected] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const userMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pushNudgeDismissed, setPushNudgeDismissed] = useState(
    () => localStorage.getItem('pushNudgeDismissed') === '1',
  )
  const pwaInstall = usePwaInstall()
  const [showIosInstallModal, setShowIosInstallModal] = useState(false)
  const [authExpired, setAuthExpired] = useState(false)
  const pushNotGranted =
    typeof Notification !== 'undefined' && Notification.permission !== 'granted'
  const showPushNudge = isPwa && pushNotGranted && !pushNudgeDismissed

  const dismissPushNudge = () => {
    localStorage.setItem('pushNudgeDismissed', '1')
    setPushNudgeDismissed(true)
  }

  useEffect(() => {
    const handler = () => {
      if (isDemoMode) {
        void handleExitDemo()
      } else {
        setAuthExpired(true)
      }
    }
    window.addEventListener('auth:expired', handler)
    return () => window.removeEventListener('auth:expired', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoMode])

  // Close user menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)')

    const syncSidebarState = (desktop: boolean) => {
      setIsDesktop(desktop)
      setSidebarOpen(desktop)
    }

    syncSidebarState(mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => {
      syncSidebarState(event.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    const handleOffline = () => {
      setIsOnline(false)
      setShowReconnected(false)
    }

    const handleOnline = () => {
      setIsOnline(true)
      setShowReconnected(true)
      window.setTimeout(() => setShowReconnected(false), 3000)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleExitDemo = async () => {
    try { await apiFetch('/demo/end', { method: 'POST' }) } catch { /* ignore */ }
    endDemo()
    logout()
    navigate('/home', { replace: true })
  }

  const closeSidebar = () => {
    if (!isDesktop) {
      setSidebarOpen(false)
    }
  }

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isDesktop && <img src="/favicon.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />}
          <div>
            <NavLink to="/groups" className="text-xl font-bold text-indigo-400 hover:text-indigo-300 transition-colors">GEM</NavLink>
            <p className="text-xs text-gray-500 mt-1">Group Event Manager</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isDesktop && <NotificationBell />}
          {/* Close button on mobile */}
          {!isDesktop && <button
            onClick={closeSidebar}
            aria-label="Close menu"
            className="p-1 text-gray-400 hover:text-gray-100"
          >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          </button>}
        </div>
      </div>
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3 space-y-1">
        {/* Collapsible Pages section */}
        <button
          onClick={() => setPagesOpen((v) => !v)}
          className="w-full flex items-center justify-between px-2 mb-1 text-xs uppercase tracking-wider text-gray-500 hover:text-gray-400 transition-colors"
        >
          <span>Pages</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`w-3 h-3 transition-transform ${pagesOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {pagesOpen && (
          <div className="mb-2 space-y-0.5">
            {[
              { to: '/home', label: 'Home', end: true },
              { to: '/updates', label: 'Updates', end: false },
              { to: '/help', label: 'Help', end: false },
              { to: '/contact', label: 'Contact', end: false },
            ].map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={closeSidebar}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        )}

        <p className="text-xs uppercase tracking-wider text-gray-500 px-2 mb-2">
          Your Groups
        </p>
        {groups?.groups?.map((g: GroupSummary) => (
          <NavLink
            key={g.id}
            to={`/groups/${g.id}`}
            onClick={closeSidebar}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`
            }
          >
            <span className="w-6 h-6 rounded-full bg-indigo-900 flex items-center justify-center text-xs font-bold">
              {g.name[0].toUpperCase()}
            </span>
            {g.name}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-gray-800">
        {/* Developer panel link — admin only, hidden in demo */}
        {user?.isAdmin && !isDemoMode && (
          <NavLink
            to="/developer"
            onClick={closeSidebar}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 mb-1 rounded-lg text-xs font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-indigo-400 hover:bg-gray-800'}`
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Developer
          </NavLink>
        )}
        {/* Demo mode: simplified exit button instead of full user menu */}
        {isDemoMode ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 truncate">Demo User</p>
              <p className="text-xs text-gray-600">@demo</p>
            </div>
            <button
              onClick={handleExitDemo}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-900/60 hover:bg-red-800 text-red-300 hover:text-white border border-red-800 hover:border-red-600 transition-colors shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Exit Demo
            </button>
          </div>
        ) : (
        /* Normal user menu */
        <div
          ref={userMenuRef}
          className="relative"
          onMouseEnter={() => {
            if (!isDesktop) return
            if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current)
            setUserMenuOpen(true)
          }}
          onMouseLeave={() => {
            if (!isDesktop) return
            userMenuCloseTimer.current = setTimeout(() => setUserMenuOpen(false), 200)
          }}
        >
          {isDesktop ? (
            <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition-colors">
              <NavLink
                to="/profile"
                onClick={() => setUserMenuOpen(false)}
                className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-indigo-500 transition-all"
              >
                <Avatar
                  name={user?.name ?? ''}
                  avatarUrl={user?.avatarUrl}
                  size="sm"
                />
              </NavLink>
              <button
                onClick={() => setUserMenuOpen((prev) => !prev)}
                className="flex items-center gap-2 flex-1 min-w-0"
              >
                <span className="truncate flex-1 text-left">
                  {user?.username ? `@${user.username}` : user?.name}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setUserMenuOpen((prev) => !prev)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition-colors"
            >
              <Avatar
                name={user?.name ?? ''}
                avatarUrl={user?.avatarUrl}
                size="sm"
              />
              <span className="truncate flex-1 text-left">
                {user?.username ? `@${user.username}` : user?.name}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}

          {userMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg py-1 shadow-xl z-50">
              <NavLink
                to="/profile"
                onClick={() => { setUserMenuOpen(false); closeSidebar() }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile
              </NavLink>
              <NavLink
                to="/settings"
                onClick={() => { setUserMenuOpen(false); closeSidebar() }}
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
                onClick={() => { setUserMenuOpen(false); handleLogout() }}
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
        )}
      </div>
    </>
  )

  return (
    <div className="flex h-full w-full overflow-hidden bg-gray-950 text-gray-100">
      <ToastContainer />

      {/* Mobile overlay */}
      {sidebarOpen && !isDesktop && (
        <div
          className="fixed inset-0 z-20 bg-black/60"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — controlled in JS for stable desktop visibility across reloads */}
      <aside
        aria-label="Sidebar navigation"
        className={`${isDesktop ? 'static inset-auto left-auto shrink-0' : 'fixed inset-y-0 left-0'} z-30 w-64 flex flex-col bg-gray-900 border-r border-gray-800 transform transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Global top banner — mobile only, hidden on channel pages (channel has its own header) */}
        {!isDesktop && !isChannelPage && (
          <header className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="p-1 text-gray-400 hover:text-gray-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <NavLink to="/groups" className="text-sm font-bold text-indigo-400 hover:text-indigo-300 transition-colors flex-1">GEM</NavLink>
            <NotificationBell />
          </header>
        )}

        {isDemoMode && <DemoBanner />}

        {authExpired && (
          <div className="px-4 py-3 bg-red-950/80 border-b border-red-800 text-red-100 text-sm">
            <p className="font-medium">Your session has expired.</p>
            <p className="text-red-300 text-xs mt-0.5">Please log out and log back in to continue using the app.</p>
            <button
              onClick={handleLogout}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-medium transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Log Out
            </button>
          </div>
        )}
        {!isOnline && (
          <div className="px-4 py-2 bg-amber-900/60 border-b border-amber-700 text-amber-100 text-xs">
            Offline mode: actions may fail until your connection is restored.
          </div>
        )}
        {isOnline && showReconnected && (
          <div className="px-4 py-2 bg-emerald-900/60 border-b border-emerald-700 text-emerald-100 text-xs">
            Reconnected. Live updates are back online.
          </div>
        )}
        {showPushNudge && (
          <div className="px-4 py-2 bg-indigo-950/80 border-b border-indigo-800 text-indigo-100 text-xs flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span className="flex-1">
              Enable push notifications to get updates when the app is closed.{' '}
              <NavLink to="/settings/notifications" className="underline font-medium hover:text-white">
                Go to notification settings →
              </NavLink>
            </span>
            <button onClick={dismissPushNudge} aria-label="Dismiss" className="p-1 text-indigo-400 hover:text-white shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* PWA install nudge — shown on mobile browsers that haven't installed the app */}
        {pwaInstall.showBanner && (
          <div className="px-4 py-2 bg-gray-800/90 border-b border-gray-700 text-gray-100 text-xs flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-5 h-5 shrink-0 rounded" />
            <span className="flex-1">Add GEM to your home screen for the best experience.</span>
            <button
              onClick={() => {
                if (pwaInstall.isIOS) setShowIosInstallModal(true)
                else pwaInstall.install()
              }}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            >
              Install
            </button>
            <button onClick={pwaInstall.dismiss} aria-label="Dismiss" className="p-1 text-gray-400 hover:text-white shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* iOS install instructions modal */}
        {showIosInstallModal && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-0"
            onClick={() => setShowIosInstallModal(false)}
          >
            <div
              className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-t-2xl p-6 pb-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <img src="/favicon.png" alt="" className="w-8 h-8 rounded-xl" />
                  <div>
                    <p className="text-white font-semibold text-sm">Add GEM to Home Screen</p>
                    <p className="text-gray-500 text-xs">gem.aidanlenahan.com</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowIosInstallModal(false)}
                  className="p-1.5 text-gray-400 hover:text-white rounded-full hover:bg-gray-800 transition-colors"
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <ol className="space-y-4">
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                  <div>
                    <p className="text-sm text-gray-200">Tap the <strong className="text-white">Share</strong> button in Safari's toolbar</p>
                    <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 bg-gray-800 rounded-lg">
                      {/* iOS share icon */}
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      <span className="text-xs text-gray-300">Share</span>
                    </div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                  <p className="text-sm text-gray-200">Scroll down and tap <strong className="text-white">Add to Home Screen</strong></p>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                  <p className="text-sm text-gray-200">Tap <strong className="text-white">Add</strong> in the top-right corner</p>
                </li>
              </ol>
              <button
                onClick={() => { setShowIosInstallModal(false); pwaInstall.dismiss() }}
                className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}

        <main className={`flex-1 min-w-0 min-h-0 overflow-x-hidden ${isChannelPage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
