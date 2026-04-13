import { useState, useEffect } from 'react'
import {
  useNotificationConfig,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../hooks/useNotifications'
import { useToast } from '../hooks/useToast'
import { apiFetch } from '../lib/api'
import Spinner from '../components/Spinner'

const NOTIFICATION_TYPES = [
  { key: 'chat_message', label: 'Chat Messages' },
  { key: 'event_created', label: 'New Events' },
  { key: 'event_changed', label: 'Event Changes' },
  { key: 'invite', label: 'Invitations' },
  { key: 'rsvp_update', label: 'RSVP Updates' },
] as const

const CHANNELS = ['push', 'email'] as const

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
  const { data: prefsData, isLoading } = useNotificationPreferences()
  const updatePrefs = useUpdateNotificationPreferences()

  const [pushPermission, setPushPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const [subscribing, setSubscribing] = useState(false)

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
      toast.success('Notification preferences saved')
    } catch {
      toast.error('Failed to save preferences')
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
    if (!config?.vapidPublicKey) {
      toast.error('Push is not configured on the server')
      return
    }
    setSubscribing(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(config.vapidPublicKey),
      })
      const subJson = subscription.toJSON()
      await apiFetch('/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            auth: subJson.keys?.auth,
            p256dh: subJson.keys?.p256dh,
          },
        }),
      })
      toast.success('Push subscription registered')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to subscribe to push'
      toast.error(message)
    } finally {
      setSubscribing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Notification Settings</h2>

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

      {/* Per-type preferences */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">
          Notification Preferences
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-2">Type</th>
                {CHANNELS.map((ch) => (
                  <th key={ch} className="text-center py-2 capitalize">
                    {ch}
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
    </div>
  )
}
