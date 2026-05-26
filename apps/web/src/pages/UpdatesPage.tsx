import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { resolveApiBaseUrl } from '../lib/api'

type ChangeType = 'new' | 'improved' | 'fixed'

interface ChangeEntry {
  type: ChangeType
  text: string
}

interface Release {
  version: string
  date: string
  label?: string
  summary: string
  changes: ChangeEntry[]
}

const releases: Release[] = [
  {
    version: '0.9',
    date: 'May 2026',
    label: 'Beta',
    summary: 'Demo mode, account management, block/unblock users, profile visibility settings, Privacy Policy & Terms, user bios, #tag mentions in chat, and more.',
    changes: [
      { type: 'new', text: 'Demo mode — explore GEM without creating an account; /demo starts a timed guest session with a live countdown banner; demo data is wiped when the session ends or you exit' },
      { type: 'new', text: 'Block/unblock users — block a user from their profile to stop receiving notifications from them; blocked users are listed under Settings → Blocked Users and can be unblocked at any time' },
      { type: 'improved', text: 'Profile visibility in Settings — the email visibility toggle now lives in Settings → Profile Visibility alongside other profile controls, no longer buried on the profile edit page' },
      { type: 'improved', text: 'Invite code info on sign-up — a ? button next to the invite code field explains what the code is and how to get one without leaving the page' },
      { type: 'new', text: 'Change password — update your login password from Settings → Account; requires your current password before the change is applied' },
      { type: 'new', text: 'Change email address — update your email from Settings → Account; password-confirmed and verified with a one-time code sent to the new address' },
      { type: 'new', text: 'Delete account — permanently remove your account and all associated data from Settings → Account; requires password confirmation' },
      { type: 'new', text: 'Privacy Policy at /privacy — explains what data is stored, how it is used, your rights (access, export, delete), and how to contact us' },
      { type: 'new', text: 'Terms of Service at /terms — covers acceptable use, your content, our liability limits, and how changes to the terms are communicated' },
      { type: 'new', text: 'User bio — add a short bio (up to 200 characters) on your profile page; shown on your public profile; editable from the Profile page with a live character counter' },
      { type: 'new', text: '#tag mentions in channel chat — type # to trigger an autocomplete of group tags; mentioned tag subscribers get a notification; tags render as green badges in the chat' },
      { type: 'new', text: 'Leave Group — non-owner members can leave any group from the Members tab with a confirm step; group owners must transfer ownership or delete the group instead' },
      { type: 'new', text: 'Stats page toggle — group admins can enable the Stats page for all members (not just admins) from group management; a Stats link appears in the group header when enabled' },
      { type: 'improved', text: 'Contact is now a modal on the Help page — the Contact link opens an overlay instead of a separate page; /contact still works and opens the modal directly' },
      { type: 'improved', text: 'Your stats on member profiles — each shared group on a profile page now shows that person\'s activity inline (events created, going/maybe RSVPs, photos uploaded) instead of a button to the group-wide stats page' },
      { type: 'new', text: 'Email visibility on profile — a toggle in Settings lets you choose whether your email address is shown on your public profile page' },
      { type: 'new', text: 'Auto-hyperlinks in channel chat — URLs typed in messages automatically become clickable links that open in a new tab' },
      { type: 'improved', text: 'Join Group modal now has Code and URL tabs — paste an invite code directly or drop in the full invite link; the URL tab includes a clipboard paste button' },
      { type: 'improved', text: 'Sender name in push notifications — chat notifications now read "Alice in #general" instead of "New message in #general"; event invite notifications show the inviter\'s name and event title' },
      { type: 'improved', text: 'Help center expanded — five new how-to articles covering getting started, creating events, chat, the updates page, and contacting support' },
      { type: 'new', text: 'Welcome email — a welcome email is sent after email verification to help new members get started' },
      { type: 'new', text: 'First-run onboarding — new users with no groups see a guided modal walking through creating a group, inviting friends, and planning a first event' },
      { type: 'improved', text: 'Empty state on the Groups page — brand-new users see a welcoming 3-step illustration instead of a blank page' },
      { type: 'improved', text: 'Private channel member list — members of an invite-only channel can now see who else is in it; a member count button appears in the channel header for all subscribers, not just admins' },
      { type: 'improved', text: 'Message delete confirmation — deleting your own message now requires a confirmation step; desktop shows an inline Confirm/Cancel prompt; mobile shows a confirmation modal before the delete fires' },
      { type: 'improved', text: 'Browser tab titles — every page now sets an accurate title (e.g. "The Crew — GEM", "#general — GEM", "Settings — GEM") so browser history and tab switching are easier' },
      { type: 'new', text: 'Date of birth at sign-up — new accounts must enter a date of birth; accounts must belong to someone 13 or older' },
      { type: 'new', text: 'Date of birth in Settings — existing accounts show a one-time editable date of birth field; once saved it is locked and displayed as read-only' },
      { type: 'fixed', text: 'HTML injection in notification emails — user-supplied content (names, group names) is now properly escaped before being embedded in email bodies' },
      { type: 'improved', text: 'Error feedback on every action — failed requests now always surface a toast with a clear message; no more silent failures when creating events, updating RSVPs, uploading photos, or managing groups' },
      { type: 'improved', text: 'Photo upload error messages — oversized files (over 10 MB) and storage-quota errors now show specific, human-readable messages instead of a raw server error' },
      { type: 'improved', text: 'Push notification permission denied — if you block push notifications, GEM now explains how to re-enable them in your browser settings instead of closing silently' },
      { type: 'improved', text: 'Album deletion confirm UI — deleting an album now shows an inline Confirm / Cancel prompt instead of a browser dialog, matching the style used elsewhere in the app' },
      { type: 'improved', text: 'Chat disconnect guard — trying to send a message when the socket is not connected now shows a clear warning instead of the message silently disappearing' },
      { type: 'fixed', text: 'Channel pin/react/delete buttons now disable while the action is in flight, preventing double-taps from sending duplicate requests' },
      { type: 'fixed', text: 'Security hardening — HSTS, Permissions-Policy, and Content-Security-Policy headers tightened; automatic dependency audits via Dependabot and secret scanning on every push' },
      { type: 'fixed', text: 'Stale-chunk crash after deploys — loading a page after a new deploy no longer throws to the error boundary; a sessionStorage reload guard triggers one clean reload to pick up fresh chunk hashes' },
      { type: 'fixed', text: 'Keyboard overlap in group modals on mobile — the group creation and join group modals now track the visual viewport so the overlay stays above the soft keyboard on iOS and Android' },
      { type: 'improved', text: 'Invite codes are now case-insensitive — account registration, group creation, and the beta code validator all normalise the code before checking, so GEMCODE, gemcode, and GemCode all work' },
      { type: 'improved', text: 'General channel always at the top — the general channel is pinned first in every channel list and sidebar; the subscribe/unsubscribe button is hidden on it since all members are automatically subscribed' },
      { type: 'improved', text: 'Channel name is a settings shortcut for admins — clicking the channel name in the channel header opens a settings modal with rename, notification tags, manage members, and delete channel options' },
    ],
  },
  {
    version: '0.8',
    date: 'May 2026',
    label: 'Beta',
    summary: '@mentions, admin photo delete, character limits, media albums, photo captions, a full-page group gallery, light mode, and duplicate event.',
    changes: [
      { type: 'new', text: '@mentions in channel messages — type @ to open an autocomplete dropdown of group members; mentioned users get an in-app notification with a link to the message; mentions are highlighted in the chat' },
      { type: 'new', text: 'Admin photo delete from the lightbox — group owners and admins get a trash icon in the lightbox toolbar; two-step inline confirm prevents accidental deletion; works in both All Photos and album views' },
      { type: 'new', text: 'Duplicate any event — a copy icon on every event page pre-fills the Create Event form with all fields (title, details, location, privacy, tags, duration) so you can pick a new date and save it as a fresh event; available to every group member' },
      { type: 'new', text: 'Photo captions — add or edit a caption on any photo directly from the lightbox; click the caption text to edit; visible to all members, editable by the uploader or a group admin' },
      { type: 'new', text: 'Media Albums — group admins can create named albums, add photos to them, set a cover, and delete albums; members can browse albums from the Photos tab' },
      { type: 'new', text: 'Group Gallery page — a dedicated full-page view of every photo in the group with infinite scroll, caption editing, and the full lightbox; linked from the Photos tab' },
      { type: 'new', text: 'Light mode — toggle between dark and light in Settings; the choice is saved to your account and applied across all devices' },
      { type: 'new', text: 'Accent colour picker in Settings — choose your highlight colour (indigo, violet, rose, amber, emerald, sky); pairs with both dark and light mode' },
      { type: 'new', text: 'How-to guides on the Help page — six illustrated accordion articles covering PWA installation, calendar subscription, photos, channels, roles, and push notifications' },
      { type: 'improved', text: 'Character limits enforced on all major inputs — event title (100), event details (3000), location (200), group name (60), group description (500), channel message (2000), channel name (32), photo caption (280); counters show remaining characters' },
      { type: 'new', text: 'Event reminders — RSVP-yes members automatically receive a push or email notification 15 minutes, 1 hour, and 1 day before an event starts; reminder timing is configurable per-channel in Notification Settings' },
      { type: 'improved', text: 'Empty-state illustrations — all "nothing here yet" placeholders (no events, no photos, no groups, no media) now show a simple SVG spot illustration instead of plain text' },
      { type: 'improved', text: 'Route-level code splitting — every page is now lazy-loaded, cutting the initial JS bundle size and speeding up first load' },
      { type: 'improved', text: 'Member count on the group page is now a button that jumps straight to the Members tab' },
      { type: 'improved', text: 'PWA icon updated — Apple touch icon added and PNG icon registered in the manifest so the home-screen shortcut looks correct on all platforms' },
    ],
  },
  {
    version: '0.7',
    date: 'May 2026',
    label: 'Beta',
    summary: 'EXIF metadata on photos, group-wide Photos tab, group stats for admins, and this Updates page.',
    changes: [
      { type: 'new', text: 'Photo info panel now shows verbose EXIF metadata — camera make/model, lens, focal length, aperture, shutter speed, ISO, GPS coordinates, and date taken (when available)' },
      { type: 'new', text: 'Image dimensions (width × height) stored and displayed for every uploaded photo' },
      { type: 'new', text: 'Photos tab on the Group page — browse every photo uploaded across all events in a group, sorted newest-first, in a touch-friendly grid' },
      { type: 'new', text: 'Clicking any photo in the group Photos tab opens the full lightbox with EXIF info, download, and swipe navigation' },
      { type: 'new', text: 'Group Stats page for admins — total events, RSVPs by status, messages, photos, storage used, most active members, and top tags; accessible from group management' },
      { type: 'new', text: 'This Updates page — a full history of GEM features, accessible from the sidebar and public site; includes an API health check button' },
      { type: 'improved', text: 'GEM favicon now appears in the desktop sidebar next to the app name' },
      { type: 'improved', text: 'Profile picture in the sidebar is now a direct link to your profile page on desktop' },
      { type: 'fixed', text: 'Public pages (Help, Contact, Updates) now scroll correctly on all devices' },
    ],
  },
  {
    version: '0.6',
    date: 'May 2026',
    label: 'Beta',
    summary: 'Media uploads in events, message replies, and per-user calendar tuning.',
    changes: [
      { type: 'new', text: 'Upload photos to any event — images stored on the server with per-group storage quotas (default 100 MB, up to 1 GB)' },
      { type: 'new', text: 'Full-screen lightbox for viewing event photos — swipe or arrow-key navigation, download button, info panel' },
      { type: 'new', text: 'Group admins get a dedicated Media tab in group management: view all uploads, see storage usage, delete any photo, toggle upload permissions, and adjust the storage cap' },
      { type: 'new', text: 'Global media toggle in the Developer panel — enable/disable uploads server-wide, optionally require an unlock code that group admins must enter' },
      { type: 'new', text: 'Reply to any channel message — replies show an inline quoted preview of the original' },
      { type: 'new', text: 'Per-user calendar preferences: choose whether untagged events appear in your ICS feed' },
      { type: 'new', text: 'Channel tags — tag channels within a group for better organisation' },
      { type: 'improved', text: 'Audit log in group management now exports to CSV' },
      { type: 'improved', text: 'Invite-only channels now auto-add the creator as a subscriber' },
      { type: 'fixed', text: 'Hover dropdown on public pages (Help, Contact) no longer lingers 200 ms after moving the cursor away' },
    ],
  },
  {
    version: '0.5',
    date: 'May 2026',
    label: 'Beta',
    summary: 'Full-featured channel chat with reactions, pins, message management, and unread tracking.',
    changes: [
      { type: 'new', text: 'Real-time channel messaging over a shared WebSocket connection — messages appear instantly for every member in the channel' },
      { type: 'new', text: 'Emoji reactions on any channel message, with live count updates across all clients' },
      { type: 'new', text: 'Pin messages in a channel — pinned messages appear in a collapsible banner at the top of the chat' },
      { type: 'new', text: 'Edit your own messages; an "edited" indicator is shown' },
      { type: 'new', text: 'Delete your own messages (admins can delete anyone\'s)' },
      { type: 'new', text: 'Typing indicators — see who is currently composing a message' },
      { type: 'new', text: 'Optimistic message sending — your message appears instantly before the server confirms it' },
      { type: 'new', text: 'Unread dot on channel list items — the server tracks your last-read position' },
      { type: 'new', text: 'Private events now display a lock glyph and a full list of invited members' },
      { type: 'new', text: 'Invite-only channels show a lock glyph consistent with private events' },
      { type: 'improved', text: 'Auto-scroll only triggers when you are already at the bottom; a "Jump to bottom" button appears when you scroll up' },
      { type: 'improved', text: 'Consecutive messages from the same user are visually grouped (Discord-style), reducing clutter' },
      { type: 'improved', text: 'Mobile keyboard no longer disrupts scroll position or triggers unwanted page zoom in channel view' },
      { type: 'fixed', text: 'Socket connection is now a shared singleton per session — no more duplicate connections on remount' },
      { type: 'fixed', text: 'Reconnect banner appears when the socket drops; live updates resume automatically on reconnect' },
      { type: 'fixed', text: 'Rate-limit errors from the server are now surfaced in the chat UI instead of silently failing' },
    ],
  },
  {
    version: '0.4',
    date: 'April–May 2026',
    label: 'Beta',
    summary: 'Notifications inbox, push delivery, security hardening, and the public-facing website.',
    changes: [
      { type: 'new', text: 'Full notifications inbox: filter by type (events, messages, group activity), search, and batch mark-as-read' },
      { type: 'new', text: 'Push notifications for PWA installs — get alerted to new events and messages even when the app is closed' },
      { type: 'new', text: 'In-app notification channel — alerts appear inside the app without a full page reload' },
      { type: 'new', text: 'PWA install prompt for iOS and Android with automatic platform detection and step-by-step instructions' },
      { type: 'new', text: 'Per-type notification preferences (push, email) in Settings — toggle each event type independently' },
      { type: 'new', text: 'Public-facing website: Landing page, Help (FAQ), and Contact pages — accessible without logging in' },
      { type: 'new', text: 'Notification bell in the desktop sidebar header; badge shows unread count' },
      { type: 'improved', text: 'Security hardening: strict CORS policy, Content-Security-Policy headers, metrics endpoint protected, session tokens no longer persisted insecurely' },
      { type: 'improved', text: 'Rate limits applied to all mutation endpoints (auth, group creation, event creation, RSVP, reactions, subscriptions)' },
      { type: 'improved', text: 'Error states with retry buttons on all data-loading pages' },
    ],
  },
  {
    version: '0.3',
    date: 'April 2026',
    label: 'Beta',
    summary: 'Event editing, group management tools, navigation polish, and per-user settings.',
    changes: [
      { type: 'new', text: 'Edit events after creation — update title, date/time, duration, location, description, RSVP cap, private toggle, and tags' },
      { type: 'new', text: 'Duration picker with 30 min / 1 hr / 2 hr / 3 hr presets; custom hour + minute inputs; per-user saved presets (up to 5)' },
      { type: 'new', text: 'Color-coded event tags — create and manage tags per group, apply up to 3 per event, filter events by tag' },
      { type: 'new', text: 'Group management page: full member list, role management, invite link controls, pending member approvals, and audit log' },
      { type: 'new', text: 'Audit log in group management records all admin actions (role changes, removals, invite resets) with timestamps' },
      { type: 'new', text: 'Per-user mute — silence notifications from a specific other user across all groups' },
      { type: 'new', text: 'ICS calendar feed — subscribe to a group\'s upcoming events in Apple Calendar, Outlook, or Google Calendar via a personal token URL' },
      { type: 'new', text: 'Event rating — members can rate events (1–5) after they end; the average appears on the event page' },
      { type: 'new', text: 'User profile pages at /u/:username — view another member\'s name, bio, and avatar' },
      { type: 'improved', text: 'PageToolbar: every page now has consistent back and reload buttons in the top-right corner' },
      { type: 'improved', text: 'Group page tabs (Events, Members, Channels) are scrollable on narrow screens' },
      { type: 'improved', text: 'Admin controls for event deletion and member removal visible directly on the group page' },
    ],
  },
  {
    version: '0.2',
    date: 'April 2026',
    label: 'Beta',
    summary: 'Email auth flows, dark mode, group invites, group roles, user profiles, and event reactions.',
    changes: [
      { type: 'new', text: 'Email-based registration with 6-digit OTP verification — invite code required during beta' },
      { type: 'new', text: 'Forgot password and reset-password flows — secure token-based, 1-hour expiry' },
      { type: 'new', text: 'SMTP email delivery via nodemailer — verification codes and password resets sent from your own mail server' },
      { type: 'new', text: 'Dark mode as the default theme, with a light mode option in Settings' },
      { type: 'new', text: 'Group invite system — admins generate a shareable invite link; new members join the group on first visit' },
      { type: 'new', text: 'Group roles: owner, admin, and member — admins can promote or demote members; role badges shown on profile and member list' },
      { type: 'new', text: 'Username field — unique, human-readable handle changeable once per year; displayed throughout the app' },
      { type: 'new', text: 'Profile photo upload — set an avatar from Settings; displayed in the sidebar, member list, and chat' },
      { type: 'new', text: 'Emoji reactions on event messages — pick from a reaction panel, see live grouped counts, toggle your own reaction off' },
      { type: 'new', text: 'Beta code system — separate codes for account registration and group creation; admin can issue codes' },
      { type: 'new', text: 'Mobile-first layout: sidebar slides in via hamburger on small screens; overlay backdrop closes it on tap' },
      { type: 'new', text: 'ARIA labels and accessibility improvements across all pages and navigation' },
      { type: 'improved', text: 'Network-aware UX via useIsOnline hook — offline state shown as a banner; retries deferred until reconnection' },
    ],
  },
  {
    version: '0.1',
    date: 'April 2026',
    label: 'Beta launch',
    summary: 'Initial private beta — the full foundation: groups, events, channels, and the PWA shell.',
    changes: [
      { type: 'new', text: 'Create and manage friend groups — name, description, and member list' },
      { type: 'new', text: 'Plan events with title, date/time, location, description, optional RSVP cap, and private-event flag' },
      { type: 'new', text: 'RSVP to events (Going / Maybe / Not going) with live attendance counts' },
      { type: 'new', text: 'Invite specific members to private events — non-invited members cannot see them' },
      { type: 'new', text: 'Create named channels within a group; open (anyone can join) or invite-only' },
      { type: 'new', text: 'Real-time channel chat powered by Socket.IO with a BullMQ notification worker for fanout' },
      { type: 'new', text: 'Per-channel subscription — join channels you care about; leave ones you don\'t' },
      { type: 'new', text: 'User profiles with display name, bio, and avatar (initials fallback)' },
      { type: 'new', text: 'ICS calendar feed — personal URL that exports your group events to any calendar app' },
      { type: 'new', text: 'Progressive Web App — installable from the browser on iOS and Android; Workbox offline caching' },
      { type: 'new', text: 'Push notification infrastructure — service worker, VAPID keys, subscription upsert endpoint' },
      { type: 'new', text: 'Notification preference system — opt in/out per event type (events, RSVPs, messages) and per channel (push, email)' },
      { type: 'new', text: 'Developer panel for admin users — health checks, Redis and DB status, notification test tools' },
      { type: 'new', text: 'Integration test suite covering auth, events, RSVPs, notifications, and calendar output' },
    ],
  },
]

