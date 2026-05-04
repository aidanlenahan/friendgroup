import { useState, useEffect } from 'react'
import PageToolbar from '../components/PageToolbar'
import {
  useNotificationConfig,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useTagPreferences,
  useUpdateTagPreference,
  useUntaggedPreference,
  useUpdateUntaggedPreference,
} from '../hooks/useNotifications'
import { useGroups } from '../hooks/useGroups'
import { useToast } from '../hooks/useToast'
import { apiFetch, getApiErrorMessage } from '../lib/api'
import Spinner from '../components/Spinner'

const NOTIFICATION_TYPES = [
  { key: 'chat_message', label: 'Chat Messages' },
  { key: 'event_created', label: 'New Events' },
  { key: 'event_changed', label: 'Event Changes' },
  { key: 'invite', label: 'Invitations' },
  { key: 'rsvp_update', label: 'RSVP Updates' },
  { key: 'event_start', label: 'Event Starting' },
] as const

const CHANNELS = ['push', 'email', 'in_app'] as const

const CHANNEL_LABELS: Record<string, string> = {
  push: 'Push',
  email: 'Email',
  in_app: 'In-App',
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  const arrayBuffer = new ArrayBuffer(outputArray.length)
  new Uint8Array(arrayBuffer).set(outputArray)
  return arrayBuffer
}

