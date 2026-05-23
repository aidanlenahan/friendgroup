import { useState, useRef, useEffect } from 'react'
import PageToolbar from '../components/PageToolbar'
import { useAuthStore } from '../stores/authStore'
import { apiFetch, ApiError } from '../lib/api'
import { useToast } from '../hooks/useToast'
import Avatar from '../components/Avatar'

type UpdateMeResponse = {
  user?: {
    id: string
    email: string
    name: string
    username?: string | null
    bio?: string | null
    usernameChangedAt?: string | null
    avatarUrl?: string | null
    theme?: string | null
    showEmail?: boolean
  }
}

export default function ProfilePage() {
  useEffect(() => {
    document.title = 'My Profile — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  const { user, setUser } = useAuthStore()
  const toast = useToast()
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [usernameError, setUsernameError] = useState('')
  const [showEmailToggling, setShowEmailToggling] = useState(false)

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Only JPG, PNG, or WebP images are allowed')
      if (avatarInputRef.current) avatarInputRef.current.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Profile photo must be under 2 MB')
      if (avatarInputRef.current) avatarInputRef.current.value = ''
      return
    }

    // Dimension check: max 800×800
    const checkDimensions = () => new Promise<boolean>((resolve) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); resolve(img.width <= 800 && img.height <= 800) }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(false) }
      img.src = url
    })
    if (!(await checkDimensions())) {
      toast.error('Profile photo must be 800×800 px or smaller')
      if (avatarInputRef.current) avatarInputRef.current.value = ''
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    setUploadingAvatar(true)
    try {
      const { avatarUrl: newUrl } = await apiFetch<{ avatarUrl: string }>('/users/me/avatar', {
        method: 'POST',
        body: formData,
      })
      setAvatarUrl(newUrl)
      if (user) {
        setUser({ ...user, avatarUrl: newUrl })
      }
      toast.success('Profile photo updated')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to upload photo'
      toast.error(msg)
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleToggleShowEmail = async () => {
    setShowEmailToggling(true)
    try {
      const newValue = !user?.showEmail
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ showEmail: newValue }),
      })
      if (data.user) {
        setUser({ ...user!, ...data.user, username: data.user.username ?? undefined, avatarUrl: data.user.avatarUrl ?? undefined })
      }
    } catch {
      toast.error('Failed to update email visibility')
    } finally {
      setShowEmailToggling(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { name, bio: bio.trim() || null, avatarUrl: avatarUrl || null }
      const trimmedUsername = username.trim()
      if (trimmedUsername && trimmedUsername !== user?.username) {
        payload.username = trimmedUsername
      }
      const data = await apiFetch<UpdateMeResponse>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      if (data.user) {
        setUser({
          ...data.user,
          username: data.user.username ?? undefined,
          avatarUrl: data.user.avatarUrl ?? undefined,
        })
      }
      toast.success('Profile updated')
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const nextAllowedAt = err.data?.nextAllowedAt as string | undefined
        if (nextAllowedAt) {
          const now = new Date()
          const next = new Date(nextAllowedAt)
          const msLeft = next.getTime() - now.getTime()
          const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))
          // Calendar-accurate month count
          let monthsLeft = (next.getFullYear() - now.getFullYear()) * 12 + (next.getMonth() - now.getMonth())
          if (next.getDate() < now.getDate()) monthsLeft--
          const dateStr = next.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          const timeLabel = monthsLeft >= 2 ? `${monthsLeft} months` : `${daysLeft} days`
          setUsernameError(`Username can be changed again on ${dateStr} (${timeLabel} from now)`)
        } else {
          setUsernameError('Username can only be changed once per year')
        }
      } else if (err instanceof ApiError && err.status === 409) {
        toast.error('That username is already taken')
      } else {
        toast.error('Failed to update profile')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Profile</h2>
        <PageToolbar backTo="/groups" />
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Avatar */}
        <div>
          <label className="block text-sm text-gray-400 mb-3">Profile Photo</label>
          <div className="flex items-center gap-4">
            <Avatar name={name || user?.name || '?'} avatarUrl={avatarUrl || null} size="lg" />
            <div>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {uploadingAvatar ? 'Uploading...' : 'Upload Photo'}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="ml-2 px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-red-400 rounded-lg transition-colors"
                >
                  Remove
                </button>
              )}
              <p className="text-xs text-gray-500 mt-1">JPG, PNG, or WebP · max 800×800 px · 2 MB</p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
          </div>
        </div>

        {/* Display Name */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Display Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Your name"
          />
        </div>

        {/* Username */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Username
            <span className="text-gray-500 ml-2 font-normal text-xs">(can be changed once per year)</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">@</span>
            <input
              value={username}
              onChange={(e) => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setUsernameError('') }}
              placeholder="your_username"
              maxLength={40}
              className={`w-full bg-gray-800 border rounded-xl pl-8 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${usernameError ? 'border-red-600' : 'border-gray-700'}`}
            />
          </div>
          {usernameError ? (
            <p className="text-xs text-red-400 mt-1">{usernameError}</p>
          ) : user?.username ? (
            <p className="text-xs text-gray-400 mt-1">Current: @{user.username}</p>
          ) : null}
        </div>

        {/* Bio */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Bio
            <span className="text-gray-500 ml-2 font-normal text-xs">(max 200 characters)</span>
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="A short bio visible on your profile"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
          />
          <p className="text-xs text-gray-600 text-right mt-0.5">{bio.length}/200</p>
        </div>

        {/* Email (read-only) + visibility toggle */}
        <div className="space-y-2">
          <label className="block text-sm text-gray-400">Email</label>
          <input
            value={user?.email ?? ''}
            readOnly
            className="w-full bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-3 text-gray-400 cursor-not-allowed"
          />
          <div className="flex items-center justify-between gap-4 px-1">
            <div>
              <p className="text-sm text-gray-300">Show email on profile</p>
              <p className="text-xs text-gray-500">Other group members can see your email on your public profile</p>
            </div>
            <button
              type="button"
              onClick={handleToggleShowEmail}
              disabled={showEmailToggling}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-50 ${
                user?.showEmail ? 'bg-indigo-600' : 'bg-gray-700'
              }`}
              role="switch"
              aria-checked={user?.showEmail}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${user?.showEmail ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}
