# Deploy

## Local / demo

```bash
npm install
docker compose -f infra/docker-compose.yml up -d postgres redis minio
DATABASE_URL=postgresql://hros:hros@localhost:5432/hros ./infra/migrate.sh
cp packages/server/.env.example packages/server/.env   # set ANTHROPIC_API_KEY (optional)
npm run dev
```

The migration is idempotent — safe to re-run. Without `ANTHROPIC_API_KEY`, AI
features serve a labeled deterministic fallback.

## Build

```bash
npm run typecheck                 # all workspaces
npm run test:core                 # engine unit tests
npm run build -w @hr-os/web       # web production bundle → packages/web/dist
npm run build -w @hr-os/server    # server → packages/server/dist (after prisma generate)
```

`prisma generate` needs a reachable `DATABASE_URL` at build time; run it before the
server build in CI/CD.

## Container topology (target)

`infra/docker-compose.yml` brings up Postgres 16, Redis, MinIO, and the server. For
production:

- **Postgres 16** with RLS — the app connects as a non-superuser role (`hros_app`)
  so `FORCE ROW LEVEL SECURITY` and the audit `REVOKE` actually bind. Provision that
  role and grant it `INSERT,SELECT` on `audit_log` only.
- **Redis** — rate-limit store and BullMQ queue (Stage 2).
- **Object storage (S3/MinIO)** — generated documents.
- **Server** — behind TLS; SSO issues the JWTs the API verifies. Set `NODE_ENV=production`
  (config then *requires* the critical env vars and refuses to boot without them).

**TODO(fable5):** `infra/Dockerfile.server` is a single-stage placeholder. Make it
multi-stage (deps → `prisma generate` + `tsc` → distroless runtime, non-root user),
add a healthcheck hitting `/healthz`, and pin base image digests.

## Migrations

Additive and idempotent. Apply with `infra/migrate.sh` (psql) or `prisma migrate
deploy`. New migrations must use `IF NOT EXISTS` / guarded `DO` blocks and never drop
or rewrite data in place.

## Environments

Per environment set: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`,
`S3_ENDPOINT`/`S3_BUCKET`, `PORT`. Keep production secrets in a manager (not in the
image, not in the repo).
