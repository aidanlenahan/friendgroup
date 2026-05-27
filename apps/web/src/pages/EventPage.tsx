import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useQuery } from '@tanstack/react-query'
import { useEvent, useEventAttendance, useRsvp, useEventRating, useEventMedia, useLikeMedia, useUpdateEvent } from '../hooks/useEvents'
import type { EventRecord, EventTag } from '../hooks/useEvents'
import { useGroupMembers, useGroupTags } from '../hooks/useGroups'
import { useCreateEventTemplate } from '../hooks/useEventTemplates'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../hooks/useToast'
import TagBadge from '../components/TagBadge'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import DurationPicker from '../components/DurationPicker'
import DateTimePicker from '../components/DateTimePicker'
import { apiFetch, ApiError, getApiErrorMessage } from '../lib/api'
import { MediaLightbox } from '../components/MediaLightbox'
import { useIsOnline } from '../hooks/useIsOnline'
import EmptyState from '../components/EmptyState'

function LockIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Private event"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function CopyIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function PencilIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildGoogleCalLink(event: EventRecord): string {
  const start = new Date(event.dateTime).toISOString().replace(/[-:]/g, '').replace('.000', '')
  const end = event.endsAt
    ? new Date(event.endsAt).toISOString().replace(/[-:]/g, '').replace('.000', '')
    : start
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: event.details ?? '',
    location: event.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

const MAX_EVENT_TAGS = 3

