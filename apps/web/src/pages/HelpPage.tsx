import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { helpArticles } from '../lib/helpArticles'

const faqs = [
  {
    question: 'What is GEM?',
    answer:
      'GEM is a private social app for friend groups. You can create groups, plan events, chat in channels, and share photos — all in one place, just for the people you actually hang out with.',
  },
  {
    question: 'How do I sign up?',
    answer:
      "GEM is currently in beta. You'll need an invite code to create an account. If you have one, head to the sign up page. If not, reach out and we'll get you in.",
  },
  {
    question: 'Where do I get an invite code?',
    answer:
      "Invite codes are currently distributed by the GEM team during the beta period. You can request one by reaching out, or get one from a friend who's already on GEM.",
  },
  {
    question: 'Is GEM free?',
    answer:
      "Yes — GEM is completely free during the beta. We'll share any future pricing plans well in advance.",
  },
  {
    question: 'Can I use GEM on my phone?',
    answer:
      'Yes. GEM is a Progressive Web App (PWA). Open it in your mobile browser, then use the "Add to Home Screen" option to install it like a native app. It works on iOS and Android.',
  },
  {
    question: 'How many people can be in a group?',
    answer:
      "Groups are designed for close friend circles. There's no hard cap, but GEM is optimized for small, trusted groups — not public communities.",
  },
  {
    question: 'Who can see my content?',
    answer:
      'Only members of your group can see the content inside it. GEM is private by design — there are no public profiles, no discovery feeds, and no ads.',
  },
  {
    question: 'How do I report a bug or problem?',
    answer:
      "Use the contact form to report any issues. During beta, we're especially interested in feedback, so don't hesitate to reach out.",
  },
]

function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i)

  return (
    <div className="space-y-2">
      {faqs.map((faq, i) => (
        <div
          key={i}
          className={`rounded-xl border transition-colors ${
            openIndex === i
              ? 'border-indigo-800/50 bg-indigo-950/30'
              : 'border-gray-800 bg-gray-900'
          }`}
        >
          <button
            onClick={() => toggle(i)}
            className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
          >
            <span className="text-sm font-medium text-gray-100">{faq.question}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`w-4 h-4 shrink-0 text-gray-400 transition-transform duration-200 ${openIndex === i ? 'rotate-180 text-indigo-400' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openIndex === i && (
            <div className="px-5 pb-4">
              <p className="text-sm text-gray-400 leading-relaxed">{faq.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ContactModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-900/60 border border-indigo-700 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-100 mb-2">Get in touch</h2>
          <p className="text-sm text-gray-400 mb-6">
            Questions, feedback, or want a beta invite? Reach out directly.
          </p>
          <p className="text-sm text-gray-400 mb-3">Email us at</p>
          <a
            href="mailto:help@gem.aidanlenahan.com"
            className="text-lg font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            help@gem.aidanlenahan.com
          </a>
        </div>
      </div>
    </div>
  )
}

export default function HelpPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [contactOpen, setContactOpen] = useState(() => searchParams.get('contact') === '1')

  const openContact = useCallback(() => setContactOpen(true), [])
  const closeContact = useCallback(() => {
    setContactOpen(false)
    // Remove the query param without adding a history entry
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('contact')
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    document.title = 'Help — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  // If the URL has ?contact=1 (e.g. navigated from /contact redirect), open modal
  useEffect(() => {
    if (searchParams.get('contact') === '1') setContactOpen(true)
  }, [searchParams])

  return (
    <>
      {contactOpen && <ContactModal onClose={closeContact} />}

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <div className="mb-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-100">
            Help
          </h1>
          <p className="mt-3 text-gray-400">
            Can't find what you're looking for?{' '}
            <button
              onClick={openContact}
              className="text-indigo-400 hover:text-indigo-300 transition-colors underline underline-offset-2"
            >
              Reach out to us.
            </button>
          </p>
        </div>

        <section className="mb-12">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">How-to guides</h2>
          <div className="space-y-2">
            {helpArticles.map((article) => (
              <Link
                key={article.slug}
                to={`/help/${article.slug}`}
                className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl border border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/50 transition-colors group"
              >
                <span className="text-sm font-medium text-gray-100">{article.title}</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4 shrink-0 text-gray-600 group-hover:text-gray-400 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-4">Frequently asked questions</h2>
          <FaqAccordion />
        </section>
      </div>
    </>
  )
}
