import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function TermsOfServicePage() {
  useEffect(() => {
    document.title = 'Terms of Service — GEM'
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      <div className="mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-100">Terms of Service</h1>
        <p className="mt-3 text-sm text-gray-500">Last updated: May 2026</p>
      </div>

      <div className="prose prose-invert prose-sm max-w-none space-y-8 text-gray-300 leading-relaxed">

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">1. Acceptance</h2>
          <p>By creating an account or using GEM, you agree to these Terms of Service and our <Link to="/privacy" className="text-indigo-400 hover:text-indigo-300 transition-colors">Privacy Policy</Link>. If you do not agree, do not use the service.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">2. What GEM is</h2>
          <p>GEM is a private group coordination app for small friend circles. It lets members create events, chat in channels, and share photos within closed groups. GEM is not a public social network and has no public content or discovery features.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">3. Eligibility</h2>
          <p>You must be at least 13 years old to use GEM. By registering, you represent that you meet this requirement. GEM is currently in beta — access may be limited to invited users.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">4. Your account</h2>
          <p>You are responsible for keeping your login credentials secure. You may not share your account or allow others to access it. Notify us immediately if you suspect unauthorized access.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">5. Acceptable use</h2>
          <p>You agree not to use GEM to:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-gray-400">
            <li>Harass, threaten, or abuse other users</li>
            <li>Post illegal content, including material that violates copyright or depicts child abuse</li>
            <li>Attempt to gain unauthorized access to other accounts or systems</li>
            <li>Scrape, automate, or reverse-engineer the service</li>
            <li>Impersonate another person or entity</li>
            <li>Distribute spam, malware, or unsolicited communications</li>
          </ul>
          <p className="mt-3">Violation of these rules may result in immediate account termination.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">6. Your content</h2>
          <p>You retain ownership of content you post (messages, photos, event details). By posting, you grant GEM a limited license to store, display, and transmit that content to other members of your group — solely to operate the service. You represent that you have the rights to post any content you share.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">7. Content removal</h2>
          <p>GEM may remove content or suspend accounts that violate these terms, at our discretion, without prior notice. We will make reasonable efforts to notify you when doing so unless prohibited by law or emergency circumstances.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">8. Service availability</h2>
          <p>GEM is provided "as is" during beta. We make no guarantees of uptime, data durability, or continued availability. We may change, suspend, or discontinue the service at any time. We will provide reasonable notice for significant changes or shutdowns.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">9. Limitation of liability</h2>
          <p>To the maximum extent permitted by law, GEM and its operators are not liable for any indirect, incidental, or consequential damages arising from your use of the service, including loss of data. Our total liability to you for any claim shall not exceed the amount you paid us in the 12 months preceding the claim (which during free beta is $0).</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">10. Termination</h2>
          <p>You may delete your account at any time in Settings → Account. We may terminate your access if you breach these terms. Upon termination, your data will be deleted as described in our <Link to="/privacy" className="text-indigo-400 hover:text-indigo-300 transition-colors">Privacy Policy</Link>.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">11. Changes to these terms</h2>
          <p>We may update these terms periodically. Material changes will be communicated by email or in-app notice at least 14 days in advance. Continued use after changes take effect constitutes acceptance.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">12. Contact</h2>
          <p>Questions about these terms? Email us at <a href="mailto:help@gem.aidanlenahan.com" className="text-indigo-400 hover:text-indigo-300 transition-colors">help@gem.aidanlenahan.com</a>.</p>
        </section>
      </div>
    </div>
  )
}
