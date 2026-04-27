# Cybersecurity Hardening Checklist for Vibe-Coded Apps

> **How to use this document:** Every `[ ]` is an actionable task. Sub-bullets provide exact implementation steps. This document has two parts: (1) a general vibe-coding security checklist, and (2) stack-specific hardening for your Friendgroup project.
> Do not start on these tasks until instructed to do so.

***

# PART 1: General Vibe-Coded App Security Hardening

*Sources: OWASP Top 10 2025, CSA Secure Vibe Coding Guide, Replit Security Checklist, Escape.tech audit findings, Checkmarx, Aikido.dev, Kiuwan, astoj/vibe-security, SoftwareMill, simonroses.com, domainoptic.com, codegeeks.solutions, serenitiesai.com, gitlab.com, cisco.com, penetolabs.com, aunimeda.com, ateamsoftsolutions.com, owasp.org, github.com/0xRadi/OWASP-Web-Checklist* [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

***

## 🔐 Section 1: Secrets & Credentials Management

- [ ] **Never hardcode secrets, API keys, or credentials in source code**
  - Grep your entire repo: `grep -ri "api_key\|secret\|password\|token" *.ts *.js *.env` and audit every hit
  - Use `.env` files locally and inject environment variables at runtime in production
  - Add `.env`, `.env.local`, `.env.production` to `.gitignore` immediately — verify with `git check-ignore -v .env`
  - Scan git history for accidentally committed secrets: `git log --all --full-history -- '*.env'` and use `git-secrets` or `truffleHog` to scan the full history
  - If a secret was ever committed, rotate it immediately — even if the commit was later deleted, it remains in git history [reddit](https://www.reddit.com/r/vibecoding/comments/1r10bk8/the_vibe_coding_security_checklist_7_critical/)

- [ ] **Use a secrets manager in production rather than raw env vars**
  - Options: AWS Secrets Manager, Doppler, HashiCorp Vault, Infisical
  - Never log environment variables: audit all `console.log(process.env)` or `logger.info(process.env)` calls and remove them [blogs.cisco](https://blogs.cisco.com/ai/announcing-new-framework-securing-ai-generated-code)

- [ ] **Scope credentials to least privilege**
  - Database users should only have `SELECT`, `INSERT`, `UPDATE`, `DELETE` on their specific tables — never `DROP`, `ALTER`, or superuser access
  - S3/R2 IAM roles should be scoped to specific buckets and actions only (`s3:PutObject`, `s3:GetObject`) — not `s3:*`
  - Rotate all credentials on a schedule (e.g., 90 days) and immediately upon any team member departure [afine](https://afine.com/sql-injection-in-the-age-of-orm-risks-mitigations-and-best-practices)

- [ ] **Audit all `NEXT_PUBLIC_` / `VITE_` prefixed env vars exposed to the browser**
  - Any variable prefixed with `VITE_` in a Vite project is bundled into the client JS and readable by anyone
  - Never put secrets, private API keys, or service-role tokens in `VITE_` variables — only public keys (e.g., VAPID public key, analytics IDs) belong there [geeksforgeeks](https://www.geeksforgeeks.org/reactjs/how-to-secure-a-vite-powered-react-app/)

***

## 🧱 Section 2: Authentication

- [ ] **Hash all passwords with bcrypt or Argon2 before storage — never store plaintext or MD5/SHA1 hashes**
  - Use `bcrypt` with a cost factor of at least 12, or `argon2id` with recommended parameters (memory: 64MB, iterations: 3, parallelism: 4)
  - Verify that your registration and password-reset flows both hash before writing to the DB [aunimeda](https://aunimeda.com/blog/owasp-top-10-2025-web-security-guide)

- [ ] **Implement short-lived JWTs with refresh token rotation**
  - Access tokens: 15-minute expiry maximum
  - Refresh tokens: store in `HttpOnly`, `Secure`, `SameSite=Strict` cookies — never in `localStorage` or `sessionStorage`
  - On every refresh, issue a new refresh token and immediately invalidate the old one (token rotation)
  - Implement refresh token reuse detection: if an already-invalidated token is submitted, invalidate the entire token family and force re-login [reddit](https://www.reddit.com/r/node/comments/1ad9i9p/jwt_auth_best_practices/)

- [ ] **Enforce account lockout and brute-force protection on login endpoints**
  - Lock account for 15–30 minutes after 5–10 failed attempts, or use progressive delays (exponential backoff)
  - Log all failed login attempts with IP, timestamp, and user agent for anomaly detection [aunimeda](https://aunimeda.com/blog/owasp-top-10-2025-web-security-guide)

- [ ] **Implement secure OTP/magic-link flows**
  - OTP codes must be cryptographically random (`crypto.randomBytes`), not `Math.random()`
  - OTPs must expire (5–10 minutes max) and be single-use — invalidate immediately after successful use
  - Rate-limit OTP generation per email address per hour to prevent email-bombing [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Verify email ownership before granting full account access**
  - Send a verification email with a signed, time-limited token upon registration
  - Restrict unverified accounts from accessing sensitive features [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Protect password reset flows from enumeration**
  - Return the same response ("If that email exists, you'll receive a reset link") regardless of whether the email exists in the DB
  - Password reset tokens must be single-use and expire within 1 hour [penetolabs](https://penetolabs.com/owasp-top-10-checklist-for-securing-modern-web-applications/)

***

## 🔒 Section 3: Authorization & Access Control (OWASP A01:2025)

- [ ] **Enforce authorization checks at the resource level, not just the route level**
  - Every database query that returns user-owned data must include a `WHERE userId = authenticatedUserId` clause or equivalent ownership check
  - Never trust user-supplied `userId`, `groupId`, `eventId` etc. from request bodies or URL params — always derive the subject from the verified JWT/session [reddit](https://www.reddit.com/r/vibecoding/comments/1r10bk8/the_vibe_coding_security_checklist_7_critical/)

- [ ] **Audit every API endpoint for IDOR (Insecure Direct Object Reference) vulnerabilities**
  - Test: can user A access user B's data by changing an ID in the URL? (e.g., `GET /api/events/42` — does it check that the requesting user is a member of that event's group?)
  - Use UUIDs instead of sequential integers for resource IDs to make enumeration harder (though this is defense-in-depth, not a substitute for auth checks) [simonroses](https://simonroses.com/2026/04/the-owasp-top-10-for-vibe-coded-applications-part-2/)

- [ ] **Implement and test Role-Based Access Control (RBAC) exhaustively**
  - Define explicit allow-lists of what each role (owner/admin/member/unauthenticated) can do per resource
  - Write automated tests for every permission boundary — test that a `member` cannot perform `admin` actions, that an `admin` of group A cannot access group B's resources, etc. [github](https://github.com/astoj/vibe-security)

- [ ] **Never expose admin routes or dashboards without multi-factor protection**
  - Admin endpoints should require a separate, elevated auth check (e.g., re-authentication + IP allowlist)
  - Grep for unprotected admin patterns: `grep -ri "admin\|superuser\|isAdmin" src/` and verify every route has a middleware guard  [reddit](https://www.reddit.com/r/vibecoding/comments/1r10bk8/the_vibe_coding_security_checklist_7_critical/)

- [ ] **Apply the principle of least privilege to all service accounts and API consumers**
  - Third-party integrations should only receive scoped API keys with the minimum required permissions
  - Revoke unused API keys and integrations on a regular schedule [blogs.cisco](https://blogs.cisco.com/ai/announcing-new-framework-securing-ai-generated-code)

***

## 💉 Section 4: Injection Prevention (OWASP A05:2025)

- [ ] **Never concatenate user input directly into SQL queries**
  - Always use parameterized queries or ORM methods
  - For raw SQL in Prisma, use tagged template syntax: `` prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}` `` — never `$queryRawUnsafe()` with user input
  - Audit all raw query calls: `grep -r "\$queryRawUnsafe\|$executeRawUnsafe" src/`  [prisma](https://www.prisma.io/docs/orm/more/best-practices)

- [ ] **Sanitize all user-provided input before rendering in HTML (XSS prevention)**
  - Never use `dangerouslySetInnerHTML` in React without sanitizing with `DOMPurify` first
  - If rich text/HTML from users must be rendered, whitelist allowed tags and attributes using `DOMPurify.sanitize(html, { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] })`
  - Audit all `dangerouslySetInnerHTML` usages: `grep -r "dangerouslySetInnerHTML" src/` [dev](https://dev.to/ashutoshsarangi/implementing-security-in-front-end-applications-react-5a33)

- [ ] **Validate all inputs with a schema validation library on the server side**
  - TypeScript types are erased at runtime — a user can send any JSON payload regardless of your TS types
  - Use Zod (or equivalent) to validate and parse every incoming request body, query parameter, and path parameter before processing [codesignal](https://codesignal.com/learn/courses/secure-input-validation-in-web-applications-2/lessons/secure-server-side-validation-with-typescript-1)

- [ ] **Prevent Header Injection and SMTP Command Injection in email flows**
  - Sanitize all user-controlled inputs used in email `To:`, `From:`, `Subject:` fields
  - Validate email addresses with a proper RFC-compliant regex or `zod.string().email()` before passing to Nodemailer
  - Never allow users to control the `envelope` object passed to Nodemailer — a known SMTP injection vector [vulert](https://vulert.com/vuln-db/nodemailer-has-smtp-command-injection-due-to-unsanitized--envelope-size--parameter)

- [ ] **Prevent Log Injection**
  - Sanitize user-controlled data before including it in log messages (strip newline characters `\n`, `\r`)
  - Veracode 2025 data found an 88% log injection failure rate in AI-generated code [simonroses](https://simonroses.com/2026/04/the-owasp-top-10-for-vibe-coded-applications-part-2/)

***

## 🛡️ Section 5: Security Headers

- [ ] **Set `Content-Security-Policy` (CSP) headers**
  - Start with a restrictive policy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://yourdomain.com;`
  - Use CSP Report-Only mode first to catch violations without breaking the app: `Content-Security-Policy-Report-Only`
  - Use nonces for any inline scripts rather than `'unsafe-inline'` [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Set `Strict-Transport-Security` (HSTS)**
  - Header value: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - Submit your domain to the HSTS preload list at [hstspreload.org](https://hstspreload.org) once you're confident in your HTTPS setup [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Set `X-Content-Type-Options: nosniff`**
  - Prevents MIME-type sniffing attacks where the browser interprets a non-JS file as executable JavaScript [geeksforgeeks](https://www.geeksforgeeks.org/reactjs/how-to-secure-a-vite-powered-react-app/)

- [ ] **Set `X-Frame-Options: DENY`**
  - Prevents your app from being embedded in iframes on other sites (clickjacking defense)
  - Modern alternative: CSP `frame-ancestors 'none'` [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Set `Referrer-Policy: strict-origin-when-cross-origin`**
  - Prevents sensitive URL parameters (tokens, IDs) from leaking in the `Referer` header to third-party sites [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Set `Permissions-Policy` to disable unused browser APIs**
  - Example: `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Remove server fingerprinting headers**
  - Remove `X-Powered-By`, `Server` headers to avoid revealing your tech stack to attackers
  - In Fastify, this is handled by `@fastify/helmet` — verify it's configured [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

***

## 🌐 Section 6: CORS Configuration

- [ ] **Never set `Access-Control-Allow-Origin: *` for authenticated API endpoints**
  - Maintain an explicit allowlist of trusted origins
  - Example: `origin: ['https://yourdomain.com', 'https://app.yourdomain.com']`
  - Verify CORS config by grepping: `grep -r "origin.*\*\|cors" src/` and auditing each instance  [reddit](https://www.reddit.com/r/vibecoding/comments/1r10bk8/the_vibe_coding_security_checklist_7_critical/)

- [ ] **Set `Access-Control-Allow-Credentials: true` only when necessary and only with specific origins**
  - Combining `credentials: true` with a wildcard origin (`*`) is forbidden by browsers but can be misconfigured in some frameworks [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Restrict allowed HTTP methods and headers in CORS config**
  - Only allow the methods your API actually uses: `methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']`
  - Don't use `allowedHeaders: '*'` — enumerate explicitly [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

***

## ⚡ Section 7: Rate Limiting & Anti-Abuse

- [ ] **Apply rate limiting to every public-facing API endpoint, not just auth**
  - Authentication endpoints: very tight limits (e.g., 5 requests/15 minutes per IP)
  - OTP/password reset: 3–5 requests/hour per email address
  - General API: 100–300 requests/minute per authenticated user
  - Messaging/notification endpoints: limit per user per minute to prevent spam [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Use sliding window or token bucket algorithms for rate limiting on Redis**
  - Fixed window counters can be gamed at window boundaries
  - Redis-based rate limiting ensures limits are shared across all server instances (horizontal scaling) [redis](https://redis.io/tutorials/howtos/ratelimiting/)

- [ ] **Implement rate limiting at the infrastructure level as well (CDN/load balancer)**
  - Application-level rate limiting can be bypassed if an attacker floods connections before your app code runs
  - Use Cloudflare, AWS WAF, or your hosting provider's DDoS protection as a first line of defense [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Return `429 Too Many Requests` with a `Retry-After` header when limits are exceeded**
  - Don't silently drop requests or return confusing 500 errors [reddit](https://www.reddit.com/r/Backend/comments/1s9kdj4/how_to_properly_implement_rate_limiting/)

***

## 📁 Section 8: File Upload Security

- [ ] **Validate file type by magic bytes (file signature), not just extension or MIME type**
  - A user can rename `malware.exe` to `photo.jpg` — check the actual file header bytes
  - Use a library like `file-type` (npm) to detect the real file type from the buffer [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Set maximum file size limits and enforce them server-side**
  - Don't rely on frontend validation — always validate size on the server before accepting the upload
  - Return a clear `413 Payload Too Large` error for oversized files [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Never serve user-uploaded files from the same origin as your app**
  - Serve uploads from a separate domain/subdomain (e.g., `media.yourapp.com` or a CDN) to isolate XSS from malicious file content
  - Set `Content-Disposition: attachment` for file downloads to prevent the browser from executing content inline [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Scan uploaded files for malware if they will be served to other users**
  - Integrate a scanning service (e.g., ClamAV, AWS Malware Protection for S3) for any user-uploaded documents [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Use signed upload URLs — never expose your storage credentials directly to the client**
  - Generate pre-signed upload URLs server-side with minimal expiry (5–15 minutes)
  - Validate that the uploaded file's content-type, size, and key match what was authorized before making it accessible [docs.aws.amazon](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/overview.html)

***

## 🔑 Section 9: Cryptography & Data Protection (OWASP A04:2025)

- [ ] **Use TLS 1.2+ for all connections — disable TLS 1.0 and 1.1**
  - Verify at: [https://www.ssllabs.com/ssltest/](https://www.ssllabs.com/ssltest/)
  - Enable HSTS to prevent protocol downgrade attacks [github](https://github.com/0xRadi/OWASP-Web-Checklist)

- [ ] **Encrypt sensitive fields at rest at the application level for highly sensitive data**
  - PII like phone numbers, private messages, health data should be encrypted at the column level using AES-256-GCM
  - Encryption at the provider/disk level is not sufficient protection if your database credentials are compromised [penetolabs](https://penetolabs.com/owasp-top-10-checklist-for-securing-modern-web-applications/)

- [ ] **Never roll your own cryptography**
  - Use established libraries: `bcrypt`/`argon2` for passwords, Node.js built-in `crypto` module (SubtleCrypto or `crypto.createCipheriv`) for other crypto needs
  - Never use `Math.random()` for anything security-related — always use `crypto.randomBytes()` [aunimeda](https://aunimeda.com/blog/owasp-top-10-2025-web-security-guide)

- [ ] **Use cryptographically secure random tokens for all security-sensitive tokens**
  - Password reset tokens, email verification tokens, calendar tokens, invite codes: all must use `crypto.randomBytes(32).toString('hex')` or similar [aunimeda](https://aunimeda.com/blog/owasp-top-10-2025-web-security-guide)

***

## 📋 Section 10: Input Validation & Schema Hardening

- [ ] **Validate ALL inputs at the API boundary — every route, every field**
  - Never assume a field is the right type just because TypeScript says so — TypeScript types are compile-time only
  - Validate: data types, lengths (min/max), formats (email regex, UUID format), allowed values (enums), numeric ranges [oneuptime](https://oneuptime.com/blog/post/2026-01-25-zod-validation-typescript/view)

- [ ] **Reject and don't silently strip unexpected fields (strict mode validation)**
  - With Zod, use `.strict()` on objects to reject payloads with unknown keys instead of silently ignoring them
  - Overly permissive schemas allow mass-assignment vulnerabilities [oneuptime](https://oneuptime.com/blog/post/2026-01-25-zod-validation-typescript/view)

- [ ] **Set maximum length constraints on all string fields**
  - Without length limits, an attacker can send multi-megabyte strings to cause denial-of-service or memory exhaustion
  - Example: `z.string().max(500)` for messages, `z.string().max(100)` for names [codesignal](https://codesignal.com/learn/courses/secure-input-validation-in-web-applications-2/lessons/secure-server-side-validation-with-typescript-1)

- [ ] **Validate and sanitize URL parameters — don't trust route params**
  - A UUID param should be validated as a UUID before hitting the database: `z.string().uuid()`
  - Integer IDs should be validated as positive integers: `z.number().int().positive()` [oneuptime](https://oneuptime.com/blog/post/2026-01-25-zod-validation-typescript/view)

***

## 🪵 Section 11: Logging, Monitoring & Observability

- [ ] **Never log sensitive data: passwords, tokens, PII, credit card numbers, SSNs**
  - Configure log redaction to automatically strip sensitive fields
  - In Pino: use the `redact` option: `pino({ redact: ['req.headers.authorization', 'body.password', 'body.token'] })` [blog.lepape](https://blog.lepape.me/nodejs-best-practices-redacting-secrets-from-pino-logs/)

- [ ] **Log all security-relevant events with sufficient context**
  - Events to log: login success/failure, logout, password change, failed authorization attempts, OTP generation, account lockout, admin actions, privilege escalation attempts
  - Each log entry must include: timestamp (ISO 8601), user ID (if authenticated), IP address, request ID, action, outcome [penetolabs](https://penetolabs.com/owasp-top-10-checklist-for-securing-modern-web-applications/)

- [ ] **Store logs in a tamper-resistant, centralized location**
  - Don't store security logs only on the application server — ship them to an external SIEM or log management service immediately
  - Attackers who compromise a server will delete local logs [github](https://github.com/astoj/vibe-security)

- [ ] **Set up alerts for anomalous activity**
  - Alert on: >10 failed login attempts from same IP in 5 minutes, access to admin endpoints from new IPs, sudden spike in 5xx errors, mass data access patterns (e.g., a user fetching 1000+ records at once) [penetolabs](https://penetolabs.com/owasp-top-10-checklist-for-securing-modern-web-applications/)

- [ ] **Set Sentry/error tracking to scrub sensitive data from error reports**
  - Configure `beforeSend` hook in Sentry to strip request headers, body contents, and cookies from error payloads before they're sent to Sentry's servers
  - Never let full request bodies (which may contain passwords/tokens) appear in your error tracking dashboard [reddit](https://www.reddit.com/r/node/comments/1o3z1bw/definitive_guide_to_production_grade/)

***

## 📦 Section 12: Dependency & Supply Chain Security (OWASP A03:2025)

- [ ] **Run `npm audit` or `pnpm audit` in your CI/CD pipeline on every push**
  - Block merges if high/critical vulnerabilities are found
  - Optionally use `npm audit --audit-level=high` to only fail on high+ severity [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Pin dependency versions in `package.json` (avoid `^` and `~` for production deps)**
  - Use exact versions or a lockfile (`package-lock.json` / `pnpm-lock.yaml`) committed to the repo
  - Unpinned dependencies can pull in malicious versions during `npm install` (supply chain attack) [kiuwan](https://www.kiuwan.com/blog/ai-code-security/)

- [ ] **Use a software composition analysis (SCA) tool**
  - Integrate Snyk, Dependabot, or Socket.dev to automatically open PRs for vulnerable dependency updates [checkmarx](https://checkmarx.com/blog/ai-is-writing-your-code-whos-keeping-it-secure/)

- [ ] **Audit and minimize your dependency tree**
  - Every dependency is an attack surface — remove unused packages with `npx depcheck`
  - Prefer well-maintained packages with active security disclosure programs [kiuwan](https://www.kiuwan.com/blog/ai-code-security/)

- [ ] **Verify package integrity with lockfile checksums**
  - Never delete and regenerate your lockfile without reviewing the diff — unexpected changes can indicate a supply chain compromise [blogs.cisco](https://blogs.cisco.com/ai/announcing-new-framework-securing-ai-generated-code)

***

## 🔧 Section 13: Error Handling & Information Disclosure

- [ ] **Never return stack traces, internal paths, or database error messages to API clients in production**
  - Return generic error messages: `{ "error": "An internal error occurred" }` with a unique request/error ID
  - Log the full error internally but never expose it externally [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Set `NODE_ENV=production` in all production environments**
  - Many frameworks (including Fastify) disable verbose error output automatically in production mode [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Do not expose API documentation (Swagger/OpenAPI) endpoints in production without authentication**
  - If you have a `/docs` route, put it behind a middleware that requires authentication or IP allowlisting [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Avoid enumeration in all user-facing responses**
  - "User not found" vs "Wrong password" tells attackers which emails are registered — return "Invalid credentials" for both cases
  - Same principle applies to API key lookups, group invite codes, etc. [penetolabs](https://penetolabs.com/owasp-top-10-checklist-for-securing-modern-web-applications/)

***

## 🔒 Section 14: Session & Cookie Security

- [ ] **Set `HttpOnly` flag on all session and refresh token cookies**
  - Prevents JavaScript (and therefore XSS) from reading the cookie value [dev](https://dev.to/ajitforger97/building-refreshing-jwt-tokens-in-nodejs-a-complete-guide-3g8g)

- [ ] **Set `Secure` flag on all cookies**
  - Ensures cookies are only sent over HTTPS connections [dev](https://dev.to/ajitforger97/building-refreshing-jwt-tokens-in-nodejs-a-complete-guide-3g8g)

- [ ] **Set `SameSite=Strict` or `SameSite=Lax` on cookies**
  - `SameSite=Strict` prevents the cookie from being sent on any cross-site request (strongest CSRF protection)
  - `SameSite=Lax` allows top-level navigations but blocks cross-site AJAX/fetch requests [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Implement CSRF protection for any state-changing requests that use cookie-based auth**
  - If you use cookie-based sessions (refresh tokens in cookies), add a CSRF token (double-submit cookie pattern or synchronizer token)
  - With `SameSite=Strict` cookies, CSRF risk is significantly reduced but not eliminated for all browser/OS combinations [geeksforgeeks](https://www.geeksforgeeks.org/reactjs/how-to-secure-a-vite-powered-react-app/)

***

## 🌐 Section 15: HTTPS & Transport Security

- [ ] **Enforce HTTPS on all endpoints — redirect all HTTP traffic to HTTPS**
  - Configure your hosting provider (Vercel, Fly.io, etc.) to redirect HTTP→HTTPS automatically
  - Never transmit credentials, tokens, or sensitive data over plain HTTP [github](https://github.com/0xRadi/OWASP-Web-Checklist)

- [ ] **Verify TLS certificate validity and enable automatic renewal**
  - Most managed platforms handle this, but verify in your hosting dashboard
  - Set up monitoring/alerts for certificate expiry (alert at 30 days, 7 days remaining) [github](https://github.com/0xRadi/OWASP-Web-Checklist)

- [ ] **Enable HSTS preloading after verifying your entire domain is on HTTPS**
  - Submit to the HSTS preload list only when you are certain no subdomains need HTTP [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

***

## 🏗️ Section 16: Infrastructure & Deployment Security

- [ ] **Never commit infrastructure credentials, deploy keys, or CI/CD secrets to the repository**
  - Use your CI/CD platform's secrets store (GitHub Actions Secrets, etc.)
  - Rotate all secrets if there's any chance they were exposed [reddit](https://www.reddit.com/r/vibecoding/comments/1r10bk8/the_vibe_coding_security_checklist_7_critical/)

- [ ] **Disable unnecessary ports and services at the infrastructure level**
  - Your database should not be publicly accessible — use a private network/VPC and only allow connections from your app servers
  - Redis should be on a private network and require a password [github](https://github.com/astoj/vibe-security)

- [ ] **Enable automated security scanning in your CI/CD pipeline**
  - Add SAST (Static Application Security Testing) tools: Semgrep, CodeQL, or Snyk Code
  - Run on every PR and block merges on new high/critical findings [reddit](https://www.reddit.com/r/Pentesting/comments/1lq0iv8/what_is_the_scene_of_xss_these_days_with_react/)

- [ ] **Set up a Web Application Firewall (WAF)**
  - Cloudflare, AWS WAF, or similar can block common attack patterns (SQL injection signatures, XSS patterns) at the network edge before they hit your app [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Use separate environments for development, staging, and production**
  - Never use production secrets or databases in development
  - Staging should mirror production security configuration [github](https://github.com/astoj/vibe-security)

***

## 🧪 Section 17: Security Testing

- [ ] **Run OWASP ZAP or Burp Suite against your app before production launch**
  - OWASP ZAP has a free automated scanner that catches common vulnerabilities
  - Test all authentication flows, all API endpoints, file upload endpoints, and WebSocket connections [owasp](https://owasp.org/www-project-top-ten/)

- [ ] **Write security-focused unit tests for all authentication and authorization logic**
  - Test: unauthenticated access returns 401, unauthorized access returns 403, user A cannot access user B's resources
  - Include negative tests — test that things fail correctly, not just that they succeed correctly [github](https://github.com/astoj/vibe-security)

- [ ] **Conduct regular dependency audits and penetration testing**
  - At minimum: run `npm audit` weekly in CI
  - For a production app with real users: engage a security researcher or pen testing firm at least annually [checkmarx](https://checkmarx.com/blog/ai-is-writing-your-code-whos-keeping-it-secure/)

- [ ] **Implement automated secret scanning in CI**
  - Use `git-secrets`, `detect-secrets`, or `truffleHog` in a pre-commit hook and CI check to catch secrets before they're pushed [blogs.cisco](https://blogs.cisco.com/ai/announcing-new-framework-securing-ai-generated-code)

***

## 🛡️ Section 18: Vibe-Coding-Specific AI Code Risks

- [ ] **Review every AI-generated authentication and authorization flow manually**
  - AI tools commonly generate authentication that is correct in happy-path scenarios but missing edge-case checks (e.g., token expiry validation, ownership checks)
  - 20% of vibe-coded apps were found to have serious authentication vulnerabilities per Wiz Research 2026 [simonroses](https://simonroses.com/2026/04/the-owasp-top-10-for-vibe-coded-applications-part-2/)

- [ ] **Audit all AI-generated database queries for IDOR vulnerabilities**
  - AI frequently generates queries like `findById(req.params.id)` without a `userId` scope — manually verify every query that returns user-owned data [reddit](https://www.reddit.com/r/vibecoding/comments/1r10bk8/the_vibe_coding_security_checklist_7_critical/)

- [ ] **Remove all AI-generated debug endpoints and verbose logging before deploying to production**
  - Grep for: `grep -r "debug\|console\.log\|TODO\|FIXME\|test.*route\|/debug" src/`  [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Run a SAST tool specifically configured for AI-generated code patterns**
  - Tools like Semgrep have rulesets for common AI-generated vulnerability patterns
  - Escape.tech's audit found 65% of vibe-coded apps had security issues and 58% had at least one critical vulnerability [simonroses](https://simonroses.com/2026/04/the-owasp-top-10-for-vibe-coded-applications-part-2/)

- [ ] **Threat model your app — AI tools don't understand your business logic**
  - Draw a data flow diagram: where does user data enter your system? Where does it leave? Who should be able to access what?
  - AI generates code that works, but doesn't know your authorization model — you must define and enforce it explicitly [cloudsecurityalliance](https://cloudsecurityalliance.org/blog/2025/04/09/secure-vibe-coding-guide)

***
***

# PART 2: Stack-Specific Hardening — Friendgroup Tech Stack

*Sources: Fastify docs, @fastify/helmet, @fastify/jwt, fastify/rate-limit, Prisma security docs, Aikido.dev Prisma/NoSQL injection research, Socket.IO docs, CVE-2025-61765 BlueRock Security, BullMQ docs, ioredis, Redis docs, AWS presigned URL best practices, React security guide, Vite security, VAPID/web-push security research, Nodemailer security, Pino redaction guides, Sentry best practices, OWASP, obsidiansecurity.com, securing.pl* [reddit](https://www.reddit.com/r/node/comments/1jdjuv9/is_fastify_a_good_choice_in_2025/)

***

## ⚡ Section A: Fastify Backend Hardening

- [ ] **Ensure `@fastify/helmet` is registered and configured with a strong CSP**
  - Register it as the first plugin so headers apply to all routes:
    ```ts
    await app.register(import('@fastify/helmet'), {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", "wss://yourdomain.com"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    })
    ```
  - Verify headers are present on all responses using `curl -I https://your-api.com/health` [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Configure `@fastify/cors` with an explicit origin allowlist**
  - Never use `origin: true` or `origin: '*'` for your API:
    ```ts
    await app.register(import('@fastify/cors'), {
      origin: ['https://yourfrontend.com'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
    ```
  - In development, allow `localhost:5173` (Vite dev server) but never deploy with localhost in the allowlist [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Configure `@fastify/rate-limit` with different tiers per route**
  - Global baseline:
    ```ts
    await app.register(import('@fastify/rate-limit'), {
      global: true,
      max: 200,
      timeWindow: '1 minute',
      redis: redisClient, // share limits across instances
    })
    ```
  - Auth endpoints override (tighter):
    ```ts
    fastify.post('/auth/login', {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    }, handler)
    ```
  - OTP generation: max 3 per email per hour
  - Messaging/notification endpoints: max 60/minute per user [oneuptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-rate-limiting/view)

- [ ] **Configure `@fastify/jwt` with short expiry and strong signing algorithm**
  - Use `HS256` at minimum, prefer `RS256` (asymmetric) if you have multiple services verifying tokens:
    ```ts
    await app.register(import('@fastify/jwt'), {
      secret: process.env.JWT_SECRET!, // min 256-bit random secret
      sign: { algorithm: 'HS256', expiresIn: '15m' },
    })
    ```
  - Validate JWT on every protected route via a `preHandler` hook — never skip token verification for "internal" routes [reddit](https://www.reddit.com/r/node/comments/1ad9i9p/jwt_auth_best_practices/)

- [ ] **Add an `onRequest` hook to strip/verify the `x-forwarded-for` header for rate limiting**
  - When behind a reverse proxy (Fly.io, Railway), Fastify needs to trust the `x-forwarded-for` header to get real client IPs:
    ```ts
    app.register(import('@fastify/rate-limit'), {
      trustProxy: true, // only if behind a trusted reverse proxy
    })
    ```
  - Without this, all requests appear to come from the proxy IP and rate limiting is bypassed [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Remove `Server` and `X-Powered-By` headers from all responses**
  - `@fastify/helmet` does this by default — verify by checking response headers
  - Also disable Fastify's default `X-Powered-By: Fastify` header [dev](https://dev.to/lcnunes09/complete-guide-to-security-headers-in-fastify-build-a-secure-by-default-api-2024-2aja)

- [ ] **Use Zod schemas for ALL request validation in Fastify routes**
  - Define a Zod schema and parse in the route handler:
    ```ts
    const CreateEventSchema = z.object({
      title: z.string().min(1).max(100),
      description: z.string().max(1000).optional(),
      groupId: z.string().uuid(),
      startAt: z.string().datetime(),
    })
    fastify.post('/events', async (req, reply) => {
      const body = CreateEventSchema.safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
      // proceed with body.data
    })
    ```
  - Never skip validation because "it's an internal endpoint" — internal endpoints are often the most dangerous if compromised [codesignal](https://codesignal.com/learn/courses/secure-input-validation-in-web-applications-2/lessons/secure-server-side-validation-with-typescript-1)

- [ ] **Add a global error handler that never leaks stack traces**
  ```ts
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, reqId: request.id }, 'Unhandled error')
    const statusCode = error.statusCode ?? 500
    reply.status(statusCode).send({
      error: statusCode < 500 ? error.message : 'Internal Server Error',
      requestId: request.id,
    })
  })
  ```
 [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Audit all Fastify route handlers for missing `await` on async operations**
  - In Fastify, an uncaught promise rejection in a route handler can crash the process or leave the request hanging
  - Enable `--unhandled-rejections=throw` in Node.js and configure PM2/your process manager to restart on crash [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

***

## 🔐 Section B: Authentication & JWT — Custom Email/Password + OTP

- [ ] **Implement refresh token rotation with a Redis-backed token store**
  - On login, issue: short-lived JWT access token (15 min) + long-lived refresh token (7–30 days)
  - Store refresh token hash in Redis with the key `refresh:{userId}:{tokenId}` — not the raw token
  - On refresh: validate token, issue new access + refresh tokens, delete old refresh token from Redis atomically
  - On reuse detection (old token submitted again): delete ALL refresh tokens for that user (`DEL refresh:{userId}:*`) and force re-login [obsidiansecurity](https://www.obsidiansecurity.com/blog/refresh-token-security-best-practices)

- [ ] **Store refresh tokens in `HttpOnly; Secure; SameSite=Strict` cookies, not response bodies**
  - Access tokens can be stored in memory (React state/Zustand store) — never in `localStorage`
  - Use the `reply.setCookie` API in Fastify with correct flags [dev](https://dev.to/ajitforger97/building-refreshing-jwt-tokens-in-nodejs-a-complete-guide-3g8g)

- [ ] **Implement OTP generation with `crypto.randomInt` or `crypto.randomBytes`**
  ```ts
  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString()
  // Store hashed OTP in DB with expiry
  const hashed = await bcrypt.hash(otp, 10)
  await prisma.otpCode.create({ data: { userId, hashedOtp: hashed, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } })
  ```
  - Verify by comparing with bcrypt — never store plaintext OTPs [aunimeda](https://aunimeda.com/blog/owasp-top-10-2025-web-security-guide)

- [ ] **Implement rate limiting specifically on the OTP verification endpoint**
  - Max 5 wrong OTP attempts per token before invalidating it and requiring a new one to be generated
  - This prevents brute-forcing 6-digit codes (1,000,000 possibilities) [aunimeda](https://aunimeda.com/blog/owasp-top-10-2025-web-security-guide)

- [ ] **Rotate `calendarToken` for ICS feed URLs immediately upon membership changes**
  - If a user leaves a group, their `calendarToken` must be invalidated so they can no longer access the private ICS feed
  - Implement a Prisma middleware or service method that rotates the token on membership removal [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

***

## 🌊 Section C: Socket.IO Security

- [ ] **Authenticate every Socket.IO connection with a JWT in the handshake**
  - Validate the JWT before allowing any socket to join a room or emit events:
    ```ts
    io.use(async (socket, next) => {
      const token = socket.handshake.auth.token
      if (!token) return next(new Error('Authentication required'))
      try {
        const payload = app.jwt.verify(token) // use your Fastify JWT instance
        socket.data.userId = payload.sub
        next()
      } catch {
        next(new Error('Invalid token'))
      }
    })
    ```
  - Reject connections with `next(new Error(...))` — don't allow unauthenticated socket connections for any reason [urhoba](https://www.urhoba.net/2025/11/best-practices-for-socketio-security.html)

- [ ] **Validate authorization when joining rooms — don't trust the client-supplied room name**
  - When a user tries to join a channel room, verify server-side that they are a member of that channel:
    ```ts
    socket.on('join-channel', async (channelId: string) => {
      const membership = await prisma.channelSubscription.findFirst({
        where: { channelId, userId: socket.data.userId }
      })
      if (!membership) return socket.emit('error', { message: 'Unauthorized' })
      socket.join(`channel:${channelId}`)
    })
    ```
  - Never broadcast to a room based solely on client-provided channel/room IDs [websocket](https://websocket.org/guides/security/)

- [ ] **Validate and sanitize all data received via socket events with Zod**
  - A socket event payload is untrusted user input just like an HTTP request body
  - Define Zod schemas for every event your server handles and parse before processing [codesignal](https://codesignal.com/learn/courses/secure-input-validation-in-web-applications-2/lessons/secure-server-side-validation-with-typescript-1)

- [ ] **Patch for CVE-2025-61765 — critical RCE in Socket.IO multi-server deployments**
  - This CVE affects multi-server deployments using Redis as a message broker (which your stack uses with BullMQ and Redis)
  - Mitigations: ensure Redis requires password authentication, is on a private network, has TLS enabled, and has ACLs restricting which keys Socket.IO can publish to
  - Check your `socket.io-redis-adapter` version and update to the patched release [bluerock](https://www.bluerock.io/post/cve-2025-61765-bluerock-discovers-critical-rce-in-socket-io-ecosystem)

- [ ] **Implement per-socket rate limiting on message events**
  - Without socket-level rate limiting, a single authenticated user can flood channels with thousands of messages per second
  - Track message count per socket in Redis and throttle/disconnect abusers:
    ```ts
    socket.on('message', async (data) => {
      const key = `msg-rate:${socket.data.userId}`
      const count = await redis.incr(key)
      if (count === 1) await redis.expire(key, 1) // 1-second window
      if (count > 10) return socket.emit('error', { message: 'Rate limited' })
      // process message
    })
    ```  [websocket](https://websocket.org/guides/security/)

- [ ] **Use Socket.IO namespaces to isolate different feature areas**
  - Use separate namespaces for event chat vs. tag channels (e.g., `/chat`, `/tags`)
  - Apply different auth middleware per namespace if needed [urhoba](https://www.urhoba.net/2025/11/best-practices-for-socketio-security.html)

***

## 🗄️ Section D: PostgreSQL + Prisma ORM

- [ ] **Always use Prisma's typed query API (`findMany`, `findUnique`, `create`, etc.) — avoid raw queries**
  - The high-level Prisma API is parameterized by design and not vulnerable to SQL injection [prisma](https://www.prisma.io/docs/orm/more/best-practices)

- [ ] **When raw SQL is unavoidable, use the tagged template syntax for `$queryRaw`**
  ```ts
  // SAFE: tagged template — Prisma parameterizes this
  const result = await prisma.$queryRaw`SELECT * FROM users WHERE id = ${userId}`
  
  // DANGEROUS: NEVER do this
  const result = await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${userId}'`)
  ```
  - Audit all uses: `grep -r "\$queryRawUnsafe\|\$executeRawUnsafe" src/` and eliminate them  [prisma](https://www.prisma.io/docs/orm/more/best-practices)

- [ ] **Audit Prisma `where` clauses for operator injection vulnerabilities**
  - Prisma with PostgreSQL can be vulnerable to operator injection if user-controlled objects are spread directly into `where` clauses
  - Never do: `prisma.user.findMany({ where: req.body.filters })` — always map user input to explicit fields [aikido](https://www.aikido.dev/blog/prisma-and-postgresql-vulnerable-to-nosql-injection)

- [ ] **Use a least-privilege database role for your application**
  - Create a dedicated Postgres role for your app that only has `SELECT`, `INSERT`, `UPDATE`, `DELETE` on specific tables
  - No `DROP TABLE`, `CREATE TABLE`, `ALTER TABLE`, `TRUNCATE` permissions for the application role
  - Use a separate migration-only role for running Prisma migrations (only used in CI/CD, not by the running application) [afine](https://afine.com/sql-injection-in-the-age-of-orm-risks-mitigations-and-best-practices)

- [ ] **Enable row-level security (RLS) on your managed Postgres (Neon/Supabase/RDS) as a defense-in-depth measure**
  - Even if your application logic has a bug, RLS ensures queries can only return rows the current database role is allowed to see
  - This is especially important on Supabase/Neon where the "anon" role is a common misconfiguration target [reddit](https://www.reddit.com/r/vibecoding/comments/1r10bk8/the_vibe_coding_security_checklist_7_critical/)

- [ ] **Encrypt sensitive columns at the application level**
  - Columns like `password_reset_tokens.token`, `notification_subscriptions.endpoint`, and any direct-message content should be hashed or encrypted before storage
  - Use Prisma middleware or a service layer to transparently encrypt/decrypt [github](https://github.com/astoj/vibe-security)

- [ ] **Never expose raw Prisma error messages to API clients**
  - Prisma errors can leak table names, column names, and constraint names — wrap all Prisma calls in try/catch and return generic errors [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Set connection pool limits appropriate for your hosting tier**
  - Misconfigured Prisma connection pools can exhaust Postgres connections under load, causing a denial of service
  - With `@prisma/adapter-pg`, configure `pg.Pool` with `max` connections based on your database plan limits
  - Use PgBouncer (available on Neon/Supabase) for connection pooling in production [prisma](https://www.prisma.io/docs/orm/more/best-practices)

***

## 🔴 Section E: Redis Security (ioredis + BullMQ)

- [ ] **Enable Redis authentication with a strong password**
  - Set `requirepass <strongpassword>` in your Redis config (or via your managed Redis provider's dashboard)
  - Never deploy Redis without authentication on any environment accessible over a network [bluerock](https://www.bluerock.io/post/cve-2025-61765-bluerock-discovers-critical-rce-in-socket-io-ecosystem)

- [ ] **Ensure Redis is on a private/internal network — never expose port 6379 publicly**
  - Verify with: `redis-cli -h your-redis-host ping` from a machine outside your VPC — it should timeout/refuse
  - Use your managed Redis provider's (Upstash/Redis Cloud) network access controls to allowlist only your app server IPs [bluerock](https://www.bluerock.io/post/cve-2025-61765-bluerock-discovers-critical-rce-in-socket-io-ecosystem)

- [ ] **Use TLS for all Redis connections in production**
  - With `ioredis`:
    ```ts
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: 6379,
      password: process.env.REDIS_PASSWORD,
      tls: {}, // enable TLS; ioredis uses Node.js tls module
    })
    ```
  - Upstash Redis provides TLS by default — verify your connection string uses `rediss://` (with double-s) [bluerock](https://www.bluerock.io/post/cve-2025-61765-bluerock-discovers-critical-rce-in-socket-io-ecosystem)

- [ ] **Set key expiry (TTL) on all ephemeral Redis keys**
  - Rate limit counters, OTP codes, session data, presence indicators — all should have explicit TTLs
  - Without TTLs, your Redis memory grows unbounded and old data persists indefinitely [redis](https://redis.io/tutorials/howtos/ratelimiting/)

- [ ] **Namespace BullMQ queue keys to prevent collision**
  - Use a consistent prefix for all queue names: `{appname}:queue:emails`, `{appname}:queue:notifications`
  - This also makes it easier to set ACLs restricting which keys each service can access [docs.bullmq](https://docs.bullmq.io/guide/rate-limiting)

- [ ] **Configure BullMQ workers with retry limits and dead-letter queues**
  - Without retry limits, a failing job (e.g., a broken email template) will retry indefinitely and block the queue:
    ```ts
    new Worker('emails', processor, {
      connection,
      limiter: { max: 50, duration: 1000 },
      settings: { backoffStrategy: (attemptsMade) => attemptsMade * 2000 }
    })
    ```
  - Configure `attempts: 3` and a `removeOnFail` policy to move permanently-failed jobs to a dead-letter queue for inspection [oneuptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-rate-limiting/view)

***

## ☁️ Section F: S3/R2 Object Storage & Presigned URLs

- [ ] **Generate presigned upload URLs server-side with short expiry (5–15 minutes)**
  ```ts
  import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
  import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
  
  const url = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: `media/${userId}/${crypto.randomUUID()}.jpg`,
    ContentType: 'image/jpeg',
    ContentLength: allowedFileSize,
  }), { expiresIn: 300 }) // 5 minutes
  ```
  - Never generate presigned URLs with expiry longer than the user session [docs.aws.amazon](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)

- [ ] **Validate the uploaded object after upload — don't trust that the client uploaded what was authorized**
  - After the client uses the presigned URL to upload, your backend should verify: file size is within limits, content type matches the signed content type, and the key matches the expected pattern
  - Use a post-upload S3 event notification or a client-side callback to your API to trigger this validation [docs.aws.amazon](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/overview.html)

- [ ] **Use a separate S3 bucket for user-uploaded content — never the same bucket as your app assets**
  - Set the bucket ACL to block all public access; serve files via presigned GET URLs or a CDN with signed URLs
  - Enable S3 Versioning to recover from accidental overwrites [docs.aws.amazon](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)

- [ ] **Set a bucket policy that restricts `s3:PutObject` to specific key prefixes**
  - Users should only be able to upload to their own prefix: `media/{userId}/*`
  - Enforce via the IAM policy attached to the server's role, and validate the key path server-side before generating the presigned URL [docs.aws.amazon](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/overview.html)

- [ ] **Enable S3 server-side encryption (SSE-S3 or SSE-KMS)**
  - For Cloudflare R2, encryption at rest is enabled by default — verify in your bucket settings [docs.aws.amazon](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)

- [ ] **Set `s3:signatureAge` condition to enforce short-lived presigned URLs at the S3 policy level**
  - This is a defense-in-depth measure ensuring even if your code generates a long expiry, S3 will reject signatures older than your policy limit [docs.aws.amazon](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)

***

## 🔔 Section G: Web Push (VAPID) & Notifications

- [ ] **Store the VAPID private key exclusively in a server-side environment variable — never expose it to the client**
  - The public VAPID key can be in `VITE_VAPID_PUBLIC_KEY` (it's meant to be public)
  - The private VAPID key must be in a server-only env var (no `VITE_` prefix) [blog.atulr](https://blog.atulr.com/web-notifications/)

- [ ] **Rotate VAPID keys if you suspect the private key has been compromised**
  - Rotating VAPID keys requires all clients to re-subscribe — plan for this operationally and have a re-subscription flow ready [securing](https://www.securing.pl/en/web-push-notifications-and-user-targeted-attacks-our-research/)

- [ ] **Validate push subscription objects server-side before storing them**
  - Validate that `endpoint` is a valid URL matching a known push service domain (Firefox, Chrome push services)
  - Validate `keys.p256dh` and `keys.auth` are present and correctly formatted [blog.atulr](https://blog.atulr.com/web-notifications/)

- [ ] **Expire and clean up stale push subscriptions**
  - Push services return `410 Gone` when a subscription is no longer valid (user unsubscribed or cleared browser data)
  - Handle this in your notification fanout worker: on `410` response, delete the subscription from your `notification_subscriptions` table [blog.atulr](https://blog.atulr.com/web-notifications/)

- [ ] **Encrypt push notification payload content if it contains sensitive information**
  - The Web Push protocol encrypts payload in transit to the push service — verify your `web-push` library version is current and using correct ECDH encryption [securing](https://www.securing.pl/en/web-push-notifications-and-user-targeted-attacks-our-research/)

***

## 📧 Section H: Nodemailer / Email Security

- [ ] **Validate all user-provided email addresses with Zod before passing to Nodemailer**
  ```ts
  const emailSchema = z.string().email().max(254) // max per RFC 5321
  const validated = emailSchema.parse(userInput)
  ```
  - Never pass raw, unvalidated user input to Nodemailer's `to:`, `from:`, or `subject:` fields [dev](https://dev.to/satyam_gupta_0d1ff2152dcc/how-to-send-emails-in-nodejs-with-nodemailer-a-2025-guide-1k09)

- [ ] **Never allow users to control the Nodemailer `envelope` object**
  - CVE disclosed in 2026 shows that user-controlled `envelope.size` allows SMTP command injection
  - Always construct mail options entirely from server-validated, trusted data [vulert](https://vulert.com/vuln-db/nodemailer-has-smtp-command-injection-due-to-unsanitized--envelope-size--parameter)

- [ ] **Store Gmail App Password (or SMTP credentials) in environment variables only**
  - Rotate the Gmail App Password immediately if it's ever logged, committed to git, or otherwise exposed
  - Use a dedicated Gmail account for transactional email — not a personal or admin account [dev](https://dev.to/satyam_gupta_0d1ff2152dcc/how-to-send-emails-in-nodejs-with-nodemailer-a-2025-guide-1k09)

- [ ] **Set up SPF, DKIM, and DMARC DNS records for your sending domain**
  - SPF: `v=spf1 include:_spf.google.com ~all` (if using Gmail SMTP)
  - DKIM: enable in your domain's DNS and configure in Gmail/your mail provider
  - DMARC: `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com`
  - Without these, your transactional emails will land in spam and your domain is spoofable [dev](https://dev.to/satyam_gupta_0d1ff2152dcc/how-to-send-emails-in-nodejs-with-nodemailer-a-2025-guide-1k09)

- [ ] **Rate-limit email sending endpoints to prevent email-bombing and cost spikes**
  - OTP emails: max 3 per email address per hour via `@fastify/rate-limit`
  - Notification emails: throttle via BullMQ rate limiter (not per HTTP request, but per queue worker) [oneuptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-rate-limiting/view)

- [ ] **Sanitize all user-controlled content included in HTML email templates**
  - If an event name or message content appears in an email, HTML-escape it before embedding in the inline HTML template
  - Use a utility like `he.encode(userContent)` to prevent HTML injection in emails [vulert](https://vulert.com/vuln-db/nodemailer-has-smtp-command-injection-due-to-unsanitized--envelope-size--parameter)

***

## ⚛️ Section I: React + TypeScript + Vite Frontend

- [ ] **Audit all uses of `dangerouslySetInnerHTML` — eliminate or sanitize with DOMPurify**
  ```bash
  grep -r "dangerouslySetInnerHTML" src/
  ```
  - If rendering user-provided rich text, install `dompurify` and sanitize:
    ```ts
    import DOMPurify from 'dompurify'
    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userHtml) }} />
    ```  [dev](https://dev.to/ashutoshsarangi/implementing-security-in-front-end-applications-react-5a33)

- [ ] **Never put sensitive data in `localStorage` or `sessionStorage`**
  - These are accessible by any JavaScript on your domain (XSS attack surface)
  - Access tokens should be in memory (Zustand store); refresh tokens in `HttpOnly` cookies [dev](https://dev.to/ajitforger97/building-refreshing-jwt-tokens-in-nodejs-a-complete-guide-3g8g)

- [ ] **Audit all `VITE_` prefixed environment variables**
  - These are bundled into the public client-side JavaScript and visible to all users in browser DevTools
  - Acceptable: `VITE_API_URL`, `VITE_VAPID_PUBLIC_KEY`, `VITE_SENTRY_DSN`
  - Never: `VITE_DATABASE_URL`, `VITE_JWT_SECRET`, `VITE_SMTP_PASS` [geeksforgeeks](https://www.geeksforgeeks.org/reactjs/how-to-secure-a-vite-powered-react-app/)

- [ ] **Configure Vite's build output to exclude source maps in production (or serve them privately)**
  - Source maps expose your original TypeScript source code to anyone with browser DevTools
  - In `vite.config.ts`: `build: { sourcemap: false }` for production, or use `'hidden'` to generate but not reference them publicly [geeksforgeeks](https://www.geeksforgeeks.org/reactjs/how-to-secure-a-vite-powered-react-app/)

- [ ] **Set up a strict Content Security Policy for the frontend served from Vercel/Netlify**
  - Add CSP headers via your hosting platform's `_headers` file (Netlify) or `vercel.json` (Vercel):
    ```
    # netlify/_headers
    /*
      Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://your-api.com wss://your-api.com; img-src 'self' data: blob: https://media.yourapp.com;
    ```  [stackhawk](https://www.stackhawk.com/blog/react-content-security-policy-guide-what-it-is-and-how-to-enable-it/)

- [ ] **Enable Subresource Integrity (SRI) for any externally loaded scripts or stylesheets**
  - Vite generates hashed filenames by default for local assets, but any CDN-loaded third-party scripts should include `integrity` and `crossorigin` attributes [geeksforgeeks](https://www.geeksforgeeks.org/reactjs/how-to-secure-a-vite-powered-react-app/)

- [ ] **Audit TanStack Query's cache for sensitive data leakage**
  - TanStack Query caches API responses in memory — ensure cached data for one user is cleared on logout
  - Call `queryClient.clear()` on logout to purge all cached responses [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

- [ ] **Implement a Content Security Policy nonce for any remaining inline scripts**
  - Work toward eliminating all inline `<script>` tags — move logic to separate files that can be `script-src 'self'` covered [stackhawk](https://www.stackhawk.com/blog/react-content-security-policy-guide-what-it-is-and-how-to-enable-it/)

***

## 🔧 Section J: PWA & Service Worker Security

- [ ] **Keep your Workbox/Vite PWA plugin up to date — service worker vulnerabilities can persist across browser restarts**
  - Service workers are long-lived — a compromised service worker can intercept all network requests until updated or unregistered [success.cse.tamu](https://success.cse.tamu.edu/wp-content/uploads/sites/197/2020/07/SW_RAID21.pdf)

- [ ] **Set a strict `scope` for your service worker to limit what requests it can intercept**
  - The service worker should only control routes within your app's path, not broader domains [success.cse.tamu](https://success.cse.tamu.edu/wp-content/uploads/sites/197/2020/07/SW_RAID21.pdf)

- [ ] **Avoid storing sensitive data (tokens, PII) in the service worker's `Cache API` or `IndexedDB`**
  - Data stored in the browser's cache persists across sessions and is accessible to any JS running on that origin
  - Cache only public, non-sensitive assets (JS bundles, CSS, static images) [success.cse.tamu](https://success.cse.tamu.edu/wp-content/uploads/sites/197/2020/07/SW_RAID21.pdf)

- [ ] **Implement a service worker update flow that forces refresh on new deployments**
  - Without this, users may run old versions of your service worker with outdated security fixes
  - Use `skipWaiting()` carefully, or prompt users to reload when a new service worker is available [success.cse.tamu](https://success.cse.tamu.edu/wp-content/uploads/sites/197/2020/07/SW_RAID21.pdf)

***

## 🔭 Section K: Observability Security (Pino + Sentry + OpenTelemetry)

- [ ] **Configure Pino to redact sensitive fields from all log output**
  ```ts
  const logger = pino({
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.token',
        'body.otp',
        'body.calendarToken',
        '*.email', // redact emails in nested objects
      ],
      censor: '[REDACTED]',
    },
  })
  ```
 [dev](https://dev.to/francoislp/nodejs-best-practices-redacting-secrets-from-your-pino-logs-1eik)

- [ ] **Configure Sentry's `beforeSend` hook to scrub PII and secrets from error reports**
  ```ts
  Sentry.init({
    dsn: process.env.VITE_SENTRY_DSN,
    beforeSend(event) {
      // Remove request body from error reports
      if (event.request?.data) delete event.request.data
      if (event.request?.cookies) delete event.request.cookies
      if (event.request?.headers?.authorization) {
        event.request.headers.authorization = '[REDACTED]'
      }
      return event
    },
  })
  ```
 [reddit](https://www.reddit.com/r/node/comments/1o3z1bw/definitive_guide_to_production_grade/)

- [ ] **Restrict who has access to your Grafana/observability dashboard**
  - Use SSO or strong passwords + MFA for all observability tooling
  - Logs and traces can contain sensitive user data — treat them as security-sensitive infrastructure [reddit](https://www.reddit.com/r/node/comments/1o3z1bw/definitive_guide_to_production_grade/)

- [ ] **Inject OpenTelemetry trace IDs into Pino log entries for correlated debugging**
  - This allows you to trace a specific user's request through all log entries without logging the user's PII as the correlation key [reddit](https://www.reddit.com/r/node/comments/1o3z1bw/definitive_guide_to_production_grade/)

- [ ] **Set log retention policies and ensure old logs are deleted per your privacy policy**
  - Logs containing user activity must be treated as PII under GDPR/CCPA
  - Set automatic log expiry (e.g., 90 days) in your log management platform [blog.lepape](https://blog.lepape.me/nodejs-best-practices-redacting-secrets-from-pino-logs/)

***

## 🧪 Section L: Testing & CI/CD Security

- [ ] **Add `npm audit --audit-level=high` as a required CI check — block PRs on high/critical findings**
  ```yaml
  # .github/workflows/security.yml
  - name: Security audit
    run: npm audit --audit-level=high
  ```
 [checkmarx](https://checkmarx.com/blog/ai-is-writing-your-code-whos-keeping-it-secure/)

- [ ] **Run Semgrep or CodeQL in CI for SAST on every PR**
  - GitHub has free CodeQL for public repos and GitHub Advanced Security for private repos
  - Semgrep Community edition has free rules covering OWASP Top 10 patterns [reddit](https://www.reddit.com/r/Pentesting/comments/1lq0iv8/what_is_the_scene_of_xss_these_days_with_react/)

- [ ] **Add a secret scanning step to your CI pipeline**
  ```yaml
  - name: Scan for secrets
    uses: trufflesecurity/trufflehog@main
    with:
      path: ./
      base: ${{ github.event.repository.default_branch }}
  ```
 [blogs.cisco](https://blogs.cisco.com/ai/announcing-new-framework-securing-ai-generated-code)

- [ ] **Write Vitest/Supertest tests for every authorization boundary**
  - Example test cases to always have:
    - `GET /api/groups/:id` returns 403 when called by a non-member
    - `POST /api/events` returns 401 when called without a JWT
    - `GET /api/users/:id/messages` returns 403 when `:id` belongs to a different user than the JWT subject [github](https://github.com/astoj/vibe-security)

- [ ] **Use `testcontainers` for integration tests against a real Postgres instance — not mocks**
  - SQL injection and ORM operator injection vulnerabilities often only manifest with a real database driver
  - Mocking Prisma hides security-relevant query behavior [prisma](https://www.prisma.io/docs/orm/more/best-practices)

- [ ] **Run Playwright E2E tests against a staging environment that mirrors production security config**
  - E2E tests should verify that: unauthenticated routes redirect to login, CORS headers are present on API responses, CSP headers are set correctly
  - Test that the app works with a strict CSP — if it doesn't, your CSP is too permissive [codegeeks](https://www.codegeeks.solutions/blog/vibe-coding-security-risks-vulnerabilities-checklist)

***

## 🌐 Section M: DevOps / Hosting Security (Fly.io / Vercel / Neon)

- [ ] **Use separate projects/apps for staging and production on all hosting platforms**
  - Staging should have separate Postgres, Redis, S3 buckets, and SMTP credentials from production [github](https://github.com/astoj/vibe-security)

- [ ] **Rotate all platform API tokens and deployment keys on a schedule**
  - Fly.io deploy tokens, Vercel/Netlify deploy hooks, Neon/Supabase database passwords — rotate every 90 days and on team member changes [github](https://github.com/astoj/vibe-security)

- [ ] **Enable Fly.io's private networking for database connections**
  - Connect your Fastify app to Neon/Postgres and Redis over Fly.io's private IPv6 network, not over the public internet [bluerock](https://www.bluerock.io/post/cve-2025-61765-bluerock-discovers-critical-rce-in-socket-io-ecosystem)

- [ ] **Enable automatic SSL/TLS certificate renewal on all domains**
  - Vercel and Fly.io handle this automatically — verify in the dashboard that your certs are valid and auto-renewing [github](https://github.com/0xRadi/OWASP-Web-Checklist)

- [ ] **Set up a Cloudflare WAF in front of both your frontend and backend**
  - Enable: Bot Fight Mode, rate limiting rules, OWASP managed ruleset
  - This provides a layer of protection even if a vulnerability exists in your application code [docs.replit](https://docs.replit.com/tutorials/vibe-code-security-checklist)

- [ ] **Enable database connection encryption (SSL/TLS) in your Prisma/pg connection string**
  - Neon, Supabase, and RDS all require SSL by default — verify your `DATABASE_URL` includes `?sslmode=require` or `?ssl=true`
  - Never connect to Postgres over an unencrypted connection in production [github](https://github.com/0xRadi/OWASP-Web-Checklist)