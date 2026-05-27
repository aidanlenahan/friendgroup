import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useCreateEvent } from '../hooks/useEvents'
import { useGroupTags } from '../hooks/useGroups'
import { useToast } from '../hooks/useToast'
import DurationPicker from '../components/DurationPicker'
import DateTimePicker from '../components/DateTimePicker'
import { useGroupEventTemplates } from '../hooks/useEventTemplates'

type CreateEventResult = { event: { id: string } }

type PrefillState = {
  title?: string
  details?: string
  dateTime?: string
  durationMinutes?: number
  location?: string
  maxAttendees?: string
  isPrivate?: boolean
  tagIds?: string[]
}

const MAX_EVENT_TAGS = 3

export default function CreateEventPage() {
  useEffect(() => {
    document.title = 'New Event — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const { state } = useLocation()
  const prefill = (state as { prefill?: PrefillState } | null)?.prefill
  const toast = useToast()
  const createEvent = useCreateEvent()
  const { data: tagsData } = useGroupTags(groupId!)

  const [title, setTitle] = useState(prefill?.title ?? '')
  const [details, setDetails] = useState(prefill?.details ?? '')
  const [dateTime, setDateTime] = useState(prefill?.dateTime ?? '')
  const [durationMinutes, setDurationMinutes] = useState(prefill?.durationMinutes ?? 60)
  const [location, setLocation] = useState(prefill?.location ?? '')
  const [maxAttendees, setMaxAttendees] = useState(prefill?.maxAttendees ?? '')
  const [isPrivate, setIsPrivate] = useState(prefill?.isPrivate ?? false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(prefill?.tagIds ?? [])
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [appliedTemplateName, setAppliedTemplateName] = useState<string | null>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const tags = tagsData?.tags ?? []
  const { data: templatesData } = useGroupEventTemplates(groupId!)

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
    if (!apiKey) return

    function initAutocomplete() {
      const input = locationInputRef.current
      if (!input) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google
      if (!g?.maps?.places) return
      const autocomplete = new g.maps.places.Autocomplete(input, { types: ['establishment', 'geocode'] })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        setLocation(place.formatted_address || place.name || '')
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
  }, [])

  if (!groupId) {
    return <div className="p-6 text-gray-400">Missing group id</div>
  }

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
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

  const applyTemplate = (templateId: string) => {
    const tpl = templatesData?.templates.find((t) => t.id === templateId)
    if (!tpl) return
    setTitle(tpl.title)
    setDetails(tpl.details ?? '')
    setDurationMinutes(tpl.durationMinutes ?? 60)
    setLocation(tpl.location ?? '')
    setMaxAttendees(tpl.maxAttendees != null ? String(tpl.maxAttendees) : '')
    setIsPrivate(tpl.isPrivate)
    const validTagIds = (tpl.tags ?? []).map((t) => t.id).filter((id) => tags.some((gt) => gt.id === id))
    setSelectedTagIds(validTagIds.slice(0, MAX_EVENT_TAGS))
    setAppliedTemplateName(tpl.name)
    setShowTemplatePicker(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = (await createEvent.mutateAsync({
        groupId,
        title,
        details: details || undefined,
        dateTime: new Date(dateTime).toISOString(),
        endsAt: dateTime ? new Date(new Date(dateTime).getTime() + durationMinutes * 60000).toISOString() : undefined,
        location: location || undefined,
        maxAttendees: maxAttendees ? Number(maxAttendees) : undefined,
        isPrivate,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      })) as CreateEventResult
      toast.success('Event created!')
      navigate(`/events/${result.event.id}`)
    } catch {
      toast.error('Failed to create event')
    }
  }

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{prefill ? 'Duplicate Event' : 'Create Event'}</h2>
        <PageToolbar />
      </div>

      {/* Template picker — only shown when not duplicating and templates exist */}
      {!prefill && (templatesData?.templates.length ?? 0) > 0 && (
        <div className="mb-4">
          {appliedTemplateName ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-900/30 border border-indigo-700/50 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
              </svg>
              <span className="text-indigo-300 flex-1 truncate">Template: <span className="font-medium text-indigo-200">{appliedTemplateName}</span></span>
              <button
                type="button"
                onClick={() => setAppliedTemplateName(null)}
                className="text-indigo-400 hover:text-indigo-200 text-xs"
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTemplatePicker((v) => !v)}
              className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
              </svg>
              Start from template
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${showTemplatePicker ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          {showTemplatePicker && (
            <div className="mt-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800">
              {templatesData!.templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl.id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors"
                >
                  <p className="text-sm font-medium text-white">{tpl.name}</p>
                  <p className="text-xs text-gray-400 truncate">{tpl.title}{tpl.location ? ` · ${tpl.location}` : ''}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Title *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={100}
            placeholder="e.g., Team BBQ, Movie night…"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Details</label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            maxLength={3000}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Start Date/Time *</label>
            <DateTimePicker
              value={dateTime}
              onChange={setDateTime}
              required
              disabled={createEvent.isPending}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Duration</label>
            <DurationPicker
              durationMinutes={durationMinutes}
              onChange={setDurationMinutes}
              disabled={createEvent.isPending}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Location</label>
          <input
            ref={locationInputRef}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., Central Park"
            maxLength={200}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Max Attendees</label>
          <input
            type="number"
            value={maxAttendees}
            onChange={(e) => setMaxAttendees(e.target.value)}
            min="1"
            placeholder="No limit"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="isPrivate"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="w-4 h-4 rounded bg-gray-800 border-gray-700 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor="isPrivate" className="text-sm text-gray-300">
            Private event (invite-only)
          </label>
        </div>

        {tags.length > 0 && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">Tags ({selectedTagIds.length}/{MAX_EVENT_TAGS})</label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    selectedTagIds.includes(tag.id)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-3 text-gray-400 hover:text-white text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createEvent.isPending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            {createEvent.isPending ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  )
}
