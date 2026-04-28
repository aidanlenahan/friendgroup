This guide defines the exact publication process for serving Friendgroup publicly at gem.aidanlenahan.com.

====== FLOW =====

Server (this VM) -> Cloudflare Tunnel running on this VM -> Cloudflare edge / WAF / rate limiting -> gem.aidanlenahan.com

===== GOALS AND TODO =====

The goal is not just to "make it reachable". The goal is to publish it in a way that is:
- reachable only through Cloudflare
- hardened at the VM, app, and edge layers
- restart-safe and boot-safe with systemd
- monitored
- backed up
- ready for later redundancy work

Preferred security measures that this process must satisfy:
- rate limiting on everything
- standard security practices
- no direct root traversal or raw origin exposure
- correct 403 and 404 behavior

Todo items this process must cover:
- systemd services enabled and automatic
- monitoring with Uptime Kuma
- Proxmox Backup Server connected
- research and plan for more redundancy

===== PROCESS =====

## 0. Current Execution Checkpoint (Updated 2026-04-27)

This section is the live status of where implementation stopped, what is complete, what is in progress, and what still must be done.

### Process task status

- [x] 1. Decide published architecture before DNS changes
	- Selected split-host architecture: `gem.aidanlenahan.com` (web) + `api-gem.aidanlenahan.com` (API)
	- Selected local-only origin bind model

- [x] 2. Convert dev runtime to production runtime
	- Production web and API systemd templates created and installed
	- API binding logic updated to support `API_HOST` and production localhost default
	- Dev/user-level systemd services that were re-spawning dev servers were disabled

- [x] 3. Lock down host process exposure for app runtime
	- App listeners now validated on localhost-only ports:
		- API `127.0.0.1:4000`
		- Web `127.0.0.1:4173`
	- Dev listener on 5173 removed from active runtime path

- [x] 4. Stop exposing raw origin dependency services
	- `infra/docker-compose.yml` updated to localhost bind mappings:
		- Postgres `127.0.0.1:5432`
		- Redis `127.0.0.1:6379`
		- MinIO `127.0.0.1:9000`
		- MinIO Console `127.0.0.1:9001`
	- Dependency containers recreated and verified healthy

- [x] 5. Production secrets hardening and rotation
	- `/etc/friendgroup/friendgroup-api.env` exists and is active
	- Rotated non-production defaults: Postgres password, MinIO root user/password, `BETA_ADMIN_SECRET`
	- Updated `VAPID_SUBJECT` to real mailto identity

- [x] 6. Final systemd hardening review
	- Services are active and enabled
	- Boot ordering and dependency startup behavior verified
	- Note: least-privilege runtime account migration remains an optional hardening enhancement

- [x] 7. Install/configure Cloudflare Tunnel
	- `cloudflared` installed from Cloudflare apt repo (v2026.3.0)
	- Named tunnel `friendgroup-prod` created and authenticated
	- `/etc/cloudflared/config.yml` created and ingress validated
	- `cloudflared.service` installed, enabled, and active with registered edge connections
- [x] 8. Configure DNS tunnel routes
	- Cloudflare DNS routes confirmed for:
		- `gem.aidanlenahan.com`
		- `api-gem.aidanlenahan.com`
	- `cloudflared tunnel route dns gem-prod ...` confirmed the web route and created the final API route to tunnel UUID `94d05537-cef0-4ded-a0fe-830088163286`
	- Authoritative DNS from `1.1.1.1` returned Cloudflare edge IPs for both hostnames
	- Public validation passed after live runtime updates:
		- `https://gem.aidanlenahan.com` -> `HTTP/2 200`
		- `https://api-gem.aidanlenahan.com/health` -> `HTTP/2 200`
		- `https://api-gem.aidanlenahan.com/not-a-route` -> app-level `HTTP/2 404`
- [ ] 9. Cloudflare WAF and edge rate limiting
- [x] 9. Cloudflare WAF and edge rate limiting
	- Executed in Cloudflare dashboard on free plan
	- Confirmed target controls for current plan:
		- `Always Use HTTPS` on
		- `Automatic HTTPS Rewrites` on
		- `Cloudflare Managed Ruleset` on
		- `Bot Fight Mode` on
		- custom scanner-path block rule created
		- single free-plan rate-limit rule created for `POST /auth/*` on `api-gem.aidanlenahan.com`
		- `Bot Fight Mode` later disabled after it challenged normal validation traffic too aggressively
	- Full free-plan Step 9 values are documented in `tmp/domain-conn-doc.md`
- [x] 10. External 401/403/404 validation through public domain
	- Initial pass was blocked by Cloudflare challenge behavior
	- After disabling `Bot Fight Mode`, public semantics were observed correctly:
		- `GET https://api-gem.aidanlenahan.com/this-does-not-exist` -> `404` JSON
		- `GET https://api-gem.aidanlenahan.com/groups` without token -> `401` JSON
		- `GET https://api-gem.aidanlenahan.com/health` -> `200` JSON
		- `GET https://api-gem.aidanlenahan.com/media/proxy/events/anything` -> `403` JSON
		- `GET https://gem.aidanlenahan.com/` -> `200`
		- `GET https://gem.aidanlenahan.com/totally-fake-page` -> `200` SPA shell
