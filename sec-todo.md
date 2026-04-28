# sec-todo.md — Friendgroup Security Hardening

> Sourced from sec-gen-todo.md and a full audit of the codebase.
> Every task references the exact file(s) and lines affected.
> Tasks are prioritized P0 (critical, fix immediately) through P5 (purely optional).
> Do not begin any task until intentionally started.

---

## P0 — Critical: Must Fix Before Any Real Users

---

### [x] No expiry on issued JWTs

All `reply.jwtSign` calls in `apps/api/src/server.ts` (lines 896, 1050, 1130, 1191) sign tokens with no `expiresIn` option. Every issued JWT is valid until the `AUTH_SECRET` changes. A stolen or leaked token grants permanent access with no way to invalidate it short of rotating the signing secret. Add `expiresIn: '7d'` (or shorter) to all `reply.jwtSign` calls. Since there are no refresh tokens today, consider `expiresIn: '30d'` as a transition value that still bounds exposure, and note that refresh token rotation is a separate P2 task below.

DONE 2026-04-28: Added JWT_EXPIRES_IN (default 7d), applied expiresIn to all auth token issuance routes.

---

### [x] AUTH_SECRET has a hardcoded insecure fallback

`apps/api/src/server.ts` line ~713:
```
secret: process.env.AUTH_SECRET || "dev-secret-change-me"
```
`apps/api/src/lib/chat.ts` line ~83 passes the same value to the Socket.IO JWT verifier. If `AUTH_SECRET` is absent from the production environment, this known public string becomes the signing secret and any attacker can forge arbitrary JWTs. Remove the fallback string entirely. On startup, throw if `AUTH_SECRET` is not set or is shorter than 32 characters.

DONE 2026-04-28: Removed fallback, now requires AUTH_SECRET and min 32 chars.

---

### [x] JWT access tokens stored in localStorage (XSS-accessible)

`apps/web/src/lib/api.ts` lines 120–129: `getToken()` and `setToken()` read and write `fg_token` to `localStorage`. `apps/web/src/stores/authStore.ts` uses Zustand's `persist` middleware, which serializes the full auth state (including the token) to `localStorage` under the key `fg-auth`. Any XSS vulnerability on the frontend, including a compromised dependency, gives full token exfiltration. Move the access token to Zustand in-memory state only (remove `persist` from authStore, or strip the `token` field from the persisted slice). Store only non-sensitive session state (user display info) in localStorage.

DONE 2026-04-28: Moved token from localStorage to in-memory only.

---

### [x] Content Security Policy completely disabled

`apps/api/src/server.ts` line 704:
```
await app.register(helmet, { contentSecurityPolicy: false });
```
This removes the primary browser-enforced XSS mitigation. Combined with tokens in `localStorage`, any XSS can exfiltrate credentials immediately. Re-enable CSP in the helmet config with a starting policy. A practical starting point for this stack:
```
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"],
    connectSrc: ["'self'", "wss://<api-domain>"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
  },
},
```
Use `Content-Security-Policy-Report-Only` first in staging to catch violations before enforcing. The frontend is a Vite/React app with no inline scripts, so `'unsafe-inline'` in `script-src` is not needed.

DONE 2026-04-28: Re-enabled CSP via helmet with restrictive directives.

---

### [x] CORS falls back to allowing all origins when WEB_BASE_URL is unset

`apps/api/src/server.ts` line ~708:
```
origin: process.env.WEB_BASE_URL ?? true,
```
When `WEB_BASE_URL` is missing, `true` instructs `@fastify/cors` to echo back the request's `Origin` header with `credentials: true`, which effectively allows any origin to make credentialed cross-origin requests. Replace with an explicit allowlist:
```ts
origin: (process.env.WEB_BASE_URL ?? "").split(",").map(s => s.trim()).filter(Boolean),
credentials: true,
methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
```
Throw on startup if `WEB_BASE_URL` is not set.

DONE 2026-04-28: Added explicit CORS allowlist.

---

### [x] /auth/dev-token endpoint active in production

`apps/api/src/server.ts` lines ~848–875. This endpoint issues a valid JWT for any existing user given only their email address — no password, no OTP. It is rate-limited but not environment-gated. In production this is a full authentication bypass for any user whose email is known. Add an early return at the start of the route handler:
```ts
if (process.env.NODE_ENV === "production") {
  return reply.status(404).send({ error: "Not found" });
}
```

DONE 2026-04-28: Returns 404 in production.

