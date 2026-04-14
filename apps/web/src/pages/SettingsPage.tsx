import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { apiFetch } from '../lib/api'
import { useToast } from '../hooks/useToast'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type UpdateMeResponse = {
  user?: {
    id: string
    email: string
    name: string
    avatarUrl?: string | null
  }
}

export default function SettingsPage() {
  const { user, login, token } = useAuthStore()
  const toast = useToast()

  const [name, setName] = useState(user?.name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          avatarUrl: avatarUrl || null,
        }),
      })
      if (token && data.user) {
        login(token, {
          ...data.user,
          avatarUrl: data.user.avatarUrl ?? undefined,
        })
      }
      toast.success('Profile updated')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const handleInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    setInstallPrompt(null)
  }

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>

      <form onSubmit={handleSave} className="space-y-4 mb-8">
        <h3 className="text-lg font-semibold text-gray-200">Profile</h3>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Avatar URL</label>
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-200">Notifications</h3>
        <Link
          to="/settings/notifications"
          className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-indigo-600 transition-colors"
        >
          <p className="text-sm font-medium text-white">Notification Settings</p>
          <p className="text-xs text-gray-500 mt-1">
            Manage push, email, and per-tag notification preferences
          </p>
        </Link>
      </div>

      {!isStandalone && (
        <div className="mt-8 space-y-4">
          <h3 className="text-lg font-semibold text-gray-200">Install App</h3>
          {installPrompt ? (
            <button
              onClick={handleInstall}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
            >
              Install Friendgroup
            </button>
          ) : (
            <p className="text-sm text-gray-500">
              Open this page in a supported browser to install the PWA.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