export default function EventPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const currentUser = useAuthStore((s) => s.user)
  const toast = useToast()

  const {
    data: eventResponse,
    isLoading,
    isError: eventError,
    error: eventErrorDetails,
    refetch: refetchEvent,
  } = useEvent(eventId!)
  const { data: attendance } = useEventAttendance(eventId!)
  const { data: mediaData, refetch: refetchMedia } = useEventMedia(eventId!)
  const likeMedia = useLikeMedia(eventId!)
  const rsvp = useRsvp(eventId!)
  const rating = useEventRating(eventId!)

  const updateEvent = useUpdateEvent(eventId!)
  const createTemplate = useCreateEventTemplate()

  const isOnline = useIsOnline()
  const mediaUploadRef = useRef<HTMLInputElement>(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null)
  const [pendingCaption, setPendingCaption] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null)
  const [removingInviteUserId, setRemovingInviteUserId] = useState<string | null>(null)
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDetails, setEditDetails] = useState('')
  const [editDateTime, setEditDateTime] = useState('')
  const [editDurationMinutes, setEditDurationMinutes] = useState(60)
  const [editTagIds, setEditTagIds] = useState<string[]>([])
  const [editLocation, setEditLocation] = useState('')
  const [editMaxAttendees, setEditMaxAttendees] = useState('')
  const editLocationInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!showEditModal) return
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
    if (!apiKey) return

    function initAutocomplete() {
      const input = editLocationInputRef.current
      if (!input) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google
      if (!g?.maps?.places) return
      const autocomplete = new g.maps.places.Autocomplete(input, { types: ['establishment', 'geocode'] })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        setEditLocation(place.formatted_address || place.name || '')
      })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).google?.maps?.places) {
      initAutocomplete()
      return
    }

    if (document.querySelector('script[data-gmaps]')) {
      window.addEventListener('gmaps:ready', initAutocomplete, { once: true })
      return
    }

    const script = document.createElement('script')
    script.dataset.gmaps = '1'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    script.onload = () => {
      window.dispatchEvent(new Event('gmaps:ready'))
      initAutocomplete()
    }
    document.head.appendChild(script)
  }, [showEditModal])
  const [editIsPrivate, setEditIsPrivate] = useState(false)

  const event = eventResponse?.event
  const isAdmin = eventResponse?.isAdmin ?? false

  useEffect(() => {
    if (!event?.title) return
    document.title = `${event.title} — GEM`
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [event?.title])
  const isCreator = eventResponse?.isCreator ?? false
  const canInvite = isAdmin || isCreator

  const { data: groupMembersData } = useGroupMembers(event?.groupId ?? '', { enabled: !!event?.groupId })
  const isMember = (groupMembersData?.members ?? []).some((m) => m.userId === currentUser?.id && m.status === 'active')
  const canDuplicate = isAdmin || isCreator || isMember
  const { data: groupTagsData } = useGroupTags(event?.groupId ?? '', { enabled: !!event?.groupId })
  const { data: eventInvitesData, refetch: refetchInvites } = useQuery({
    queryKey: ['events', eventId, 'invites'],
    queryFn: () => apiFetch<{ invites: Array<{ id: string; userId: string; invitedUser: { id: string; name: string; avatarUrl?: string | null } }> }>(`/events/${eventId}/invites`),
    enabled: !!eventId && (canInvite || !!event?.isPrivate),
  })
  const invitedUserIds = new Set((eventInvitesData?.invites ?? []).map((i) => i.userId))

  const invitableMembers = (groupMembersData?.members ?? []).filter(
    (m) => m.status === 'active' && m.userId !== currentUser?.id && !invitedUserIds.has(m.userId)
  )

  const handleInvite = async (userId: string) => {
    setInvitingUserId(userId)
    try {
      await apiFetch(`/events/${eventId}/invites`, { method: 'POST', body: JSON.stringify({ userId }) })
      await refetchInvites()
      toast.success('Invitation sent')
    } catch {
      toast.error('Failed to send invitation')
    } finally {
      setInvitingUserId(null)
    }
  }

  const handleRemoveInvite = async (userId: string) => {
    setRemovingInviteUserId(userId)
    try {
      await apiFetch(`/events/${eventId}/invites/${userId}`, { method: 'DELETE' })
      await refetchInvites()
      toast.success('Invite removed')
    } catch {
      toast.error('Failed to remove invite')
    } finally {
      setRemovingInviteUserId(null)
    }
  }

  const eventTags = event?.tags ?? []

  const handleRating = async (value: number) => {
    try {
      await rating.mutateAsync(value)
    } catch {
      toast.error('Failed to save rating')
    }
  }

  const handleOpenEditModal = () => {
    if (!event) return
    setEditTitle(event.title)
    setEditDetails(event.details ?? '')
    setEditDateTime(isoToDatetimeLocal(event.dateTime))
    setEditDurationMinutes(
      event.endsAt
        ? Math.max(1, Math.round((new Date(event.endsAt).getTime() - new Date(event.dateTime).getTime()) / 60000))
        : 60
    )
    setEditTagIds(event.tags?.map((t) => t.id) ?? [])
    setEditLocation(event.location ?? '')
    setEditMaxAttendees(event.maxAttendees != null ? String(event.maxAttendees) : '')
    setEditIsPrivate(event.isPrivate ?? false)
    setShowEditModal(true)
  }

  const handleSaveAsTemplate = async () => {
    if (!event || !templateName.trim()) return
    const durationMinutes = event.endsAt
      ? Math.max(1, Math.round((new Date(event.endsAt).getTime() - new Date(event.dateTime).getTime()) / 60000))
      : undefined
    try {
      await createTemplate.mutateAsync({
        groupId: event.groupId,
        name: templateName.trim(),
        title: event.title,
        details: event.details ?? undefined,
        durationMinutes,
        location: event.location ?? undefined,
        maxAttendees: event.maxAttendees ?? undefined,
        isPrivate: event.isPrivate ?? false,
        tagIds: event.tags?.map((t) => t.id),
      })
      toast.success('Template saved')
      setShowSaveTemplateModal(false)
      setTemplateName('')
    } catch (err) {
      const msg = err instanceof Error && err.message.includes('TEMPLATE_LIMIT')
        ? 'This group has reached the 15-template limit. Delete a template in Manage Group to add more.'
        : 'Failed to save template'
      toast.error(msg)
    }
  }

  const handleDuplicate = () => {
    if (!event) return
    const durationMinutes = event.endsAt
      ? Math.max(1, Math.round((new Date(event.endsAt).getTime() - new Date(event.dateTime).getTime()) / 60000))
      : 60
    navigate(`/groups/${event.groupId}/events/new`, {
      state: {
        prefill: {
          title: event.title,
          details: event.details ?? '',
          dateTime: isoToDatetimeLocal(event.dateTime),
          durationMinutes,
          location: event.location ?? '',
          maxAttendees: event.maxAttendees != null ? String(event.maxAttendees) : '',
          isPrivate: event.isPrivate ?? false,
          tagIds: event.tags?.map((t) => t.id) ?? [],
        },
      },
    })
  }

  const toggleEditTag = (tagId: string) => {
    setEditTagIds((prev) => {
      if (prev.includes(tagId)) {
        return prev.filter((id) => id !== tagId)
      }
      if (prev.length >= MAX_EVENT_TAGS) {
        toast.error(`You can add up to ${MAX_EVENT_TAGS} tags per event`)
        return prev
      }
      return [...prev, tagId]
    })
  }

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await updateEvent.mutateAsync({
        title: editTitle,
        details: editDetails || undefined,
        dateTime: new Date(editDateTime).toISOString(),
        endsAt: new Date(new Date(editDateTime).getTime() + editDurationMinutes * 60000).toISOString(),
        location: editLocation || undefined,
        maxAttendees: editMaxAttendees ? Number(editMaxAttendees) : undefined,
        isPrivate: editIsPrivate,
        tagIds: editTagIds,
      })
      toast.success('Event updated')
      setShowEditModal(false)
      refetchEvent()
    } catch {
      toast.error('Failed to update event')
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
      </div>
    )
  }

  if (eventError && !event) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
        <p>{!isOnline ? 'You are offline and there is no cached data.' : getApiErrorMessage(eventErrorDetails, 'Failed to load event.')}</p>
        {isOnline && (
          <button
            onClick={() => refetchEvent()}
            className="px-4 py-2 rounded-xl bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (!event) {
    return <div className="p-6 text-gray-400">Event not found</div>
  }

  const handleRsvp = async (status: 'yes' | 'no' | 'maybe') => {
    try {
      await rsvp.mutateAsync(status)
      toast.success(`RSVP updated to ${status}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RSVP_RATE_LIMITED') {
        toast.error('Slow down — you can only change your RSVP 3 times per minute.')
      } else {
        toast.error('Failed to update RSVP')
      }
    }
  }

  const counts = attendance?.counts ?? { yes: 0, no: 0, maybe: 0 }

  const handleIcsDownload = async () => {
    const res = await fetch(`/api/events/${eventId}/calendar.ics`, {
      credentials: 'include',
    })
    if (!res.ok) { toast.error('Failed to download calendar file'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gem-event-${eventId}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleMediaFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Only JPG, PNG, or WebP images are allowed')
      if (mediaUploadRef.current) mediaUploadRef.current.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be under 5 MB')
      if (mediaUploadRef.current) mediaUploadRef.current.value = ''
      return
    }
    setPendingCaption('')
    setPendingUploadFile(file)
    if (mediaUploadRef.current) mediaUploadRef.current.value = ''
  }

  const handleConfirmUpload = async () => {
    if (!pendingUploadFile || !eventId) return
    const formData = new FormData()
    formData.append('file', pendingUploadFile)
    if (pendingCaption.trim()) formData.append('caption', pendingCaption.trim().slice(0, 280))
    setUploadingMedia(true)
    try {
      await apiFetch(`/events/${eventId}/media`, { method: 'POST', body: formData })
      toast.success('Photo uploaded')
      refetchMedia()
      setPendingUploadFile(null)
      setPendingCaption('')
    } catch (err) {
      // Provide friendly messages for the two most common upload failures.
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('413') || msg.includes('too large') || msg.includes('FILE_TOO_LARGE')) {
        toast.error('Photo is too large. Maximum file size is 10 MB.')
      } else if (msg.includes('quota') || msg.includes('QUOTA') || msg.includes('storage')) {
        toast.error('Storage quota reached. Delete some photos to free up space.')
      } else {
        toast.error(getApiErrorMessage(err, 'Failed to upload photo'))
      }
    } finally {
      setUploadingMedia(false)
    }
  }

  const handleSaveCaption = async (assetId: string, caption: string | null) => {
    await apiFetch(`/media/${assetId}/caption`, { method: 'PATCH', body: JSON.stringify({ caption }) })
    refetchMedia()
  }

  const handleDeleteMedia = async (assetId: string) => {
    setDeletingMediaId(assetId)
    try {
      await apiFetch(`/media/${assetId}`, { method: 'DELETE' })
      refetchMedia()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete photo')
    } finally {
      setDeletingMediaId(null)
    }
  }

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:p-6 max-w-5xl mx-auto">
      {eventError && !isOnline && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-sm">
          You are offline. Showing cached data.
        </div>
      )}
      {/* Event Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            {event.isPrivate && <LockIcon className="w-5 h-5 text-gray-500 shrink-0" />}
            {event.title}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {canDuplicate && (
              <>
                <button
                  onClick={() => { setTemplateName(event?.title ?? ''); setShowSaveTemplateModal(true) }}
                  className="p-2 rounded-xl bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  aria-label="Save as template"
                  title="Save as template"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h8l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 3v4h-6V3M9 13h6M9 17h4" />
                  </svg>
                </button>
                <button
                  onClick={handleDuplicate}
                  className="p-2 rounded-xl bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  aria-label="Duplicate event"
                >
                  <CopyIcon />
                </button>
              </>
            )}
            {(isAdmin || isCreator) && (
              <button
                onClick={handleOpenEditModal}
                className="p-2 rounded-xl bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                aria-label="Edit event"
              >
                <PencilIcon />
              </button>
            )}
            <PageToolbar backTo={`/groups/${event.groupId}`} />
          </div>
        </div>
        <p className="text-gray-400 mt-1">{formatDate(event.dateTime)}</p>
        {event.endsAt && (
          <p className="text-gray-500 text-sm">Until {formatDate(event.endsAt)}</p>
        )}
        {event.location && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-gray-400 text-sm">{event.location}</p>
            <span className="text-gray-600 text-xs">·</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Google Maps
            </a>
            <span className="text-gray-600 text-xs">·</span>
            <a
              href={`https://maps.apple.com/?q=${encodeURIComponent(event.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Apple Maps
            </a>
            <span className="text-gray-600 text-xs">·</span>
            <a
              href={`https://waze.com/ul?q=${encodeURIComponent(event.location)}&navigate=yes`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Waze
            </a>
          </div>
        )}
        {event.details && <p className="text-gray-300 mt-3">{event.details}</p>}
        {eventTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {eventTags.map((tag: EventTag) => (
              <TagBadge key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </div>
        )}
        {event.isPrivate && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-600 text-white text-sm font-semibold transition-colors"
          >
            Invited Members
          </button>
        )}
      </div>

      {/* Invite Members Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Invited Members</h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-gray-400 hover:text-white text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Already invited */}
            {(eventInvitesData?.invites ?? []).length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2">Already invited</p>
                <div className="space-y-1">
                  {eventInvitesData!.invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-indigo-300 truncate">{inv.invitedUser.name}</span>
                      {canInvite && (
                        <button
                          onClick={() => handleRemoveInvite(inv.userId)}
                          disabled={removingInviteUserId === inv.userId}
                          className="shrink-0 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40 text-sm leading-none"
                          aria-label={`Remove ${inv.invitedUser.name}`}
                        >
                          {removingInviteUserId === inv.userId ? '…' : '×'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invitable members — admin / creator only */}
            {canInvite && (
              invitableMembers.length === 0 ? (
                <p className="text-sm text-gray-500">All group members have already been invited.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {invitableMembers.map((m) => (
                    <div key={m.userId} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{m.name}</p>
                          {m.username && <p className="text-xs text-indigo-400">@{m.username}</p>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleInvite(m.userId)}
                        disabled={invitingUserId === m.userId}
                        className="shrink-0 px-3 py-1 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        {invitingUserId === m.userId ? '...' : 'Invite'}
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Edit Event Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">Edit Event</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-white text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Title *</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  maxLength={100}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Details</label>
                <textarea
                  value={editDetails}
                  onChange={(e) => setEditDetails(e.target.value)}
                  rows={4}
                  maxLength={3000}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Start Date/Time *</label>
                  <DateTimePicker
                    value={editDateTime}
                    onChange={setEditDateTime}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Duration</label>
                  <DurationPicker
                    durationMinutes={editDurationMinutes}
                    onChange={setEditDurationMinutes}
                    disabled={updateEvent.isPending}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Location</label>
                <input
                  ref={editLocationInputRef}
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  placeholder="e.g., Central Park"
                  maxLength={200}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Attendees</label>
                <input
                  type="number"
                  value={editMaxAttendees}
                  onChange={(e) => setEditMaxAttendees(e.target.value)}
                  min="1"
                  placeholder="No limit"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="editIsPrivate"
                  checked={editIsPrivate}
                  onChange={(e) => setEditIsPrivate(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-800 border-gray-700 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="editIsPrivate" className="text-sm text-gray-300">
                  Private event (invite-only)
                </label>
              </div>
              {groupTagsData?.tags && groupTagsData.tags.length > 0 && (
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Tags ({editTagIds.length}/{MAX_EVENT_TAGS})</label>
                  <div className="flex flex-wrap gap-2">
                    {groupTagsData.tags.map((tag) => {
                      const selected = editTagIds.includes(tag.id)
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleEditTag(tag.id)}
                          className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
                        >
                          {tag.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-3 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateEvent.isPending}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
                >
                  {updateEvent.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RSVP + Attendance */}
      <section aria-label="RSVP and attendance" className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span id="rsvp-label" className="text-sm text-gray-300">RSVP:</span>
          <div role="group" aria-labelledby="rsvp-label" className="flex flex-wrap gap-2">
          {(['yes', 'no', 'maybe'] as const).map((status) => (
            <button
              key={status}
              onClick={() => handleRsvp(status)}
              disabled={rsvp.isPending}
              aria-label={`RSVP ${status}`}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === 'yes'
                  ? 'bg-green-900 text-green-300 hover:bg-green-800'
                  : status === 'maybe'
                    ? 'bg-yellow-900 text-yellow-300 hover:bg-yellow-800'
                    : 'bg-red-900 text-red-300 hover:bg-red-800'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
          </div>
        </div>
        <div className="flex gap-4 text-sm text-gray-400">
          <span>{counts.yes} going</span>
          <span>{counts.maybe} maybe</span>
          <span>{counts.no} can't go</span>
        </div>
        {attendance?.attendees && (
          <div className="flex flex-wrap gap-2 mt-3">
            {attendance.attendees
              .filter((a) => a.status === 'yes')
              .map((a) => (
                <Avatar key={a.user.id} name={a.user.name} avatarUrl={a.user.avatarUrl} size="sm" title={`${a.user.name} (going)`} />
              ))}
            {attendance.attendees
              .filter((a) => a.status === 'maybe')
              .map((a) => (
                <Avatar key={a.user.id} name={a.user.name} avatarUrl={a.user.avatarUrl} size="sm" title={`${a.user.name} (maybe)`} />
              ))}
            {attendance.attendees
              .filter((a) => a.status === 'no')
              .map((a) => (
                <Avatar key={a.user.id} name={a.user.name} avatarUrl={a.user.avatarUrl} size="sm" title={`${a.user.name} (can't go)`} />
              ))}
          </div>
        )}
      </section>

      {/* Calendar Links */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          type="button"
          onClick={handleIcsDownload}
          className="px-3 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
        >
          Download .ics
        </button>
        <a
          href={buildGoogleCalLink(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
        >
          Add to Google Calendar
        </a>
      </div>

      {/* Rating */}
      <section aria-label="Event rating" className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-300">Rate this event</p>
          {event.avgRating != null && (
            <span className="text-sm text-gray-400">
              Avg: <span className="text-amber-400 font-semibold">{event.avgRating.toFixed(1)}</span>
              <span className="text-gray-600 text-xs ml-1">({event.ratingCount} rating{event.ratingCount !== 1 ? 's' : ''})</span>
            </span>
          )}
        </div>
        <div role="group" aria-label="Rate this event" className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => handleRating(n)}
              aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
              disabled={rating.isPending}
              className={`text-2xl transition-transform hover:scale-110 disabled:opacity-50 ${
                n <= (event.myRating ?? 0) ? 'text-amber-400' : 'text-gray-700 hover:text-amber-300'
              }`}
            >
              ★
            </button>
          ))}
          {event.myRating != null && (
            <span className="text-xs text-gray-500 self-center ml-1">Your rating: {event.myRating}★</span>
          )}
        </div>
      </section>

      {/* Media Section */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">Media</h3>
          {mediaData?.mediaUpload?.canUpload && (
            <>
              <button
                type="button"
                onClick={() => mediaUploadRef.current?.click()}
                disabled={uploadingMedia}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {uploadingMedia ? 'Uploading...' : '+ Add Photo'}
              </button>
              <input
                ref={mediaUploadRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleMediaFileSelected}
              />
            </>
          )}
        </div>

        {mediaData?.mediaUpload && !mediaData.mediaUpload.enabled && (
          <p className="text-gray-600 text-xs mb-2">Media uploads are disabled for this group.</p>
        )}

        {!mediaData?.media?.length ? (
          <EmptyState
            icon={
              <svg className="w-14 h-14" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="14" width="52" height="38" rx="5"/>
                <circle cx="20" cy="27" r="5"/>
                <polyline points="6,52 24,34 36,46 44,38 58,52"/>
              </svg>
            }
            title="No media yet"
            description="Upload photos to capture this event."
          />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {mediaData.media.map((m, i) => {
              const canDelete = m.uploaderId === currentUser?.id || isAdmin
              return (
                <div key={m.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="block w-full aspect-square bg-gray-800 rounded-lg overflow-hidden"
                  >
                    <img src={m.url} alt={m.filename} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </button>
                  {/* Like button */}
                  <button
                    onClick={() => likeMedia.mutate(m.id)}
                    className={`absolute bottom-1 right-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      m.likedByMe
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-900/80 text-gray-300 hover:bg-red-700 hover:text-white'
                    }`}
                    aria-label={m.likedByMe ? 'Unlike' : 'Like'}
                  >
                    ♥ {m.likeCount > 0 && <span>{m.likeCount}</span>}
                  </button>
                  {/* Delete button (own upload or group admin) */}
                  {canDelete && (
                    <button
                      onClick={() => handleDeleteMedia(m.id)}
                      disabled={deletingMediaId === m.id}
                      className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center w-5 h-5 bg-red-600/80 hover:bg-red-600 text-white rounded-full text-xs disabled:opacity-50"
                      aria-label="Delete photo"
                    >
                      {deletingMediaId === m.id ? '…' : '×'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Lightbox */}
        {lightboxIndex !== null && mediaData?.media && (
          <MediaLightbox
            media={mediaData.media as import('../components/MediaLightbox').LightboxMedia[]}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            currentUserId={currentUser?.id}
            isAdmin={isAdmin}
            onSaveCaption={handleSaveCaption}
          />
        )}

        {/* Upload modal */}
        {pendingUploadFile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setPendingUploadFile(null)}>
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-white">Add Photo</h3>
              <img
                src={URL.createObjectURL(pendingUploadFile)}
                alt="Preview"
                className="w-full aspect-video object-cover rounded-lg bg-gray-800"
              />
              <div>
                <label className="block text-xs text-gray-400 mb-1">Caption <span className="text-gray-600">(optional)</span></label>
                <textarea
                  value={pendingCaption}
                  onChange={(e) => setPendingCaption(e.target.value.slice(0, 280))}
                  placeholder="Describe this photo…"
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-600 mt-0.5 text-right">{pendingCaption.length}/280</p>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setPendingUploadFile(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUpload}
                  disabled={uploadingMedia}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                >
                  {uploadingMedia ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        )}

        {mediaData?.mediaUpload?.enabled && (
          <p className="text-xs text-gray-600 mt-2">
            {Math.round(mediaData.mediaUpload.usedBytes / (1024 * 1024))} MB / {Math.round(mediaData.mediaUpload.limitBytes / (1024 * 1024))} MB used
          </p>
        )}
      </div>

      {/* Save as Template modal */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Save as template</h3>
            <p className="text-sm text-gray-400">
              Give this template a name so it's easy to find when creating a new event.
            </p>
            <input
              autoFocus
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              maxLength={80}
              placeholder="e.g., Team BBQ, Movie night…"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAsTemplate() }}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowSaveTemplateModal(false); setTemplateName('') }}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                disabled={!templateName.trim() || createTemplate.isPending}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {createTemplate.isPending ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

