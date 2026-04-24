# Friendgroup Tech Stack

## Architecture
- Frontend: React + TypeScript + Vite (single app powering web + PWA shell)
- Backend API: Node.js + TypeScript + Fastify
- Realtime: Socket.IO for chat and live event updates
- Database: PostgreSQL (primary relational store)
- Cache/queues: Redis (presence, rate limits, background jobs)
- File storage: S3-compatible object storage for event media

## Frontend
- React 19 + TypeScript
- Vite for fast builds/dev server
- React Router for app navigation
- TanStack Query for server-state caching and sync
- Zustand for lightweight client UI state
- Tailwind CSS + Headless UI for accessible components

## PWA and Notifications
- Service worker + manifest via Workbox/Vite PWA plugin
- Web Push with VAPID keys (`web-push` package)
- Notification preference center in app (push/email toggles by type/tag)

## Backend
- Fastify for HTTP API
- Zod for request/response schema validation
- Socket.IO namespaces/rooms for event chat + tag channels
- BullMQ (Redis-backed) for async jobs (email sends, notification fanout)

## Data and Persistence
- PostgreSQL + Prisma ORM
- Core tables: users, groups, memberships, events, event_invites, rsvps, channels, messages, tags, user_tag_prefs, media_assets, notification_subscriptions, notification_events
- Redis for ephemeral presence/session helpers and queue transport

## Authentication and Authorization
- Auth: custom email/password registration + OTP email codes (no external auth service)
- Authorization: role-based access (owner/admin/member) at group and channel level

## Calendar Integration
- ICS generation/export using `ical-generator`
- Google Calendar deep-links for one-click add
- Webhook/job strategy for keeping updated ICS feeds in sync

## Email
- Transactional transport: Nodemailer via direct SMTP
- Default provider: Gmail SMTP with an App Password (port 465 / SMTPS)
- Any SMTP server supported via `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` env vars
- Inline HTML templates — no external template dependency

## DevOps and Hosting
- Frontend hosting: Vercel or Netlify
- Backend hosting: Fly.io, Railway, or Render
- Managed Postgres: Neon/Supabase/RDS
- Managed Redis: Upstash/Redis Cloud
- Object storage: Cloudflare R2/S3

## Observability
- Logging: Pino
- Error tracking: Sentry
- Metrics: OpenTelemetry + hosted dashboard (Grafana Cloud or equivalent)

## Testing
- Unit: Vitest
- API integration: Supertest + testcontainers (Postgres)
- E2E: Playwright
- Contract validation: Zod schemas shared between client/server

## Security Baseline
- Input validation on all writes
- Rate limiting (auth, messaging, notification endpoints)
- Signed upload URLs for media
- Encryption in transit + at rest via provider defaults
- Secrets in environment variables only (`.env` not committed)

## Why This Stack
- TypeScript end-to-end lowers schema drift risk.
- Fastify + Postgres + Redis scales well for chat + event workloads.
- React/Vite + PWA support gives fast web and installable app from one codebase.
- Queue-backed notifications avoid blocking request paths.