- [x] 11. Final root traversal/origin discovery validation
	- Public DNS for `gem.aidanlenahan.com` and `api-gem.aidanlenahan.com` resolves to Cloudflare edge IPs, not the VM public IP
	- Media proxy code and runtime behavior both restrict proxy access to `avatars/` keys only
	- Dotfile-style public requests such as `/.env` and `/.git/config` did not expose file contents
	- No source-map files were emitted in `apps/web/dist`
	- Caveat: direct TCP port probing was executed from the VM against its public IP, which is supportive but not as authoritative as a truly separate external network test
- [x] 12. Security headers + proxy/IP correctness audit
	- API public and local-origin responses include the expected Helmet header set (`x-content-type-options`, `x-frame-options`, `referrer-policy`, `strict-transport-security`, and related defaults)
	- API CORS is pinned to `https://gem.aidanlenahan.com` and does not reflect arbitrary origins
	- Fastify `trustProxy` was missing and has now been enabled so IP-aware logic behind Cloudflare can use real client IPs instead of edge IPs
	- Web root currently exposes only baseline edge/application headers; no sensitive artifacts were found, and deeper browser-facing CSP tuning remains a future hardening item
- [x] 13. External end-to-end validation from non-origin device
	- VM-side preflight checks passed (`200/401/404/403` semantics correct on all public hostnames)
	- Non-origin device validation confirmed: user validated on external device/network — all flows worked
- [x] 14. Reboot persistence verification
	- VM rebooted (2026-04-28)
	- Post-reboot: `cloudflared`, `gem-api`, `gem-web` all came back active
	- Docker containers (postgres, redis, minio) all healthy after reboot
	- API health gate: `{"status":"ok"}` confirmed post-reboot
- [ ] 15. Uptime Kuma rollout
- [ ] 16. PBS backup integration + restore test
- [ ] 17. Incident/rollback runbook finalization
- [ ] 18. Redundancy plan execution prep

### What is in progress right now

- Steps 8-14 complete.
- Phase E (directory rename `/var/www/friendgroup` → `/var/www/gem`) complete as of 2026-04-28.
- Step 15 (Uptime Kuma) deferred — to be done later.
- Steps 16-18 pending.

### What still must be done before public launch

- Complete Steps 7 through 18 above.
- Validate public domain behavior (TLS, WAF, rate limits, 401/403/404, auth flows, uploads, chat, notifications).
- Confirm monitoring and backups are operational and tested.

### Bot Fight Mode guidance

Do not re-enable `Bot Fight Mode` yet.

Reason:
- it previously challenged normal validation and likely normal user traffic
- the current combination of managed rules, scanner-path block rule, and auth rate-limit rule is safer and more predictable for this deployment stage

Revisit `Bot Fight Mode` only after later external functional validation is stable and only if you are prepared to retest public browsing and API behavior again.

### HTTP response format policy

Keep the current response-type split.

- Web app routes may return HTML app shell responses.
- API endpoints should return JSON for `200`, `401`, `403`, `404`, and other app-level API errors.
- Cloudflare/tunnel edge failures such as unmatched-host `404` or transient origin `502` should remain edge-generated, not custom HTML pages.

Reason:
- JSON API errors are easier to consume, test, and debug.
- The React web app can present branded UX inside the SPA without changing API semantics.
- Replacing edge failures with custom HTML would make diagnosis harder and blur the boundary between origin problems and edge problems.

### Where detailed execution logs live

- Full chronological execution log is maintained in `tmp/domain-conn-doc.md`.

## 1. Decide the published architecture before changing DNS

Use one public hostname for the app:
- gem.aidanlenahan.com -> Friendgroup web app

Do not expose the VM directly to the internet on app ports.
Do not publish Fastify or Vite directly on 0.0.0.0 for public access.
Cloudflare Tunnel should be the only ingress path.

Recommended service layout on the VM:
- web app served locally on 127.0.0.1:4173 or another fixed internal port
- API served locally on 127.0.0.1:4000
- postgres, redis, and minio bound only to localhost or private Docker bridge, not public interfaces
- cloudflared runs locally and forwards external traffic to the local web service

Preferred hostname layout:
- gem.aidanlenahan.com -> web frontend
- api-gem.aidanlenahan.com -> API for clear separation

If keeping a single hostname for both app and API, then the frontend and API must be routed by the same reverse proxy or Cloudflare ingress rules with path-based routing. In practice, a separate API subdomain is cleaner and safer.

Recommended final layout:
- gem.aidanlenahan.com -> web
- api-gem.aidanlenahan.com -> api
- optional status.gem.aidanlenahan.com -> Uptime Kuma, protected behind Cloudflare Access

## 1.1 Safe Rebrand Plan: friendgroup -> gem (non-destructive)

You can and should do this as a staged migration, not a one-shot global replace.

### Why staged is safer

