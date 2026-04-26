import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useQuery } from '@tanstack/react-query'
import {
  useGroup,
  useGroupMembers,
  useGroupTags,
  useGroupInviteCode,
  useRegenerateInviteCode,
  useUpdateGroup,
  useDeleteGroup,
  useUpdateMemberRole,
  useRemoveMember,
  useApproveMember,
  useDenyMember,
  useCreateTag,
  useDeleteTag,
  useMuteMember,
  useUnmuteMember,
} from '../hooks/useGroups'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../hooks/useToast'
import { apiFetch, getApiErrorMessage } from '../lib/api'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'
import TagBadge from '../components/TagBadge'

function RoleGlyph({ role }: { role: 'owner' | 'admin' | 'member' }) {
  if (role === 'owner') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-[1.35rem] w-[1.35rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 18h14l-1-9-4 3-2-5-2 5-4-3-1 9Z" />
      </svg>
    )
  }
  if (role === 'admin') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 6 6v5c0 4.5 2.4 7.7 6 10 3.6-2.3 6-5.5 6-10V6l-6-3Z" />
      </svg>
    )
  }
  return null
}

export default function GroupManagePage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const currentUser = useAuthStore((s) => s.user)

  const { data: groupData, isLoading: groupLoading } = useGroup(groupId!)
  const { data: membersData, isLoading: membersLoading } = useGroupMembers(groupId!)
  const { data: tagsData } = useGroupTags(groupId!)
  const { data: inviteCodeData, refetch: refetchInviteCode } = useGroupInviteCode(groupId!)

  // Derive role (needed by hooks below)
  const myMembership = membersData?.members?.find((m) => m.userId === currentUser?.id)
  const isOwner = myMembership?.role === 'owner'
  const isAdmin = isOwner || myMembership?.role === 'admin'

  type AuditLogEntry = {
    id: string
    action: string
    createdAt: string
    meta?: Record<string, unknown> | null
    actor: { id: string; name: string; avatarUrl?: string | null }
    targetUser?: { id: string; name: string } | null
  }
  const [showAuditLog, setShowAuditLog] = useState(false)
  const [auditLogPage, setAuditLogPage] = useState(0)
  const auditLogSectionRef = useRef<HTMLElement>(null)
  const { data: auditLogData } = useQuery({
    queryKey: ['groups', groupId, 'audit-log'],
    queryFn: () => apiFetch<{ logs: AuditLogEntry[] }>(`/groups/${groupId}/audit-log`),
    enabled: !!groupId && showAuditLog && isAdmin,
  })

  const updateGroup = useUpdateGroup(groupId!)
  const deleteGroup = useDeleteGroup(groupId!)
  const updateMemberRole = useUpdateMemberRole(groupId!)
  const removeMember = useRemoveMember(groupId!)
  const regenerateCode = useRegenerateInviteCode(groupId!)
  const approveMember = useApproveMember(groupId!)
  const denyMember = useDenyMember(groupId!)
  const createTag = useCreateTag(groupId!)
  const deleteTag = useDeleteTag(groupId!)
  const muteMember = useMuteMember(groupId!)
  const unmuteMember = useUnmuteMember(groupId!)

  // Tag creation state
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#6366f1')
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<string | null>(null)

  // Group info edit state
  const group = groupData?.group
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [infoSaving, setInfoSaving] = useState(false)

  useEffect(() => {
    if (group) {
      setEditName(group.name ?? '')
      setEditDescription(group.description ?? '')
    }
  }, [group])

  // Invite code state
  const [showCode, setShowCode] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  // Members section state
  const [membersOpen, setMembersOpen] = useState(false)
  const [memberActionMenuUserId, setMemberActionMenuUserId] = useState<string | null>(null)
  const memberActionMenuRef = useRef<HTMLDivElement>(null)

  // Delete confirmation state
  const [deletePhase, setDeletePhase] = useState<'idle' | 'confirm' | 'typing'>('idle')
  const [deleteInput, setDeleteInput] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (memberActionMenuRef.current && !memberActionMenuRef.current.contains(e.target as Node)) {
        setMemberActionMenuUserId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // --- Guards ---
  if (groupLoading || membersLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
      </div>
    )
  }

  if (!group) {
    return <EmptyState title="Group not found" description="This group does not exist or you don't have access." />
  }

  // Access guard — only admins/owners
  if (!isAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="text-6xl font-black text-red-500">403</div>
        <h1 className="text-2xl font-bold text-white">Access Denied</h1>
        <p className="text-gray-400 text-sm max-w-sm">
          Group management is restricted to admins and owners.
        </p>
        <Link to={`/groups/${groupId}`} className="text-indigo-400 text-sm hover:text-indigo-300">
          ← Back to group
        </Link>
      </div>
    )
  }

  const activeMembers = membersData?.members?.filter((m) => m.status === 'active') ?? []
  const pendingMembers = membersData?.members?.filter((m) => m.status === 'pending') ?? []

  // --- Handlers ---
  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editName.trim()) return
    setInfoSaving(true)
    try {
      await updateGroup.mutateAsync({
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      })
      toast.success('Group info updated')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update group'))
    } finally {
      setInfoSaving(false)
    }
  }

  const handleShowCode = () => {
    setShowCode(true)
    refetchInviteCode()
  }

  const handleCopyCode = async () => {
    const code = inviteCodeData?.inviteCode
    if (!code) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code)
      } else {
        const el = document.createElement('textarea')
        el.value = code
        el.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      toast.error('Failed to copy code')
    }
  }

  const handleRegenerateCode = async () => {
    try {
      await regenerateCode.mutateAsync()
      await refetchInviteCode()
      toast.success('Invite code regenerated')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to regenerate code'))
    }
  }

  const handleRoleToggle = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    try {
      await updateMemberRole.mutateAsync({ userId, role: newRole })
      toast.success(`Member ${newRole === 'admin' ? 'promoted to admin' : 'demoted to member'}`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update role'))
    }
  }

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId)
      setConfirmRemove(null)
      setMemberActionMenuUserId(null)
      toast.success('Member removed')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to remove member'))
    }
  }

  const handleMuteToggle = (userId: string, isMuted: boolean) => {
    setMemberActionMenuUserId(null)
    if (isMuted) {
      unmuteMember.mutate(userId)
    } else {
      muteMember.mutate({ userId })
    }
  }

  const handleApprove = async (userId: string) => {
    try {
      await approveMember.mutateAsync(userId)
      toast.success('Member approved')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to approve'))
    }
  }

  const handleDeny = async (userId: string) => {
    try {
      await denyMember.mutateAsync(userId)
      toast.success('Request denied')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to deny'))
    }
  }

  const handleDeleteGroup = async () => {
    if (deleteInput !== group.name) return
    try {
      await deleteGroup.mutateAsync()
      toast.success('Group deleted')
      navigate('/groups')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to delete group'))
    }
  }

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTagName.trim()) return
    try {
      await createTag.mutateAsync({ name: newTagName.trim(), color: newTagColor })
      setNewTagName('')
      toast.success('Tag created')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to create tag'))
    }
  }

  const handleDeleteTag = async (tagId: string) => {
    try {
      await deleteTag.mutateAsync(tagId)
      setConfirmDeleteTag(null)
      toast.success('Tag deleted')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to delete tag'))
    }
  }

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Manage Group</h2>
          <p className="text-gray-500 text-sm">{group.name}</p>
        </div>
        <PageToolbar backTo={`/groups/${groupId}`} />
      </div>

      {/* ── Group Info ── */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-base font-semibold text-white">Group Info</h3>
        <form onSubmit={handleSaveInfo} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={255}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Optional description"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={infoSaving || !editName.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {infoSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </section>

      {/* ── Invite Code ── */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Invite Code</h3>
          {!showCode && (
            <button
              onClick={handleShowCode}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-900/50 border border-indigo-700 text-indigo-300 hover:bg-indigo-800/50 transition-colors font-medium"
            >
              Show Code
            </button>
          )}
        </div>
        {showCode ? (
          <>
            <p className="text-xs text-gray-500">Share this code so people can request to join the group.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-lg tracking-widest text-indigo-300 bg-gray-800 rounded-lg px-4 py-2 select-all">
                {inviteCodeData?.inviteCode
                  ? inviteCodeData.inviteCode.match(/.{1,4}/g)?.join('-')
                  : '————————————'}
              </code>
              <button
                onClick={handleCopyCode}
                disabled={!inviteCodeData?.inviteCode}
                className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
              >
                {copiedCode ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={handleRegenerateCode}
                disabled={regenerateCode.isPending}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                {regenerateCode.isPending ? 'Regenerating...' : 'Regenerate (invalidates current)'}
              </button>
              <button
                onClick={() => setShowCode(false)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Hide
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500">Click "Show Code" to reveal the current invite code.</p>
        )}
      </section>

      {/* ── Pending Requests ── */}
      {pendingMembers.length > 0 && (
        <section className="bg-gray-900 border border-amber-800/50 rounded-xl p-5 space-y-3">
          <h3 className="text-base font-semibold text-amber-400">
            Pending Requests ({pendingMembers.length})
          </h3>
          <div className="space-y-2">
            {pendingMembers.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 bg-amber-900/10 rounded-xl p-3 border border-amber-800/40">
                <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{m.name}</p>
                  {m.username && <p className="text-xs text-indigo-400">@{m.username}</p>}
                  <p className="text-xs text-gray-500 truncate">{m.email}</p>
                </div>
                <button
                  onClick={() => handleApprove(m.userId)}
                  disabled={approveMember.isPending}
                  className="text-xs px-2 py-1 rounded-lg bg-emerald-900 text-emerald-300 hover:bg-emerald-800 transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDeny(m.userId)}
                  disabled={denyMember.isPending}
                  className="text-xs px-2 py-1 rounded-lg bg-red-900/70 text-red-300 hover:bg-red-900 transition-colors disabled:opacity-50"
                >
                  Deny
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Members ── */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Members ({activeMembers.length})</h3>
          <button
            onClick={() => setMembersOpen((o) => !o)}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors font-medium"
          >
            {membersOpen ? 'Hide' : 'Show'}
          </button>
        </div>
        {membersOpen && (activeMembers.length === 0 ? (
          <p className="text-gray-500 text-sm">No active members.</p>
        ) : (
          <div className="space-y-2">
            {activeMembers.map((m) => {
              const isSelf = m.userId === currentUser?.id
              const isThisOwner = m.role === 'owner'
              const isMuted = !!(m.mutedUntil && new Date(m.mutedUntil) > new Date())
              return (
                <div key={m.userId} className="flex items-center gap-3 rounded-xl p-3 bg-gray-800/50 border border-gray-700/50">
                  <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    {m.username && !isSelf ? (
                      <Link to={`/u/${m.username}`} className="text-sm font-medium text-white hover:text-indigo-300 transition-colors truncate block">
                        {m.name}{isSelf && <span className="text-xs text-gray-500 ml-1">(you)</span>}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-white truncate">
                        {m.name}{isSelf && <span className="text-xs text-gray-500 ml-1">(you)</span>}
                      </p>
                    )}
                    {m.username && <p className="text-xs text-indigo-400">@{m.username}</p>}
                    <p className="text-xs text-gray-500 truncate">{m.email}</p>
                  </div>
                  {(m.role === 'owner' || m.role === 'admin') && (
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-amber-300 shrink-0"
                      title={m.role === 'owner' ? 'Owner' : 'Admin'}
                      aria-label={m.role === 'owner' ? 'Owner' : 'Admin'}
                    >
                      <RoleGlyph role={m.role} />
                    </span>
                  )}
                  {!isSelf && (
                    <div className="relative shrink-0" ref={memberActionMenuUserId === m.userId ? memberActionMenuRef : null}>
                      <button
                        type="button"
                        aria-label={`Open member actions for ${m.name}`}
                        aria-expanded={memberActionMenuUserId === m.userId}
                        onClick={() => {
                          setConfirmRemove((c) => (c === m.userId ? c : null))
                          setMemberActionMenuUserId((c) => (c === m.userId ? null : m.userId))
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-gray-300 transition-colors hover:bg-gray-700"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </button>
                      {memberActionMenuUserId === m.userId && (
                        <div className="absolute right-0 top-11 z-20 min-w-[11rem] rounded-xl border border-gray-800 bg-gray-950 p-1.5 shadow-2xl shadow-black/40">
                          {/* Mute/Unmute */}
                          {!isThisOwner && (
                            <button
                              type="button"
                              onClick={() => handleMuteToggle(m.userId, isMuted)}
                              disabled={muteMember.isPending || unmuteMember.isPending}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
                            >
                              {isMuted ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.143 17.082a24.248 24.248 0 0 0 3.714 0M3 3l18 18M10.584 10.587a2 2 0 0 0 2.828 2.83M7.843 7.84A6.002 6.002 0 0 0 6 13v3l-1.256 1.148A1 1 0 0 0 5.5 19h13a1 1 0 0 0 .756-1.652l-.256-.234" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
                                </svg>
                              )}
                              <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                            </button>
                          )}
                          {/* Promote/Demote — owner only */}
                          {isOwner && !isThisOwner && (
                            <button
                              type="button"
                              onClick={() => { setMemberActionMenuUserId(null); handleRoleToggle(m.userId, m.role) }}
                              disabled={updateMemberRole.isPending}
                              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
                            >
                              {m.role === 'admin' ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0-5-5m5 5 5-5" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-5 5m5-5 5 5" />
                                </svg>
                              )}
                              <span>{m.role === 'admin' ? 'Demote to member' : 'Promote to admin'}</span>
                            </button>
                          )}
                          {/* Remove */}
                          {!isThisOwner && (
                            confirmRemove === m.userId ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(m.userId)}
                                  disabled={removeMember.isPending}
                                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-950/50 disabled:opacity-50"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-7 4v6m4-6v6m-7 4h10a1 1 0 0 0 1-1V6H6v13a1 1 0 0 0 1 1Z" />
                                  </svg>
                                  <span>Confirm remove</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemove(null)}
                                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-gray-900"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmRemove(m.userId)}
                                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-950/50"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-7 4v6m4-6v6m-7 4h10a1 1 0 0 0 1-1V6H6v13a1 1 0 0 0 1 1Z" />
                                </svg>
                                <span>Remove</span>
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </section>

      {/* ── Tags ── */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-base font-semibold text-white">Tags</h3>
        <p className="text-xs text-gray-500">Tags are used to categorize events and let members subscribe to topics.</p>

        {/* Existing tags */}
        <div className="flex flex-wrap gap-2">
          {!tagsData?.tags?.length ? (
            <p className="text-sm text-gray-500">No tags yet.</p>
          ) : (
            tagsData.tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-1 group">
                <TagBadge name={tag.name} color={tag.color} />
                {confirmDeleteTag === tag.id ? (
                  <>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      disabled={deleteTag.isPending}
                      className="text-xs px-1.5 py-0.5 rounded bg-red-900 text-red-300 hover:bg-red-800 transition-colors disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteTag(null)}
                      className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                <button
                    onClick={() => setConfirmDeleteTag(tag.id)}
                    className="h-5 w-5 flex items-center justify-center rounded text-gray-500 hover:text-red-400 transition-colors"
                    aria-label={`Delete ${tag.name} tag`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Create new tag form */}
        <form onSubmit={handleCreateTag} className="flex items-end gap-2 pt-2 border-t border-gray-800">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-400 mb-1">New tag name</label>
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              maxLength={50}
              placeholder="e.g., hiking, gaming, food"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Color</label>
            <input
              type="color"
              value={newTagColor}
              onChange={(e) => setNewTagColor(e.target.value)}
              className="h-9 w-12 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer"
            />
          </div>
          <button
            type="submit"
            disabled={createTag.isPending || !newTagName.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {createTag.isPending ? 'Adding...' : 'Add Tag'}
          </button>
        </form>
      </section>

      {/* ── Danger Zone — owner only ── */}
      {isOwner && (
        <section className="bg-gray-900 border border-red-900/60 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-red-400">Danger Zone</h3>
          <p className="text-sm text-gray-400">
            Deleting this group is permanent and cannot be undone. All events, channels, messages, and memberships will be erased.
          </p>

          {deletePhase === 'idle' && (
            <button
              onClick={() => setDeletePhase('confirm')}
              className="px-4 py-2 bg-red-900/40 border border-red-700 hover:bg-red-900/70 text-red-300 text-sm font-medium rounded-lg transition-colors"
            >
              Delete Group
            </button>
          )}

          {deletePhase === 'confirm' && (
            <div className="space-y-3">
              <p className="text-sm text-red-300 font-medium">
                Are you sure? Type the group name <span className="font-mono bg-gray-800 px-1 rounded">{group.name}</span> to confirm.
              </p>
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={group.name}
                className="w-full bg-gray-800 border border-red-800 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-red-600"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteGroup}
                  disabled={deleteInput !== group.name || deleteGroup.isPending}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {deleteGroup.isPending ? 'Deleting...' : 'Permanently Delete'}
                </button>
                <button
                  onClick={() => { setDeletePhase('idle'); setDeleteInput('') }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Audit Log */}
      {isAdmin && (
        <section ref={auditLogSectionRef} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <button
            onClick={() => {
              setShowAuditLog((v) => {
                if (v) setAuditLogPage(0)
                return !v
              })
            }}
            className="w-full flex items-center justify-between text-left"
          >
            <h3 className="text-base font-semibold text-white">Activity Log</h3>
            <span className="text-gray-400 text-sm">{showAuditLog ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showAuditLog && (() => {
            const PAGE_SIZE = 10
            const allLogs = auditLogData?.logs ?? []
            const totalPages = Math.max(1, Math.ceil(allLogs.length / PAGE_SIZE))
            const currentPage = Math.min(auditLogPage, totalPages - 1)
            const pageLogs = allLogs.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
            const hasPrev = currentPage > 0
            const hasNext = currentPage < totalPages - 1
            return (
              <div className="mt-4 space-y-2">
                {!allLogs.length ? (
                  <p className="text-sm text-gray-500">No activity recorded yet.</p>
                ) : (
                  pageLogs.map((log) => {
                    const actionLabel: Record<string, string> = {
                      member_approved: 'approved',
                      member_denied: 'denied',
                      member_removed: 'removed',
                      role_changed: 'changed role of',
                      member_joined: 'requested to join',
                    }
                    const label = actionLabel[log.action] ?? log.action
                    const meta = log.meta as { from?: string; to?: string } | null
                    return (
                      <div key={log.id} className="flex items-start gap-3 py-2 border-b border-gray-800 last:border-0">
                        <Avatar name={log.actor.name} avatarUrl={log.actor.avatarUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-200">
                            <span className="font-medium">{log.actor.name}</span>
                            {' '}{label}{' '}
                            {log.targetUser && log.targetUser.id !== log.actor.id && (
                              <span className="font-medium">{log.targetUser.name}</span>
                            )}
                            {meta?.from && meta?.to && (
                              <span className="text-gray-400"> ({meta.from} → {meta.to})</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(log.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
                {(hasPrev || hasNext) && (
                  <div className="flex items-center justify-between pt-3 border-t border-gray-800">
                    <div>
                      {hasPrev && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuditLogPage((p) => p - 1)
                            auditLogSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
                        >
                          ← Previous
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      Page {currentPage + 1} of {totalPages}
                    </span>
                    <div>
                      {hasNext && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuditLogPage((p) => p + 1)
                            auditLogSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
                        >
                          Next →
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </section>
      )}
    </div>
  )
}
