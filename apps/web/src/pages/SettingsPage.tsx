import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import { useDurationPresetsStore, formatDuration, MAX_PRESETS_COUNT } from '../stores/durationPresetsStore'
import { apiFetch } from '../lib/api'
import { useToast } from '../hooks/useToast'
import { useGroups } from '../hooks/useGroups'
import { useTagPreferences, useUpdateTagPreference } from '../hooks/useNotifications'
import Avatar from '../components/Avatar'

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
    theme?: string | null
  }
}

type AvatarUploadUrlResponse = {
  uploadUrl: string
  publicUrl: string
  objectKey: string
}

interface MutedUser {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
  mutedAt: string
}

export default function SettingsPage() {
  const { user, login, token } = useAuthStore()
  const toast = useToast()
  const qc = useQueryClient()

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [themeSaving, setThemeSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentTheme = user?.theme ?? 'dark'

  // Tag subscriptions state
  const { data: groupsData } = useGroups()
  const [tagGroupId, setTagGroupId] = useState('')
  const { data: tagPrefsData } = useTagPreferences(tagGroupId)
  const updateTagPref = useUpdateTagPreference()

  // Muted users
  const { data: mutedData } = useQuery({
    queryKey: ['users', 'muted'],
    queryFn: () => apiFetch<{ mutedUsers: MutedUser[] }>('/users/muted'),
  })
  const unmuteUser = useMutation({
    mutationFn: (userId: string) =>
      apiFetch<{ muted: boolean }>(`/users/${userId}/mute`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'muted'] }),
    onError: () => toast.error('Failed to unmute user'),
  })

  // Duration presets
  const { presets: durationPresets, addPreset, removePreset } = useDurationPresetsStore()
  const [addPresetHr, setAddPresetHr] = useState(0)
  const [addPresetMin, setAddPresetMin] = useState(30)

  const handleAddPreset = (e: React.FormEvent) => {
    e.preventDefault()
    const total = addPresetHr * 60 + addPresetMin
    if (total < 1) {
      toast.error('Duration must be at least 1 minute')
      return
    }
    if (durationPresets.includes(total)) {
      toast.error('That duration already exists')
      return
    }
    addPreset(total)
    setAddPresetHr(0)
    setAddPresetMin(30)
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Only image files are supported (JPEG, PNG, GIF, WebP, AVIF)')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setAvatarUploading(true)
    try {
      // 1. Get presigned upload URL
      const { uploadUrl, publicUrl } = await apiFetch<AvatarUploadUrlResponse>(
        '/media/avatar-upload-url',
        {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        }
      )

      // 2. PUT directly to S3/MinIO
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!s3Res.ok) throw new Error('S3 upload failed')

      // 3. Persist new URL on user record (also deletes old avatar from S3)
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: publicUrl }),
      })
      if (token && data.user) {
        login(token, {
          ...data.user,
          username: data.user.username ?? undefined,
          avatarUrl: data.user.avatarUrl ?? undefined,
          theme: data.user.theme ?? 'dark',
        })
      }
      toast.success('Profile photo updated')
    } catch {
      toast.error('Failed to upload photo. Please try again.')
    } finally {
      setAvatarUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    setInstallPrompt(null)
  }

  const handleThemeChange = async (newTheme: 'dark' | 'light') => {
    if (newTheme === currentTheme || themeSaving) return
    setThemeSaving(true)
    try {
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ theme: newTheme }),
      })
      if (token && data.user) {
        login(token, {
          ...data.user,
          username: data.user.username ?? undefined,
          avatarUrl: data.user.avatarUrl ?? undefined,
          theme: data.user.theme ?? 'dark',
        })
      }
    } catch {
      toast.error('Failed to save theme preference')
    } finally {
      setThemeSaving(false)
    }
  }

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        <PageToolbar backTo="/groups" />
      </div>

      {/* Profile */}
      <div className="space-y-4 mb-8">
        <h3 className="text-lg font-semibold text-gray-200">Profile</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-4">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="Profile photo"
                className="w-16 h-16 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
                {user?.name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              {user?.username && (
                <p className="text-xs text-gray-400 truncate">@{user.username}</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="mt-2 text-sm bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {avatarUploading ? 'Uploading…' : 'Upload Photo'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        <h3 className="text-lg font-semibold text-gray-200">Appearance</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-sm font-medium text-white mb-3">Theme</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleThemeChange('dark')}
              disabled={themeSaving}
              aria-pressed={currentTheme === 'dark'}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                currentTheme === 'dark'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Dark
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange('light')}
              disabled={themeSaving}
              aria-pressed={currentTheme === 'light'}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                currentTheme === 'light'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Light
            </button>
          </div>
        </div>
      </div>

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

      {/* Tag Subscriptions */}
      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-semibold text-gray-200">Tag Subscriptions</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          <p className="text-xs text-gray-500">Subscribe to topics to receive notifications for matching events.</p>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Group</label>
            <select
              value={tagGroupId}
              onChange={(e) => setTagGroupId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select a group…</option>
              {groupsData?.groups?.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          {tagGroupId && (
            <div className="space-y-2">
              {!tagPrefsData?.preferences?.length ? (
                <p className="text-xs text-gray-500">No tags in this group yet.</p>
              ) : (
                tagPrefsData.preferences.map((pref) => (
                  <div key={pref.tagId} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-300">{pref.tagName}</span>
                    <button
                      onClick={() =>
                        updateTagPref.mutate(
                          { tagId: pref.tagId, subscribed: !pref.subscribed },
                          { onError: () => toast.error('Failed to update subscription') }
                        )
                      }
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                        pref.subscribed ? 'bg-indigo-600' : 'bg-gray-700'
                      }`}
                      role="switch"
                      aria-checked={pref.subscribed}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          pref.subscribed ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Muted Users */}
      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-semibold text-gray-200">Muted Users</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-xs text-gray-500">You won't receive notifications from muted users.</p>
          {!mutedData?.mutedUsers?.length ? (
            <p className="text-sm text-gray-500">No muted users.</p>
          ) : (
            mutedData.mutedUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-3">
                <Avatar name={u.name} avatarUrl={u.avatarUrl} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{u.name}</p>
                  {u.username && (
                    <p className="text-xs text-gray-500 truncate">@{u.username}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => unmuteUser.mutate(u.id)}
                  disabled={unmuteUser.isPending}
                  className="text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Unmute
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Duration Presets */}
      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-semibold text-gray-200">Event Duration Presets</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          <p className="text-xs text-gray-500">
            Customize the duration options shown when creating or editing events. Maximum {MAX_PRESETS_COUNT} presets.
          </p>
          <div className="space-y-2">
            {durationPresets.map((p) => (
              <div key={p} className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-300">{formatDuration(p)}</span>
                <button
                  type="button"
                  onClick={() => removePreset(p)}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {durationPresets.length < MAX_PRESETS_COUNT ? (
            <form onSubmit={handleAddPreset} className="flex items-center gap-2 pt-2 border-t border-gray-800">
              <input
                type="number"
                min="0"
                max="23"
                value={addPresetHr}
                onChange={(e) => setAddPresetHr(Math.max(0, Number(e.target.value)))}
                className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-gray-400 text-sm">hr</span>
              <input
                type="number"
                min="0"
                max="59"
                value={addPresetMin}
                onChange={(e) => setAddPresetMin(Math.max(0, Math.min(59, Number(e.target.value))))}
                className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-gray-400 text-sm">min</span>
              <button
                type="submit"
                className="ml-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
              >
                Add
              </button>
            </form>
          ) : (
            <p className="text-xs text-gray-500 pt-2 border-t border-gray-800">Maximum of {MAX_PRESETS_COUNT} presets reached.</p>
          )}
        </div>
      </div>

      {!isStandalone && (
        <div className="mt-8 space-y-4">
          <h3 className="text-lg font-semibold text-gray-200">Install App</h3>
          {installPrompt ? (
            <button
              onClick={handleInstall}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
            >
              Install Gem
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