- `friendgroup` appears in multiple contexts with different risk:
	- runtime wiring (`systemd`, `/etc/friendgroup/*`, tunnel names)
	- data-layer identifiers (DB user/db name, bucket names)
	- code/package metadata (`package.json` names, tests, labels)
	- docs and historical logs
- replacing all at once can break startup, deployment scripts, and restore workflows.
- staged rename gives instant rollback at each phase.

### Phase A (safe now, zero downtime)

- Create parallel `gem` identities without removing `friendgroup` identities:
	- create `gem-prod` Cloudflare tunnel (done)
	- keep `friendgroup-prod` tunnel active until `gem-prod` is fully validated
	- add gem-named templates in repo (`gem-*.service`, `gem-*.env.example`) while preserving existing files
- Keep filesystem path `/var/www/friendgroup` unchanged during this phase.

Phase A execution status (2026-04-27):
- [x] `gem-prod` tunnel created in Cloudflare
- [x] Existing `friendgroup-prod` tunnel left active (no traffic cutover yet)
- [x] Parallel gem templates added in repo:
	- `infra/systemd/gem-api.prod.service`
	- `infra/systemd/gem-web.prod.service`
	- `infra/gem-api.env.example`
	- `infra/cloudflared/gem-prod.config.example.yml`
- [x] Existing friendgroup-named templates preserved unchanged for rollback
- [x] Working directory remains `/var/www/friendgroup` (no folder rename in Phase A)

Phase A exit criteria:
- parallel identities exist
- no runtime service switch performed
- rollback remains immediate by design (because nothing destructive was changed)

### Phase B (runtime cutover, low risk, quick rollback)

- Switch cloudflared runtime from old tunnel credentials to `gem-prod` credentials.
- Validate:
	- `systemctl status cloudflared`
	- `cloudflared tunnel info gem-prod`
	- local health endpoints still 200
- Rollback path: restore previous `/etc/cloudflared/config.yml` and restart cloudflared.

Phase B execution status (2026-04-27):
- [x] Cloudflared runtime switched from `friendgroup-prod` to `gem-prod`
- [x] Pre-cutover rollback snapshot captured at `/etc/cloudflared/backups/20260427-235938/`
	- `config.yml.pre-phaseB`
	- `5d3504c0-17fb-4d8d-9802-d1f5b247f855.json.pre-phaseB`
- [x] Active runtime config now references tunnel UUID `94d05537-cef0-4ded-a0fe-830088163286`
- [x] `cloudflared.service` restarted and is active
- [x] `cloudflared tunnel info gem-prod` shows active connectors
- [x] `friendgroup-prod` now shows no active connection (expected after cutover)
- [x] Local app health gates remain green (`/health`, `/health/db`, `/health/redis`)

Phase B rollback command set:
1. `sudo cp /etc/cloudflared/backups/20260427-235938/config.yml.pre-phaseB /etc/cloudflared/config.yml`
2. `sudo systemctl restart cloudflared`
3. `cloudflared tunnel info friendgroup-prod`

### Phase C (service identity rename, no data migration)

- Add gem-named systemd units in parallel (`gem-api.service`, `gem-web.service`).
- Enable/start gem units while old units are still available.
- After verification, disable old unit names.
- Keep working directory unchanged (`/var/www/friendgroup`) until Phase E.

Phase C execution status (2026-04-28):
- [x] Live unit files created:
	- `/etc/systemd/system/gem-api.service`
	- `/etc/systemd/system/gem-web.service`
- [x] Gem API env file created:
	- `/etc/friendgroup/gem-api.env`
	- initial contents copied from `/etc/friendgroup/friendgroup-api.env` for non-destructive parity
- [x] Pre-cutover rollback snapshot captured at `/etc/systemd/system/rebrand-backups/20260428-023447/`
- [x] Old services stopped and replacement services started successfully
	- `gem-api.service` active on `127.0.0.1:4000`
	- `gem-web.service` active on `127.0.0.1:4173`
- [x] Old unit names preserved but disabled for rollback
	- `friendgroup-api.service` disabled
	- `friendgroup-web.service` disabled
	- files retained at `/etc/systemd/system/`
- [x] Health gates passed after cutover

Phase C rollback command set:
1. `sudo systemctl disable gem-api gem-web`
2. `sudo systemctl stop gem-api gem-web`
3. `sudo systemctl enable friendgroup-api friendgroup-web`
4. `sudo systemctl start friendgroup-api friendgroup-web`

### Recommended order from current state

Best next move after Phase C: do Step 8 before Phase D.

Why this order is preferred:
- Step 8 is operational wiring only. It exposes the already-stable runtime through the intended public domain path.
- Phase D increases surface area substantially by changing branding text, package names, labels, config strings, and source references.
- If public reachability is broken after a large textual rebrand, root cause becomes harder to isolate.
- Completing Step 8 first lets public-domain validation happen against the already-stable Phase B/C runtime state.

Decision rule:
- Finish Step 8 and basic public reachability checks first.
- Then begin Phase D in narrow batches with rebuild/test gates.

### Phase D (app/config textual rebrand)

- Replace branding text and package names in source/config where safe.
- Exclude generated outputs and caches from global replacement:
	- `apps/*/dist`
	- `apps/web/dev-dist`
	- `node_modules`
	- `test-results`
	- historical docs under `tmp/`
