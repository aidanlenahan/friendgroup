import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'

interface MutualGroup {
  id: string
  name: string
  avatarUrl?: string | null
}

interface UserProfile {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
  createdAt: string
  mutualGroups: MutualGroup[]
}

function useUserProfile(username: string) {
  return useQuery({
    queryKey: ['users', username],
    queryFn: () => apiFetch<{ user: UserProfile }>(`/users/${encodeURIComponent(username)}`),
    enabled: Boolean(username),
    retry: false,
  })
}

function useMutedUsers() {
  return useQuery({
    queryKey: ['users', 'muted'],
    queryFn: () => apiFetch<{ mutedUsers: { id: string }[] }>('/users/muted'),
  })
}

function useMuteUser(targetUserId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ muted: boolean }>(`/users/${targetUserId}/mute`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'muted'] }),
  })
}

function useUnmuteUser(targetUserId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ muted: boolean }>(`/users/${targetUserId}/mute`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'muted'] }),
  })
}

export default function UserProfilePage() {
  const { username } = useParams<{ username: string }>()
  const { data, isLoading, error } = useUserProfile(username ?? '')
  const { user: currentUser } = useAuthStore()

  const { data: mutedData } = useMutedUsers()
  const userId = data?.user?.id ?? ''
  const isMuted = mutedData?.mutedUsers.some((u) => u.id === userId) ?? false

  const muteUser = useMuteUser(userId)
  const unmuteUser = useUnmuteUser(userId)

  const isOwnProfile = Boolean(currentUser && data?.user && currentUser.id === data.user.id)

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
      </div>
    )
  }

  if (error || !data?.user) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-gray-400 px-4">
        <p className="text-lg font-medium text-white">User not found</p>
        <p className="text-sm text-gray-500">@{username} doesn't exist or hasn't set a username yet.</p>
        <Link to="/groups" className="text-indigo-400 hover:text-indigo-300 text-sm mt-2">
          ← Back to groups
        </Link>
      </div>
    )
  }

  const { user } = data
  const joinedYear = new Date(user.createdAt).getFullYear()

  const handleMuteToggle = () => {
    if (isMuted) {
      unmuteUser.mutate()
    } else {
      muteUser.mutate()
    }
  }

  const muteLoading = muteUser.isPending || unmuteUser.isPending

  return (
    <div className="px-4 py-6 sm:p-6 max-w-xl mx-auto">
      {/* Back */}
      <Link
        to={-1 as unknown as string}
        onClick={(e) => { e.preventDefault(); window.history.back() }}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-6"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </Link>

      {/* Profile card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex items-start gap-5">
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white truncate">{user.name}</h1>
          {user.username && (
            <p className="text-indigo-400 text-sm">@{user.username}</p>
          )}
          <p className="text-gray-500 text-xs mt-1">Member since {joinedYear}</p>

          {!isOwnProfile && (
            <button
              type="button"
              onClick={handleMuteToggle}
              disabled={muteLoading}
              className={`mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                isMuted
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {muteLoading ? '…' : isMuted ? 'Unmute' : 'Mute'}
            </button>
          )}
        </div>
      </div>

      {isMuted && (
        <p className="mt-2 text-xs text-amber-500 pl-1">
          You won't receive notifications from this user.
        </p>
      )}

      {/* Mutual groups */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Mutual Groups ({user.mutualGroups.length})
        </h2>
        {user.mutualGroups.length === 0 ? (
          <p className="text-sm text-gray-500">No groups in common.</p>
        ) : (
          <div className="space-y-2">
            {user.mutualGroups.map((g) => (
              <Link
                key={g.id}
                to={`/groups/${g.id}`}
                className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl p-3 hover:border-indigo-600 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-indigo-900 flex items-center justify-center text-sm font-bold text-indigo-300 shrink-0">
                  {g.name[0].toUpperCase()}
                </div>
                <span className="text-sm font-medium text-white truncate">{g.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

