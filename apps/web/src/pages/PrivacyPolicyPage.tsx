import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = 'Privacy Policy — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      <div className="mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-100">Privacy Policy</h1>
        <p className="mt-3 text-sm text-gray-500">Last updated: May 2026</p>
      </div>

      <div className="prose prose-invert prose-sm max-w-none space-y-8 text-gray-300 leading-relaxed">

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">1. What we collect</h2>
          <p>When you create an account we collect your name, email address, and a hashed password. When you use the app we store content you create: events, RSVPs, channel messages, photos, and group membership records. We also collect basic server logs (IP address, browser type, timestamps) for security and debugging purposes.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">2. How we use it</h2>
          <p>Your data is used solely to operate GEM — to show you your groups, send notifications you've opted into, and let other members of your groups interact with you. We do not sell your data. We do not run ads. We do not build profiles for third-party use.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">3. Who can see your data</h2>
          <p>Content inside a group is visible only to active members of that group. Your email address is hidden from other members by default; you can choose to display it on your profile in Settings. Photos you upload are accessible to group members via a private URL — they are not publicly indexed.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">4. Third-party services</h2>
          <p>GEM uses a small number of third-party services to operate:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-gray-400">
            <li><strong className="text-gray-300">Cloudflare R2 / AWS S3</strong> — photo and media storage</li>
            <li><strong className="text-gray-300">SMTP provider</strong> — transactional email delivery</li>
            <li><strong className="text-gray-300">Sentry</strong> — error tracking (no personal data in payloads)</li>
          </ul>
          <p className="mt-3">These services process data only as necessary to provide their function. No social networks, analytics companies, or advertising platforms receive your data.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">5. Notifications</h2>
          <p>Push notifications and emails are sent only for events you've opted into (group activity, event reminders, @mentions). You can adjust or disable all notification channels at any time in <Link to="/settings/notifications" className="text-indigo-400 hover:text-indigo-300 transition-colors">Notification Settings</Link>.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">6. Data retention</h2>
          <p>Your data is retained for as long as your account exists. When you delete your account, your profile and all directly associated records are permanently deleted. Some content you created inside groups (messages, event records) may remain in anonymised form — your name and identity are removed.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">7. Your rights</h2>
          <p>You have the right to access, correct, export, or delete your personal data at any time. You can:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-gray-400">
            <li>Update your name, email, or avatar in <Link to="/settings" className="text-indigo-400 hover:text-indigo-300 transition-colors">Settings</Link></li>
            <li>Delete your account permanently in Settings → Account</li>
            <li>Request a data export by emailing <a href="mailto:help@gem.aidanlenahan.com" className="text-indigo-400 hover:text-indigo-300 transition-colors">help@gem.aidanlenahan.com</a></li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">8. Cookies and storage</h2>
          <p>GEM uses an HTTP-only cookie to store your authentication session. No third-party tracking cookies are set. The app stores minimal data in your browser's localStorage for offline functionality (cached preferences, draft state).</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">9. Children</h2>
          <p>GEM is not directed at children under 13. If you believe a child under 13 has created an account, please contact us and we will delete it promptly.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">10. Changes to this policy</h2>
          <p>If we make material changes to this policy we will notify users via email or an in-app notice at least 14 days before the change takes effect.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">11. Contact</h2>
          <p>Questions about this policy? Email us at <a href="mailto:help@gem.aidanlenahan.com" className="text-indigo-400 hover:text-indigo-300 transition-colors">help@gem.aidanlenahan.com</a>.</p>
        </section>
      </div>
    </div>
  )
}
