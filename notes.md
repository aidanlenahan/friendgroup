# GEM — AI Context Reference
> One-stop reference for AI agents working in this codebase. Generated 2026-04-22.

---

## AI Working Instructions

These rules apply to every coding session in this repo. Follow them without being asked.

### 1. Write a chat dump throughout every session

During every session (or when significant work is done), create a file in `/var/www/friendgroup/tmp/chat/` named with today's date and a short topic slug:

```
/var/www/friendgroup/tmp/chat/YYYY-MM-DD-short-topic-description.txt
```

The file must be **extensive**. Include:
- Date and session title at the top
- Every task attempted and its outcome (done / partial / blocked)
- Every file modified — list each file and summarize what changed and why
- Any new DB migrations created and what they added/changed
- Any new API routes or changes to existing ones
- Any new frontend pages, components, or hooks
- Any bugs found and how they were fixed (root cause, not just "fixed it")
- Build/test status at end of session (`npm run build`, `npm run typecheck`, `npm run test`)
- Services restart status (`sudo systemctl restart friendgroup-api friendgroup-web`)
- Anything left incomplete, blocked, or deferred — with enough context for the next session to pick up cleanly

Use the existing files in `/var/www/friendgroup/tmp/chat/` as formatting reference.

### 2. Cross off completed tasks

Whenever a task is completed, immediately update both files if relevant:
- **`/var/www/friendgroup/tasks.txt`** — change `[ ]` to `[x]`, and add a `DONE <date>` note with a brief summary of what was implemented and which files were changed.
- **`/var/www/friendgroup/TODO.txt`** — change `[ ]` to `[x]` for any matching phase checklist items.

Do not batch this. Mark tasks done as soon as they are done, not at the end of the session.

### 3. Update TECHSTACK.md if the stack changes

If any technology is added, removed, swapped, or significantly reconfigured, update `/var/www/friendgroup/TECHSTACK.md` immediately. Examples that require an update:
- New npm package added for a core concern (not just a dev tool)
- Auth provider, email provider, storage provider, or DB changed
- New architectural layer introduced (e.g. a new queue, a new service)
- A previously planned technology is abandoned

### 4. Update PRD.md if requirements change

If the product requirements shift — new features added to scope, features explicitly descoped, user stories changed, or success metrics updated — update `/var/www/friendgroup/PRD.md`. Do not let the PRD drift from reality.

### 5. Update this file (notes.md) if it becomes stale

