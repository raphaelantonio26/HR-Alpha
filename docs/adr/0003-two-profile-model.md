# ADR 0003 — One image, two profiles (production / demo), selected by environment

- **Status:** Accepted
- **Date:** 2026-06
- **Context:** HR OS needs a real production deployment with Microsoft Entra
  (OIDC) single sign-on and SCIM provisioning, **and** a public demo with no SSO
  that anyone can explore. These must not diverge into two builds, and the demo
  must never be one switch away from real data or unbounded model spend.

## Decision

Ship **one container image** and select behavior entirely through **environment**,
validated at boot.

- **Profile P (production / SSO):** `AUTH_MODE=oidc` against Entra (issuer +
  audience verified; tenant and roles mapped from claims), SCIM enabled,
  `PROD_DATA_PLANE=true`, fronted by Azure Front Door + WAF, minimum 1 replica.
- **Profile D (demo / no-SSO):** `DEMO_MODE=true`. A tenant-pinned **demo session
  minter** (`POST /demo/session`) issues short-lived HS256 tokens hard-bound to the
  synthetic demo tenant and refuses any other tenant or a non-demo role. The AI
  gateway defaults to the **labeled deterministic fallback**; a real key is
  **refused** unless `DEMO_ALLOW_LIVE_AI=true`, and live AI is then capped per-IP.
  The app scales to zero and a scheduled Job reseeds the synthetic tenant. The
  `/auth/dev-token` route is disabled in **both** production and demo.

A **fail-closed boot guard** (`config.assertProfileSafety`) refuses to start on any
contradictory configuration: demo combined with OIDC, SCIM, or a production data
plane; demo with a model key but no explicit live-AI opt-in; production missing
issuer/audience or CORS. Safety is enforced at startup, not by operator discipline.

The SPA mirrors the split with the build flag `VITE_DEMO_MODE`: the **DemoGate**
front door and the persistent synthetic-data banner render only in demo, and
`api.ts` routes authentication to `/demo/session` instead of the dev-token route.
Infrastructure selects the profile through one Bicep parameter (`profile` = `P` |
`D`); the same template provisions both.

## Alternatives considered

- **Two images / two branches.** Rejected: guaranteed drift and double the
  maintenance and scanning surface. One artifact is promoted everywhere.
- **A runtime admin toggle between demo and prod.** Rejected: a demo must not be a
  single toggle away from touching production data. Environment selection plus a
  fail-closed boot guard makes an unsafe combination refuse to run at all.
- **Demo with live AI on by default.** Rejected on cost and safety. The labeled
  fallback is the default; live AI is explicit opt-in and rate-capped per IP.
- **Demo writes against the real tenant.** Rejected: the demo writes only within
  the synthetic tenant (RLS-confined) and is periodically reseeded, so visitor
  edits are bounded and self-healing.

## Consequences

- The exact image that passed CI is what runs in prod and in the demo; only
  parameters and one build flag differ.
- The demo is safe by construction: tenant-pinned tokens, no SSO/SCIM/prod data,
  fallback AI, scale-to-zero, scheduled reseed, and a boot that refuses unsafe env.
- Promotion is trivial and auditable; there is no profile-specific code path that
  could behave differently between environments beyond what the env declares.
