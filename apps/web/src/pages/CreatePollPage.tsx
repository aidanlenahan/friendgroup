import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useCreatePoll, useUpdatePoll, type Poll } from '../hooks/usePolls'
import { useToast } from '../hooks/useToast'
import DateTimePicker from '../components/DateTimePicker'

const MAX_OPTIONS = 5
const MAX_QUESTION_LEN = 200
const MAX_TITLE_LEN = 80
const MAX_DESC_LEN = 200
const MAX_LOC_LEN = 200

type OptionDraft = {
  title: string
  dateTime: string
  description: string
  location: string
}

function blank(): OptionDraft {
  return { title: '', dateTime: '', description: '', location: '' }
}

export default function CreatePollPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const { state } = useLocation()
  const existingPoll = (state as { poll?: Poll } | null)?.poll
  const isEdit = !!existingPoll

  useEffect(() => {
    document.title = isEdit ? 'Edit Poll — GEM' : 'New Poll — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [isEdit])

  const toast = useToast()
  const createPoll = useCreatePoll()
  const updatePoll = useUpdatePoll()

  const [question, setQuestion] = useState(existingPoll?.question ?? '')
  const [options, setOptions] = useState<OptionDraft[]>(
    existingPoll?.options.map((o) => ({
      title: o.title,
      dateTime: o.dateTime ? new Date(o.dateTime).toISOString().slice(0, 16) : '',
      description: o.description ?? '',
      location: o.location ?? '',
    })) ?? [blank(), blank()]
  )

  if (!groupId) return <div className="p-6 text-gray-400">Missing group id</div>

  const setOption = (i: number, field: keyof OptionDraft, value: string) => {
    setOptions((prev) => prev.map((o, idx) => idx === i ? { ...o, [field]: value } : o))
  }

  const addOption = () => {
    if (options.length < MAX_OPTIONS) setOptions((prev) => [...prev, blank()])
  }

  const removeOption = (i: number) => {
    if (options.length > 1) setOptions((prev) => prev.filter((_, idx) => idx !== i))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const filledOptions = options.filter((o) => o.title.trim())
    if (!filledOptions.length) { toast.error('Add at least one option'); return }

    const payload = filledOptions.map((o, i) => ({
      title: o.title.trim(),
      dateTime: o.dateTime || undefined,
      description: o.description.trim() || undefined,
      location: o.location.trim() || undefined,
      order: i + 1,
    }))

    try {
      if (isEdit) {
        await updatePoll.mutateAsync({ pollId: existingPoll.id, groupId, question: question.trim(), options: payload })
        toast.success('Poll updated')
      } else {
        await createPoll.mutateAsync({ groupId, question: question.trim(), options: payload })
        toast.success('Poll created')
      }
      navigate(`/groups/${groupId}?tab=polls`)
    } catch {
      toast.error(isEdit ? 'Failed to update poll' : 'Failed to create poll')
    }
  }

  const isPending = createPoll.isPending || updatePoll.isPending

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{isEdit ? 'Edit Poll' : 'New Poll'}</h2>
        <PageToolbar />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Question */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Question <span className="text-gray-600">*</span>
          </label>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            maxLength={MAX_QUESTION_LEN}
            placeholder="e.g., When should we do the picnic?"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-600 mt-1 text-right">{question.length}/{MAX_QUESTION_LEN}</p>
        </div>

        {/* Options */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">
              Options <span className="text-gray-600">({options.length}/{MAX_OPTIONS})</span>
            </label>
          </div>

          <div className="space-y-4">
            {options.map((opt, i) => (
              <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-indigo-400 w-5 shrink-0">#{i + 1}</span>
                  <input
                    value={opt.title}
                    onChange={(e) => setOption(i, 'title', e.target.value)}
                    required
                    maxLength={MAX_TITLE_LEN}
                    placeholder="Option title *"
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {options.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="shrink-0 text-gray-600 hover:text-red-400 transition-colors"
                      title="Remove option"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Date / Time</label>
                    <DateTimePicker
                      value={opt.dateTime}
                      onChange={(v) => setOption(i, 'dateTime', v)}
                      disabled={isPending}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Location</label>
                    <input
                      value={opt.location}
                      onChange={(e) => setOption(i, 'location', e.target.value)}
                      maxLength={MAX_LOC_LEN}
                      placeholder="Optional"
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="pl-7">
                  <label className="block text-xs text-gray-500 mb-1">Description</label>
                  <input
                    value={opt.description}
                    onChange={(e) => setOption(i, 'description', e.target.value)}
                    maxLength={MAX_DESC_LEN}
                    placeholder="Optional note"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            ))}
          </div>

          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={addOption}
              className="mt-3 w-full py-2 rounded-xl border border-dashed border-gray-700 text-gray-500 hover:text-indigo-400 hover:border-indigo-600 text-sm transition-colors"
            >
              + Add option
            </button>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-3 text-gray-400 hover:text-white text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            {isPending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Changes' : 'Create Poll')}
          </button>
        </div>
      </form>
    </div>
  )
}
