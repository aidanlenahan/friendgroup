import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

const features = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    title: 'Private Groups',
    description: 'Create invite-only spaces for your crew. Only the people you trust.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Event Planning',
    description: 'Create events, send invites, and track RSVPs — no more endless group chats.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    title: 'Group Channels',
    description: 'Stay in sync with dedicated channels for every topic, trip, or plan.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Photo Sharing',
    description: 'Share moments from your events in one place, not scattered across apps.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
    title: 'Smart Notifications',
    description: 'Get notified about what matters — never miss a plan or update.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Works Everywhere',
    description: 'Install as a PWA on any device. Fast, offline-capable, always with you.',
  },
]

export default function LandingPage() {
  const { token } = useAuthStore()

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-indigo-600/10 rounded-full blur-3xl" />
          <div className="absolute top-20 right-0 w-64 h-64 bg-violet-600/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/60 border border-indigo-800/40 text-indigo-300 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Now in beta
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-gray-100 leading-tight">
            Plans that actually{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
              happen
            </span>
          </h1>

          <p className="mt-5 text-lg sm:text-xl text-gray-400 max-w-xl mx-auto leading-relaxed">
            GEM is the Group Event Manager for your crew — organize events, chat in channels, and share memories in one private space.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            {token ? (
              <Link
                to="/groups"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-600/20"
              >
                Open App
              </Link>
            ) : (
              <>
                <Link
                  to="/register"
                  className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-600/20"
                >
                  Get started free
                </Link>
                <Link
                  to="/login"
                  className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold text-gray-300 hover:text-gray-100 bg-gray-800/60 hover:bg-gray-800 border border-gray-700/60 transition-colors"
                >
                  Log in
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">
            Everything your group needs
          </h2>
          <p className="mt-3 text-gray-400 max-w-md mx-auto">
            Built for real friend groups, not mass social networks.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-indigo-800/60 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-950/60 border border-indigo-800/30 flex items-center justify-center text-indigo-400 mb-4 group-hover:bg-indigo-900/40 transition-colors">
                {f.icon}
              </div>
              <h3 className="font-semibold text-gray-100 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Banner */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-indigo-600 p-10 text-center">
          <div className="absolute inset-0 pointer-events-none" aria-hidden>
            <div className="absolute -top-10 -right-10 w-56 h-56 bg-violet-500/30 rounded-full blur-2xl" />
            <div className="absolute -bottom-10 -left-10 w-56 h-56 bg-indigo-400/20 rounded-full blur-2xl" />
          </div>
          <h2 className="relative text-2xl sm:text-3xl font-bold text-white">
            Ready to bring your group together?
          </h2>
          <p className="relative mt-2 text-indigo-100 text-sm">
            Sign up with a beta invite code and start planning today.
          </p>
          <div className="relative mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            {token ? (
              <Link
                to="/groups"
                className="px-6 py-3 rounded-xl text-sm font-semibold bg-white text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                Open App
              </Link>
            ) : (
              <>
                <Link
                  to="/register"
                  className="px-6 py-3 rounded-xl text-sm font-semibold bg-white text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  Create account
                </Link>
                <Link
                  to="/contact"
                  className="px-6 py-3 rounded-xl text-sm font-semibold text-white border border-white/40 hover:bg-white/10 transition-colors"
                >
                  Request a code
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