If any of the following change, update the relevant section of `/var/www/friendgroup/tmp/notes.md`:
- New API routes added or existing ones changed
- New frontend pages or routes
- Schema changes (new models, new fields, removed fields)
- New environment variables
- Role/permission changes
- New known gotchas or bugs fixed
- Pending items resolved or new ones discovered
- Tech stack changes (mirror what's in TECHSTACK.md)

---

## What This App Is

**Friendgroup** is a mobile-first web app + installable PWA for small-to-medium friend groups (5–200 people) to plan events, chat, and share media — without splitting across multiple apps. Key differentiator: tag-based notification preferences so members only get notified about topics they care about.

**Not a social network.** No public feed. No native apps (PWA first). No advanced moderation tooling in MVP.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Headless UI |
| State / data | TanStack Query (server state), Zustand (client UI state), React Router |
| Backend | Fastify, TypeScript, Zod (validation) |
| Realtime | Socket.IO (event chat rooms + group channel rooms) |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache / queues | Redis 7 (ioredis), BullMQ |
| File storage | S3-compatible: MinIO locally, Cloudflare R2 or AWS S3 in prod |
| Email | Nodemailer + Gmail SMTP App Password (or any SMTP). NOT Resend (was migrated away). |
| Push notifications | Web Push + VAPID (`web-push` package). NOT Firebase. |
| PWA | Workbox / `vite-plugin-pwa`, `injectManifest` strategy |
| Testing | Vitest (unit + integration), Playwright (E2E), Supertest |
| Error tracking | Sentry (`@sentry/node` API, `@sentry/react` frontend) |
| Observability | Pino logging, custom in-process `/metrics` endpoint |

---

## Monorepo Structure

```
/var/www/friendgroup/
  apps/
    api/            Fastify REST API + Socket.IO server (port 3000 / 4000)
    web/            React + Vite frontend / PWA (port 5173)
  packages/
    shared/         Shared TypeScript types and utilities
  infra/
    docker-compose.yml   Local Postgres 16, Redis 7, MinIO
    systemd/             friendgroup-api.service, friendgroup-web.service
  PRD.md            Product requirements
  TECHSTACK.md      Tech stack decisions
  tasks.txt         Feature + bug backlog (priority ordered)
  TODO.txt          Phase-based roadmap (1–11 phases)
  tmp/
    SETUP.md        Full environment setup guide
    chat/           Historical session chat dumps (per-session work logs)
    notes.md        This file
```

**Key single files:**
- `apps/api/src/server.ts` — entire API in one file (all routes, middleware, workers)
- `apps/api/src/lib/chat.ts` — Socket.IO chat server (event rooms + channel rooms)
- `apps/api/src/lib/mailer.ts` — Nodemailer SMTP transport, sendTransactionalEmail()
- `apps/api/src/lib/notifications.ts` — VAPID push, buildNotificationEmail()
- `apps/api/src/lib/calendar.ts` — ICS generation, Google Calendar links
- `apps/api/src/middleware/authorization.ts` — requireGroupMembership, requireRole, canAccessEvent
- `apps/web/src/App.tsx` — all React routes
- `apps/web/src/sw.ts` — service worker
- `apps/web/src/lib/api.ts` — typed API client (ApiError class, retry logic)

---

## Database Schema (Prisma Models)

All models live in `apps/api/prisma/schema.prisma`. PostgreSQL with Prisma ORM. IDs are CUIDs.

**Core models:**

| Model | Key fields | Notes |
|---|---|---|
| `User` | id, email, name, username (unique, yearly change limit), passwordHash, emailVerified, avatarUrl, theme (dark/light) | username changeable once per year max |
| `Group` | id, name, ownerId, description, avatarUrl, inviteCode (12-char hex, unique) | inviteCode auto-generated on creation |
| `Membership` | userId, groupId, role (owner/admin/member), status (active/pending) | pending = join requested, not yet approved |
| `Event` | groupId, createdById, title, details, dateTime, endsAt, isPrivate, maxAttendees, location, isLegendary | tags are M2M relation |
| `RSVP` | eventId, userId, status (yes/no/maybe), updatedAt | unique per eventId+userId |
| `EventRating` | eventId, userId, value (1-5 int) | one per user per event, replaced old `rating` field on Event |
| `EventInvite` | eventId, userId, invitedById | for private event access |
| `Channel` | groupId, name, isInviteOnly | general channel auto-created with every group |
| `ChannelSubscription` | userId, channelId | |
| `Message` | eventId? OR channelId?, userId, content, pinned | nullable eventId/channelId (one or other set) |
| `MessageReaction` | messageId, userId, emoji | unique per messageId+userId+emoji |
| `Tag` | groupId, name, color | tags are group-scoped |
| `UserTagPreference` | userId, tagId, subscribed | |
| `MediaAsset` | eventId, userId, s3Key, mimeType, sizeBytes | image-only; avatars stored as URL on User (not here) |
| `NotificationSubscription` | userId, endpoint, keys (JSON) | VAPID push subscription |
| `UserNotificationPreference` | userId, type, channel (push/email), enabled | |
| `NotificationEvent` | userId, eventId?, type, deliveredAt | log |
| `BetaCode` | code, type (registration/group_creation), usedAt, usedById | one-time use |
| `PasswordResetToken` | userId, token, expiresAt, usedAt | |
| `AuditLog` | groupId, actorId, action, targetUserId, meta | actions: member_joined/approved/denied/removed/role_changed |

---

## Authentication & Authorization

**Auth is fully custom — no Auth.js, no Clerk, no OAuth providers.**

- JWT tokens signed with `AUTH_SECRET` env var (`@fastify/jwt`)
- Password hashing: `scrypt` via Node.js `crypto` module (salt:derivedKey format)
- Email verification: 6-digit OTP stored in Redis (10-min TTL), required before login

**Auth flows:**
1. **Register**: `POST /auth/register` → OTP sent → `POST /auth/verify-email` → JWT
2. **Password login**: `POST /auth/login` (blocks unverified users with 403 `EMAIL_NOT_VERIFIED`)
3. **Passwordless login**: `POST /auth/request-login-code` → `POST /auth/verify-login-code`
4. **Forgot password**: `POST /auth/forgot-password` → email link → `POST /auth/reset-password`
5. **Dev token**: `POST /auth/dev-token` — for seeded dev users (no password needed)

**Authorization middleware (`authorization.ts`):**
- `requireGroupMembership(prisma, userId, groupId)` — must be active member (pending = 403 `MEMBERSHIP_PENDING`)
- `requireRole(role, allowed)` — checks role is in allowed array
- `canAccessEvent(prisma, eventId, userId)` — membership + invite-only check

**Roles:** `owner` > `admin` > `member`
- Owner: only one per group, can do everything including delete group, change owner
- Admin: approve/deny joins, remove members (non-owners), regenerate invite codes, create tags
- Member: RSVP, chat, upload media, tag events with existing tags

---

## Beta Access Control

Registration and group creation can be gated behind single-use beta codes.

**Env flags:**
- `REGISTRATION_BETA_REQUIRED=true` — require beta code on `/auth/register`
- `GROUP_CREATION_BETA_REQUIRED=true` — require beta code on `POST /groups`
- `BETA_ADMIN_SECRET` — secret for `POST /admin/beta-codes` endpoint

**Runtime override:** Registration invite code can be changed without restart via:
- `PATCH /admin/dev/config` → saved to Redis key `admin:registration_invite_code`
- API checks Redis first, falls back to `REGISTRATION_INVITE_CODE` env var

**Code types:** `BetaCode.type` = `"registration"` or `"group_creation"`. One-time use.

---

## Key API Routes

All routes in `apps/api/src/server.ts`. Base: `http://localhost:3000` (dev) or `http://localhost:4000`.

**Auth**
- `POST /auth/register` — firstName, lastName, email, password, betaCode?
- `POST /auth/verify-email` — { userId, code }
- `POST /auth/resend-verification` — { userId } (60s cooldown)
- `POST /auth/login` — email + password
- `POST /auth/request-login-code` — email
- `POST /auth/verify-login-code` — { userId, code }
- `POST /auth/forgot-password` — email
- `POST /auth/reset-password` — { token, password }
- `POST /auth/dev-token` — { userId } (dev only)

**Users**
- `GET /users/me` — current user profile
- `PATCH /users/me` — update name, username (1yr limit), avatarUrl, theme
- `GET /users/:username` — public profile + mutual groups

**Groups**
- `GET /groups` — user's groups
- `POST /groups` — create group (betaCode if required). Auto-creates "general" channel.
- `GET /groups/:groupId` — group details
- `PATCH /groups/:groupId` — edit (admin+)
- `GET /groups/:groupId/members` — admin/owner sees pending; members see active only
- `PATCH /groups/:groupId/members/:userId/role` — change role (owner only)
- `DELETE /groups/:groupId/members/:userId` — remove member
- `POST /groups/:groupId/members/:userId/approve` — approve pending (admin+)
- `POST /groups/:groupId/members/:userId/deny` — deny pending (admin+)
- `GET /groups/:groupId/invite-code` — any active member
- `POST /groups/:groupId/invite-code/regenerate` — admin+
- `POST /groups/join` — { inviteCode } (12-char raw or formatted XXXX-XXXX-XXXX)
- `GET /groups/:groupId/audit-log` — admin+ only
- `GET /groups/:groupId/tags` — list tags
- `POST /groups/:groupId/tags` — create tag (admin+ only, { name, color })
- `PATCH /groups/:groupId/tags/:tagId` — update tag (admin+ only)
- `DELETE /groups/:groupId/tags/:tagId` — delete tag (admin+ only)
- `GET /groups/:groupId/channels` — list channels
- `POST /groups/:groupId/channels` — create channel (admin+, { name, isInviteOnly })
- `GET /groups/:groupId/channels/:channelId/messages` — paginated history

**Events**
- `GET /events` — filtered by groupId and/or date range
- `POST /events` — create event
- `GET /events/:id` — single event with attendance + RSVP status + ratings
- `PATCH /events/:id` — update event
- `DELETE /events/:id` — delete (admin/owner)
- `POST /events/:id/rsvps` — set RSVP status (yes/no/maybe), supports `expectedUpdatedAt` for conflict detection (409 `RSVP_CONFLICT`)
- `PATCH /events/:id/rsvps/:userId` — admin override RSVP
- `GET /events/:id/ratings` — { avgRating, myRating, ratingCount }
- `POST /events/:id/ratings` — { value: 1-5 } (upsert per user)
- `PATCH /events/:id/tags` — { tagIds } — any active member can set tags
- `GET /events/:id/invites` — list invites
- `POST /events/:id/invites` — invite a user
- `GET /events/:id/calendar.ics` — ICS export
- `GET /groups/:groupId/calendar.ics` — group ICS feed
- `GET /events/:id/google-calendar` — Google Calendar deep-link

**Media**
- `POST /media/upload-url` — presigned S3 PUT URL (images only: jpeg/png/gif/webp/heic/heif/avif)
- `POST /media/avatar-upload-url` — presigned PUT for avatar (stored as User.avatarUrl directly)
- `POST /media/complete` — commit upload to DB
- `GET /events/:id/media` — media list for event

**Notifications**
- `POST /notifications/subscribe` — save VAPID push subscription
- `GET /notifications/config` — { pushConfigured, emailConfigured }
- `PUT /notifications/preferences` — update per-type/channel prefs
- `GET /notifications/preferences/tags` — get tag subscriptions for groupId
- `PUT /notifications/preferences/tags/:tagId` — toggle tag subscription
- `POST /notifications/test/push` — test push send
- `POST /notifications/test/email` — test email send

**Admin (developer-only, guarded by `ADMIN_EMAILS` env var)**
- `GET /admin/dev/config` — current config
- `PATCH /admin/dev/config` — change registration invite code at runtime (Redis override)
- `POST /admin/dev/group-codes` — generate group_creation beta codes
- `DELETE /admin/dev/group-codes/:id` — revoke code

**Health / Observability**
- `GET /health` — basic health
- `GET /health/db` — DB connectivity
- `GET /health/redis` — Redis connectivity
- `GET /health/storage` — S3/MinIO connectivity
- `GET /metrics` — in-process metrics (requests, latency p50/p95/p99, BullMQ job counts)

---

## Frontend Routes

All routes in `apps/web/src/App.tsx`. Public routes: `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`. Legacy debug: `/phase-7/debug`, `/phase-9/diagnostics`. All others require auth (JWT in Zustand `authStore`).

| Route | Page |
|---|---|
| `/groups` | GroupsPage — list + create + join |
| `/groups/:groupId` | GroupPage — tabs: events, channels, members |
| `/groups/:groupId/manage` | GroupManagePage — admin panel (members, tags, audit log, danger zone) |
| `/groups/:groupId/events/new` | CreateEventPage |
| `/events/:eventId` | EventPage — details, RSVP, ratings, tags, chat, media, invites |
| `/groups/:groupId/channels/:channelId` | ChannelPage — real-time channel chat |
| `/settings` | SettingsPage |
| `/settings/notifications` | NotificationSettingsPage |
| `/profile` | ProfilePage — edit own profile |
| `/u/:username` | UserProfilePage — public profile + mutual groups |
| `/developer` | DeveloperPage — admin only (ADMIN_EMAILS guard) |

---

## Realtime / Socket.IO

**Event chat rooms** (`chat.ts` createChatServer):
- Join: `join:room { eventId }` → socket joins room `event:{eventId}`
- Send: `message:send { eventId, content }` → persists + broadcasts `message:new`
- Typing: `typing:start eventId` / `typing:stop eventId`
- Reactions: wired to REST endpoints, not socket events

**Channel rooms:**
- Join: `join:channel { channelId, groupId }` → room `channel:{channelId}`
- Send: `channel:message:send { channelId, content }` → broadcasts `channel:message:new`
- Typing: `channel:typing:start channelId` / `channel:typing:stop channelId`

**Rate limiting:** `CHAT_MESSAGE_RATE_LIMIT_PER_MINUTE` env (default 30). In-memory per-user rolling counter. Emits `RATE_LIMITED` socket error with `retryAfterSeconds` when exceeded.

---

## Notifications

**Push:** VAPID via `web-push` package. Keys via `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars. VAPID_SUBJECT must be an `https://` or `mailto:` URI — **not** a `.local` hostname (Apple rejects it).

**Email:** Nodemailer SMTP via `apps/api/src/lib/mailer.ts`.
- Configured by: `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_SECURE` (true), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `isMailConfigured()` returns false when SMTP_USER/SMTP_PASS not set — email silently skipped
- In non-production: always logs email body + code to stdout

**Fanout queue:** BullMQ `notification-fanout` queue (Redis-backed). Uses two dedicated Redis connections (`queueConnection` + `workerConnection`). Both must be closed on graceful shutdown.

**Email send sites in server.ts:**
1. `/auth/register` — registration OTP
2. `/auth/resend-verification` — resend OTP
3. `/auth/request-login-code` — passwordless code
4. `/notifications/test/email` — test endpoint
5. Notification fanout BullMQ worker — push/email on events/chat
6. `/groups/join` — email to group owner on new join request

---

## Media Uploads

Flow: client → `POST /media/upload-url` (get presigned S3 PUT URL) → PUT directly to S3/MinIO → `POST /media/complete` (commit to DB).

**Limits:**
- Per file: `MEDIA_MAX_FILE_BYTES` env (default 10 MB)
- Per event: `MEDIA_MAX_EVENT_BYTES` env (default 200 MB)
- Per user total bytes: `MEDIA_MAX_USER_BYTES` env (default 1 GB)
- Per user file count: `MEDIA_MAX_USER_FILES` env (default 100)

**Allowed MIME types** (images only): `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/heic`, `image/heif`, `image/avif`

**Avatars:** Stored as `User.avatarUrl` (URL string), **not** as `MediaAsset` rows. Old avatar S3 object is deleted on overwrite. Avatar upload uses separate `POST /media/avatar-upload-url` endpoint with `context: 'avatar'`.

---

## Calendar Integration

`apps/api/src/lib/calendar.ts`

- **ICS export**: RFC 5545 compliant. Line folding at 75 octets. `DTEND` uses `event.endsAt` if set, else `dateTime + 2h`. `LOCATION`, `URL`, `SEQUENCE:0` fields included. `DESCRIPTION` omitted when empty.
- **Google Calendar deep-link**: one-click add via `buildGoogleCalendarLink()`
- Three ICS routes: single event, group feed, (calendar sync job)

---

## Background Jobs (BullMQ)

Two queues:
1. `notification-fanout` — push + email dispatch after events/chat. Attempts: 3, exponential backoff.
2. `calendar-sync` — keeps ICS feeds updated.

Both queues use dedicated Redis connections separate from the main `redis` instance.

---

## Environment Variables

**API (`apps/api/.env`):**
```
DATABASE_URL=postgresql://friendgroup:friendgroup@localhost:5432/friendgroup_dev
REDIS_URL=redis://localhost:6379
AUTH_SECRET=<jwt-signing-secret>
VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>
VAPID_SUBJECT=mailto:you@example.com  # must NOT be .local
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=friendgroup-media
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=Friendgroup <noreply@example.com>
REGISTRATION_BETA_REQUIRED=true
REGISTRATION_INVITE_CODE=<12-char-no-dashes>
GROUP_CREATION_BETA_REQUIRED=true
BETA_ADMIN_SECRET=<secret>
ADMIN_EMAILS=admin1@example.com,admin2@example.com  # comma-separated; set in .env
WEB_BASE_URL=http://localhost:5173
SENTRY_DSN_API=   # optional
CHAT_MESSAGE_RATE_LIMIT_PER_MINUTE=30
MEDIA_MAX_FILE_BYTES=10485760
MEDIA_MAX_EVENT_BYTES=209715200
MEDIA_MAX_USER_BYTES=1073741824
MEDIA_MAX_USER_FILES=100
```

**Web (`apps/web/.env`):**
```
VITE_API_BASE_URL=http://localhost:3000
VITE_SENTRY_DSN=   # optional
```

---

## Local Infrastructure

Docker Compose (`infra/docker-compose.yml`):
- **Postgres 16**: port 5432, user `friendgroup`, password `friendgroup`, db `friendgroup_dev`
- **Redis 7**: port 6379
- **MinIO**: port 9000 (API), 9001 (console), root user/pass: `minioadmin/minioadmin`

Start all: `docker compose -f infra/docker-compose.yml up -d`

---

## Development Commands

```bash
npm install              # install all workspace deps
npm run dev              # start API + web in parallel
npm run build            # build both apps
npm run test             # run all tests (Vitest)
npm run typecheck        # tsc check across all workspaces
npm run db:migrate       # Prisma migrate dev
npm run db:seed          # seed DB with demo users/group/tags
npm run db:studio        # Prisma Studio UI
```

**Restart production services:**
```bash
sudo systemctl restart friendgroup-api friendgroup-web
```

---

## Tags System

- Tags are group-scoped (`Tag.groupId`).
- **Only owner/admin** can create/edit/delete tags (`POST /groups/:groupId/tags`).
- **Any active member** can assign tags to an event (`PATCH /events/:id/tags` with `{ tagIds }`).
- Tags drive notification fanout: users subscribed to a tag receive notifications for matching events/messages.
- Tag subscriptions managed in `NotificationSettingsPage` → "Tag Subscriptions" section.
- Tags removed from GroupPage (no longer a tab). Tag management moved to GroupManagePage.

---

## Event Ratings

- **Schema**: `EventRating` table (eventId, userId, value 1–5 int). One rating per user per event (upsert).
- **Old schema** (`Event.rating Int?`) was removed in migration `20260422121405_event_ratings`.
- `GET /events/:id` returns `avgRating` (1 decimal), `myRating`, `ratingCount`.
- UI: 5 amber stars in EventPage. Clicking star upserts via `POST /events/:id/ratings`.
- `isLegendary` field remains on `Event` (manually set by admin/owner).

---

## Invite Code Format

- Stored as raw 12-char hex string in DB (e.g. `a1b2c3d4e5f6`).
- Displayed as `XXXX-XXXX-XXXX` format in UI (formatting is display-only).
- Join modal strips dashes before sending to API.
- Any active member can view/copy the code. Only admin+ can regenerate.
- Regenerating immediately invalidates the old code.

---

## Role & Permission Summary

| Action | Member | Admin | Owner |
|---|---|---|---|
| View group / events | ✅ | ✅ | ✅ |
| Create event | ✅ | ✅ | ✅ |
| RSVP / chat / upload | ✅ | ✅ | ✅ |
| Tag events (existing tags) | ✅ | ✅ | ✅ |
| View invite code | ✅ | ✅ | ✅ |
| Approve/deny join requests | ❌ | ✅ | ✅ |
| Regenerate invite code | ❌ | ✅ | ✅ |
| Remove members | ❌ | ✅ (non-owners) | ✅ |
| Edit group info | ❌ | ✅ | ✅ |
| Create/delete tags | ❌ | ✅ | ✅ |
| Create channels | ❌ | ✅ | ✅ |
| Delete events | ❌ | ✅ | ✅ |
| Change member roles | ❌ | ❌ | ✅ |
| Delete group | ❌ | ❌ | ✅ |

---

## PWA & Service Worker

- Strategy: `injectManifest` via `vite-plugin-pwa`
- Custom service worker at `apps/web/src/sw.ts`
- **Must** include `precacheAndRoute(self.__WB_MANIFEST)` — otherwise production build fails
- Push event listener in service worker
- Offline-first UX: cache-aware loading states, reconnect indicators
- Install promotion UI in app
- Notification permission request flow handled in app

---

## Known Gotchas & Bugs Fixed

- **Auto-approve bug (fixed 2026-04-22)**: `requireGroupMembership` previously only checked if membership existed, not if `status === 'active'`. Pending users could access group resources. Fixed in `authorization.ts`.
- **VAPID subject must not be `.local`**: Apple Web Push rejects VAPID JWT with 403 BadJwtToken when subject uses `.local`. Use `https://` or `mailto:`.
- **Service worker `__WB_MANIFEST` required**: injectManifest strategy requires the Workbox injection point or prod build fails.
- **Two BullMQ Redis connections required**: producer queue + worker each need their own Redis connection with `maxRetriesPerRequest: null`. Both must be closed on shutdown.
- **`rg` (ripgrep) may not be available**: use `grep` instead in terminal commands.
- **Playwright requires system deps on Linux**: run `npx playwright install-deps chromium` (needs sudo) to get `libatk-1.0.so.0` and related libs.
- **`ApiError.data` field**: The `ApiError` class in `apps/web/src/lib/api.ts` has a `data?: Record<string, unknown>` field for structured error body (e.g. `nextAllowedAt` from 422 `USERNAME_CHANGE_TOO_SOON`).
- **GET /events/:id was missing** until 2026-04-14 — only list existed. Now added before the list route.
- **Email previously used Resend** — fully migrated to Nodemailer/SMTP in 2026-04-16. No `RESEND_API_KEY` needed.
- **Services may need manual restart**: `sudo systemctl restart friendgroup-api friendgroup-web` — systemd password auth sometimes fails in automated restart flows.

---

## Pending / Not Yet Done

- [ ] **Recurring events** — no schema support. Needs `recurrenceRule` on Event + RRULE UI
- [ ] **Dev vs prod deployment strategy** — single DB (`friendgroup_dev`) currently. Need separate prod env + `.env.production`
- [ ] **Phase 7 manual device matrix** — iOS Safari / Android Chrome PWA + push validation (not automated)
- [ ] **Cross-browser installability validation** — iOS Safari, Android Chrome, desktop
- [ ] **Manual calendar client testing** — Google Calendar, Apple Calendar, Outlook
- [ ] **Per-asset media ratings** — distinct from event-level ratings
- [ ] **Alternative verification channels** — WhatsApp/Telegram/SMS (very low priority)
- [ ] **Mute members** — not yet implemented
- [ ] **Profile picture uploads confirmed working** — endpoint exists, overwrite behavior partially confirmed

---

## Data Seeding

```bash
npm run db:seed   # seeds demo users, groups, tags
```

Dev users without passwords can authenticate via `POST /auth/dev-token { userId }`.

To reset/add beta codes via SQL:
```sql
INSERT INTO "BetaCode" (id, code, type, "createdAt")
VALUES (gen_random_uuid(), 'YOURCODEHERE', 'registration', NOW())
ON CONFLICT (code) DO UPDATE SET "usedAt" = NULL, "usedById" = NULL;
```

---

## Frontend State Management

- **Zustand** (`authStore`) — JWT token, user object. Persisted in localStorage.
- **TanStack Query** — all server state. `staleTime: 30_000`. No retry for 401/403/404. Retries (max 3) for 429/5xx/network errors with exponential backoff. Honors `Retry-After` header for 429.
- **`ApiError` class** — typed error from `apiFetch()`. Fields: `status`, `code` (string error code), `message`, `retryAfterSeconds`, `data` (raw body for structured errors).

---

## Testing

- **API unit tests**: `apps/api/src/__tests__/` — calendar.unit, notifications.unit, validation.unit
- **API integration tests**: events.integration, notifications.integration, phase9.integration, calendar.integration (uses real DB + testcontainers)
- **Frontend unit/integration**: Vitest + Testing Library — Phase7DebugPage.test, Phase9DiagnosticsPage.test
- **E2E**: Playwright (`apps/web/e2e/phase9-smoke.spec.ts`) — mobile viewport smoke, PWA push flow

Run all tests: `npm run test`
Run E2E: `npm --workspace apps/web run test:e2e`

---

## Admin / Developer Panel

Route: `/developer` (UI-guarded by `ADMIN_EMAILS` list, server-guarded by `requireAdminEmail()` middleware).

Accessible only to emails in `ADMIN_EMAILS` env var (comma-separated list set in `apps/api/.env`). Never commit real addresses.

Three tabs:
1. **Config** — view/change registration invite code (runtime Redis override), view group creation codes
2. **Phase 7 Debug** — push notification and service worker debug tools
3. **Phase 9 Diagnostics** — API connectivity and system diagnostics

---

## PRD Summary (Goals)

1. Lightweight event planning for friend groups
2. Organized conversations by event and tag/topic channels
3. Reduce notification fatigue through tag-based preferences
4. Media memories tied to events
5. Work as responsive website and installable PWA

**MVP scope is complete.** All phases 1–11 are implemented. App is in beta (access-gated by codes).
