import type { ReactNode } from 'react'

export interface HelpArticle {
  slug: string
  title: string
  body: ReactNode
}

export const helpArticles: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started with GEM',
    body: (
      <>
        <p>GEM is a private space for close friend groups — no public feeds, no strangers. Here's how to go from zero to planning in a few minutes.</p>
        <p className="font-medium text-gray-200 mt-3">Step 1 — Join a group</p>
        <p className="mt-1">If a friend invited you, tap the invite link they shared or open GEM, tap <strong>Join a Group</strong>, and enter the invite code. You'll be added as a member instantly.</p>
        <p className="font-medium text-gray-200 mt-3">Step 2 — Or create your own group</p>
        <ol className="list-decimal list-inside space-y-1 mt-1">
          <li>Tap <strong>Create a Group</strong> from the home screen.</li>
          <li>Give your group a name (e.g. "The Crew" or "Book Club").</li>
          <li>Copy the invite link or code and share it with your friends.</li>
        </ol>
        <p className="font-medium text-gray-200 mt-3">Step 3 — Explore your group</p>
        <p className="mt-1">Once you're in a group you'll see three tabs: <strong>Events</strong>, <strong>Channels</strong>, and <strong>Members</strong>. Create an event, join a channel, or invite more people from the Members tab.</p>
        <p className="mt-3 text-gray-500 text-xs">Need help? Email us at help@gem.aidanlenahan.com or visit the Contact page.</p>
      </>
    ),
  },
  {
    slug: 'create-event',
    title: 'Create and manage events',
    body: (
      <>
        <p>Events are the core of GEM — a place to coordinate plans, collect RSVPs, and keep the conversation in one spot.</p>
        <p className="font-medium text-gray-200 mt-3">Creating an event</p>
        <ol className="list-decimal list-inside space-y-1 mt-1">
          <li>Open your group and go to the <strong>Events</strong> tab.</li>
          <li>Tap the <strong>+</strong> button in the top right.</li>
          <li>Fill in a name, date, time, and optional location or description.</li>
          <li>Tap <strong>Create</strong>. All group members will see the event immediately.</li>
        </ol>
        <p className="font-medium text-gray-200 mt-3">RSVPs</p>
        <p className="mt-1">Open an event and tap <strong>Going</strong>, <strong>Maybe</strong>, or <strong>Not going</strong>. You can change your RSVP at any time. Admins can see a full RSVP list from the event page.</p>
        <p className="font-medium text-gray-200 mt-3">Event chat</p>
        <p className="mt-1">Each event has its own chat thread. Use it to share details, directions, or last-minute changes — it stays attached to the event so nothing gets lost.</p>
        <p className="font-medium text-gray-200 mt-3">Legendary events</p>
        <p className="mt-1">Admins can mark special events as <strong>Legendary</strong>. These are starred and highlighted at the top of the events list.</p>
        <p className="mt-3 text-gray-500 text-xs">Events sync to your calendar app via ICS — see <em>Subscribe your calendar to a group</em> for setup instructions.</p>
      </>
    ),
  },
  {
    slug: 'chat',
    title: 'Chat with your friends',
    body: (
      <>
        <p>GEM has two types of chat: <strong>Channels</strong> (topic-based, persistent rooms) and <strong>Event chat</strong> (tied to a specific event).</p>
        <p className="font-medium text-gray-200 mt-3">Channels</p>
        <p className="mt-1">Channels live in your group's <strong>Channels</strong> tab. They're great for ongoing conversations — #general, #planning, #random. Join any open channel by tapping <strong>Join</strong>. Admins can create new channels and make them invite-only if needed.</p>
        <p className="font-medium text-gray-200 mt-3">Event chat</p>
        <p className="mt-1">Open any event and scroll down to find its chat thread. This is the best place for event-specific coordination.</p>
        <p className="font-medium text-gray-200 mt-3">Message features</p>
        <ul className="list-disc list-inside space-y-1 mt-1">
          <li>Tap and hold (or swipe right on mobile) to react, reply, pin, edit, or delete a message.</li>
          <li>Inline replies quote the original message so threads stay clear.</li>
          <li>Pinned messages appear at the top of the channel.</li>
          <li>An unread dot on a channel means there are new messages since your last visit.</li>
        </ul>
        <p className="mt-3 text-gray-500 text-xs">For more detail on channels specifically, see <em>Using channels</em>.</p>
      </>
    ),
  },
  {
    slug: 'updates',
    title: "What's new — seeing GEM updates",
    body: (
      <>
        <p>The GEM team ships updates regularly. Here's how to stay in the loop.</p>
        <p className="font-medium text-gray-200 mt-3">Updates page</p>
        <p className="mt-1">Visit <strong>/updates</strong> (tap the menu and choose <strong>What's New</strong>) for a full changelog of every version — new features, improvements, and fixes, listed newest first.</p>
        <p className="font-medium text-gray-200 mt-3">Version numbers</p>
        <p className="mt-1">GEM uses simple version numbers like v0.9. Each release page describes exactly what changed so you know what's new without having to go hunting.</p>
        <p className="font-medium text-gray-200 mt-3">Stay notified</p>
        <p className="mt-1">Enable push notifications (see <em>Enable push notifications</em>) to receive alerts for new events and messages. Major GEM updates may also be announced via email.</p>
        <p className="mt-3 text-gray-500 text-xs">Have a feature request? Let us know at help@gem.aidanlenahan.com — we read everything.</p>
      </>
    ),
  },
  {
    slug: 'get-help',
    title: 'Getting help and contacting support',
    body: (
      <>
        <p>If you're stuck, something looks wrong, or you just have a question — here's how to get help.</p>
        <p className="font-medium text-gray-200 mt-3">Help center</p>
        <p className="mt-1">You're already here! Browse the how-to guides on this page for step-by-step instructions on all major features. The FAQ section covers common questions about accounts, privacy, and pricing.</p>
        <p className="font-medium text-gray-200 mt-3">Contact us</p>
        <p className="mt-1">For anything not covered here — bugs, account issues, feedback, or general questions — reach out directly:</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Visit the <strong>Contact</strong> page from the menu</li>
          <li>Email <strong>help@gem.aidanlenahan.com</strong></li>
        </ul>
        <p className="mt-3">We're a small team and read every message. You'll usually hear back within a day or two.</p>
        <p className="font-medium text-gray-200 mt-3">Reporting a bug</p>
        <p className="mt-1">When reporting a bug, it helps to include: what you were doing, what you expected to happen, and what actually happened. Screenshots or screen recordings are always welcome.</p>
        <p className="mt-3 text-gray-500 text-xs">GEM is in active development. If something feels off, ask — it might be a known issue we're already working on.</p>
      </>
    ),
  },
  {
    slug: 'install',
    title: 'Install GEM on your phone',
    body: (
      <>
        <p>GEM is a Progressive Web App (PWA) — no app store required.</p>
        <p className="font-medium text-gray-200 mt-3">On iPhone (Safari)</p>
        <ol className="list-decimal list-inside space-y-1 mt-1">
          <li>Open GEM in Safari.</li>
          <li>Tap the Share button (the box with an arrow).</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. GEM now appears on your home screen like a native app.</li>
        </ol>
        <p className="font-medium text-gray-200 mt-3">On Android (Chrome)</p>
        <ol className="list-decimal list-inside space-y-1 mt-1">
          <li>Open GEM in Chrome.</li>
          <li>Tap the three-dot menu (⋮) in the top right.</li>
          <li>Tap <strong>Add to Home screen</strong>, then <strong>Add</strong>.</li>
        </ol>
        <p className="mt-3 text-gray-500 text-xs">Once installed, GEM can send you push notifications for new events and messages even when the app is closed.</p>
      </>
    ),
  },
  {
    slug: 'calendar',
    title: 'Subscribe your calendar to a group',
    body: (
      <>
        <p>GEM generates a personal ICS feed for each group. Paste it into any calendar app to see upcoming events alongside your own schedule — and it updates automatically.</p>
        <ol className="list-decimal list-inside space-y-1 mt-3">
          <li>Open the group page and go to the <strong>Events</strong> tab.</li>
          <li>Tap the calendar icon near the top of the tab.</li>
          <li>Copy your personal ICS URL.</li>
          <li>In your calendar app, choose <strong>Add calendar by URL</strong> (Apple Calendar, Google Calendar, and Outlook all support this) and paste the URL.</li>
        </ol>
        <p className="mt-3 text-gray-500 text-xs">Your ICS URL is personal — it includes a private token. Don't share it publicly. You can regenerate it from Settings if needed.</p>
      </>
    ),
  },
  {
    slug: 'photos',
    title: 'Upload and manage photos',
    body: (
      <>
        <p>You can attach photos to any event your group has created.</p>
        <ol className="list-decimal list-inside space-y-1 mt-3">
          <li>Open an event page.</li>
          <li>Scroll to the <strong>Photos</strong> section and tap the upload button.</li>
          <li>Select one or more images from your device.</li>
          <li>Tap a photo to open the lightbox — from there you can add a caption, download the original, or view EXIF metadata.</li>
        </ol>
        <p className="font-medium text-gray-200 mt-3">Albums</p>
        <p className="mt-1">Group admins can create named albums from the <strong>Photos</strong> tab on the group page. Any photo can be added to one or more albums.</p>
        <p className="mt-3 text-gray-500 text-xs">Each group has a storage quota set by the admin (default 100 MB, up to 1 GB). Storage usage is visible in Group Management → Media.</p>
      </>
    ),
  },
  {
    slug: 'channels',
    title: 'Using channels',
    body: (
      <>
        <p>Channels are persistent group chats that live alongside events. Each group can have multiple channels for different topics.</p>
        <p className="font-medium text-gray-200 mt-3">Joining a channel</p>
        <p className="mt-1">Open the group page, go to the <strong>Channels</strong> tab, and tap <strong>Join</strong> next to any open channel. Invite-only channels require an admin to add you.</p>
        <p className="font-medium text-gray-200 mt-3">Key features</p>
        <ul className="list-disc list-inside space-y-1 mt-1">
          <li>Emoji reactions on any message</li>
          <li>Reply to a specific message with an inline quote</li>
          <li>Pin important messages — they appear at the top of the chat</li>
          <li>Edit or delete your own messages</li>
          <li>Unread dot on channels with new messages since your last visit</li>
        </ul>
        <p className="font-medium text-gray-200 mt-3">On mobile</p>
        <ul className="list-disc list-inside space-y-1 mt-1">
          <li>Tap the hamburger icon inside the chat to slide open the full channel list without leaving the conversation.</li>
          <li>Slide right on any message to bring up actions for that message. You can pin a message, react, or edit and delete the message if it's yours.</li>
        </ul>
      </>
    ),
  },
  {
    slug: 'roles',
    title: 'Group roles and permissions',
    body: (
      <>
        <p>Every group has three roles: <strong>Owner</strong>, <strong>Admin</strong>, and <strong>Member</strong>.</p>
        <ul className="list-disc list-inside space-y-1 mt-3">
          <li><strong>Owner</strong> — the person who created the group. Full control, cannot be removed by admins.</li>
          <li><strong>Admin</strong> — can invite and remove members, promote other members to admin, manage events, delete photos, create albums, and adjust group settings.</li>
          <li><strong>Member</strong> — can create events, RSVP, upload photos, send messages, and join open channels.</li>
        </ul>
        <p className="font-medium text-gray-200 mt-3">Promoting a member</p>
        <p className="mt-1">Go to the group page → Members tab, tap the action button (⋯) next to a member, and choose <strong>Promote to admin</strong>.</p>
      </>
    ),
  },
  {
    slug: 'notifications',
    title: 'Enable push notifications',
    body: (
      <>
        <p>Push notifications let GEM alert you to new events and messages even when the app is closed. They require GEM to be installed as a PWA.</p>
        <ol className="list-decimal list-inside space-y-1 mt-3">
          <li>Install GEM on your home screen (see <em>Install GEM on your phone</em>).</li>
          <li>Open Settings → Notifications.</li>
          <li>Tap <strong>Enable push notifications</strong> and allow the permission prompt.</li>
          <li>Use the toggles to choose which notification types you want (events, messages, group activity).</li>
        </ol>
        <p className="mt-3 text-gray-500 text-xs">If you don't see the enable button, your browser may have previously blocked the permission. Reset it in your browser's site settings and try again.</p>
      </>
    ),
  },
]

export function getArticle(slug: string): HelpArticle | undefined {
  return helpArticles.find((a) => a.slug === slug)
}
