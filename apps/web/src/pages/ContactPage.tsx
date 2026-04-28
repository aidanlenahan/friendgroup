import { useState } from 'react'

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' })
  const [status, setStatus] = useState<Status>('idle')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    // Simulate submission — replace with real API call when available
    await new Promise((r) => setTimeout(r, 800))
    setStatus('success')
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-100">
          Get in touch
        </h1>
        <p className="mt-3 text-gray-400">
          Questions, feedback, or want a beta invite? Send us a message.
        </p>
      </div>

      {status === 'success' ? (
        <div className="rounded-2xl bg-emerald-950/40 border border-emerald-800/50 p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-900/60 border border-emerald-700 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-100">Message sent!</h2>
          <p className="mt-2 text-sm text-gray-400">We'll get back to you as soon as possible.</p>
          <button
            onClick={() => { setForm({ name: '', email: '', subject: '', message: '' }); setStatus('idle') }}
            className="mt-6 px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            Send another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-gray-400 mb-1.5">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={form.name}
                onChange={handleChange}
                placeholder="Your name"
                className="w-full px-3 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-400 mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={form.email}
                onChange={handleChange}
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label htmlFor="subject" className="block text-xs font-medium text-gray-400 mb-1.5">
              Subject
            </label>
            <select
              id="subject"
              name="subject"
              required
              value={form.subject}
              onChange={handleChange}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            >
              <option value="" disabled>Select a topic…</option>
              <option value="beta-invite">Request a beta invite</option>
              <option value="bug">Report a bug</option>
              <option value="feedback">General feedback</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="message" className="block text-xs font-medium text-gray-400 mb-1.5">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={5}
              value={form.message}
              onChange={handleChange}
              placeholder="Tell us what's on your mind…"
              className="w-full px-3 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            />
          </div>

          {status === 'error' && (
            <p className="text-sm text-red-400">Something went wrong. Please try again.</p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white transition-colors shadow-lg shadow-indigo-600/20"
          >
            {status === 'loading' ? 'Sending…' : 'Send message'}
          </button>
        </form>
      )}
    </div>
  )
}