- Rebuild and run tests after each scoped batch.

### Phase E (optional path/data identifier rename; highest risk)

Phase E execution status (2026-04-28): **COMPLETE**
- [x] `/var/www/friendgroup` renamed to `/var/www/gem`
- [x] `/etc/systemd/system/gem-api.service` — all `WorkingDirectory`, `ExecStart*`, and `ReadWritePaths` updated to `/var/www/gem`
- [x] `/etc/systemd/system/gem-web.service` — `WorkingDirectory` and `ReadWritePaths` updated to `/var/www/gem`
- [x] `systemctl daemon-reload` completed
- [x] Both services restarted successfully from new path
- [x] Health gates passed: API `{"status":"ok"}`, web `HTTP 200`
- DB names/users/buckets (`friendgroup_*`) left unchanged — stable and private identifiers, no migration needed

Phase E rollback (if needed):
1. `sudo systemctl stop gem-api gem-web`
2. `sudo mv /var/www/gem /var/www/friendgroup`
3. `sudo sed -i 's|/var/www/gem|/var/www/friendgroup|g' /etc/systemd/system/gem-api.service /etc/systemd/system/gem-web.service`
4. `sudo systemctl daemon-reload && sudo systemctl start gem-api gem-web`

### Phase gates (do not skip)

After each phase:
1. `curl -sS http://127.0.0.1:4000/health`
2. `curl -sS http://127.0.0.1:4000/health/db`
3. `curl -sS http://127.0.0.1:4000/health/redis`
4. `systemctl status friendgroup-api friendgroup-web cloudflared --no-pager`
5. External check through Cloudflare hostname(s)

Rollback rule:
- Keep previous config/service files in place until the new layer is verified and documented.
- Do not delete old tunnel/service identifiers in the same step as enabling new ones.

## 2. Convert the current dev-style runtime into a production runtime

Current repo state:
- infra/systemd/friendgroup-api.service runs npm run dev:api
- infra/systemd/friendgroup-web.service runs npm run dev:web
- both are development services, not production-grade publish services

Before public launch, replace dev execution with production execution.

Required changes:
- API should run the built server, not tsx watch
- web should run a production build behind a stable local server
- services must bind to localhost/private interfaces only

Production target:
- API: npm run build --workspace=apps/api, then node apps/api/dist/server.js
- web: npm run build --workspace=apps/web, then either:
	- use a simple static file server bound to 127.0.0.1, or
	- use Vite preview only as an interim solution, or
	- preferably use nginx/caddy locally in front of the built web assets

Do not publish with:
- npm run dev
- vite dev server
- tsx watch

Those are fine for development but not for an internet-facing service.

### 2.1 Concrete implementation profile for this repo

This repo uses Vite dev server on port 5173 in development.

That is expected and correct for local dev. It is not the production runtime.

For production publishing through Cloudflare Tunnel, use this internal port map:
- dev web: 5173 (local development only)
- prod web: 4173 (localhost only)
- prod api: 4000 (localhost only)

Why this split is recommended:
- avoids collisions between dev and prod processes
- makes firewall and tunnel rules explicit
- makes troubleshooting and rollback clearer

Implementation details:
- web production process: build app, then serve built assets on 127.0.0.1:4173
- api production process: run built server on 127.0.0.1:4000
- cloudflared ingress maps public hostnames to those localhost ports

Minimal production web command pattern:
- npm --workspace apps/web run build
- npm --workspace apps/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort

Minimal production api command pattern:
- npm --workspace apps/api run build
- NODE_ENV=production node apps/api/dist/server.js

Cloudflare tunnel ingress should map exactly:
- gem.aidanlenahan.com -> http://127.0.0.1:4173
- api-gem.aidanlenahan.com -> http://127.0.0.1:4000
- final catch-all -> http_status:404

Non-negotiable publishing rule:
- no direct public traffic to 5173, 4173, or 4000
- only cloudflared should provide external ingress

If you need full command-by-command execution details, service file examples, validation matrix, and rollback sequence, see:
- tmp/domain-conn-doc.md

## 3. Lock down the VM before introducing public traffic

### OS and package baseline

On the VM:
1. Fully update packages.
2. Confirm time sync is working.
3. Confirm disk space, memory headroom, and swap behavior.
4. Confirm the box reboots cleanly.

Required checks:
- apt update && apt upgrade -y
- timedatectl status
- df -h
- free -h
- uptime

### SSH hardening

Required:
- disable password auth if you have working SSH keys
- disable root SSH login
- keep sudo for your named user only
- restrict SSH to known admin IPs if practical

In /etc/ssh/sshd_config, verify or set:
- PermitRootLogin no
- PasswordAuthentication no
- PubkeyAuthentication yes

After changes:
- test a second SSH session before restarting sshd

### Host firewall

Use UFW or nftables. UFW is fine here.

Principles:
- default deny inbound
- default allow outbound
- allow SSH only
- do not expose app ports publicly if Cloudflare Tunnel is used

