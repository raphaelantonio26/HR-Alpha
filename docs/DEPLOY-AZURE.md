# Deploying HR OS to Azure

This is the operator runbook for standing up HR OS on Microsoft Azure. It covers
both deployment profiles from one Bicep template:

- **Profile P** - production, Microsoft Entra ID (OIDC) sign-in, SCIM provisioning.
- **Profile D** - public demo, no SSO (tenant-pinned demo minter), AI in labeled
  fallback by default, scales to zero, self-healing synthetic data.

> Validation note: the Bicep was authored against current resource schemas but
> was not compiled in the build sandbox (the Bicep CLI host was unreachable
> there). Always run `az bicep build` and `az deployment group what-if` before an
> apply. Every command below is the real command to run; nothing here provisions
> anything until you run it against your subscription.

---

## 0. Prerequisites

- Azure subscription with Owner (or Contributor + RBAC Administrator) on the
  target resource group.
- Azure CLI 2.60+ with the Bicep tool: `az bicep install`.
- A GitHub repository hosting this monorepo.
- Decide a region (examples use `westus2`) and a resource group per profile,
  e.g. `rg-hros-prod` and `rg-hros-demo`.

```bash
az group create -n rg-hros-prod -l westus2
az group create -n rg-hros-demo -l westus2
```

---

## 1. One-time: keyless CI (GitHub -> Azure OIDC federation)

No client secret is stored anywhere. GitHub presents a short-lived OIDC token;
Entra validates it against a federated credential.

```bash
# App registration + service principal for CI
az ad app create --display-name "hr-os-github-deployer"
APP_ID=$(az ad app list --display-name "hr-os-github-deployer" --query "[0].appId" -o tsv)
az ad sp create --id "$APP_ID"

# Federated credential: trust this repo's main branch (or an environment)
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<OWNER>/<REPO>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
# If you gate deploys on a GitHub Environment named "production", also add:
#   "subject": "repo:<OWNER>/<REPO>:environment:production"
# NOTE: repos created/renamed/transferred after 2026-07-15 must use GitHub's
#       immutable OIDC subject format.

# Least-privilege RBAC: scope to the resource group(s) only
SUB=$(az account show --query id -o tsv)
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/$SUB/resourceGroups/rg-hros-prod"
# ACR push + Container Apps roll are covered by Contributor at RG scope.
```

Set these in GitHub (Settings -> Secrets and variables -> Actions):

| Kind     | Name                              | Value                                  |
|----------|-----------------------------------|----------------------------------------|
| Secret   | `AZURE_CLIENT_ID`                 | `$APP_ID`                               |
| Secret   | `AZURE_TENANT_ID`                 | your Entra tenant GUID                  |
| Secret   | `AZURE_SUBSCRIPTION_ID`           | `$SUB`                                  |
| Secret   | `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA deployment token (after step 3)     |
| Variable | `AZURE_RESOURCE_GROUP`            | `rg-hros-prod`                          |
| Variable | `ACR_NAME`                        | the ACR name from the deploy outputs    |
| Variable | `CONTAINER_APP`                   | the API app name from the outputs       |
| Variable | `MIGRATE_JOB`                     | the migrate Job name from the outputs   |
| Variable | `STATIC_WEB_APP`                  | the Static Web App name from the outputs|

---

## 2. One-time: bootstrap Key Vault for deploy-time secrets

Deploy-time secrets are never committed. Put them in a small bootstrap vault that
the parameter files reference. (This is separate from the application Key Vault
the template creates.)

```bash
az keyvault create -n kv-hros-bootstrap -g rg-hros-prod -l westus2 --enable-rbac-authorization true
az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Key Vault Secrets Officer" \
  --scope "$(az keyvault show -n kv-hros-bootstrap -g rg-hros-prod --query id -o tsv)"

# Generate strong secrets and store them (prod profile names shown)
az keyvault secret set --vault-name kv-hros-bootstrap --name hros-pg-admin-password --value "$(openssl rand -base64 24)"
az keyvault secret set --vault-name kv-hros-bootstrap --name hros-app-db-password   --value "$(openssl rand -base64 24)"
az keyvault secret set --vault-name kv-hros-bootstrap --name hros-jwt-secret        --value "$(openssl rand -base64 48)"
az keyvault secret set --vault-name kv-hros-bootstrap --name hros-scim-token        --value "$(openssl rand -base64 32)"
az keyvault secret set --vault-name kv-hros-bootstrap --name hros-anthropic-api-key --value "<your-anthropic-key-or-skip>"
# Demo profile uses hrosdemo-* names; the demo does NOT need scim/anthropic.
az keyvault secret set --vault-name kv-hros-bootstrap --name hrosdemo-pg-admin-password --value "$(openssl rand -base64 24)"
az keyvault secret set --vault-name kv-hros-bootstrap --name hrosdemo-app-db-password   --value "$(openssl rand -base64 24)"
az keyvault secret set --vault-name kv-hros-bootstrap --name hrosdemo-jwt-secret        --value "$(openssl rand -base64 48)"
```

Then edit the `keyVault.id` placeholders in
`infra/azure/main.parameters.profile-{p,d}.json` to point at this vault, and fill
in the Entra `oidcIssuer` / `oidcAudience` / `scimTenantId` for Profile P.

---

## 3. Provision the infrastructure

```bash
# Compile + preview (do this every time before apply)
az bicep build --file infra/azure/main.bicep
az deployment group what-if -g rg-hros-prod \
  -f infra/azure/main.bicep -p @infra/azure/main.parameters.profile-p.json

