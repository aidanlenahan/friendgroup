import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { apiFetch, ApiError } from '../lib/api'
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
    username?: string | null
    usernameChangedAt?: string | null
    avatarUrl?: string | null
  }
}

type UploadUrlResponse = {
  uploadUrl: string
  fileKey: string
  publicUrl: string
}

export default function SettingsPage() {
  const { user, login, token } = useAuthStore()
  const toast = useToast()
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    setUploadingAvatar(true)
    try {
      const { uploadUrl, publicUrl } = await apiFetch<UploadUrlResponse>('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: file.type, context: 'avatar' }),
      })
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      setAvatarUrl(publicUrl)
      toast.success('Photo uploaded — save your profile to apply it')
    } catch {
      toast.error('Failed to upload photo')
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { name, avatarUrl: avatarUrl || null }
      const trimmedUsername = username.trim()
      if (trimmedUsername && trimmedUsername !== user?.username) {
        payload.username = trimmedUsername
      }
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      if (token && data.user) {
        login(token, {
          ...data.user,
          username: data.user.username ?? undefined,
          avatarUrl: data.user.avatarUrl ?? undefined,
        })
      }
      toast.success('Profile updated')
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        toast.error('Username can only be changed once per year')
      } else if (err instanceof ApiError && err.status === 409) {
        toast.error('That username is already taken')
      } else {
        toast.error('Failed to update profile')
      }
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

        {/* Avatar */}
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Profile"
              className="w-16 h-16 rounded-full object-cover border-2 border-gray-700"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-indigo-900 flex items-center justify-center text-2xl font-bold text-white">
              {(name || user?.name || '?')[0].toUpperCase()}
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {uploadingAvatar ? 'Uploading...' : 'Upload Photo'}
            </button>
            <p className="text-xs text-gray-500 mt-1">JPG, PNG, or GIF</p>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Display Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Username
            <span className="text-gray-600 ml-2 font-normal">(can be changed once per year)</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="your_username"
              maxLength={40}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-8 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {user?.username && (
            <p className="text-xs text-gray-600 mt-1">Current: @{user.username}</p>
          )}
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

      <div className="mt-8 space-y-4">
        <h3 className="text-lg font-semibold text-gray-200">Developer Tools</h3>
        <Link
          to="/phase-7/debug"
          className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-yellow-600 transition-colors"
        >
          <p className="text-sm font-medium text-white">Phase 7 Debug</p>
          <p className="text-xs text-gray-500 mt-1">Push notifications &amp; service worker debug</p>
        </Link>
        <Link
          to="/phase-9/diagnostics"
          className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-yellow-600 transition-colors"
        >
          <p className="text-sm font-medium text-white">Phase 9 Diagnostics</p>
          <p className="text-xs text-gray-500 mt-1">API connectivity &amp; system diagnostics</p>
        </Link>
      </div>
    </div>
  )
}
