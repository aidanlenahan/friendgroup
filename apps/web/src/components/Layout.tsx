import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useGroups } from '../hooks/useGroups'
import ToastContainer from './Toast'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { data: groups } = useGroups()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <ToastContainer />
      {/* Sidebar */}
      <aside className="w-64 flex flex-col bg-gray-900 border-r border-gray-800">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-xl font-bold text-indigo-400">Friendgroup</h1>
          <p className="text-xs text-gray-500 mt-1">{user?.name}</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-xs uppercase tracking-wider text-gray-500 px-2 mb-2">
            Your Groups
          </p>
          {groups?.groups?.map((g: any) => (
            <NavLink
              key={g.id}
              to={`/groups/${g.id}`}
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
      </aside>
      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
