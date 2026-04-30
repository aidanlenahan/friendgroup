export default function ContactPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      <div className="mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-100">
          Get in touch
        </h1>
        <p className="mt-3 text-gray-400">
          Questions, feedback, or want a beta invite? Reach out directly.
        </p>
      </div>

      <div className="rounded-2xl bg-gray-900 border border-gray-800 p-10 text-center">
        <div className="w-12 h-12 rounded-full bg-indigo-900/60 border border-indigo-700 flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm text-gray-400 mb-3">Email us at</p>
        <a
          href="mailto:help@gem.aidanlenahan.com"
          className="text-lg font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          help@gem.aidanlenahan.com
        </a>
      </div>
    </div>
  )
}
