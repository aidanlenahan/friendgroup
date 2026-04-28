# Gem

A web app and installable PWA for friend groups to plan events, chat, and share media — in one place.

## What it does

Most friend groups split coordination across multiple apps: one for scheduling, another for chat, another for photos. Gem consolidates event planning, event-scoped chat, and notifications into a single app, with group membership and permission controls baked in.

**Core features:**

- **Groups** — Create and manage multiple independent groups. Roles: owner, admin, member.
- **Group invites** — Each group has a shareable 12-character invite code. Join requests create a pending membership; owner is notified by email and can approve or deny from the Members tab.
- **Events** — Create events with title, description, date/time, location, tags, and RSVP tracking. Rate events and mark standout ones as legendary.
- **Event chat** — Each event has its own chat room. Supports pinned messages, typing indicators, message reactions, and cursor-paginated history.
- **Tag channels** — Group-level topic channels. Users subscribe to tags they care about; notifications are scoped to matching tags.
- **Notifications** — Web push (VAPID) and email (SMTP). Per-user delivery preferences by type and tag.
- **Media** — Photo/video uploads per event via signed S3 URLs. Per-file and per-event size limits enforced.
- **Calendar export** — ICS export and Google Calendar deep-link per event.
- **User profiles** — Display name, avatar (S3-uploaded), unique username (changeable once per year), and dark/light theme preference.
- **Auth** — Email/password registration with OTP verification, passwordless sign-in via email code, and forgot-password reset flow.
- **Beta access control** — Group creation and registration gateable behind single-use beta codes.
- **PWA** — Installable, service-worker backed, works on mobile.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Headless UI |
| State / data | TanStack Query, Zustand, React Router |
| Backend | Fastify, TypeScript, Zod |
| Realtime | Socket.IO |
| Database | PostgreSQL + Prisma ORM |
| Cache / queues | Redis, BullMQ |
| File storage | S3-compatible (local: MinIO) |
| Email | Nodemailer (SMTP — Gmail App Password or any SMTP server) |
| Push | Web Push (VAPID) |
| Testing | Vitest, Supertest, Playwright |
| PWA | Workbox / vite-plugin-pwa |

## Project structure

```
apps/
  api/          Fastify REST + Socket.IO server
  web/          React + Vite frontend / PWA
packages/
  shared/       Shared TypeScript types and utilities
infra/
  docker-compose.yml    Local Postgres, Redis, MinIO
```

## Local development

**Prerequisites:** Node 20+, Docker

**1. Start infrastructure**

```bash
docker compose -f infra/docker-compose.yml up -d
```

**2. Configure environment**

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Edit `apps/api/.env` and set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` for push notifications. For transactional email, set `SMTP_USER` and `SMTP_PASS` (Gmail App Password works — leave blank to disable email in dev). All other defaults work as-is for local development.

**3. Install dependencies and migrate**

```bash
npm install
npm run db:migrate
```

**4. Start dev servers**

```bash
npm run dev
```

- API: `http://localhost:3000`
- Web: `http://localhost:5173`

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start API and web in parallel |
| `npm run build` | Build both apps |
| `npm run test` | Run all tests |
| `npm run typecheck` | TypeScript check across all workspaces |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Seed the database |
| `npm run db:studio` | Open Prisma Studio |

## Environment variables

See `apps/api/.env.example` and `apps/web/.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `AUTH_SECRET` | JWT signing secret |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push keys (generate with `web-push generate-vapid-keys`) |
| `S3_ENDPOINT` / `S3_BUCKET` | Object storage config |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | SMTP server config (defaults to Gmail — `smtp.gmail.com:465`) |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials (Gmail: use an App Password). Optional in dev |
| `EMAIL_FROM` | Sender address, e.g. `Gem <noreply@example.com>` |
| `GROUP_CREATION_BETA_REQUIRED` | Set to `true` to require beta codes for group creation |
| `BETA_ADMIN_SECRET` | Secret for the `POST /admin/beta-codes` endpoint |
| `VITE_API_BASE_URL` | API base URL used by the frontend |
