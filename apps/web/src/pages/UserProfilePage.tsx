import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
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

interface MemberStats {
  eventsCreated: number
  rsvpYes: number
  rsvpMaybe: number
  rsvpNo: number
  photosUploaded: number
}

function UserGroupStats({ groupId, userId }: { groupId: string; userId: string }) {
  const { data } = useQuery<MemberStats>({
    queryKey: ['groups', groupId, 'members', userId, 'stats'],
    queryFn: () => apiFetch(`/groups/${groupId}/members/${userId}/stats`),
    staleTime: 60_000,
  })

  if (!data) return null

  const items = [
    data.eventsCreated > 0 && { label: 'created', value: data.eventsCreated },
    data.rsvpYes > 0 && { label: 'going', value: data.rsvpYes },
    data.rsvpMaybe > 0 && { label: 'maybe', value: data.rsvpMaybe },
    data.photosUploaded > 0 && { label: 'photos', value: data.photosUploaded },
  ].filter(Boolean) as { label: string; value: number }[]

  if (items.length === 0) return null

  return (
    <div className="px-3 pb-2.5 flex items-center gap-3 flex-wrap">
      {items.map((item) => (
        <span key={item.label} className="text-xs text-gray-500">
          <span className="text-gray-300 font-medium">{item.value}</span> {item.label}
        </span>
      ))}
    </div>
  )
}

interface UserProfile {
  id: string
  name: string
  username: string | null
  bio?: string | null
  avatarUrl: string | null
  email?: string | null
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

  useEffect(() => {
    if (!data?.user?.name) return
    document.title = `${data.user.name} — GEM`
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [data?.user?.name])

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
  const joinedLabel = new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

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
      <div className="flex justify-end mb-4">
        <PageToolbar />
      </div>

      {/* Profile card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex items-start gap-5">
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white truncate">{user.name}</h1>
          {user.username && (
            <p className="text-indigo-400 text-sm">@{user.username}</p>
          )}
          <p className="text-gray-500 text-xs mt-1">Member since {joinedLabel}</p>
          {user.bio && (
            <p className="text-gray-300 text-sm mt-2 whitespace-pre-wrap break-words">{user.bio}</p>
          )}
          {user.email && (
            <p className="text-gray-400 text-xs mt-0.5">{user.email}</p>
          )}

          {!isOwnProfile && (
            <button
              type="button"
              onClick={handleMuteToggle}
              disabled={muteLoading}
              className={`mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                isMuted
                  ? 'bg-red-950 text-red-400 hover:bg-red-900'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {muteLoading ? '…' : isMuted ? 'Unblock' : 'Block'}
            </button>
          )}
        </div>
      </div>

      {isMuted && (
        <p className="mt-2 text-xs text-red-500 pl-1">
          You have blocked this user. They won't appear in your notifications.
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
              <div key={g.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <Link
                  to={`/groups/${g.id}`}
                  className="flex items-center gap-3 p-3 hover:bg-gray-800/50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-indigo-900 flex items-center justify-center text-sm font-bold text-indigo-300 shrink-0">
                    {g.name[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-white truncate flex-1 min-w-0">{g.name}</span>
                </Link>
                <UserGroupStats groupId={g.id} userId={user.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

