/**
 * DeveloperPage — restricted to admin users only.
 *
 * Features:
 *  - View and edit the registration invite code (stored as Redis override on API)
 *  - View and generate group creation beta codes
 *  - Embedded Phase 7 (push/SW debug) and Phase 9 (API diagnostics) tools
 *
 * Access: users whose email is in the ADMIN_EMAILS env var on the API.
 * Any other authenticated user receives a 403-style blocked screen.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useAuthStore } from '../stores/authStore'
import { apiFetch } from '../lib/api'
import { Phase7DebugPage } from './Phase7DebugPage'
import { Phase9DiagnosticsPage } from './Phase9DiagnosticsPage'

type DevConfig = {
  registrationInviteCode: string
  groupCreationInviteCode: string
  registrationBetaRequired: boolean
  groupCreationBetaRequired: boolean
  groupCodes: Array<{ id: string; code: string; createdAt: string }>
  registrationCodes: Array<{ id: string; code: string; createdAt: string }>
}

type Tab = 'config' | 'phase7' | 'phase9'

export default function DeveloperPage() {
  const { user } = useAuthStore()

  // Guard — non-admin users see a 403 screen
  if (!user || !user.isAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="text-6xl font-black text-red-500">403</div>
        <h1 className="text-2xl font-bold text-white">Access Denied</h1>
        <p className="text-gray-400 text-sm max-w-sm">
          The developer panel is restricted to authorized accounts only.
        </p>
      </div>
    )
  }

  return <DeveloperContent />
}

function DeveloperContent() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('config')

  return (
    <div className="px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Developer Panel</h2>
          <p className="text-gray-400 text-sm mt-1">Admin-only tools for managing app configuration.</p>
        </div>
        <PageToolbar />
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 border-b border-gray-800 pb-1">
        {([
          { key: 'config', label: 'Config' },
          { key: 'phase7', label: 'Phase 7 Debug' },
          { key: 'phase9', label: 'Phase 9 Diagnostics' },
        ] as Array<{ key: Tab; label: string }>).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === key
                ? 'text-white border-b-2 border-indigo-500 -mb-px'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'config' && <ConfigTab />}
      {activeTab === 'phase7' && <Phase7DebugPage />}
      {activeTab === 'phase9' && <Phase9DiagnosticsPage />}
    </div>
  )
}

function ConfigTab() {
  const [config, setConfig] = useState<DevConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Registration code edit state
  const [editCode, setEditCode] = useState('')
  const [codeEditing, setCodeEditing] = useState(false)
  const [codeSaving, setCodeSaving] = useState(false)
  const [codeMsg, setCodeMsg] = useState('')

  // Group creation persistent code edit state
  const [editGroupCode, setEditGroupCode] = useState('')
  const [groupCodeEditing, setGroupCodeEditing] = useState(false)
  const [groupCodeSaving, setGroupCodeSaving] = useState(false)
  const [groupCodeMsg, setGroupCodeMsg] = useState('')

  // One-time group codes state
  const [genCount, setGenCount] = useState(1)
  const [genLoading, setGenLoading] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // One-time registration codes state
  const [regGenCount, setRegGenCount] = useState(1)
  const [regGenLoading, setRegGenLoading] = useState(false)
  const [regGenMsg, setRegGenMsg] = useState('')
  const [regDeleteLoading, setRegDeleteLoading] = useState<string | null>(null)
  const [regCopiedId, setRegCopiedId] = useState<string | null>(null)

  const loadConfig = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await apiFetch<DevConfig>('/admin/dev/config')
      setConfig(data)
      setEditCode(data.registrationInviteCode)
      setEditGroupCode(data.groupCreationInviteCode)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load config')
    } finally {
      setLoading(false)
    }
  }

  // Load on first render
  useState(() => { loadConfig() })

  const handleSaveCode = async () => {
    if (!editCode.trim()) return
    setCodeSaving(true)
    setCodeMsg('')
    try {
      const data = await apiFetch<{ registrationInviteCode: string; groupCreationInviteCode: string }>('/admin/dev/config', {
        method: 'PATCH',
        body: JSON.stringify({ registrationInviteCode: editCode.trim() }),
      })
      setConfig((prev) => prev ? { ...prev, registrationInviteCode: data.registrationInviteCode } : prev)
      setEditCode(data.registrationInviteCode)
      setCodeEditing(false)
      setCodeMsg('Saved!')
      setTimeout(() => setCodeMsg(''), 2500)
    } catch (err) {
      setCodeMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setCodeSaving(false)
    }
  }

  const handleSaveGroupCode = async () => {
    if (!editGroupCode.trim()) return
    setGroupCodeSaving(true)
    setGroupCodeMsg('')
    try {
      const data = await apiFetch<{ registrationInviteCode: string; groupCreationInviteCode: string }>('/admin/dev/config', {
        method: 'PATCH',
        body: JSON.stringify({ groupCreationInviteCode: editGroupCode.trim() }),
      })
      setConfig((prev) => prev ? { ...prev, groupCreationInviteCode: data.groupCreationInviteCode } : prev)
      setEditGroupCode(data.groupCreationInviteCode)
      setGroupCodeEditing(false)
      setGroupCodeMsg('Saved!')
      setTimeout(() => setGroupCodeMsg(''), 2500)
    } catch (err) {
      setGroupCodeMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setGroupCodeSaving(false)
    }
  }

  const handleGenCodes = async () => {
    setGenLoading(true)
    setGenMsg('')
    try {
      await apiFetch('/admin/dev/group-codes', {
        method: 'POST',
        body: JSON.stringify({ count: genCount }),
      })
      await loadConfig()
      setGenMsg(`Generated ${genCount} code${genCount > 1 ? 's' : ''}`)
      setTimeout(() => setGenMsg(''), 3000)
    } catch (err) {
      setGenMsg(err instanceof Error ? err.message : 'Failed to generate')
    } finally {
      setGenLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteLoading(id)
    try {
      await apiFetch(`/admin/dev/group-codes/${id}`, { method: 'DELETE' })
      setConfig((prev) => prev ? { ...prev, groupCodes: prev.groupCodes.filter((c) => c.id !== id) } : prev)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleteLoading(null)
    }
  }

  const handleCopy = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // fallback
    }
  }

  const handleGenRegCodes = async () => {
    setRegGenLoading(true)
    setRegGenMsg('')
    try {
      await apiFetch('/admin/dev/registration-codes', {
        method: 'POST',
        body: JSON.stringify({ count: regGenCount }),
      })
      await loadConfig()
      setRegGenMsg(`Generated ${regGenCount} code${regGenCount > 1 ? 's' : ''}`)
      setTimeout(() => setRegGenMsg(''), 3000)
    } catch (err) {
      setRegGenMsg(err instanceof Error ? err.message : 'Failed to generate')
    } finally {
      setRegGenLoading(false)
    }
  }

  const handleDeleteRegCode = async (id: string) => {
    setRegDeleteLoading(id)
    try {
      await apiFetch(`/admin/dev/registration-codes/${id}`, { method: 'DELETE' })
      setConfig((prev) => prev ? { ...prev, registrationCodes: prev.registrationCodes.filter((c) => c.id !== id) } : prev)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setRegDeleteLoading(null)
    }
  }

  const handleRegCopy = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setRegCopiedId(id)
      setTimeout(() => setRegCopiedId(null), 2000)
    } catch {
      // fallback
    }
  }

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading config...</p>
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-red-400 text-sm">{loadError}</p>
        <button onClick={loadConfig} className="px-4 py-2 bg-gray-800 text-gray-200 rounded-lg text-sm hover:bg-gray-700">
          Retry
        </button>
      </div>
    )
  }

  if (!config) return null

  return (
    <div className="space-y-8">

      {/* Registration Invite Code — Persistent */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Account Creation Code (Persistent)</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Shared code that never expires — anyone with this code can register.{' '}
            {config.registrationBetaRequired ? (
              <span className="text-amber-400">Gate is ON</span>
            ) : (
              <span className="text-emerald-400">Gate is OFF (open registration)</span>
            )}
          </p>
        </div>

        {codeEditing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editCode}
              onChange={(e) => setEditCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64))}
              placeholder="New code (alphanumeric)"
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white font-mono tracking-wider placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveCode}
                disabled={codeSaving || editCode.trim().length < 4}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {codeSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setCodeEditing(false); setEditCode(config.registrationInviteCode) }}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-xl tracking-widest text-indigo-300 bg-gray-800 rounded-lg px-4 py-2.5 select-all">
              {config.registrationInviteCode || '(not set)'}
            </code>
            <button
              onClick={() => setCodeEditing(true)}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg border border-gray-700"
            >
              Edit
            </button>
          </div>
        )}

        {codeMsg && (
          <p className={`text-xs ${codeMsg === 'Saved!' ? 'text-emerald-400' : 'text-red-400'}`}>{codeMsg}</p>
        )}
      </section>

      {/* One-time Account Creation Codes */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Account Creation Codes (One-time)</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Single-use codes for account registration — consumed on use.{' '}
            {config.registrationBetaRequired ? (
              <span className="text-amber-400">Gate is ON</span>
            ) : (
              <span className="text-emerald-400">Gate is OFF (open registration)</span>
            )}
          </p>
        </div>

        {/* Generate controls */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 whitespace-nowrap">Generate</label>
          <input
            type="number"
            min={1}
            max={20}
            value={regGenCount}
            onChange={(e) => setRegGenCount(Math.min(20, Math.max(1, Number(e.target.value))))}
            className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <label className="text-xs text-gray-400">code{regGenCount > 1 ? 's' : ''}</label>
          <button
            onClick={handleGenRegCodes}
            disabled={regGenLoading}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {regGenLoading ? 'Generating...' : 'Generate'}
          </button>
          {regGenMsg && <span className="text-xs text-emerald-400">{regGenMsg}</span>}
        </div>

        {/* Unused codes list */}
        {config.registrationCodes.length === 0 ? (
          <p className="text-gray-500 text-sm">No unused one-time registration codes.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              Unused ({config.registrationCodes.length})
            </p>
            <div className="divide-y divide-gray-800 rounded-lg overflow-hidden border border-gray-800">
              {config.registrationCodes.map((c) => (
                <div key={c.id} className="flex items-center gap-3 bg-gray-800/60 px-4 py-2.5">
                  <code className="flex-1 font-mono text-sm text-indigo-300 tracking-widest select-all">
                    {c.code}
                  </code>
                  <button
                    onClick={() => handleRegCopy(c.code, c.id)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1"
                  >
                    {regCopiedId === c.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => handleDeleteRegCode(c.id)}
                    disabled={regDeleteLoading === c.id}
                    className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors px-2 py-1"
                  >
                    {regDeleteLoading === c.id ? '...' : 'Revoke'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Group Creation Persistent Code */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Group Creation Code (Persistent)</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Shared code that never expires — anyone with this code can create a group.{' '}
            {config.groupCreationBetaRequired ? (
              <span className="text-amber-400">Gate is ON</span>
            ) : (
              <span className="text-emerald-400">Gate is OFF (anyone can create groups)</span>
            )}
          </p>
        </div>

        {groupCodeEditing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editGroupCode}
              onChange={(e) => setEditGroupCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64))}
              placeholder="New code (alphanumeric)"
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white font-mono tracking-wider placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveGroupCode}
                disabled={groupCodeSaving || editGroupCode.trim().length < 4}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {groupCodeSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setGroupCodeEditing(false); setEditGroupCode(config.groupCreationInviteCode) }}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-xl tracking-widest text-indigo-300 bg-gray-800 rounded-lg px-4 py-2.5 select-all">
              {config.groupCreationInviteCode || '(not set)'}
            </code>
            <button
              onClick={() => setGroupCodeEditing(true)}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg border border-gray-700"
            >
              Edit
            </button>
          </div>
        )}

        {groupCodeMsg && (
          <p className={`text-xs ${groupCodeMsg === 'Saved!' ? 'text-emerald-400' : 'text-red-400'}`}>{groupCodeMsg}</p>
        )}
      </section>

      {/* Group Creation Codes — One-time */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Group Creation Codes (One-time)</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Single-use codes required to create a new group — consumed on use.{' '}
            {config.groupCreationBetaRequired ? (
              <span className="text-amber-400">Gate is ON</span>
            ) : (
              <span className="text-emerald-400">Gate is OFF (anyone can create groups)</span>
            )}
          </p>
        </div>

        {/* Generate controls */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 whitespace-nowrap">Generate</label>
          <input
            type="number"
            min={1}
            max={20}
            value={genCount}
            onChange={(e) => setGenCount(Math.min(20, Math.max(1, Number(e.target.value))))}
            className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <label className="text-xs text-gray-400">code{genCount > 1 ? 's' : ''}</label>
          <button
            onClick={handleGenCodes}
            disabled={genLoading}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {genLoading ? 'Generating...' : 'Generate'}
          </button>
          {genMsg && <span className="text-xs text-emerald-400">{genMsg}</span>}
        </div>

        {/* Unused codes list */}
        {config.groupCodes.length === 0 ? (
          <p className="text-gray-500 text-sm">No unused group creation codes.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              Unused ({config.groupCodes.length})
            </p>
            <div className="divide-y divide-gray-800 rounded-lg overflow-hidden border border-gray-800">
              {config.groupCodes.map((c) => (
                <div key={c.id} className="flex items-center gap-3 bg-gray-800/60 px-4 py-2.5">
                  <code className="flex-1 font-mono text-sm text-indigo-300 tracking-widest select-all">
                    {c.code}
                  </code>
                  <button
                    onClick={() => handleCopy(c.code, c.id)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1"
                  >
                    {copiedId === c.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={deleteLoading === c.id}
                    className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors px-2 py-1"
                  >
                    {deleteLoading === c.id ? '...' : 'Revoke'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