---

### [x] /metrics endpoint has no authentication

`apps/api/src/server.ts` line 779. The `/metrics` route is publicly accessible and returns queue depths, error bucket counts, latency percentiles, Sentry environment, and worker state. This leaks internal operational detail to unauthenticated callers. Add `requireAuth` and `requireAdminEmail` as preHandlers, or move the route under the existing `/admin/` prefix so it inherits that guard.

DONE 2026-04-28: Added admin auth preHandler.

---

## P1 — High: Important Before Real-User Traffic

---

### [x] Pino logger logs Authorization headers and sensitive request fields

`apps/api/src/server.ts` line ~316:
```ts
const app = Fastify({ logger: true });
```
Fastify's default Pino serializer logs the full request object including headers. `Authorization: Bearer <token>` will appear in logs on every authenticated request. Configure the Pino logger with redact:
```ts
const app = Fastify({
  logger: {
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "body.password",
        "body.token",
        "body.code",
        "body.otp",
        "body.betaCode",
        "body.calendarToken",
      ],
      censor: "[REDACTED]",
    },
  },
});
```

DONE 2026-04-28: Added logger redaction configuration for sensitive request data.

---

### [x] Sentry captures request bodies and auth headers without scrubbing

`apps/api/src/server.ts` lines ~318–328 (API Sentry.init) and `apps/web/src/main.tsx` lines 15–22 (frontend Sentry.init). Neither init call includes a `beforeSend` hook. Sentry can capture and transmit full request bodies (which may include passwords, OTP codes, and tokens) and `Authorization` headers to Sentry's servers. Add a `beforeSend` hook to both:
```ts
beforeSend(event) {
  if (event.request?.data) delete event.request.data;
  if (event.request?.cookies) delete event.request.cookies;
  if (event.request?.headers?.authorization) {
    event.request.headers.authorization = "[REDACTED]";
  }
  return event;
},
```

DONE 2026-04-28: Added API Sentry scrubbing via beforeSend.

---

### [x] invite-only channel access check missing in Socket.IO handler

`apps/api/src/lib/chat.ts` lines 286–318 (`join:channel` event handler). The handler verifies that the user is an active group member and that the channel belongs to the group, but it does NOT check `channel.isInviteOnly` or whether the user has a `ChannelSubscription` record. Any group member can join any invite-only channel by emitting `join:channel` with its ID, bypassing the intended access restriction. Add after the channel fetch:
```ts
if (channel.isInviteOnly) {
  const sub = await prisma.channelSubscription.findUnique({
    where: { userId_channelId: { userId: user.id, channelId } },
  });
  if (!sub) {
    socket.emit("error", { code: "FORBIDDEN", message: "Not subscribed to this channel" });
    return;
  }
}
```

DONE 2026-04-28: Enforced invite-only channel access in join:channel.

---

### [x] Math.random() used for beta code generation

