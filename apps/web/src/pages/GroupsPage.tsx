import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGroups, useCreateGroup } from '../hooks/useGroups'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'

export default function GroupsPage() {
  const { data, isLoading } = useGroups()
  const createGroup = useCreateGroup()
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    await createGroup.mutateAsync({ name, description })
    setShowModal(false)
    setName('')
    setDescription('')
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Your Groups</h2>
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
        >
          + New Group
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-indigo-400" />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.groups.map((g: any) => (
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
                <span>{g.memberCount} members</span>
                <span>{g.role}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)}>
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
    </div>
  )
}
