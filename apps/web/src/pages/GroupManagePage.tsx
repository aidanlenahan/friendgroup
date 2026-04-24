import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
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
  const [confirmMute, setConfirmMute] = useState<string | null>(null)

  // Delete confirmation state
  const [deletePhase, setDeletePhase] = useState<'idle' | 'confirm' | 'typing'>('idle')
  const [deleteInput, setDeleteInput] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

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
      toast.success('Member removed')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to remove member'))
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
      <div className="flex items-center gap-3">
        <Link
          to={`/groups/${groupId}`}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          aria-label="Back to group"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-white">Manage Group</h2>
          <p className="text-gray-500 text-sm">{group.name}</p>
        </div>
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
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${
                    isThisOwner
                      ? 'bg-indigo-900 text-indigo-300'
                      : m.role === 'admin'
                      ? 'bg-amber-900 text-amber-300'
                      : 'bg-gray-700 text-gray-400'
                  }`}>
                    {m.role}
                  </span>

                  {/* Role toggle — owner only, not for self or other owners */}
                  {isOwner && !isSelf && !isThisOwner && (
                    <button
                      onClick={() => handleRoleToggle(m.userId, m.role)}
                      disabled={updateMemberRole.isPending}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors disabled:opacity-50 shrink-0"
                    >
                      {m.role === 'admin' ? 'Demote' : 'Make Admin'}
                    </button>
                  )}

                  {/* Remove — admin/owner can remove, but not self or owners */}
                  {!isSelf && !isThisOwner && (
                    <>
                      {confirmRemove === m.userId ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleRemoveMember(m.userId)}
                            disabled={removeMember.isPending}
                            className="text-xs px-2 py-1 rounded-lg bg-red-900 text-red-300 hover:bg-red-800 transition-colors disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="text-xs px-2 py-1 rounded-lg bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(m.userId)}
                          className="text-xs px-2 py-1 rounded-lg text-red-500 hover:bg-red-900/30 transition-colors shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}

                  {/* Mute/Unmute — admin/owner can mute non-owners (not self) */}
                  {!isSelf && !isThisOwner && (
                    <>
                      {m.mutedUntil && new Date(m.mutedUntil) > new Date() ? (
                        <button
                          onClick={() => unmuteMember.mutate(m.userId)}
                          disabled={unmuteMember.isPending}
                          className="text-xs px-2 py-1 rounded-lg bg-amber-900/50 text-amber-300 hover:bg-amber-800/60 transition-colors shrink-0 disabled:opacity-50"
                        >
                          Unmute
                        </button>
                      ) : confirmMute === m.userId ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => { muteMember.mutate({ userId: m.userId }); setConfirmMute(null) }}
                            disabled={muteMember.isPending}
                            className="text-xs px-2 py-1 rounded-lg bg-orange-900 text-orange-300 hover:bg-orange-800 transition-colors disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmMute(null)}
                            className="text-xs px-2 py-1 rounded-lg bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmMute(m.userId)}
                          className="text-xs px-2 py-1 rounded-lg text-orange-400 hover:bg-orange-900/30 transition-colors shrink-0"
                        >
                          Mute
                        </button>
                      )}
                    </>
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
                    className="text-xs text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    aria-label={`Delete ${tag.name} tag`}
                  >
                    ✕
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
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <button
            onClick={() => setShowAuditLog((v) => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <h3 className="text-base font-semibold text-white">Activity Log</h3>
            <span className="text-gray-400 text-sm">{showAuditLog ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showAuditLog && (
            <div className="mt-4 space-y-2">
              {!auditLogData?.logs?.length ? (
                <p className="text-sm text-gray-500">No activity recorded yet.</p>
              ) : (
                auditLogData.logs.map((log) => {
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
            </div>
          )}
        </section>
      )}
    </div>
  )
}