`apps/api/src/server.ts` line 3398:
```ts
const code = `${body.type.slice(0, 3).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
```
`Math.random()` is not cryptographically secure. This branch is reached when generating bulk codes (count > 1) or when no custom code is provided to `POST /admin/beta-codes`. Replace with the same pattern already used elsewhere in the file:
```ts
const code = randomBytes(6).toString("hex").toUpperCase().slice(0, 12);
```

DONE 2026-04-28: Replaced with crypto randomBytes.

---

### [x] Calendar webhook secret is optional with no fallback protection

`apps/api/src/server.ts` lines ~2590–2600 (POST /calendar/sync/webhook):
```ts
const expectedSecret = process.env.CALENDAR_WEBHOOK_SECRET;
const providedSecret = request.headers["x-calendar-webhook-secret"];
if (expectedSecret) {
  if (typeof providedSecret !== "string" || providedSecret !== expectedSecret) {
    return reply.status(403).send(...);
  }
}
```
If `CALENDAR_WEBHOOK_SECRET` is not set, the `if (expectedSecret)` block is skipped and anyone can trigger calendar sync queue jobs without any authorization. This can be used for queue flooding. Make the secret required: throw on startup if it is absent, or fall back to requiring a valid JWT (add `requireAuth` when no CALENDAR_WEBHOOK_SECRET is configured).

DONE 2026-04-28: Endpoint now always enforces x-calendar-webhook-secret.

---

### No per-account lockout on repeated failed login attempts

`apps/api/src/server.ts` lines ~1098–1135 (POST /auth/login). The rate limit is `{ max: 10, timeWindow: "1 minute" }` per IP (or user ID, but at login time the user is not authenticated, so `request.ip` is the actual key). A distributed attacker using 10 IPs can attempt 100 passwords per minute against a single account with no per-account throttle. Add a Redis counter keyed to the email: `login:failures:{email}`. After 10 consecutive failures within any rolling 15-minute window, return `429` with a `Retry-After` of 30 minutes and refuse to compare the password at all until the lockout expires.

---

### trustProxy not configured — IP-based rate limiting uses proxy IP

`apps/api/src/server.ts` lines ~719–724 (`@fastify/rate-limit` registration). The `keyGenerator` falls back to `request.ip`. When deployed behind a reverse proxy (Fly.io, Railway, Nginx), `request.ip` resolves to the proxy's IP, making all requests appear to originate from the same source and collapsing per-IP rate limits to a global shared limit. Register Fastify with `{ trustProxy: true }` (as a top-level option to `Fastify({...})`) and pass `trustProxy: true` to the rate-limit plugin options so `X-Forwarded-For` is read instead.

---

## P2 — Medium: Address Before Public Launch

---

### OTP codes stored as plaintext in Redis

`apps/api/src/server.ts`: OTP codes are stored raw in Redis:
- `redis.setex(`verify:email:${user.id}`, 600, otpCode)` (email verification)
- `redis.setex(`login:code:${user.id}`, 600, otpCode)` (passwordless login)

If Redis is compromised or its memory is snapshotted, all active OTPs are exposed. Hash the code before storing using `createHash("sha256").update(otpCode).digest("hex")`. On verification, hash the submitted code the same way before comparing with `===`.

---

### File type validated only by user-declared MIME, not by magic bytes

`apps/api/src/server.ts` lines ~1497 and ~1612. Both the upload-url generation and the media complete endpoints validate `body.mimeType` against `allowedMediaMimeTypes`, but this value is supplied by the client in the request body — the actual uploaded bytes are never inspected. A user can declare `image/jpeg` and upload a valid PNG or any other content. Install the `file-type` npm package. In the `POST /media/complete` handler (or in a post-upload BullMQ validation job), fetch the first 16 bytes of the newly-uploaded S3 object and confirm the detected type matches an allowed image type. Delete the object and return `415` if it does not.

---

### User-controlled content not HTML-escaped in outgoing email templates

Multiple `sendTransactionalEmail` calls in `apps/api/src/server.ts` interpolate user-provided data directly into HTML strings:
- Group join email (~line 2998): `currentUser.name`, `currentUser.email`, `group.name`
- Member approval email (~line 3090): `group.name`
- Member denial email (~line 3148): `group.name`
- Password reset email (~line 1230): no user-controlled content, safe

If a user registers with a display name containing `<img src=x onerror=alert(1)>`, that payload renders as HTML in the recipient's email client. Add a small `escapeHtml()` helper that replaces `&`, `<`, `>`, `"`, `'` with their HTML entities, and apply it to every user-controlled value before embedding it in the HTML email string.

---

### Zod schemas do not reject unknown/extra fields (mass-assignment risk)

`apps/api/src/lib/validation.ts` — `validateRequest` calls `schema.parseAsync()`. Zod's default behavior on objects is to strip unknown keys silently rather than reject the request. This means an attacker can probe whether extra fields are silently accepted and processed by the DB. Apply `.strict()` to schemas for all database-write operations: `updateUserBodySchema`, `updateGroupBodySchema`, `updateEventBodySchema`, `createEventBodySchema`, `registerBodySchema`. Routes that touch financial or privilege-escalation fields are the highest priority.

---

### [x] Avatar objects use public-read ACL inconsistently with media assets

`apps/api/src/server.ts` line ~1638:
```ts
const putCommand = new PutObjectCommand({
  Bucket: s3Bucket,
  Key: objectKey,
  ACL: "public-read",
  ...
});
```
Avatar uploads are signed with `ACL: "public-read"`, making every avatar URL permanently public to anyone who knows or guesses the URL. Event media assets use `ACL: "private"`. A user who leaves a group or is removed retains public access to their avatar if anyone retained the URL. Switch avatars to `ACL: "private"` and serve them through the `/media/proxy/*` endpoint that is already planned in `tasks.txt` (the avatar proxy task). This also ensures the access pattern is consistent with media assets.

DONE 2026-04-28: Changed to private.

---

### HTML injection risk via group/event names in Socket.IO notification bodies

`apps/api/src/server.ts` — notification fanout queue payloads embed raw user-controlled event titles and user names into `title` and `body` fields (e.g. `title: \`New event: ${event.title}\``). These fields reach Sentry logs, push notification payloads, and email subject lines. Although currently the frontend renders these as text (no innerHTML), this is a defense-in-depth gap. Strip or encode angle brackets and HTML entities from user-controlled strings before embedding them in notification payloads.

---

### Refresh token rotation not implemented

P0 ("No expiry on issued JWTs") explicitly deferred refresh token rotation to P2 as a follow-up task, but that task is absent from this document. The app currently issues a single JWT with no mechanism to invalidate it short of rotating `AUTH_SECRET`. Implement a short-lived access token (15 minutes) paired with a long-lived refresh token (7–30 days) stored in an `HttpOnly; Secure; SameSite=Strict` cookie. On each refresh request, atomically delete the old refresh token hash from Redis and issue a new one. On reuse detection (an already-invalidated refresh token is presented), delete all refresh tokens for that user (`DEL refresh:{userId}:*`) and force re-login. Changes required: add `POST /auth/refresh` to `apps/api/src/server.ts`, update `apps/web/src/lib/api.ts` to intercept 401 responses and attempt a silent refresh before retrying, and update `apps/web/src/stores/authStore.ts` to hold the access token in Zustand memory only (no persistence), relying on the `HttpOnly` cookie for session continuity across page reloads.

---

### Socket.IO event payloads not validated with Zod

`apps/api/src/lib/chat.ts` — all socket event handlers (`message:send`, `channel:message:send`, `join:event`, `join:channel`, `leave:event`, `leave:channel`, `typing:start`, `typing:stop`) use manual `typeof` checks for basic type validation but do not use Zod schemas. Specific gaps: `eventId` and `channelId` are checked as strings but not validated as UUIDs, so a crafted non-UUID string hits the database lookup without pre-validation; `content` is silently truncated at 4000 characters rather than being rejected with an error (allowing oversized payloads to pass through); `groupId` in `join:channel` receives no UUID check either. Add Zod schemas for each event type (e.g., `z.object({ eventId: z.string().uuid(), content: z.string().min(1).max(4000) })`) and call `.parse()` at the start of each handler, replacing the current manual checks and returning a structured error on failure.

---

### Chat rate limiter uses in-process memory — not Redis-backed

`apps/api/src/lib/chat.ts` lines 51–73: `consumeChatQuota()` uses a module-level `Map<string, { windowStartMs, count }>`. This means: (1) rate limits reset on every server restart or deploy, allowing a brief abuse window immediately after deployments; (2) in any multi-instance deployment, each process maintains independent counters, multiplying the effective allowed rate by the number of instances; (3) the map grows unbounded as users connect and is never evicted, creating a memory leak risk over time. Replace with a Redis-backed sliding window counter using `INCR` + `EXPIRE` on a key like `chat:quota:{userId}` with a 60-second TTL. The ioredis `redis` client instance is already available in `apps/api/src/server.ts` and can be passed into `createChatServer` alongside the existing arguments.

---

### OTP verification endpoints lack per-code failure invalidation

`apps/api/src/server.ts` lines 1033 (`POST /auth/verify-email`, `max: 20, timeWindow: "1 minute"`) and 1161 (`POST /auth/verify-login-code`, `max: 10, timeWindow: "1 minute"`). Both endpoints apply only IP-based rate limiting. There is no counter that invalidates the OTP after N consecutive failed attempts for a given user. A distributed attacker operating across many source IPs can attempt substantially more than the per-IP limit before the 10-minute OTP expiry. Add a Redis counter `otp:failures:{userId}` that increments on each failed verification attempt. After 5 failures, delete the stored OTP key immediately (invalidating it) and return a 429 instructing the user to request a new code. Reset the failure counter on successful verification or when a new OTP is issued.

---

## P3 — Moderate: Address in First Post-Launch Sprint

---

### HSTS not explicitly configured in helmet registration

`apps/api/src/server.ts` line 702. The `@fastify/helmet` plugin is registered with `contentSecurityPolicy: false` and no other explicit options. Helmet v13's defaults may include HSTS, but it is not verified or explicitly configured. Add:
```ts
hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
```
to the helmet options. Verify the header is present on production responses with `curl -sI https://<api-domain>/health | grep -i strict`.

---

### Permissions-Policy header not explicitly configured

`apps/api/src/server.ts` line 702. No `Permissions-Policy` header is explicitly set. This app does not use camera, microphone, geolocation, or payment APIs. Add to the helmet registration:
```ts
permissionsPolicy: {
  camera: [],
  microphone: [],
  geolocation: [],
  payment: [],
},
```

---

### npm audit not part of any CI/CD pipeline

No CI configuration files were found in the workspace. At minimum, add a local `package.json` script and document that it must be run before deployments:
```json
"scripts": {
  "audit:security": "pnpm --recursive audit --audit-level=high"
}
```
Longer term, add a GitHub Actions workflow step that runs `pnpm --recursive audit --audit-level=high` on every push and blocks merge on findings.

---

### All dependency versions use ^ semver ranges (supply chain risk)

`apps/api/package.json` and `apps/web/package.json` — every production dependency uses a `^` range (e.g. `"fastify": "^5.8.4"`). This means a `pnpm install` after a lockfile deletion or on a fresh CI runner can pull in a newer minor version. The committed `pnpm-lock.yaml` (if it exists) mitigates this, but the `^` in `package.json` still allows drift. Consider pinning exact versions for production dependencies in both packages, especially for security-sensitive packages: `@fastify/jwt`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/helmet`.

---

### Log injection not mitigated — user content with newlines in log output

`apps/api/src/lib/chat.ts` and `apps/api/src/server.ts` — user-provided message content and names are passed directly to Pino log calls without stripping `\n` or `\r`. A user can craft a message like `"normal message\n[ERROR] admin logged in from 1.2.3.4"` to inject false log entries. Before logging any user-controlled value, sanitize it: `content.replace(/[\r\n\t]/g, " ")`.

---

### TanStack Query cache not cleared on logout

`apps/web/src/stores/authStore.ts` — `logout()` calls `setToken(null)` and clears Zustand state, but does not clear TanStack Query's cache. All in-memory cached API responses (group lists, member lists, event data) persist after logout. A user who logs out on a shared device and then a second person opens the app could see the previous user's cached data before fresh API calls are made. In the `logout()` function, also call `queryClient.clear()`. The query client reference can be passed to the store or accessed via a singleton.

---

### Vite production source maps setting not verified

`apps/web/vite.config.ts` — the source map setting for production builds is not visible in the workspace configuration review. If `build.sourcemap: true` is present, the original TypeScript source will be served alongside the production bundle and readable by anyone via browser DevTools. Verify the Vite config has `build: { sourcemap: false }` (or `'hidden'`) for production. `'hidden'` still generates maps for private error tracking use but does not reference them from the bundle.

---

### SPF, DKIM, and DMARC not configured for the sending email domain

Infrastructure/DNS task. The current sending address uses Gmail SMTP configured via `SMTP_USER`. Without SPF/DKIM/DMARC on the sending domain, outgoing emails (OTP codes, password resets, group invites) are likely to land in spam, and the domain is spoofable. Once the permanent subdomain is live and `noreply@<subdomain>` is configured:
- SPF: add `v=spf1 include:_spf.google.com ~all` (if keeping Gmail) or the sending provider's SPF record
- DKIM: enable via Gmail admin or the SMTP provider's configuration
- DMARC: add `v=DMARC1; p=quarantine; rua=mailto:dmarc@<subdomain>`

---

### Redis connection uses plaintext redis:// scheme in production

`apps/api/src/server.ts` — `new Redis(process.env.REDIS_URL || "redis://...")`. If the managed Redis provider supports TLS (Upstash, Redis Cloud both do), the `REDIS_URL` should use the `rediss://` scheme (note double-s), which enables TLS encryption in transit. The same applies to `queueConnection` and `workerConnection`. Verify the `REDIS_URL` value in the production environment uses `rediss://` or explicitly pass `tls: {}` in the ioredis options.

---

### Database connection SSL mode not enforced

`apps/api/src/server.ts` line ~57:
```ts
const pool = new Pool({ connectionString });
```
The `pg.Pool` is initialized from `DATABASE_URL` without any SSL enforcement. On managed Postgres providers (Neon, Supabase, RDS), SSL is typically required, but if the connection string lacks `?sslmode=require` (Neon/Supabase) or if `ssl: true` is not set in the pool config, the connection may silently fall back to plaintext. Add `ssl: { rejectUnauthorized: true }` to the Pool options, or ensure `DATABASE_URL` includes `?sslmode=require`.

---

### Admin routes lack defense-in-depth beyond email check

`apps/api/src/server.ts` — `requireAdminEmail()` checks that the authenticated user's email is in `ADMIN_EMAILS`. Once P0 (JWT in localStorage) is fixed, the primary vector is reduced. However, there is no additional verification for admin operations (no IP allowlist, no re-authentication, no rate limiting stricter than regular routes). As defense-in-depth: add a per-request check against `ADMIN_ALLOWED_IPS` env var, and apply a tighter rate limit (e.g. `max: 20, timeWindow: "1 minute"`) to all `/admin/*` routes.

---

### Secret scanning not in the CI pipeline

No evidence of a secret scanning step in CI. Add TruffleHog or `git-secrets` as a pre-commit hook or CI step to catch accidentally committed secrets. At minimum, run `git log --all --full-history -- '*.env'` and `grep -rn "AUTH_SECRET\|SMTP_PASS\|VAPID_PRIVATE\|S3_SECRET" .` manually across the full git history to confirm no secrets have been committed.

---

### SAST not included in CI pipeline

The P3 tasks already include `npm audit` and secret scanning, but no static application security testing (SAST) tool is configured. `apps/api/src/server.ts` and `apps/api/src/lib/chat.ts` are large, AI-generated files that benefit from automated analysis for patterns such as unvalidated redirects, missing authorization checks, and injection sinks. Add Semgrep as a GitHub Actions step running on every pull request with the `p/owasp-top-ten` and `p/nodejs` rulesets (free tier). Alternatively, enable CodeQL (free for public repos, available under GitHub Advanced Security for private repos). Block merges when new high-severity findings are introduced by the PR diff.

---

### No security-focused unit or integration tests for auth/authz boundaries

No test file in the workspace verifies that protected resources reject unauthorized access. This is especially critical given the number of AI-generated route handlers in `apps/api/src/server.ts` that implement their own ownership checks. Add Vitest + supertest tests covering at minimum: unauthenticated requests return 401, a non-member requesting group-scoped data returns 403, a member of group A cannot read group B's events or messages (IDOR check), a `member` role cannot perform `admin`-role actions, and the `/auth/dev-token` route returns 404 in a production environment simulation. These tests should run in the existing `apps/api` test setup against a real Postgres instance (testcontainers or a local test DB) so that Prisma query behavior is accurately validated.

---

### Nodemailer envelope control not explicitly guarded

`apps/api/src/lib/mailer.ts` lines 49–53: `transporter.sendMail({ from, ...opts })`. The `opts` object is assembled entirely by server code (not passed directly from user input), which is the correct pattern. However, a CVE disclosed in 2026 demonstrates that a user-controlled `envelope.size` parameter enables SMTP command injection in Nodemailer. Verify with `grep -rn "envelope" apps/api/src/` that no call site passes an `envelope` key within `opts`. Additionally, confirm the `to` field in every `sendTransactionalEmail` call is an email address retrieved from the database that was previously validated with `z.string().email()` at registration — not a raw request field. This is currently the case, but the confirmation should be documented and maintained as the mailer grows.

---

## P4 — Low: Address Over Time

---

### Database user privileges not confirmed to be least-privilege

`apps/api/src/server.ts` line ~57 — the `DATABASE_URL` is used without confirming the Postgres user it references has minimal permissions. On managed providers, the default user is often a superuser-equivalent. Create a dedicated application user with only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the specific application tables (not the `information_schema` or system catalogs). Use a separate migration-only user (with DDL rights) exclusively for running `prisma migrate deploy` in CI/CD, never in the running application.

---

### S3 bucket policy does not restrict key prefixes at the IAM/bucket level

`apps/api/src/server.ts` — presigned URLs are generated with application-side key path construction (e.g. `avatars/${currentUser.id}/...` and `${event.id}/...`). However, if the signing IAM credentials are leaked, they can generate presigned URLs for any key in the bucket. Add a bucket-level condition to the IAM role policy restricting `s3:PutObject` to keys matching `avatars/*` and `*/media/*`. Also enable S3 Object Lock or Versioning to protect against accidental overwrites.

---

### Prisma connection pool not configured with explicit limits

`apps/api/src/server.ts` line ~57:
```ts
const pool = new Pool({ connectionString });
```
No `max` connection count is set. Under load spikes, the pool will attempt to open as many connections as needed, which can exhaust the Postgres provider's connection limit (Neon free tier allows ~100) and cause a cascading denial of service. Set `max: 10` (or appropriate for your hosting tier) and `idleTimeoutMillis: 30000` in the `pg.Pool` options.

---

### Malware scanning not implemented for uploaded media

`apps/api/src/server.ts` — images uploaded via POST /media/complete are stored in S3 and immediately visible to all group members. There is no malware or content scanning. Add an async BullMQ job triggered by the `/media/complete` handler that: fetches the uploaded object, scans it with ClamAV (self-hosted) or AWS Malware Protection, and either marks the asset as `safe` (adding a `status` field to `MediaAsset`) or deletes it. Make the media list endpoint filter to only `safe` assets.

---

### Push subscription endpoint domain not validated

`apps/api/src/server.ts` — POST /notifications/subscribe validates `endpoint` as a URL but does not check its domain against known push service providers. An attacker could register any arbitrary URL as a push endpoint. Add a domain whitelist check after the URL parse:
```ts
const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "notify.windows.com"];
const domain = new URL(body.endpoint).hostname;
if (!allowed.some(d => domain === d || domain.endsWith("." + d))) {
  return reply.status(400).send({ error: "Invalid push endpoint domain" });
}
```

---

### BullMQ queue names lack an application prefix

`apps/api/src/server.ts` — queues are named `"notification-fanout"` and `"calendar-sync"` with no application-level prefix. If the Redis instance is shared with other services or if a second environment uses the same Redis, queue names will collide. Use BullMQ's `prefix` option:
```ts
new Queue("notification-fanout", { connection: queueConnection, prefix: "{friendgroup}" });
```
This also simplifies Redis ACL configuration to `~{friendgroup}:*`.

---

### Rotate platform tokens and credentials on a schedule

Infrastructure/operational task. Fly.io deploy tokens, Vercel/Netlify deploy hooks, Neon/Supabase database passwords, S3/R2 access keys, Gmail App Password, VAPID keys, and `AUTH_SECRET` should all be rotated on a documented schedule (e.g., every 90 days) and immediately on any team member departure. Establish a rotation runbook that covers each credential and how to update the corresponding environment variable without downtime.

---

### S3 PutObjectCommand does not specify server-side encryption

`apps/api/src/server.ts` lines 1531 and 1644: both `PutObjectCommand` calls construct the command without a `ServerSideEncryption` field. If the bucket does not have a default encryption policy enforced at the bucket level, uploaded objects may be stored without server-side encryption at rest. Add `ServerSideEncryption: "AES256"` to both PutObjectCommand calls to enforce SSE-S3 regardless of bucket-level defaults. If the storage backend is Cloudflare R2, encryption at rest is enabled by default — verify this is the case by checking the R2 bucket settings and document the confirmation so it is not re-questioned in future audits.

---

### Row-level security on managed Postgres not enabled

The project uses a managed Postgres provider (Neon, based on connection string patterns and `tmp/SETUP.md`). Neon supports PostgreSQL row-level security. Enabling RLS on key tables (`Membership`, `Event`, `Message`, `MediaAsset`, `NotificationSubscription`) means that even if a future bug introduces a raw or unchecked query, the database itself enforces per-user access control as a second line of defense. Implement a dedicated application role with RLS policies on each sensitive table, enforcing `user_id = current_setting('app.current_user_id')::text`. Pass the authenticated user ID via `SET LOCAL app.current_user_id = $1` at the start of each transaction. This does not replace application-level checks but limits the blast radius of any authorization regression.

---

### Staging environment does not mirror production security configuration

`infra/docker-compose.yml` provides a local development environment only; there is no documented staging environment with production-equivalent security settings. As a result, CSP enforcement, HTTPS-only cookies, CORS allowlists, Redis authentication, and rate limiting behavior are not tested together before each production deploy. Set up a persistent staging environment (a separate Fly.io app, Neon branch, and staging Redis instance) with its own environment variables mirroring production security configuration. Run the Playwright E2E suite in `apps/web/e2e/` against staging before every production deploy to catch regressions introduced by new features.

---

### PWA service worker may cache API-adjacent JS that bypasses logout

`apps/web/vite.config.ts` — the Workbox `globPatterns: ['**/*.{js,css,html,ico,png,svg}']` precaches all JS bundles. After a user logs out, the service worker continues to serve the cached JS and the browser may serve stale React component trees that still reference old query cache state before TanStack Query's `queryClient.clear()` runs. Additionally, verify that no `runtimeCaching` rule in the Workbox config caches responses from the API (`/api/*` or `wss://` WebSocket handshakes) — runtime caching of authenticated API responses would allow a second user on a shared device to see the prior user's data served from the service worker cache without a network request. Add an explicit `runtimeCaching` entry that uses `NetworkOnly` strategy for all API routes to prevent this.

---

## P5 — Optional / Nice-to-Have

---

### HSTS preload list submission

Once HSTS is explicitly configured (P3) and the permanent production domain has been stable for at least 8 weeks, submit to [hstspreload.org](https://hstspreload.org). This instructs browsers to use HTTPS exclusively for the domain before the first visit, preventing SSL stripping attacks on first contact. Preload requires `max-age` of at least 31536000 and `includeSubDomains`.

---

### Application-level encryption for private messages

Messages in the `messages` table are stored as plaintext UTF-8. If the database is directly accessed (compromised credentials, provider breach), all chat history is immediately readable. For high-sensitivity deployments, add column-level AES-256-GCM encryption via a Prisma middleware that transparently encrypts on write and decrypts on read. This is a significant implementation undertaking and only warranted if the app handles genuinely private communications beyond friend group coordination.

---

### Secrets manager for credential management

All secrets are currently injected as environment variables from the hosting platform's config. Migrating to a secrets manager (Doppler, HashiCorp Vault, AWS Secrets Manager) would provide: centralized audit logs of who accessed each secret, automatic rotation workflows, and clear access control by service. The highest-value secrets to migrate first would be `AUTH_SECRET`, `SMTP_PASS`, `VAPID_PRIVATE_KEY`, and `S3_SECRET_ACCESS_KEY`.

---

### Software composition analysis with Dependabot or Snyk

Enable Dependabot on the GitHub repository to auto-open PRs for dependency version updates and known CVEs. Alternatively, add Snyk as a CI step for deeper analysis including transitive dependency vulnerabilities and license compliance. The most critical packages to watch are `@fastify/jwt`, `socket.io`, `nodemailer`, `@aws-sdk/client-s3`, and `bullmq`.

---

### VAPID key rotation procedure documented

`apps/api/src/server.ts` — VAPID keys are loaded from `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` env vars. Rotating them invalidates all existing push subscriptions, requiring all users to re-subscribe. Document a rotation runbook and build a front-end flow that detects a 410/404 response on the next push and prompts the user to re-subscribe. The existing stale subscription cleanup (delete on 410) handles the server side; the client side needs a recovery path.

---

### OTel trace ID injection into Pino log entries

`apps/api/src/server.ts` — Pino logs and OpenTelemetry traces are currently separate. Injecting the active trace ID into each Pino log entry allows correlating a user's request across all log lines without logging PII as the correlation key. Add the OpenTelemetry Pino instrumentation package and configure a `mixin` in the Pino options to append `{ traceId, spanId }` to each log entry.

---

### Log retention policy establishment

Pino logs shipped to an external log management service (not yet confirmed) may contain user email addresses, IP addresses, and activity patterns — all potentially PII under GDPR. Establish a written retention policy (e.g., 90 days) and configure automatic log expiry in the log management platform. Document what data appears in logs and how it is handled.

---

### WAF not configured in front of API or frontend

No Web Application Firewall is part of the documented production infrastructure. A CDN-level WAF (Cloudflare free tier covers most of what is needed) would block common attack signatures — SQL injection patterns, XSS payloads, credential stuffing bots, and volumetric DDoS — before they reach the Fastify application layer. Configure Cloudflare in front of both the frontend domain and the API domain. Enable at minimum: Bot Fight Mode, the OWASP Core Rule Set (managed ruleset), and a rate limiting rule targeting `POST /auth/*` endpoints to 10 requests per minute per IP at the CDN edge. This provides a meaningful additional layer of protection even if an application-level vulnerability is later discovered.

---

### Production database and Redis connections not confirmed on private network

`apps/api/src/server.ts` lines 58 and 62–95: `DATABASE_URL` and `REDIS_URL` accept any connection string. It is not documented or enforced that the production Postgres (Neon) and Redis instances are accessible only from the API server and not from the public internet. Confirm that the Neon project has IP allowlisting configured to permit connections only from the production server's IP or CIDR range. Confirm that the Redis instance (Upstash or similar) is likewise restricted to the API server's IP. If deployed on Fly.io, configure Postgres and Redis access via Fly.io's internal private network (`.internal` DNS addresses) so they are unreachable from any external IP. Document the confirmed network topology so it is not left ambiguous.