const badgeStyles: Record<ChangeType, string> = {
  new: 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60',
  improved: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  fixed: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
}

const badgeLabel: Record<ChangeType, string> = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
}

type HealthStatus = 'idle' | 'checking' | 'ok' | 'degraded' | 'error'

function ApiHealthButton() {
  const [status, setStatus] = useState<HealthStatus>('idle')
  const [latency, setLatency] = useState<number | null>(null)

  const check = async () => {
    setStatus('checking')
    setLatency(null)
    const t0 = performance.now()
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/health`)
      const ms = Math.round(performance.now() - t0)
      setLatency(ms)
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setStatus(data.status === 'ok' ? 'ok' : 'degraded')
      } else {
        setStatus('error')
      }
    } catch {
      setLatency(Math.round(performance.now() - t0))
      setStatus('error')
    }
  }

  const statusStyles: Record<HealthStatus, string> = {
    idle: 'text-gray-400',
    checking: 'text-gray-400 animate-pulse',
    ok: 'text-emerald-400',
    degraded: 'text-amber-400',
    error: 'text-red-400',
  }

  const statusLabel: Record<HealthStatus, string> = {
    idle: '',
    checking: 'Checking…',
    ok: `API online${latency !== null ? ` · ${latency} ms` : ''}`,
    degraded: `API degraded${latency !== null ? ` · ${latency} ms` : ''}`,
    error: 'API unreachable',
  }

  return (
    <div className="flex items-center gap-2.5">
      <button
        onClick={check}
        disabled={status === 'checking'}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 border border-gray-700/60 text-gray-300 hover:text-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        API health
      </button>
      {status !== 'idle' && (
        <span className={`text-xs font-medium ${statusStyles[status]}`}>
          {statusLabel[status]}
        </span>
      )}
    </div>
  )
}


function ReleaseRow({ release, isCurrent = false }: { release: Release; isCurrent?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative pl-8">
      {/* Timeline dot */}
      <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-indigo-600 border-2 border-gray-950 shrink-0" aria-hidden="true" />

      {/* Header row — clickable */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-gray-100">v{release.version}</span>
          {isCurrent && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
              Current
            </span>
          )}
          {release.label && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
              {release.label}
            </span>
          )}
          <span className="text-sm text-gray-500 ml-auto">{release.date}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <p className="text-sm text-gray-400 mt-1">{release.summary}</p>
      </button>

      {/* Change list */}
      {open && (
        <ul className="mt-4 space-y-2">
          {release.changes.map((change, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-gray-300">
              <span
                className={`shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${badgeStyles[change.type]}`}
              >
                {badgeLabel[change.type]}
              </span>
              <span className="leading-relaxed">{change.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function UpdatesPage() {
  useEffect(() => {
    document.title = "What's New — GEM"
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      {/* Header */}
      <div className="mb-12 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-100">
          Updates
        </h1>
        <p className="mt-3 text-gray-400">
          GEM is a private social app for friend groups.{' '}
          <a
            href="https://github.com/aidanlenahan/gem"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            View source on GitHub.
          </a>
        </p>
        <p className="mt-1 text-gray-500 text-sm">
          <Link to="/contact" className="text-indigo-400 hover:text-indigo-300 transition-colors">
            Have feedback?
          </Link>
          {' '}We'd love to hear it.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <a
            href="https://status.aidanlenahan.com/status/gem"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 border border-gray-700/60 text-gray-300 hover:text-gray-100 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Status
          </a>
          <ApiHealthButton />
        </div>
      </div>

      {/* Changelog */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-6">What's new</h2>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-800" aria-hidden="true" />

          <div className="space-y-8">
            {releases.map((release, i) => (
              <ReleaseRow key={release.version} release={release} isCurrent={i === 0} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