Recommended UFW baseline:
- ufw default deny incoming
- ufw default allow outgoing
- ufw allow OpenSSH
- ufw enable

Do not allow these ports publicly unless there is a very specific admin reason:
- 3000
- 4000
- 4173
- 5173
- 5432
- 6379
- 9000
- 9001

If Docker publishes those ports now, change compose and service bindings so they are localhost-only or private-only.

### Fail2ban

Install Fail2ban for SSH protection even though Cloudflare handles app ingress.

Minimum scope:
- protect sshd
- aggressive enough to slow brute force, not lock yourself out

## 4. Stop exposing raw origin services

This is critical for the user's "no root traversal" and "403s and 404s" goal, because origin leakage defeats most edge protections.

Required origin posture:
- only cloudflared should accept public web traffic
- app services should listen only on localhost
- docker containers for postgres, redis, and minio should not be publicly reachable

Specifically for the current compose file:
- postgres currently exposes 5432:5432
- redis currently exposes 6379:6379
- minio currently exposes 9000:9000 and 9001:9001

Before launch, change this so that either:
- those ports bind to 127.0.0.1 only, or
- they are not published at all and are only used on the Docker network

Safer examples:
- 127.0.0.1:5432:5432
- 127.0.0.1:6379:6379
- 127.0.0.1:9000:9000
- 127.0.0.1:9001:9001

If MinIO console is needed for occasional admin tasks, keep it localhost-only and use SSH tunneling when needed.

## 5. Create production environment files and secrets

Do not reuse the current development .env as production.

Create a production env file for the API with production values for:
- NODE_ENV=production
- API_BASE_URL=https://api-gem.aidanlenahan.com or the chosen final origin
- WEB_BASE_URL=https://gem.aidanlenahan.com
- DATABASE_URL
- REDIS_URL
- AUTH_SECRET
- SENTRY_DSN
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY
- VAPID_SUBJECT
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_USER
- SMTP_PASS
- EMAIL_FROM
- S3 endpoint and credentials
- S3_PUBLIC_BASE_URL if media remains proxied by API

Rules:
- AUTH_SECRET must be strong and unique
- SMTP credentials must not be personal long-term credentials if you can avoid it
- MinIO credentials must not remain minioadmin/minioadmin in production
- database password must not remain friendgroup
- do not commit production env files

Before go-live, rotate all placeholder and local credentials:
- postgres password
- redis auth if enabled
- minio root user and password
- auth secret
- smtp credentials
- any beta/admin secrets

## 6. Build proper production systemd units

Your todo says systemd services must be enabled and automatic. This needs to be done for:
- friendgroup-api
- friendgroup-web
- cloudflared
- optionally uptime-kuma

Required systemd properties:
- runs on boot
- restarts automatically on failure
- has explicit WorkingDirectory
- uses production environment file
- binds only to localhost/private interfaces
- logs to journald

Recommended service behavior:
- Restart=always
- RestartSec=3
- After=network-online.target
- Wants=network-online.target

For the API service, add hardening where possible:
- User=friendgroup
- Group=friendgroup
- NoNewPrivileges=true
- PrivateTmp=true
- ProtectSystem=full
- ProtectHome=true
- ReadWritePaths only where needed
- LimitNOFILE high enough for sockets

For the web service, do the same.

Operational note from current rollout state:
- Production units are currently running as `aidan:devs` to align with workspace ownership and avoid build-time permission failures.
- After launch stabilization, you can migrate to a dedicated service account once filesystem ownership is fully normalized.

After unit creation:
1. sudo systemctl daemon-reload
2. sudo systemctl enable friendgroup-api
3. sudo systemctl enable friendgroup-web
4. sudo systemctl start friendgroup-api
5. sudo systemctl start friendgroup-web
6. sudo systemctl status friendgroup-api friendgroup-web
7. journalctl -u friendgroup-api -n 100 --no-pager
8. journalctl -u friendgroup-web -n 100 --no-pager

Definition of done for this section:
- both services survive reboot
- both services restart after failure
- both services only bind internally

## 7. Install and configure Cloudflare Tunnel on this VM

This is the core of the requested flow.

### Install cloudflared

Install the official cloudflared package on the VM.

Then authenticate with Cloudflare and create a named tunnel.

Expected tunnel ownership:
- one named tunnel dedicated to Friendgroup production
- credentials stored under /etc/cloudflared/

### Create ingress rules

Recommended ingress configuration:
- hostname: gem.aidanlenahan.com -> service: http://127.0.0.1:4173
- hostname: api-gem.aidanlenahan.com -> service: http://127.0.0.1:4000
- catch-all final rule -> http_status:404

That last rule matters. It directly supports the requirement for clean 404 behavior and prevents accidental exposure of anything not explicitly mapped.

Example structure:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /etc/cloudflared/<tunnel-uuid>.json

ingress:
	- hostname: gem.aidanlenahan.com
		service: http://127.0.0.1:4173
	- hostname: api-gem.aidanlenahan.com
		service: http://127.0.0.1:4000
	- service: http_status:404
