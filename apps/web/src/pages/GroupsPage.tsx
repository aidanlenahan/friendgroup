import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGroups, useCreateGroup, useJoinGroup } from '../hooks/useGroups'
import type { GroupSummary } from '../hooks/useGroups'
import Modal from '../components/Modal'
import { GroupCardSkeleton } from '../components/Skeleton'
import { getApiErrorMessage, ApiError, apiFetch } from '../lib/api'
import { useIsOnline } from '../hooks/useIsOnline'
import { useAuthStore } from '../stores/authStore'
import { useQueryClient } from '@tanstack/react-query'

function getGreeting(name: string): string {
  const hour = new Date().getHours()
  let phrases: string[]
  if (hour >= 5 && hour < 12) {
    phrases = [
      `Good morning, ${name}`,
      `Rise and shine, ${name}`,
      `Morning, ${name}`,
      `Hey ${name}, top of the mornin'`,
      `Hey ${name}`,
      `Welcome back, ${name}`,
      `How's it going, ${name}`,
    ]
  } else if (hour >= 12 && hour < 17) {
    phrases = [
      `Good afternoon, ${name}`,
      `Hey ${name}, good day!`,
      `Hello, ${name}`,
      `Hey there, ${name}`,
      `Welcome back, ${name}`,
      `How's your afternoon, ${name}`,
    ]
  } else if (hour >= 17 && hour < 22) {
    phrases = [
      `Good evening, ${name}`,
      `Hey ${name}, hope you had a great day`,
      `Evening, ${name}`,
      `Hi ${name}`,
      `Welcome back, ${name}`,
      `How was your day, ${name}`,
    ]
  } else {
    phrases = [
      `Hey ${name}, burning the midnight oil?`,
      `Still up, ${name}?`,
      `Hello, ${name}!`,
      `Hey night owl, ${name}!`,
      `Late night, ${name}`,
      `Hey ${name}`,
    ]
  }
  // Pick a phrase deterministically per name+hour so it doesn't jump on re-render
  const idx = (name.length + hour) % phrases.length
  return phrases[idx]
}

