# Todo

## Security fixes (from commit audit be315ca / c2a55ff)

- [x] Fix `trustProxy`: changed `true` → `1` in `apps/api/src/server.ts` — trusts exactly one upstream hop (cloudflared), not unlimited
- [x] Fix media proxy: added bucket name validation against `S3_BUCKET` env var in `/media/proxy/*` route — prevents cross-bucket access
- [x] Fix `.env.example`: updated `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` to match `docker-compose.yml` MinIO credentials (`gemstorage` / `bdfc664...`)

## Remaining from previous audit (c2a55ff)

- [x] Move `docker-compose.yml` credentials to env-file variables or replace with obvious placeholders — DONE 2026-04-28: replaced `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, and `MINIO_ROOT_PASSWORD` in `infra/docker-compose.yml` with env-variable interpolation placeholders (`${...}`), and updated env examples in `apps/api/.env.example`, `infra/friendgroup-api.env.example`, and `infra/gem-api.env.example`.

## App

- [ ] Fix separate column when subscribing to URL in Google Calendar. Fixable?

## Launch checklist

- [ ] Step 13: External end-to-end validation from non-origin device (mobile data + separate network laptop)
- [ ] Step 14: Reboot persistence verification
- [ ] Step 15: Uptime Kuma rollout
- [ ] Step 16: PBS backup integration + restore test
