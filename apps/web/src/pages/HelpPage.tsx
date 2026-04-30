import { useState } from 'react'
import { Link } from 'react-router-dom'

const faqs = [
  {
    question: 'What is GEM?',
    answer:
      'GEM is a private social app for friend groups. You can create groups, plan events, chat in channels, and share photos — all in one place, just for the people you actually hang out with.',
  },
  {
    question: 'How do I sign up?',
    answer:
      'GEM is currently in beta. You\'ll need an invite code to create an account. If you have one, head to the sign up page. If not, reach out via the Contact page and we\'ll get you in.',
  },
  {
    question: 'Where do I get an invite code?',
    answer:
      'Invite codes are currently distributed by the GEM team during the beta period. You can request one through the Contact page or get one from a friend who\'s already on GEM.',
  },
  {
    question: 'Is GEM free?',
    answer:
      'Yes — GEM is completely free during the beta. We\'ll share any future pricing plans well in advance.',
  },
  {
    question: 'Can I use GEM on my phone?',
    answer:
      'Yes. GEM is a Progressive Web App (PWA). Open it in your mobile browser, then use the "Add to Home Screen" option to install it like a native app. It works on iOS and Android.',
  },
  {
    question: 'How many people can be in a group?',
    answer:
      'Groups are designed for close friend circles. There\'s no hard cap, but GEM is optimized for small, trusted groups — not public communities.',
  },
  {
    question: 'Who can see my content?',
    answer:
      'Only members of your group can see the content inside it. GEM is private by design — there are no public profiles, no discovery feeds, and no ads.',
  },
  {
    question: 'How do I report a bug or problem?',
    answer:
      'Use the Contact page to report any issues. During beta, we\'re especially interested in feedback, so don\'t hesitate to reach out.',
  },
]

export default function HelpPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i)

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      <div className="mb-12 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-100">
          Help
        </h1>
        <p className="mt-3 text-gray-400">
          Can't find what you're looking for?{' '}
          <Link to="/contact" className="text-indigo-400 hover:text-indigo-300 transition-colors">
            Reach out to us.
          </Link>
        </p>
      </div>

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
    </div>
  )
}