export default function NotificationSettingsPage() {
  const toast = useToast()
  const { data: config } = useNotificationConfig()
  const { data: prefsData, isLoading, isError, error } = useNotificationPreferences()
  const updatePrefs = useUpdateNotificationPreferences()
  const updateTagPref = useUpdateTagPreference()
  const { data: groupsData } = useGroups()
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const { data: tagPrefsData } = useTagPreferences(selectedGroupId)
  const { data: untaggedPrefData } = useUntaggedPreference(selectedGroupId)

  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )
  const [subscribing, setSubscribing] = useState(false)
  const [showDeniedModal, setShowDeniedModal] = useState(false)

  const isPwa =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true)
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

  const defaultTab = isPwa && isIOS ? 'ios' : isPwa && isAndroid ? 'android' : 'website'
  const [deniedModalTab, setDeniedModalTab] = useState<'website' | 'ios' | 'android'>(defaultTab)
  const updateUntaggedPref = useUpdateUntaggedPreference()

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPushPermission(Notification.permission)
    }
  }, [])

  // Build a map of preferences for easy toggling
  const [localPrefs, setLocalPrefs] = useState<
    Record<string, Record<string, boolean>>
  >({})

  useEffect(() => {
    if (!prefsData?.preferences) return
    const map: Record<string, Record<string, boolean>> = {}
    for (const type of NOTIFICATION_TYPES) {
      map[type.key] = {}
      for (const channel of CHANNELS) {
        const pref = prefsData.preferences.find(
          (p: { type: string; channel: string; enabled: boolean }) =>
            p.type === type.key && p.channel === channel,
        )
        map[type.key][channel] = pref ? pref.enabled : true
      }
    }
    setLocalPrefs(map)
  }, [prefsData])

  const togglePref = (type: string, channel: string) => {
    setLocalPrefs((prev) => ({
      ...prev,
      [type]: { ...prev[type], [channel]: !prev[type]?.[channel] },
    }))
  }

  const hasAnyPushEnabled = (prefs: Record<string, Record<string, boolean>>) =>
    NOTIFICATION_TYPES.some((type) => prefs[type.key]?.['push'] ?? true)

  const upsertPushSubscription = async () => {
    if (!config?.vapidPublicKey) {
      throw new Error('Push is not configured on the server')
    }

    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(config.vapidPublicKey),
      })
    }

    const subJson = subscription.toJSON()
    if (!subJson.endpoint || !subJson.keys?.auth || !subJson.keys?.p256dh) {
      throw new Error('Push subscription is missing required keys')
    }

    await apiFetch('/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: {
          auth: subJson.keys.auth,
          p256dh: subJson.keys.p256dh,
        },
      }),
    })
  }

  const clearPushSubscription = async () => {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      await subscription.unsubscribe()
    }
    await apiFetch('/notifications/subscribe', { method: 'DELETE' })
  }

  const syncPushSubscriptionForPrefs = async (prefs: Record<string, Record<string, boolean>>) => {
    const pushEnabled = hasAnyPushEnabled(prefs)
    if (!pushEnabled) {
      await clearPushSubscription()
      return
    }

    if (!('Notification' in window)) {
      throw new Error('Push notifications are not supported in this browser')
    }

    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      setPushPermission(result)
      if (result !== 'granted') {
        throw new Error('Push permission was not granted')
      }
    } else if (Notification.permission !== 'granted') {
      throw new Error('Push permission is denied in browser settings')
    }

    await upsertPushSubscription()
  }

  const handleSave = async () => {
    const prefs: Array<{ type: string; channel: string; enabled: boolean }> = []
    for (const type of NOTIFICATION_TYPES) {
      for (const channel of CHANNELS) {
        prefs.push({
          type: type.key,
          channel,
          enabled: localPrefs[type.key]?.[channel] ?? true,
        })
      }
    }
    try {
      await updatePrefs.mutateAsync(prefs)
      await syncPushSubscriptionForPrefs(localPrefs)
      toast.success('Notification preferences saved')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save preferences'
      toast.error(message)
    }
  }

  const requestPushPermission = async () => {
    if (!('Notification' in window)) {
      toast.error('Push notifications are not supported in this browser')
      return
    }
    const result = await Notification.requestPermission()
    setPushPermission(result)
    if (result === 'granted') {
      toast.success('Push notifications enabled')
    }
  }

  const subscribePush = async () => {
    setSubscribing(true)
    try {
      await upsertPushSubscription()
      toast.success('Push subscription registered')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to subscribe to push'
      toast.error(message)
    } finally {
      setSubscribing(false)
    }
  }

  if (isError) {
    return (
      <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-6">Notification Settings</h2>
        <p className="text-gray-400">{getApiErrorMessage(error, 'Failed to load notification preferences.')}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
      </div>
    )
  }

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Notification Settings</h2>
        <PageToolbar />
      </div>

      {/* Push Permission */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Push Notifications</h3>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              pushPermission === 'granted'
                ? 'bg-green-900 text-green-300'
                : pushPermission === 'denied'
                  ? 'bg-red-900 text-red-300'
                  : 'bg-gray-800 text-gray-400'
            }`}
          >
            {pushPermission}
          </span>
          {pushPermission !== 'granted' && pushPermission !== 'denied' && (
            <button
              onClick={requestPushPermission}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded-lg text-sm transition-colors"
            >
              Enable Push
            </button>
          )}
          {pushPermission === 'denied' && (
            <button
              onClick={() => setShowDeniedModal(true)}
              aria-label="How to re-enable push notifications"
              className="w-5 h-5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold flex items-center justify-center transition-colors"
            >
              ?
            </button>
          )}
          {pushPermission === 'granted' && (
            <button
              onClick={subscribePush}
              disabled={subscribing}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1 rounded-lg text-sm transition-colors"
            >
              {subscribing ? 'Subscribing...' : 'Subscribe'}
            </button>
          )}
        </div>
      </div>

      {showDeniedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setShowDeniedModal(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-base font-semibold text-white">Re-enable Push Notifications</h3>
              <button
                onClick={() => setShowDeniedModal(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors ml-4 shrink-0"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1">
              {(['website', 'ios', 'android'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDeniedModalTab(tab)}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                    deniedModalTab === tab
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tab === 'website' ? 'Website' : tab === 'ios' ? 'iOS' : 'Android'}
                </button>
              ))}
            </div>

            {deniedModalTab === 'website' && (
              <>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  Push notifications are blocked in your browser. To re-enable them:
                </p>
                <ol className="text-sm text-gray-300 space-y-2 list-none">
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">1.</span>Click the lock or info icon in your browser&apos;s address bar.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">2.</span>Find <strong className="text-white">Notifications</strong> and change it to <strong className="text-white">Allow</strong>.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">3.</span>Reload the page.</li>
                </ol>
              </>
            )}

            {deniedModalTab === 'ios' && (
              <>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  On iOS, notifications are controlled in the Settings app:
                </p>
                <ol className="text-sm text-gray-300 space-y-2 list-none">
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">1.</span>Open the <strong className="text-white">Settings</strong> app.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">2.</span>Tap <strong className="text-white">Notifications</strong>.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">3.</span>Find and tap <strong className="text-white">GEM</strong>.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">4.</span>Toggle <strong className="text-white">Allow Notifications</strong> on.</li>
                </ol>
              </>
            )}

            {deniedModalTab === 'android' && (
              <>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  On Android, re-enable notifications from Chrome settings:
                </p>
                <ol className="text-sm text-gray-300 space-y-2 list-none">
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">1.</span>Open <strong className="text-white">Chrome</strong> and tap the three-dot menu <strong className="text-white">⋮</strong>.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">2.</span>Go to <strong className="text-white">Settings &gt; Site settings &gt; Notifications</strong>.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">3.</span>Find the <strong className="text-white">GEM</strong> site and tap it.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">4.</span>Change the permission to <strong className="text-white">Allow</strong>.</li>
                  <li className="flex gap-2"><span className="text-indigo-400 font-bold shrink-0">5.</span>Reload the app.</li>
                </ol>
              </>
            )}

            <button
              onClick={() => setShowDeniedModal(false)}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Per-type preferences */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">
          Notification Preferences
        </h3>
        <p className="text-xs text-gray-500 mb-4">In-App controls what appears in your notification inbox. Push and Email require permission above.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-2">Type</th>
                {CHANNELS.map((ch) => (
                  <th key={ch} className="text-center py-2">
                    {CHANNEL_LABELS[ch] ?? ch}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_TYPES.map((type) => (
                <tr key={type.key} className="border-t border-gray-800">
                  <td className="py-3 text-gray-300">{type.label}</td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="text-center py-3">
                      <button
                        role="switch"
                        aria-checked={localPrefs[type.key]?.[ch] ?? true}
                        aria-label={`${type.label} via ${ch}`}
                        onClick={() => togglePref(type.key, ch)}
                        className={`w-10 h-6 rounded-full relative transition-colors ${
                          localPrefs[type.key]?.[ch]
                            ? 'bg-indigo-600'
                            : 'bg-gray-700'
                        }`}
                      >
                        <span
                          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                            localPrefs[type.key]?.[ch] ? 'translate-x-4' : ''
                          }`}
                        />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={updatePrefs.isPending}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
      >
        {updatePrefs.isPending ? 'Saving...' : 'Save Preferences'}
      </button>

      {/* Tag Subscriptions */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mt-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Tag Subscriptions</h3>
        <p className="text-xs text-gray-500 mb-4">Subscribe to tags to receive notifications for events and messages tagged with topics you care about.</p>

        {/* Group selector */}
        {groupsData?.groups && groupsData.groups.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-400 mb-1">Select group</label>
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-auto"
            >
              <option value="">— Choose a group —</option>
              {groupsData.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedGroupId && (
          tagPrefsData?.preferences && tagPrefsData.preferences.length > 0 ? (
            <div className="space-y-2">
              {tagPrefsData.preferences.map((pref) => (
                <div key={pref.tagId} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                  <span className="text-sm text-gray-300">{pref.tagName}</span>
                  <button
                    role="switch"
                    aria-checked={pref.subscribed}
                    aria-label={`Subscribe to ${pref.tagName}`}
                    onClick={async () => {
                      try {
                        await updateTagPref.mutateAsync({ tagId: pref.tagId, subscribed: !pref.subscribed })
                      } catch {
                        toast.error('Failed to update tag subscription')
                      }
                    }}
                    disabled={updateTagPref.isPending}
                    className={`w-10 h-6 rounded-full relative transition-colors disabled:opacity-50 ${pref.subscribed ? 'bg-indigo-600' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${pref.subscribed ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No tags in this group yet. Admins can create tags from the group management page.</p>
          )
        )}
      </div>
    </div>
  )
}