```

Important details:
- do not point the tunnel to 0.0.0.0 services if you can avoid it
- prefer localhost targets
- use explicit hostnames only
- no wildcard catch-all to a real backend unless intentional

### Run cloudflared as systemd

Enable automatic boot and restart behavior.

Required checks:
- sudo systemctl enable cloudflared
- sudo systemctl start cloudflared
- sudo systemctl status cloudflared
- journalctl -u cloudflared -n 100 --no-pager

Definition of done:
- tunnel reconnects after reboot
- tunnel reconnects after transient network loss
- no manual login needed after initial setup

## 8. Configure DNS in Cloudflare

Create DNS entries through tunnel routing, not raw A records to the VM public IP.

Preferred records:
- gem.aidanlenahan.com -> proxied CNAME managed by Cloudflare Tunnel
- api-gem.aidanlenahan.com -> proxied CNAME managed by Cloudflare Tunnel

Do not:
- point DNS directly at the VM public IP for app traffic
- expose origin IP if tunnel is the desired security boundary

After DNS creation, verify:
- `dig gem.aidanlenahan.com`
- `dig api-gem.aidanlenahan.com`
- Cloudflare dashboard shows the tunnel routes attached to the hostnames

## 9. Add Cloudflare edge protections

This section satisfies the user's requirement for rate limiting on everything and standard security practices.

### SSL/TLS mode

Set Cloudflare SSL/TLS appropriately.

If all traffic goes through Tunnel, Cloudflare handles the public TLS edge. Still verify:
- HTTPS enforced
- Automatic HTTPS Rewrites enabled if needed
- HSTS enabled only after validating stable HTTPS everywhere

### WAF managed rules

Enable:
- Cloudflare Managed Ruleset
- OWASP core-style protections if available in your plan
- bot protections as available

Review initial events in simulate/log mode if possible before fully blocking noisy categories.

### Rate limiting

The requirement says rate limiting on everything. That means both Cloudflare edge limits and application limits.

Cloudflare edge rate-limit recommendations:
- global limit for all requests to gem.aidanlenahan.com to slow floods
- tighter limits for auth endpoints on api-gem.aidanlenahan.com
- tighter limits for password reset, login code, verify-email, beta/admin endpoints
- specific rate limits for upload-related endpoints

Example policy groups:
- `/auth/login` -> very tight
- `/auth/register` -> tight
- `/auth/request-login-code` -> very tight
- `/auth/forgot-password` -> very tight
- `/notifications/*` -> moderate
- `/media/*` -> moderate
- `/groups/*`, `/events/*`, `/channels/*` -> moderate but not so low that normal use breaks

Edge behavior recommendations:
- challenge or block on obvious abuse
- prefer managed challenge where false positives are possible
- block clearly malicious repetition

### Country / ASN / bot restrictions

Optional, depending on expected users:
- allow only the countries you realistically need
- challenge traffic from high-risk ASNs if abuse appears
- use bot score features if available

### Custom firewall rules

Add explicit rules for:
- block known bad paths you do not serve
- challenge repeat high-rate requests
- challenge suspicious scanners probing admin/php/wordpress paths

Examples to block or challenge:
- `/wp-admin`
- `/wp-login.php`
- `/.env`
- `/.git`
- `/server-status`
- `/phpmyadmin`

Even though your app will return 404 for most of these, blocking/challenging them at the edge reduces log noise and wasted origin traffic.

## 10. Enforce correct 403 and 404 behavior

The user explicitly asked for 403s and 404s.

This must be enforced at multiple layers.

### At Cloudflare Tunnel ingress

Use the final `http_status:404` ingress rule so unknown hostnames and unmapped traffic return 404.

### At the application layer

Ensure:
- forbidden resources return 403
- not-found resources return 404
- unauthorized returns 401 where authentication is missing
- do not collapse everything into 500

Examples to verify manually:
- invalid route on web -> 404 page or app not-found route
- invalid API route -> JSON 404
- invite-only/private access without permission -> 403
- missing token on protected route -> 401
- forbidden media key outside avatars on proxy route -> 403

### At the edge for unwanted probes

Use firewall rules to block/challenge obvious exploit scans before they hit the app.

## 11. Prevent root traversal and origin discovery

The phrase "no root traversal" is best interpreted here as:
- no path traversal
- no directory listing
- no direct origin exposure
- no accidental access to filesystem-like paths

Required controls:

### App-level controls

- never map user input directly to filesystem paths
- do not serve arbitrary files from disk
- keep media serving behind explicit route logic
- on the avatar proxy route, only permit the avatars/ prefix
- reject malformed wildcard paths early with 400 or 403

### Web server/static controls

If nginx/caddy is used for static assets:
- disable directory listing
- do not expose source maps publicly unless intentionally needed
- do not expose dotfiles

### Origin exposure controls

- no public app ports on the VM
- no direct DNS to origin IP
- optionally add host firewall rules that only allow Cloudflare-managed egress paths if your setup changes away from Tunnel later

## 12. Add application-layer security headers and backend hardening

Cloudflare is not a substitute for app security.

Before launch, verify in the API and web responses:
- Content-Security-Policy
- Strict-Transport-Security after HTTPS is proven stable
- X-Content-Type-Options: nosniff
- Referrer-Policy
- Permissions-Policy
- frame-ancestors 'none' or X-Frame-Options: DENY where appropriate

Also verify:
- CORS allowlist is explicit, not wildcard
- trustProxy is correctly configured if app logic depends on real client IPs behind Cloudflare
- logs redact auth headers and sensitive bodies
- Sentry scrubs sensitive request data
- JWT secrets and webhook secrets have no weak fallbacks
- all public routes have rate limits, especially auth and notification endpoints

## 13. Validate local-only service reachability before turning on public routing

Before pointing real traffic at the hostname, confirm the local chain works on the VM.

Required tests from the VM:
- curl http://127.0.0.1:4000/health
- curl http://127.0.0.1:4173
- curl through cloudflared local diagnostics if used

Required tests from another device:
- https://gem.aidanlenahan.com loads the web app
- https://api-gem.aidanlenahan.com/health returns expected response
- login works
- websocket/chat works through Cloudflare
- file upload works
- avatar proxy works on mobile network, not just local wifi
- no mixed-content warnings

## 14. Configure systemd services to be enabled and automatic

This is one of the explicit todos, so treat it as a tracked deliverable.

Definition of done:
- friendgroup-api enabled
- friendgroup-web enabled
- cloudflared enabled
- docker engine enabled if using Docker-managed dependencies
- any required compose stack starts automatically or is managed by systemd

Verification commands:
- sudo systemctl is-enabled friendgroup-api
- sudo systemctl is-enabled friendgroup-web
- sudo systemctl is-enabled cloudflared
- sudo systemctl is-active friendgroup-api friendgroup-web cloudflared

Then reboot the VM and re-check all of the above.

## 15. Add monitoring with Uptime Kuma

This is an explicit todo and should be treated as launch-blocking if you want operational visibility.

Recommended monitors:
- web homepage: https://gem.aidanlenahan.com
- api health: https://api-gem.aidanlenahan.com/health
- cloudflared process if exposed by host metrics or systemd monitoring
- postgres availability
- redis availability
- disk space on VM
- memory usage on VM
- CPU load on VM
- SSL certificate/HTTPS reachability at the public edge

Deployment recommendations:
- run Uptime Kuma on the same VM only if necessary
- better: run it on another machine so it can detect total VM outage
- if public UI is exposed, protect it with Cloudflare Access or IP restrictions

Minimum alerts:
- web down
- api down
- repeated flapping
- disk nearly full
- backup failures

## 16. Connect Proxmox Backup Server

This is an explicit todo and should cover both VM-level recovery and app-data recovery.

Minimum backup scope:
- full VM backups via Proxmox Backup Server
- database backups with retention
- MinIO/media backups or snapshot strategy
- environment and config backups excluding secret leakage outside the trusted backup store

You need both platform and application recovery.

Recommended coverage:
- scheduled VM backup from Proxmox host to PBS
- separate Postgres logical dump on schedule
- MinIO data snapshot or object replication/backups
- backup verification by actually restoring to a test environment periodically

Definition of done:
- backup job exists
- backup job runs on schedule
- retention policy exists
- restore procedure is written down
- at least one test restore has been performed

## 17. Add a written incident and rollback plan

Before public launch, document these exact actions:
- how to disable the tunnel quickly
- how to pause Cloudflare routing
- how to stop only the web service
- how to stop only the api service
- how to rotate compromised secrets
- how to restore the latest working backup
- how to roll back to the previous app release

Keep the commands and file locations in an internal ops note.

## 18. Redundancy research and next-stage architecture

This is the last explicit todo item: research more redundancy.

For this app, redundancy should be approached in stages.

### Stage 1: single VM, hardened

This is the current target.
Requirements:
- tunnel ingress
- local services only
- backups
- monitoring
- auto restart

### Stage 2: reduce single points of failure

Options to research:
- move Uptime Kuma off-box
- move email to a dedicated transactional provider
- move object storage from local MinIO to managed S3/R2
- move Postgres from local container to managed Postgres
- move Redis from local container to managed Redis

### Stage 3: multi-host resilience

If the app grows or uptime matters more:
- second app VM
- managed database with backups and failover
- managed object storage
- shared Redis or queue backend
- stateless app deploys behind Cloudflare to multiple origins

Important note:
True redundancy is not just "another VM". It requires removing local-state bottlenecks. Right now the main bottlenecks are likely:
- local postgres
- local redis
- local minio/media
- single VM compute

## 19. Go-live checklist

Do not consider the app published until every item below is true.

Infrastructure:
- VM fully patched
- SSH hardened
- firewall enabled
- only required inbound access allowed
- app ports not publicly exposed

Application runtime:
- production build used
- production env used
- secrets rotated from dev defaults
- api and web systemd services enabled
- services survive reboot

Cloudflare:
- tunnel created
- ingress rules explicit
- DNS mapped through tunnel
- final catch-all returns 404
- WAF enabled
- rate limiting enabled
- HTTPS enforced

Security behavior:
- unknown paths return 404
- forbidden resources return 403
- protected routes return 401 when unauthenticated
- CORS restricted
- headers hardened
- logs scrub sensitive data

Operations:
- Uptime Kuma monitoring live
- backups configured in PBS
- restore steps documented
- rollback steps documented

Functional validation:
- login works
- chat works
- uploads work
- avatars load on mobile
- notifications work
- calendar functionality works through the public domain

## 20. Recommended execution order

Follow this order exactly to reduce risk:

1. Build production services locally on the VM.
2. Convert app services from dev mode to production mode.
3. Bind app and dependency services to localhost/private only.
4. Harden SSH and host firewall.
5. Rotate and prepare production secrets.
6. Install and configure systemd units for app services.
7. Install and configure cloudflared.
8. Create tunnel ingress rules with final 404 catch-all.
9. Attach DNS hostnames through Cloudflare Tunnel.
10. Enable Cloudflare WAF and rate limiting.
11. Validate 401, 403, and 404 behavior from outside the VM.
12. Enable services on boot and verify with a full reboot.
13. Add Uptime Kuma monitors and alerts.
14. Connect Proxmox Backup Server and verify at least one restore path.
15. Document rollback and incident response.
16. Publish publicly.

## 21. Non-negotiable rules for this setup

These should remain true after launch:
- no direct public DNS to the VM origin for app traffic
- no public database, redis, or minio ports
- no dev server published to the internet
- no wildcard allow-all CORS for authenticated API traffic
- no missing catch-all ingress rule
- no production secrets committed to git
- no launch without monitoring and backups

## 22. Repo Rename and Rebrand Plan (friendgroup -> gem)

This section adds the requested process for:
- updating TECHSTACK as needed
- renaming folder `friendgroup` -> `gem`
- renaming project references from `friendgroup` -> `gem`
- preserving Copilot chat history and avoiding breakage

### 22.1 When to do the rename

Do not rename while deployment stabilization is still in progress.

Recommended timing:
1. Finish infrastructure hardening and Cloudflare tunnel rollout.
2. Confirm stable runtime, monitoring, and backup flows.
3. Cut a stable git checkpoint/tag.
4. Perform rename in a dedicated branch + maintenance window.

Reason:
- path and identifier renames can break service units, scripts, env references, and deployment docs.
- doing rename mid-rollout increases rollback risk.

### 22.2 Preserve Copilot chats and history before renaming

Important behavior:
- VS Code/Copilot workspace chat history is keyed by workspace identity and path metadata.
- Renaming/moving the project directory can make prior chat threads appear missing in the new folder context.

To avoid chat/history loss risk:
1. Keep the current folder path intact until history is exported/archived.
2. Continue saving session summaries to `tmp/chat/` and `tmp/domain-conn-doc.md` (already in use).
3. Create a full backup of:
	- repo working tree
	- `.git`
	- `tmp/chat/`
	- deployment docs (`domain-connect.md`, `tmp/domain-conn-doc.md`)
4. Only then perform folder rename/move.

Safe approach:
- Use a copy-first migration (`friendgroup` -> `gem`) rather than immediate move/delete.
- Keep old path available until the new path is fully validated.

### 22.3 Rename scope (what must change)

Filesystem/path rename:
- project directory name: `friendgroup` -> `gem`

Code/config/documentation rename targets:
- package names and descriptions where appropriate
- service names (`friendgroup-api`, `friendgroup-web`) if desired
- systemd unit filenames and descriptions
- env values and URLs that embed old project name
- docker container names and volume names
- docs, scripts, and CI references
- branding/user-facing text in app UI

Do not blindly replace all string occurrences without review.

### 22.4 Safe technical rename sequence

1. Create branch: `chore/rename-friendgroup-to-gem`.
2. Snapshot current deploy state and backup all docs/chat logs.
3. Rename repo folder (copy-first recommended).
4. Update path-dependent files first:
	- systemd units
	- scripts
	- docker compose paths
	- cloudflared config targets
5. Update project identifiers and UI strings (`friendgroup` -> `gem`) in reviewed batches.
6. Run full validation:
	- build
	- typecheck
	- tests
	- local service startup
	- systemd startup
7. Re-validate Cloudflare tunnel mappings and health endpoints.
8. Keep old directory as fallback until stable in production.
9. Remove old path only after successful cutover and verification.

### 22.5 TECHSTACK.md update requirement

Update `TECHSTACK.md` as part of rename work when any of the following change:
- runtime architecture
- service names/roles
- deployment topology details
- core platform components

At minimum after rename, update:
- project naming references
- deployment/service naming conventions
- domain/host naming conventions

### 22.6 Rename risk controls

Must-have controls during rename:
- one focused PR for rename only
- no feature work mixed into rename PR
- reversible cutover plan
- explicit rollback steps to old folder/service names
- verification checklist signed off before deleting old path

### 22.7 Practical recommendation for your current state

Given current progress, do this order:
1. Finish publication hardening (Steps 7-18).
2. Confirm stable public deployment.
3. Perform rename in a dedicated follow-up cycle using the sequence above.

This gives the lowest chance of breaking deployment and the lowest chance of losing Copilot workspace context.