# HR OS

A multi-tenant, HRIS-agnostic enterprise HR platform. TypeScript monorepo:
deterministic decision engines, a Fastify API with a server-side AI gateway,
database-enforced tenant isolation and append-only audit, and a React/Tailwind
web app on the Atrium design system.

> **Status (Stage 1):** foundation + correctness-critical engines are built and
> **unit-proven (88/88)**; server, web, connectors, and infra skeletons are
> written and **typecheck/build green**. The remaining module UIs, live ADP
> driver, SSO/SCIM, and infra-dependent test gates are Stage 2 — see
> [`docs/FABLE5_HANDOFF.md`](docs/FABLE5_HANDOFF.md), the authoritative status.

## Quickstart

```bash
npm install
npm run typecheck        # all workspaces
npm run test:core        # 88 engine unit tests
npm run build -w @hr-os/web   # production web build

# Full stack (needs Docker):
docker compose -f infra/docker-compose.yml up -d postgres redis minio
DATABASE_URL=postgresql://hros:hros@localhost:5432/hros ./infra/migrate.sh
npm run dev              # web + api
```

Copy `packages/server/.env.example` to `packages/server/.env`. With no
`ANTHROPIC_API_KEY`, AI features degrade to a clearly labeled deterministic
fallback (by design).

## Layout

```
packages/
  contracts/   canonical types + zod schemas + enums   (the shared vocabulary)
  core/        pure decision engines + 88 unit tests    (leave, comp, er, jd, org, metrics)
  connectors/  HRIS driver contract, ADP WFN + CSV, sync pipeline
  server/      Fastify API, AI gateway, Prisma + RLS + audit, RBAC, auth
  web/         Vite + React + Tailwind SPA: shell + 13 surfaces
infra/         docker-compose, migration, synthetic seed
docs/          architecture, handoff, connectors, rule packs, metrics, security, deploy, ops
```

## Principles

AI assists; humans decide. Never fabricate pay, benefits, legal conclusions, or
citations. No PII reaches a model or a log. Every mutation is audited and
append-only at the database. Tenant isolation is enforced by Postgres RLS, not by
application code. See [`CLAUDE.md`](CLAUDE.md) for the full invariant set that
governs all future work.

*Brand: navy #004B87 · red #EF3340 · Arial · "Building on a Foundation of Trust."*
