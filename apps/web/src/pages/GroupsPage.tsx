import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGroups, useCreateGroup, useJoinGroup } from '../hooks/useGroups'
import type { GroupSummary } from '../hooks/useGroups'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'
import { getApiErrorMessage, ApiError } from '../lib/api'
import { useIsOnline } from '../hooks/useIsOnline'

export default function GroupsPage() {
  const { data, isLoading, isError, error, refetch } = useGroups()
  const isOnline = useIsOnline()
  const createGroup = useCreateGroup()
  const joinGroup = useJoinGroup()
  const [showModal, setShowModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [betaCode, setBetaCode] = useState('')
  const [betaCodeError, setBetaCodeError] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joinSuccess, setJoinSuccess] = useState('')

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setBetaCodeError('')
    const payload: { name: string; description?: string; betaCode?: string } = { name, description }
    if (betaCode.trim()) payload.betaCode = betaCode.trim()
    try {
      await createGroup.mutateAsync(payload)
      setShowModal(false)
      setName('')
      setDescription('')
      setBetaCode('')
      setBetaCodeError('')
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'INVALID_BETA_CODE') {
        setBetaCodeError('Invalid or already used beta code.')
      } else if (err instanceof ApiError && err.code === 'BETA_CODE_REQUIRED') {
        setBetaCodeError('A beta invite code is required.')
      } else {
        setBetaCodeError('')
        throw err
      }
    }
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError('')
    setJoinSuccess('')
    try {
      const result = await joinGroup.mutateAsync(joinCode.trim())
      setJoinSuccess(`Join request sent for "${result.groupName}". The owner will review it shortly.`)
      setJoinCode('')
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'INVALID_INVITE_CODE') {
        setJoinError('Invalid invite code. Check the code and try again.')
      } else if (err instanceof ApiError && err.code === 'ALREADY_MEMBER') {
        setJoinError('You are already a member of this group.')
      } else if (err instanceof ApiError && err.code === 'ALREADY_PENDING') {
        setJoinError('You already have a pending request for this group.')
      } else {
        setJoinError(getApiErrorMessage(err, 'Failed to send join request.'))
      }
    }
  }

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-white">Your Groups</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowJoinModal(true); setJoinError(''); setJoinSuccess(''); setJoinCode('') }}
            className="whitespace-nowrap bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          >
            Join Group
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="whitespace-nowrap bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          >
            + New Group
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-indigo-400" />
        </div>
      ) : isError && !data?.groups?.length ? (
        <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
          <p>{!isOnline ? 'You are offline and there is no cached data.' : getApiErrorMessage(error, 'Failed to load groups.')}</p>
          {isOnline && (
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-xl bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 transition-colors"
            >
              Try again
            </button>
          )}
        </div>
      ) : !data?.groups?.length ? (
        <EmptyState
          title="No groups yet"
          description="Create your first friend group to get started."
          action={
            <button
              onClick={() => setShowModal(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold"
            >
              Create Group
            </button>
          }
        />
      ) : (
        <>
          {isError && !isOnline && (
            <div className="mb-4 px-4 py-2 rounded-xl bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-sm">
              You are offline. Showing cached data.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.groups.map((g: GroupSummary) => (
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-indigo-600 transition-colors group"
            >
              <div className="w-12 h-12 rounded-xl bg-indigo-900 flex items-center justify-center text-xl font-bold mb-3">
                {g.name[0].toUpperCase()}
              </div>
              <h3 className="font-semibold text-white group-hover:text-indigo-300">
                {g.name}
              </h3>
              {g.description && (
                <p className="text-gray-400 text-sm mt-1 line-clamp-2">{g.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
                <span>{g._count?.memberships ?? 0} members</span>
              </div>
            </Link>
          ))}
          </div>
        </>
      )}

      <Modal open={showModal} onClose={() => { setShowModal(false); setBetaCodeError('') }}>
        <h3 className="text-lg font-bold text-white mb-4">Create Group</h3>
        <form onSubmit={handleCreate} className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <div>
            <input
              value={betaCode}
              onChange={(e) => { setBetaCode(e.target.value); setBetaCodeError('') }}
              placeholder="Beta invite code"
              required
              className={`w-full bg-gray-800 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${betaCodeError ? 'border-red-500' : 'border-gray-700'}`}
            />
            {betaCodeError && (
              <p className="mt-1.5 text-sm text-red-400">{betaCodeError}</p>
            )}
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2 text-gray-400 hover:text-white text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createGroup.isPending}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {createGroup.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showJoinModal} onClose={() => { setShowJoinModal(false); setJoinError(''); setJoinSuccess(''); setJoinCode('') }}>
        <h3 className="text-lg font-bold text-white mb-1">Join a Group</h3>
        <p className="text-gray-400 text-sm mb-4">Enter the 12-character invite code shared by the group owner.</p>
        {joinSuccess ? (
          <div className="space-y-4">
            <div className="px-4 py-3 rounded-xl bg-emerald-900/40 border border-emerald-700 text-emerald-300 text-sm">
              {joinSuccess}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => { setShowJoinModal(false); setJoinSuccess('') }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleJoin} className="space-y-3">
            <div>
              <input
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); setJoinError('') }}
                placeholder="e.g. a1b2c3d4e5f6"
                maxLength={12}
                required
                className={`w-full bg-gray-800 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-wider ${joinError ? 'border-red-500' : 'border-gray-700'}`}
              />
              {joinError && (
                <p className="mt-1.5 text-sm text-red-400">{joinError}</p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={joinGroup.isPending || joinCode.trim().length !== 12}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {joinGroup.isPending ? 'Sending...' : 'Request to Join'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