export default function GroupsPage() {
  useEffect(() => {
    document.title = 'Groups — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading, isError, error, refetch } = useGroups()
  const isOnline = useIsOnline()
  const { user, setUser } = useAuthStore()
  const qc = useQueryClient()
  const createGroup = useCreateGroup()
  const joinGroup = useJoinGroup()

  const prefetchGroup = useCallback((groupId: string) => {
    qc.prefetchQuery({
      queryKey: ['groups', groupId],
      queryFn: () => apiFetch<{ group: unknown }>(`/groups/${groupId}`),
      staleTime: 30_000,
    })
  }, [qc])
  const [showModal, setShowModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [betaCode, setBetaCode] = useState('')
  const [betaCodeError, setBetaCodeError] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joinSuccess, setJoinSuccess] = useState('')
  const [joinTab, setJoinTab] = useState<'code' | 'url'>('code')
  const [joinUrl, setJoinUrl] = useState('')
  const [joinUrlError, setJoinUrlError] = useState('')

  useEffect(() => {
    const inviteCode = searchParams.get('invite')
    if (!inviteCode) {
      return
    }

    const normalized = inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    if (!normalized) {
      return
    }

    const formatted = normalized.match(/.{1,4}/g)?.join('-') ?? normalized
    setJoinCode(formatted)
    setJoinError('')
    setJoinSuccess('')
    setShowJoinModal(true)
  }, [searchParams])

  useEffect(() => {
    if (!isLoading && data && !data.groups?.length && user && !user.onboardingDone) {
      setShowOnboarding(true)
    }
  }, [isLoading, data, user])

  const handleDismissOnboarding = async () => {
    setShowOnboarding(false)
    try {
      const res = await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ onboardingDone: true }) }) as { user: typeof user }
      if (res?.user && user) setUser({ ...user, onboardingDone: true })
    } catch { /* non-critical */ }
  }

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
        setBetaCodeError('Invalid or already used invite code.')
      } else if (err instanceof ApiError && err.code === 'BETA_CODE_REQUIRED') {
        setBetaCodeError('An invite code is required.')
      } else {
        setBetaCodeError('')
        throw err
      }
    }
  }

  const extractCodeFromUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url.trim())
      const invite = parsed.searchParams.get('invite')
      if (invite) return invite.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    } catch { /* not a URL */ }
    return null
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError('')
    setJoinUrlError('')
    setJoinSuccess('')

    let rawCode: string
    if (joinTab === 'url') {
      const extracted = extractCodeFromUrl(joinUrl)
      if (!extracted || extracted.length !== 12) {
        setJoinUrlError('Could not find a valid invite code in that URL.')
        return
      }
      rawCode = extracted
    } else {
      rawCode = joinCode.replace(/-/g, '').trim()
    }

    try {
      const result = await joinGroup.mutateAsync(rawCode)
      setJoinSuccess(`Join request sent for "${result.groupName}". The owner will review it shortly.`)
      setJoinCode('')
      setJoinUrl('')
      setSearchParams({}, { replace: true })
    } catch (err: unknown) {
      const setErr = joinTab === 'url' ? setJoinUrlError : setJoinError
      if (err instanceof ApiError && err.code === 'INVALID_INVITE_CODE') {
        setErr('Invalid invite code. Check the link and try again.')
      } else if (err instanceof ApiError && err.code === 'ALREADY_MEMBER') {
        setErr('You are already a member of this group.')
      } else if (err instanceof ApiError && err.code === 'ALREADY_PENDING') {
        setErr('You already have a pending request for this group.')
      } else {
        setErr(getApiErrorMessage(err, 'Failed to send join request.'))
      }
    }
  }

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:p-6 max-w-4xl mx-auto">
      {user && (
        <p className="text-gray-400 text-sm mb-4">{getGreeting(user.name.split(' ')[0])}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-white">Your Groups</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowJoinModal(true); setJoinTab('code'); setJoinError(''); setJoinUrlError(''); setJoinSuccess(''); setJoinCode(''); setJoinUrl(''); setSearchParams({}, { replace: true }) }}
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
        <div className="space-y-2 mt-2">
          {Array.from({ length: 4 }).map((_, i) => <GroupCardSkeleton key={i} />)}
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
        <div className="flex flex-col items-center py-12 px-4 text-center gap-6">
          <svg className="w-16 h-16 text-gray-600" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="24" cy="22" r="9"/>
            <path d="M4 54c0-11 9-20 20-20"/>
            <circle cx="42" cy="22" r="9"/>
            <path d="M42 34c11 0 20 9 20 20"/>
            <line x1="32" y1="34" x2="32" y2="54"/>
          </svg>
          <div>
            <h3 className="text-xl font-bold text-white mb-1">Welcome to Gem!</h3>
            <p className="text-gray-400 text-sm">Your private space for friends to plan events and stay connected.</p>
          </div>
          <div className="w-full max-w-xs space-y-2 text-left">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Get started in 3 steps</p>
            {([
              { n: '1', text: 'Create a group for your friend circle' },
              { n: '2', text: 'Invite friends with a shareable link' },
              { n: '3', text: 'Plan your first event together' },
            ] as const).map(({ n, text }) => (
              <div key={n} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                <span className="w-6 h-6 flex items-center justify-center rounded-full bg-indigo-900 text-indigo-300 text-xs font-bold shrink-0">{n}</span>
                <span className="text-sm text-gray-300">{text}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setShowJoinModal(true); setJoinTab('code'); setJoinError(''); setJoinUrlError(''); setJoinSuccess(''); setJoinCode(''); setJoinUrl(''); setSearchParams({}, { replace: true }) }}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              Join Group
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold"
            >
              Create Group
            </button>
          </div>
        </div>
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
              onMouseEnter={() => prefetchGroup(g.id)}
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

      <Modal open={showOnboarding} onClose={handleDismissOnboarding}>
        <div className="text-center px-2 pb-2">
          <div className="flex items-center justify-center mb-4">
            <svg className="w-14 h-14 text-indigo-400" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="24" cy="22" r="9"/>
              <path d="M4 54c0-11 9-20 20-20"/>
              <circle cx="42" cy="22" r="9"/>
              <path d="M42 34c11 0 20 9 20 20"/>
              <line x1="32" y1="34" x2="32" y2="54"/>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-white mb-1">Welcome to Gem!</h3>
          <p className="text-gray-400 text-sm mb-5">Your private space for friends to plan events and stay connected.</p>
          <div className="space-y-2 text-left mb-5">
            {([
              { n: '1', label: 'Join a group', desc: 'Enter an invite code to join your friend circle' },
              { n: '2', label: 'Invite your friends', desc: 'Share a link or invite code — no signup spam' },
              { n: '3', label: 'Plan events together', desc: 'Create events, RSVP, and chat in one place' },
            ] as const).map(({ n, label, desc }) => (
              <div key={n} className="flex items-start gap-3 bg-gray-800 rounded-xl px-4 py-3">
                <span className="w-6 h-6 flex items-center justify-center rounded-full bg-indigo-900 text-indigo-300 text-xs font-bold shrink-0 mt-0.5">{n}</span>
                <div>
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDismissOnboarding}
              className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            >
              Got it
            </button>
            <button
              type="button"
              onClick={() => { handleDismissOnboarding(); setShowJoinModal(true); setJoinTab('code'); setJoinError(''); setJoinUrlError(''); setJoinSuccess(''); setJoinCode(''); setJoinUrl('') }}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            >
              Join a Group
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showModal} onClose={() => { setShowModal(false); setBetaCodeError('') }}>
        <h3 className="text-lg font-bold text-white mb-4">Create Group</h3>
        <form onSubmit={handleCreate} className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            required
            maxLength={60}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            maxLength={500}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <div>
            <input
              value={betaCode}
              onChange={(e) => { setBetaCode(e.target.value); setBetaCodeError('') }}
              placeholder="Invite code"
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

      <Modal open={showJoinModal} onClose={() => { setShowJoinModal(false); setJoinError(''); setJoinUrlError(''); setJoinSuccess(''); setJoinCode(''); setJoinUrl(''); setSearchParams({}, { replace: true }) }}>
        <h3 className="text-lg font-bold text-white mb-3">Join a Group</h3>
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
          <form onSubmit={handleJoin} className="space-y-4">
            {/* Tab switcher */}
            <div className="flex rounded-xl bg-gray-800 p-1 gap-1">
              {(['code', 'url'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => { setJoinTab(tab); setJoinError(''); setJoinUrlError('') }}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                    joinTab === tab ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tab === 'code' ? 'Code' : 'URL'}
                </button>
              ))}
            </div>

            {joinTab === 'code' && (
              <div>
                <p className="text-gray-400 text-xs mb-2">Paste the invite code shared by the group owner.</p>
                <div className="flex gap-2">
                  <input
                    value={joinCode}
                    onChange={(e) => {
                      const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16)
                      setJoinCode(raw)
                      setJoinError('')
                    }}
                    placeholder="XXXX-XXXX-XXXX"
                    maxLength={16}
                    required={joinTab === 'code'}
                    className={`flex-1 min-w-0 bg-gray-800 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-wider ${joinError ? 'border-red-500' : 'border-gray-700'}`}
                  />
                  <button
                    type="button"
                    title="Paste from clipboard"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText()
                        const raw = text.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16)
                        setJoinCode(raw)
                        setJoinError('')
                      } catch { /* clipboard permission denied */ }
                    }}
                    className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </button>
                </div>
                {joinError && <p className="mt-1.5 text-sm text-red-400">{joinError}</p>}
              </div>
            )}

            {joinTab === 'url' && (
              <div>
                <p className="text-gray-400 text-xs mb-2">Paste the full invite link — the code is extracted automatically.</p>
                <div className="flex gap-2">
                  <input
                    value={joinUrl}
                    onChange={(e) => { setJoinUrl(e.target.value); setJoinUrlError('') }}
                    placeholder="https://gem.example.com/groups?invite=…"
                    required={joinTab === 'url'}
                    className={`flex-1 min-w-0 bg-gray-800 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm ${joinUrlError ? 'border-red-500' : 'border-gray-700'}`}
                  />
                  <button
                    type="button"
                    title="Paste from clipboard"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText()
                        setJoinUrl(text.trim())
                        setJoinUrlError('')
                      } catch { /* clipboard permission denied */ }
                    }}
                    className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </button>
                </div>
                {joinUrlError && <p className="mt-1.5 text-sm text-red-400">{joinUrlError}</p>}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setShowJoinModal(false); setJoinError(''); setJoinUrlError(''); setJoinCode(''); setJoinUrl('') }}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  joinGroup.isPending ||
                  (joinTab === 'code' && joinCode.replace(/-/g, '').trim().length !== 12) ||
                  (joinTab === 'url' && !joinUrl.trim())
                }
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