# Apply
az deployment group create -g rg-hros-prod \
  -f infra/azure/main.bicep -p @infra/azure/main.parameters.profile-p.json
```

Capture the outputs (ACR name, API app name, migrate Job name, SWA name, public
URL) and populate the GitHub variables from step 1. Grab the SWA token:

```bash
az staticwebapp secrets list -n <STATIC_WEB_APP> -g rg-hros-prod --query "properties.apiKey" -o tsv
```

The demo is identical with the `-demo` resource group and the `profile-d` file.

---

## 4. First deploy (image + schema + SPA)

The first provision uses a public placeholder image. Trigger the deploy workflow
(`Actions -> deploy-azure -> Run workflow`, or publish a release). It will:

1. `az acr build` the API image **in ACR** (no local Docker), tagged with the
   commit SHA and `latest`.
2. Scan the image with Trivy (fails on HIGH/CRITICAL) and attach a Syft SBOM.
3. Start the **migration Job**, which (as the Postgres admin) bootstraps the
   non-superuser `hros_app` role and applies `migration.sql` through
   node-postgres - see `infra/migrate.ts`.
4. Roll the Container App to the new image.
5. Build and upload the SPA to Static Web Apps.

Confirm the migration before relying on the app:

```bash
az containerapp job execution list -n <MIGRATE_JOB> -g rg-hros-prod -o table
```

Seed synthetic demo data once (Profile D), via the reseed Job (it clears then
restores the canonical synthetic tenant):

```bash
az containerapp job start -n <RESEED_JOB> -g rg-hros-demo
```

---

## 5. Operations

**Demo self-heal.** The reseed Job runs on a 6-hour cron in Profile D; it removes
visitor-added rows and restores the canonical synthetic tenant. Adjust the cadence
via the `cronExpression` in `main.bicep`, or run it on demand with
`az containerapp job start`.

**Rollback.** Container Apps keeps revisions. To revert the API:

```bash
az containerapp revision list -n <CONTAINER_APP> -g rg-hros-prod -o table
az containerapp ingress traffic set -n <CONTAINER_APP> -g rg-hros-prod \
  --revision-weight <previous-revision>=100
```

Or redeploy by re-running the workflow against an earlier commit/release.

**Graceful shutdown.** Azure sends SIGTERM with a 30s grace window before SIGKILL.
The server flips `/readyz` to 503 on SIGTERM so Front Door / the ingress stops
sending new traffic, finishes in-flight requests, then closes the pool and Redis
within a 25s cap (see `packages/server/src/index.ts`).

---

## 6. Secret inventory

Application secrets live in the **application Key Vault** the template creates and
are read by the Container App via a user-assigned managed identity (Key Vault
Secrets User). Nothing is inlined in the app config.

| Key Vault secret      | Purpose                                              | Profile |
|-----------------------|------------------------------------------------------|---------|
| `database-url`        | App principal DSN (`hros_app`, `sslmode=require`)    | P, D    |
| `admin-database-url`  | Admin DSN, migrate Job only                          | P, D    |
| `app-db-password`     | App role password (migrate Job role bootstrap)       | P, D    |
| `jwt-secret`          | HS256 signing (demo minter / service tokens)         | P, D    |
| `redis-url`           | `rediss://` URL for rate-limit store                 | P, D    |
| `scim-token`          | SCIM bearer token (read only when `SCIM_ENABLED`)    | P       |
| `anthropic-api-key`   | AI gateway key (omit in demo for labeled fallback)   | P (opt) |

Deploy-time secrets (bootstrap vault, step 2): `*-pg-admin-password`,
`*-app-db-password`, `*-jwt-secret`, `hros-scim-token`, `hros-anthropic-api-key`.

---

## 7. Production hardening backlog (deliberate, not yet applied)

This template ships working public endpoints fronted by Front Door + WAF and the
Postgres firewall, which is enough to run. Before a regulated production go-live:

- **Private networking.** Add a VNet with delegated subnets and Private Endpoints
  for Postgres, Redis, Storage, and Key Vault; set each `publicNetworkAccess` to
  `Disabled`; integrate the Container Apps environment with the VNet. The
  `TODO(prod-hardening)` markers in `main.bicep` flag every spot.
- **Entra DB auth.** Optionally switch the app principal to Entra token auth on
  Postgres instead of a password role.
- **Customer-managed keys** for Storage and Postgres if your policy requires it.
- **Per-tenant SCIM tokens.** The current SCIM endpoint is single-tenant per
  deployment; multi-tenant token mapping is a documented seam in `routes/scim.ts`.
