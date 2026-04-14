import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useGroups } from '../hooks/useGroups'
import type { GroupSummary } from '../hooks/useGroups'
import ToastContainer from './Toast'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { data: groups } = useGroups()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const closeSidebar = () => setSidebarOpen(false)

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-indigo-400">Friendgroup</h1>
          <p className="text-xs text-gray-500 mt-1">{user?.name}</p>
        </div>
        {/* Close button on mobile */}
        <button
          onClick={closeSidebar}
          aria-label="Close menu"
          className="md:hidden p-1 text-gray-400 hover:text-gray-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3 space-y-1">
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
      <div className="p-3 border-t border-gray-800 space-y-1">
        <NavLink
          to="/settings"
          onClick={closeSidebar}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800"
        >
          Settings
        </NavLink>
        <button
          onClick={handleLogout}
          className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-gray-800"
        >
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <ToastContainer />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — hidden off-canvas on mobile, always visible on md+ */}
      <aside
        aria-label="Sidebar navigation"
        className={`fixed inset-y-0 left-0 z-30 w-64 flex flex-col bg-gray-900 border-r border-gray-800 transform transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:flex`}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="p-1 text-gray-400 hover:text-gray-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold text-indigo-400">Friendgroup</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
