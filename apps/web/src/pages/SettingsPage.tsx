import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
    birthdate?: string | null
    birthdateSet?: boolean
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
  useEffect(() => {
    document.title = 'Settings — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  const { user, setUser, logout } = useAuthStore()
  const toast = useToast()
  const qc = useQueryClient()

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [themeSaving, setThemeSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const rawTheme = user?.theme ?? 'dark'
  const [currentMode, currentAccentRaw] = rawTheme.split(':')
  const currentTheme = (currentMode === 'light' ? 'light' : 'dark') as 'dark' | 'light'
  const currentAccent = currentAccentRaw ?? 'indigo'

  // Tag subscriptions state
  const { data: groupsData } = useGroups()
  const [tagGroupId, setTagGroupId] = useState('')
  const { data: tagPrefsData } = useTagPreferences(tagGroupId)
  const updateTagPref = useUpdateTagPreference()

  // Blocked (muted) users
  const { data: mutedData } = useQuery({
    queryKey: ['users', 'muted'],
    queryFn: () => apiFetch<{ mutedUsers: MutedUser[] }>('/users/muted'),
  })
  const unmuteUser = useMutation({
    mutationFn: (userId: string) =>
      apiFetch<{ muted: boolean }>(`/users/${userId}/mute`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'muted'] }),
    onError: () => toast.error('Failed to unblock user'),
  })

  // Profile visibility
  const [showEmailToggling, setShowEmailToggling] = useState(false)
  const handleToggleShowEmail = async () => {
    if (showEmailToggling) return
    setShowEmailToggling(true)
    try {
      const data = await apiFetch<{ user: { showEmail: boolean } }>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ showEmail: !user?.showEmail }),
      })
      setUser({ ...user!, showEmail: data.user.showEmail })
    } catch {
      toast.error('Failed to update email visibility')
    } finally {
      setShowEmailToggling(false)
    }
  }

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
      if (data.user) {
        setUser({
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

  const saveTheme = async (mode: 'dark' | 'light', accent: string) => {
    const newTheme = accent === 'indigo' ? mode : `${mode}:${accent}`
    if (newTheme === rawTheme || themeSaving) return
    setThemeSaving(true)
    try {
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ theme: newTheme }),
      })
      if (data.user) {
        setUser({
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

  const handleModeChange = (newMode: 'dark' | 'light') => saveTheme(newMode, currentAccent)
  const handleAccentChange = (newAccent: string) => saveTheme(currentTheme, newAccent)

  const navigate = useNavigate()

  // --- Birthdate ---
  const [birthdateEdit, setBirthdateEdit] = useState('')
  const [birthdateSaving, setBirthdateSaving] = useState(false)

  const maxBirthdate = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 13)
    return d.toISOString().split('T')[0]
  })()

  const handleSaveBirthdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!birthdateEdit || birthdateEdit > maxBirthdate) return
    setBirthdateSaving(true)
    try {
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ birthdate: birthdateEdit }),
      })
      if (data.user) {
        setUser({
          ...user!,
          ...data.user,
          username: data.user.username ?? undefined,
          avatarUrl: data.user.avatarUrl ?? undefined,
          theme: data.user.theme ?? 'dark',
        })
      }
      toast.success('Date of birth saved')
      setBirthdateEdit('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save date of birth'
      toast.error(msg)
    } finally {
      setBirthdateSaving(false)
    }
  }

  // --- Change Password ---
  const [changePwOpen, setChangePwOpen] = useState(false)
  const [changePwCurrent, setChangePwCurrent] = useState('')
  const [changePwNew, setChangePwNew] = useState('')
  const [changePwConfirm, setChangePwConfirm] = useState('')
  const [changePwLoading, setChangePwLoading] = useState(false)

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (changePwNew !== changePwConfirm) {
      toast.error('New passwords do not match')
      return
    }
    if (changePwNew.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    setChangePwLoading(true)
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: changePwCurrent, newPassword: changePwNew }),
      })
      toast.success('Password updated')
      setChangePwCurrent('')
      setChangePwNew('')
      setChangePwConfirm('')
      setChangePwOpen(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change password'
      toast.error(msg)
    } finally {
      setChangePwLoading(false)
    }
  }

  // --- Change Email ---
  type EmailStep = 'idle' | 'form' | 'verify'
  const [emailStep, setEmailStep] = useState<EmailStep>('idle')
  const [changeEmailPassword, setChangeEmailPassword] = useState('')
  const [changeEmailNew, setChangeEmailNew] = useState('')
  const [changeEmailCode, setChangeEmailCode] = useState('')
  const [changeEmailLoading, setChangeEmailLoading] = useState(false)

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangeEmailLoading(true)
    try {
      await apiFetch('/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({ password: changeEmailPassword, newEmail: changeEmailNew }),
      })
      setEmailStep('verify')
      toast.success('Verification code sent to your new address')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initiate email change'
      toast.error(msg)
    } finally {
      setChangeEmailLoading(false)
    }
  }

  const handleVerifyEmailChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangeEmailLoading(true)
    try {
      const data = await apiFetch<{ newEmail: string }>('/auth/verify-email-change', {
        method: 'POST',
        body: JSON.stringify({ code: changeEmailCode }),
      })
      if (user) {
        setUser({ ...user, email: data.newEmail })
      }
      toast.success('Email address updated')
      setEmailStep('idle')
      setChangeEmailPassword('')
      setChangeEmailNew('')
      setChangeEmailCode('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to verify email change'
      toast.error(msg)
    } finally {
      setChangeEmailLoading(false)
    }
  }

  // --- Delete Account ---
  type DeleteStep = 'idle' | 'form' | 'verify'
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteCode, setDeleteCode] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  const handleRequestDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setDeleteLoading(true)
    try {
      await apiFetch('/auth/request-account-deletion', {
        method: 'POST',
        body: JSON.stringify({ password: deletePassword }),
      })
      setDeleteStep('verify')
      toast.success('Verification code sent to your email')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send verification code'
      toast.error(msg)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleConfirmDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setDeleteLoading(true)
    try {
      await apiFetch('/users/me', {
        method: 'DELETE',
        body: JSON.stringify({ code: deleteCode }),
      })
      logout()
      navigate('/home')
      toast.success('Your account has been permanently deleted')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete account'
      toast.error(msg)
    } finally {
      setDeleteLoading(false)
    }
  }

  const resetDeleteFlow = () => {
    setDeleteStep('idle')
    setDeletePassword('')
    setDeleteCode('')
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
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-5">
          {/* Mode */}
          <div>
            <p className="text-sm font-medium text-white mb-3">Mode</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleModeChange('dark')}
                disabled={themeSaving}
                aria-pressed={currentTheme === 'dark'}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  currentTheme === 'dark'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                Dark
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('light')}
                disabled={themeSaving}
                aria-pressed={currentTheme === 'light'}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  currentTheme === 'light'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                Light
              </button>
            </div>
          </div>

          {/* Accent */}
          <div>
            <p className="text-sm font-medium text-white mb-3">Accent colour</p>
            <div className="flex gap-2 flex-wrap">
              {([
                { id: 'indigo',  label: '',  color: 'oklch(51.1% 0.262 276.966)' }, // indigo
                { id: 'violet',  label: '',  color: 'oklch(54.1% 0.281 293.009)' }, // violet
                { id: 'sky',     label: '',     color: 'oklch(58.8% 0.158 241.966)' }, // sky
                { id: 'emerald', label: '', color: 'oklch(59.6% 0.145 163.225)' }, // emerald
                { id: 'rose',    label: '',    color: 'oklch(58.6% 0.253 17.585)'  }, // rose
                { id: 'amber',   label: '',   color: 'oklch(66.6% 0.179 58.318)'  }, // amber
              ] as const).map(({ id, label, color }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleAccentChange(id)}
                  disabled={themeSaving}
                  aria-pressed={currentAccent === id}
                  aria-label={label}
                  title={label}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                    currentAccent === id
                      ? 'bg-gray-700 text-white ring-2 ring-offset-2 ring-offset-gray-900 ring-white/30'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {label}
                </button>
              ))}
            </div>
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

      {/* Profile Visibility */}
      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-semibold text-gray-200">Profile Visibility</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Show email on profile</p>
              <p className="text-xs text-gray-500 mt-0.5">Other group members can see your email on your public profile</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!user?.showEmail}
              onClick={handleToggleShowEmail}
              disabled={showEmailToggling}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${user?.showEmail ? 'bg-indigo-600' : 'bg-gray-700'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${user?.showEmail ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Blocked Users */}
      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-semibold text-gray-200">Blocked Users</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-xs text-gray-500">Blocked users won't appear in notifications. Unblock them from their profile or here.</p>
          {!mutedData?.mutedUsers?.length ? (
            <p className="text-sm text-gray-500">No blocked users.</p>
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
                  Unblock
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

      {/* Account Management */}
      {!user?.isDemo && (
        <div className="space-y-4 mt-8">
          <h3 className="text-lg font-semibold text-gray-200">Account</h3>

          {/* Date of Birth */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-sm font-medium text-white mb-0.5">Date of Birth</p>
            <p className="text-xs text-gray-500 mb-3">
              {user?.birthdateSet
                ? 'This field is locked and cannot be changed.'
                : 'You have one opportunity to set your date of birth.'}
            </p>
            {user?.birthdateSet ? (
              <div>
                <input
                  type="date"
                  value={user.birthdate ? user.birthdate.split('T')[0] : ''}
                  disabled
                  className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-gray-500 text-sm cursor-not-allowed"
                />
                <p className="text-xs text-gray-600 mt-1">Date of birth cannot be changed after it has been set.</p>
              </div>
            ) : (
              <form onSubmit={handleSaveBirthdate} className="flex items-end gap-3">
                <div className="flex-1">
                  <input
                    type="date"
                    value={birthdateEdit}
                    onChange={(e) => setBirthdateEdit(e.target.value)}
                    max={maxBirthdate}
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={birthdateSaving || !birthdateEdit || birthdateEdit > maxBirthdate}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
                >
                  {birthdateSaving ? 'Saving…' : 'Save'}
                </button>
              </form>
            )}
          </div>

          {/* Change Password */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => { setChangePwOpen((v) => !v); setChangePwCurrent(''); setChangePwNew(''); setChangePwConfirm('') }}
              className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-white">Change password</p>
                <p className="text-xs text-gray-500 mt-0.5">Update your login password</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-500 transition-transform ${changePwOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {changePwOpen && (
              <form onSubmit={handleChangePassword} className="px-4 pb-4 pt-0 space-y-3 border-t border-gray-800">
                <div className="pt-3">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Current password</label>
                  <input
                    type="password"
                    value={changePwCurrent}
                    onChange={(e) => setChangePwCurrent(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">New password</label>
                  <input
                    type="password"
                    value={changePwNew}
                    onChange={(e) => setChangePwNew(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Confirm new password</label>
                  <input
                    type="password"
                    value={changePwConfirm}
                    onChange={(e) => setChangePwConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={changePwLoading}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {changePwLoading ? 'Saving…' : 'Update password'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChangePwOpen(false)}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Change Email */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setEmailStep((s) => s === 'idle' ? 'form' : 'idle')
                setChangeEmailPassword('')
                setChangeEmailNew('')
                setChangeEmailCode('')
              }}
              className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-white">Change email</p>
                <p className="text-xs text-gray-500 mt-0.5">Current: {user?.email}</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-500 transition-transform ${emailStep !== 'idle' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {emailStep === 'form' && (
              <form onSubmit={handleRequestEmailChange} className="px-4 pb-4 pt-0 space-y-3 border-t border-gray-800">
                <div className="pt-3">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Confirm your password</label>
                  <input
                    type="password"
                    value={changeEmailPassword}
                    onChange={(e) => setChangeEmailPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">New email address</label>
                  <input
                    type="email"
                    value={changeEmailNew}
                    onChange={(e) => setChangeEmailNew(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={changeEmailLoading}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {changeEmailLoading ? 'Sending…' : 'Send verification code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailStep('idle')}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {emailStep === 'verify' && (
              <form onSubmit={handleVerifyEmailChange} className="px-4 pb-4 pt-0 space-y-3 border-t border-gray-800">
                <p className="pt-3 text-xs text-gray-400">We sent a 6-digit code to <span className="text-gray-200">{changeEmailNew}</span>. Enter it below to confirm the change.</p>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={changeEmailCode}
                    onChange={(e) => setChangeEmailCode(e.target.value.replace(/\D/g, ''))}
                    required
                    placeholder="000000"
                    className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={changeEmailLoading}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {changeEmailLoading ? 'Verifying…' : 'Confirm new email'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailStep('form')}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                  >
                    Back
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Delete Account */}
          <div className="bg-gray-900 border border-red-900/40 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => { deleteStep === 'idle' ? setDeleteStep('form') : resetDeleteFlow() }}
              className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-red-950/20 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-red-400">Delete account</p>
                <p className="text-xs text-gray-500 mt-0.5">Permanently remove your account and all data</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-500 transition-transform ${deleteStep !== 'idle' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {deleteStep === 'form' && (
              <form onSubmit={handleRequestDeleteAccount} className="px-4 pb-4 pt-0 space-y-3 border-t border-red-900/40">
                <p className="pt-3 text-xs text-gray-400">
                  This action is <span className="text-red-400 font-medium">permanent and cannot be undone</span>. Your profile, group memberships, and all content you've created will be deleted.
                </p>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Enter your password to continue</label>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Your current password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={deleteLoading || !deletePassword}
                    className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {deleteLoading ? 'Sending…' : 'Send verification code'}
                  </button>
                  <button
                    type="button"
                    onClick={resetDeleteFlow}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {deleteStep === 'verify' && (
              <form onSubmit={handleConfirmDeleteAccount} className="px-4 pb-4 pt-0 space-y-3 border-t border-red-900/40">
                <p className="pt-3 text-xs text-gray-400">
                  We sent a 6-digit code to <span className="text-gray-200">{user?.email}</span>. Enter it below to permanently delete your account.
                </p>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={deleteCode}
                    onChange={(e) => setDeleteCode(e.target.value.replace(/\D/g, ''))}
                    required
                    placeholder="000000"
                    className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={deleteLoading || deleteCode.length !== 6}
                    className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {deleteLoading ? 'Deleting…' : 'Delete my account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeleteStep('form'); setDeleteCode('') }}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                  >
                    Back
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {!isStandalone && (
        <div className="mt-8 space-y-4">
          <h3 className="text-lg font-semibold text-gray-200">Install App</h3>
          {installPrompt ? (
            <button
              onClick={handleInstall}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
            >
              Install GEM
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
