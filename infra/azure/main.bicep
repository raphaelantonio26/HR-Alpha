// =============================================================================
// HR OS - Azure infrastructure (single template, two profiles).
//
// ONE template provisions BOTH deployment profiles; they differ only by
// parameters (docs/adr/0003-two-profile):
//   - Profile P (prod/SSO):  profile='P'  -> Entra OIDC, SCIM, no demo, FrontDoor
//   - Profile D (demo/no-SSO): profile='D' -> demo minter, labeled-fallback AI,
//                                              scale-to-zero, reseed Job
//
// VALIDATION STATUS: authored against verified resource schemas / API versions
// (PostgreSQL Flexible Server azure.extensions allowlist; Container Apps SIGTERM
// 30s + liveness/readiness probes; Key Vault secret references via user-assigned
// identity; GitHub->Azure OIDC for CI). It was NOT compiled in the build sandbox
// (the Bicep CLI binary host was unreachable there). Run `az bicep build
// --file infra/azure/main.bicep` and `az deployment group what-if` before any
// apply. See docs/DEPLOY-AZURE.md.
//
// SECURITY POSTURE
//   - App connects as a NON-superuser, NOBYPASSRLS Postgres role (RLS + the
//     append-only audit trigger are the real isolation; see ADR 0002).
//   - No secret is inlined: passwords arrive as @secure() params, are stored in
//     Key Vault, and the Container App reads them by reference using a
//     user-assigned managed identity (Key Vault Secrets User).
//   - TLS everywhere (Postgres sslmode=require, Redis rediss://, FD HTTPS).
//   - TODO(prod-hardening): private networking. This template uses public
//     endpoints fronted by Front Door + WAF and the Postgres firewall. For the
//     full production cutover, add a VNet with delegated subnets and Private
//     Endpoints for Postgres/Redis/Storage/Key Vault, and lock public access
//     off. Documented in DEPLOY-AZURE.md so it is a deliberate decision.
// =============================================================================

targetScope = 'resourceGroup'

// ---- Profile + naming -------------------------------------------------------
@allowed(['P', 'D'])
@description('Deployment profile: P = production/SSO, D = demo/no-SSO.')
param profile string

@description('Lowercase prefix for resource names (e.g. "hros" or "hrosdemo"). 3-11 chars.')
@minLength(3)
@maxLength(11)
param namePrefix string

@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Optional suffix to keep globally-unique names unique. Defaults to a hash of the RG id.')
param nameSuffix string = take(uniqueString(resourceGroup().id), 5)

// ---- Container image --------------------------------------------------------
@description('API image reference. First provision uses a public placeholder; CI then pushes the real image to ACR and updates the app.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

// ---- Database ---------------------------------------------------------------
@description('PostgreSQL Flexible Server admin login (member of azure_pg_admin; runs migrations).')
param pgAdminLogin string = 'hrosadmin'

@secure()
@description('PostgreSQL admin password.')
param pgAdminPassword string

@description('Non-superuser application role the API connects as.')
param appDbUser string = 'hros_app'

@secure()
@description('Password for the application DB role.')
param appDbPassword string

@description('Application database name.')
param databaseName string = 'hros'

@description('Postgres Flexible Server SKU, e.g. Standard_B2s (burstable) or Standard_D2ds_v5.')
param pgSkuName string = (profile == 'P') ? 'Standard_D2ds_v5' : 'Standard_B1ms'

@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param pgSkuTier string = (profile == 'P') ? 'GeneralPurpose' : 'Burstable'

@description('Postgres storage in GB.')
param pgStorageGB int = 32

// ---- Auth / app secrets -----------------------------------------------------
@description('Entra (OIDC) issuer, e.g. https://login.microsoftonline.com/<tenant-guid>/v2.0 . Required for Profile P; empty for D.')
param oidcIssuer string = ''

@description('Entra app audience the token aud must match (App ID URI or client id). Required for Profile P.')
param oidcAudience string = ''

@secure()
@description('HS256 secret used to sign demo session tokens (Profile D) and any service-profile HS256 tokens.')
param jwtSecret string

@description('Enable SCIM provisioning (Profile P only).')
param scimEnabled bool = false

@secure()
@description('SCIM bearer token Entra presents. Required when scimEnabled.')
param scimToken string = ''

@description('HR OS application tenant id SCIM provisions into. Required when scimEnabled.')
param scimTenantId string = ''

@secure()
@description('Anthropic API key for the server-side AI gateway. Leave EMPTY in demo for the labeled fallback (boot refuses a key in demo unless demoAllowLiveAi=true).')
param anthropicApiKey string = ''

@description('Demo: allow capped live AI (per-IP). Default false -> labeled fallback.')
param demoAllowLiveAi bool = false

// ---- Edge -------------------------------------------------------------------
@description('Deploy Azure Front Door + WAF in front of the API. Default true for prod.')
param deployFrontDoor bool = (profile == 'P')

@allowed(['Standard_AzureFrontDoor', 'Premium_AzureFrontDoor'])
@description('Front Door SKU. Premium enables managed WAF rule sets.')
param frontDoorSku string = 'Premium_AzureFrontDoor'

@description('Min replicas for the API. Prod keeps 1 warm; demo scales to zero.')
param apiMinReplicas int = (profile == 'P') ? 1 : 0

@description('Max replicas for the API.')
param apiMaxReplicas int = (profile == 'P') ? 10 : 2

// ---- Derived ----------------------------------------------------------------
var isProd = profile == 'P'
var demoMode = profile == 'D'
var authMode = empty(oidcIssuer) ? 'hs256' : 'oidc'
var tags = {
  app: 'hr-os'
  profile: profile
  managedBy: 'bicep'
}

// Resource names (storage + ACR must be alphanumeric/global-unique).
var acrName = toLower('${namePrefix}acr${nameSuffix}')
var storageName = toLower('${namePrefix}st${nameSuffix}')
var kvName = toLower('${namePrefix}-kv-${nameSuffix}')
var pgName = toLower('${namePrefix}-pg-${nameSuffix}')
var redisName = toLower('${namePrefix}-redis-${nameSuffix}')
var lawName = '${namePrefix}-law-${nameSuffix}'
var aiName = '${namePrefix}-ai-${nameSuffix}'
var acaEnvName = '${namePrefix}-aca-${nameSuffix}'
var apiAppName = '${namePrefix}-api-${nameSuffix}'
var migrateJobName = '${namePrefix}-migrate-${nameSuffix}'
var reseedJobName = '${namePrefix}-reseed-${nameSuffix}'
var swaName = '${namePrefix}-web-${nameSuffix}'
var uamiName = '${namePrefix}-id-${nameSuffix}'
var fdProfileName = '${namePrefix}-fd-${nameSuffix}'
var fdEndpointName = '${namePrefix}-api-${nameSuffix}'
var wafPolicyName = toLower(replace('${namePrefix}waf${nameSuffix}', '-', ''))

// Built-in role definition ids.
var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var roleAcrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// =============================================================================
// Identity
// =============================================================================
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: uamiName
  location: location
  tags: tags
}

// =============================================================================
// Observability: Log Analytics + (workspace-based) Application Insights
// =============================================================================
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    DisableIpMasking: false
  }
}

// =============================================================================
// Container Registry
// =============================================================================
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    adminUserEnabled: false // pull via managed identity, never admin creds
  }
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, roleAcrPull)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// =============================================================================
// Key Vault (RBAC mode) + secrets
// =============================================================================
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true // RBAC, not access policies
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled' // TODO(prod-hardening): private endpoint
  }
}

resource kvSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, uami.id, roleKeyVaultSecretsUser)
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// App principal connection string (TLS required). Stored only in Key Vault.
var appDatabaseUrl = 'postgresql://${appDbUser}:${appDbPassword}@${pg.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
// Admin connection string used ONLY by the migrate Job.
var adminDatabaseUrl = 'postgresql://${pgAdminLogin}:${pgAdminPassword}@${pg.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
// ioredis URL form (TLS). 6380 is the SSL port.
var redisUrl = 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380'

resource secretDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: { value: appDatabaseUrl }
}
resource secretAdminDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'admin-database-url'
  properties: { value: adminDatabaseUrl }
}
resource secretAppDbPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'app-db-password'
  properties: { value: appDbPassword }
}
resource secretJwt 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'jwt-secret'
  properties: { value: jwtSecret }
}
resource secretRedis 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'redis-url'
  properties: { value: redisUrl }
}
// SCIM token only meaningful in Profile P; store a placeholder otherwise so the
// reference is always resolvable (SCIM_ENABLED gates whether it is ever read).
resource secretScim 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'scim-token'
  properties: { value: empty(scimToken) ? 'unused' : scimToken }
}
// Anthropic key: store actual (prod) or a placeholder. In demo the app config
// leaves it empty unless demoAllowLiveAi; we only WIRE it into the app when set.
resource secretAnthropic 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'anthropic-api-key'
  properties: { value: empty(anthropicApiKey) ? 'unused' : anthropicApiKey }
}

// =============================================================================
// PostgreSQL Flexible Server 16 (+ pgcrypto allowlist + database)
// =============================================================================
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: tags
  sku: {
    name: pgSkuName
    tier: pgSkuTier
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: pgStorageGB }
    backup: {
      backupRetentionDays: isProd ? 14 : 7
      geoRedundantBackup: isProd ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: isProd ? 'ZoneRedundant' : 'Disabled'
    }
    authConfig: {
      passwordAuthEntra: 'Disabled'   // entra DB auth not used; app uses role+pw over TLS
      passwordAuth: 'Enabled'
    }
  }
}

// Allowlist pgcrypto (trusted extension). The migration's CREATE EXTENSION then
// succeeds. NOTE: only gen_random_uuid() is used, core in PG13+ -> pgcrypto is
// effectively optional, allowlisted only to keep migration.sql byte-for-byte.
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: {
    value: 'PGCRYPTO'
    source: 'user-override'
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow other Azure services (Container Apps egress) to reach the server.
// TODO(prod-hardening): replace with VNet integration + Private Endpoint.
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// =============================================================================
// Azure Cache for Redis (TLS only) - backs edge + AI-gateway rate limits
// =============================================================================
resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisName
  location: location
  tags: tags
  properties: {
    sku: {
      name: isProd ? 'Standard' : 'Basic'
      family: 'C'
      capacity: isProd ? 1 : 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
    }
  }
}

// =============================================================================
// Storage (Blob) - the document-store seam (S3_ENDPOINT/S3_BUCKET). Wired, not
// faked: the documents feature is not built this phase, but the bucket exists so
// the seam has a real target. Private container, TLS, no public blobs.
// =============================================================================
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: isProd ? 'Standard_ZRS' : 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled' // TODO(prod-hardening): private endpoint
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource docsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'hros-documents'
  properties: {
    publicAccess: 'None'
  }
}

// =============================================================================
// Container Apps managed environment
// =============================================================================
resource acaEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: acaEnvName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

// CORS allowlist: the SPA origin. Prefer the Front Door endpoint when deployed,
// else the Static Web App default hostname.
var swaHost = 'https://${swa.properties.defaultHostname}'
var corsOrigins = swaHost

// Common app secrets (Key Vault references via the user-assigned identity).
var appSecrets = [
  { name: 'database-url', keyVaultUrl: secretDatabaseUrl.properties.secretUri, identity: uami.id }
  { name: 'jwt-secret', keyVaultUrl: secretJwt.properties.secretUri, identity: uami.id }
  { name: 'redis-url', keyVaultUrl: secretRedis.properties.secretUri, identity: uami.id }
  { name: 'scim-token', keyVaultUrl: secretScim.properties.secretUri, identity: uami.id }
  { name: 'anthropic-api-key', keyVaultUrl: secretAnthropic.properties.secretUri, identity: uami.id }
]

// Base env shared by both profiles.
var baseEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '8080' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
  { name: 'REDIS_URL', secretRef: 'redis-url' }
  { name: 'CORS_ORIGINS', value: corsOrigins }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
  { name: 'AUTH_MODE', value: authMode }
]

// Profile P additions: OIDC + SCIM + explicit prod data plane.
var prodEnv = [
  { name: 'OIDC_ISSUER', value: oidcIssuer }
  { name: 'OIDC_AUDIENCE', value: oidcAudience }
  { name: 'SCIM_ENABLED', value: string(scimEnabled) }
  { name: 'SCIM_TOKEN', secretRef: 'scim-token' }
  { name: 'SCIM_TENANT_ID', value: scimTenantId }
  { name: 'PROD_DATA_PLANE', value: 'true' }
  { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
]

// Profile D additions: demo minter + (default) labeled fallback AI. The key is
// wired ONLY when demoAllowLiveAi is true; otherwise it is left unset so the
// fail-closed boot guard is satisfied and the gateway uses the labeled fallback.
var demoEnvBase = [
  { name: 'DEMO_MODE', value: 'true' }
  { name: 'DEMO_ALLOW_LIVE_AI', value: string(demoAllowLiveAi) }
  { name: 'SCIM_ENABLED', value: 'false' }
]
var demoEnv = demoAllowLiveAi ? concat(demoEnvBase, [ { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' } ]) : demoEnvBase

var apiEnv = concat(baseEnv, isProd ? prodEnv : demoEnv)

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: acaEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        // Lock the app's own ingress to Front Door when FD is deployed.
        ipSecurityRestrictions: deployFrontDoor ? [
          {
            name: 'AllowFrontDoorOnly'
            action: 'Allow'
            ipAddressRange: 'AzureFrontDoor.Backend'
            description: 'Only Front Door service tag may reach the app ingress.'
          }
        ] : []
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uami.id
        }
      ]
      secrets: appSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json(isProd ? '1.0' : '0.5')
            memory: isProd ? '2Gi' : '1Gi'
          }
          env: apiEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 8080 }
              initialDelaySeconds: 10
              periodSeconds: 15
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/readyz', port: 8080 }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: { path: '/healthz', port: 8080 }
              initialDelaySeconds: 3
              periodSeconds: 3
              failureThreshold: 20
            }
          ]
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: apiMaxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: { concurrentRequests: '50' }
            }
          }
        ]
      }
    }
  }
}

// =============================================================================
// Migration Job (manual trigger). Runs as ADMIN: bootstraps the app role and
// applies the schema via node-postgres (infra/migrate.ts).
// =============================================================================
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: migrateJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    environmentId: acaEnv.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 1
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uami.id
        }
      ]
      secrets: [
        { name: 'admin-database-url', keyVaultUrl: secretAdminDatabaseUrl.properties.secretUri, identity: uami.id }
        { name: 'app-db-password', keyVaultUrl: secretAppDbPassword.properties.secretUri, identity: uami.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: apiImage
          command: [ 'tsx', 'infra/migrate.ts' ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'ADMIN_DATABASE_URL', secretRef: 'admin-database-url' }
            { name: 'APP_DB_USER', value: appDbUser }
            { name: 'APP_DB_PASSWORD', secretRef: 'app-db-password' }
          ]
        }
      ]
    }
  }
}

// =============================================================================
// Reseed Job (Profile D only). Scheduled self-heal of the synthetic demo tenant
// (infra/reseed.ts). Connects as the APP role; RLS confines it to the demo tenant.
// =============================================================================
resource reseedJob 'Microsoft.App/jobs@2024-03-01' = if (demoMode) {
  name: reseedJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    environmentId: acaEnv.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 600
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        // Every 6 hours, on the hour.
        cronExpression: '0 */6 * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uami.id
        }
      ]
      secrets: [
        { name: 'database-url', keyVaultUrl: secretDatabaseUrl.properties.secretUri, identity: uami.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'reseed'
          image: apiImage
          command: [ 'tsx', 'infra/reseed.ts' ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
        }
      ]
    }
  }
}

// =============================================================================
// Static Web App (SPA hosting for @hr-os/web). CI deploys the built dist.
// =============================================================================
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: location
  tags: tags
  sku: {
    name: isProd ? 'Standard' : 'Free'
    tier: isProd ? 'Standard' : 'Free'
  }
  properties: {
    // CI pushes content via the deployment token; no repo wiring here.
    buildProperties: {
      appLocation: 'packages/web'
      outputLocation: 'dist'
    }
  }
}

// =============================================================================
// Front Door (Standard/Premium) + WAF  [Profile P by default]
// =============================================================================
resource wafPolicy 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2024-02-01' = if (deployFrontDoor) {
  name: wafPolicyName
  location: 'global'
  tags: tags
  sku: { name: frontDoorSku }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: 'Prevention'
    }
    managedRules: (frontDoorSku == 'Premium_AzureFrontDoor') ? {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
          ruleSetAction: 'Block'
        }
        {
          ruleSetType: 'Microsoft_BotManagerRuleSet'
          ruleSetVersion: '1.0'
        }
      ]
    } : {
      managedRuleSets: []
    }
  }
}

resource fdProfile 'Microsoft.Cdn/profiles@2024-02-01' = if (deployFrontDoor) {
  name: fdProfileName
  location: 'global'
  tags: tags
  sku: { name: frontDoorSku }
}

resource fdEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = if (deployFrontDoor) {
  parent: fdProfile
  name: fdEndpointName
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource fdOriginGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = if (deployFrontDoor) {
  parent: fdProfile
  name: 'api-origin-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/healthz'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 30
    }
  }
}

resource fdOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = if (deployFrontDoor) {
  parent: fdOriginGroup
  name: 'api-origin'
  properties: {
    hostName: apiApp.properties.configuration.ingress.fqdn
    originHostHeader: apiApp.properties.configuration.ingress.fqdn
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource fdRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = if (deployFrontDoor) {
  parent: fdEndpoint
  name: 'api-route'
  dependsOn: [
    fdOrigin
  ]
  properties: {
    originGroup: {
      id: fdOriginGroup.id
    }
    supportedProtocols: [ 'Https' ]
    patternsToMatch: [ '/*' ]
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
  }
}

resource fdSecurityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2024-02-01' = if (deployFrontDoor) {
  parent: fdProfile
  name: 'api-waf-association'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: {
        id: wafPolicy.id
      }
      associations: [
        {
          domains: [
            {
              id: fdEndpoint.id
            }
          ]
          patternsToMatch: [ '/*' ]
        }
      ]
    }
  }
}

// =============================================================================
// Outputs (no secrets)
// =============================================================================
output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output apiAppName string = apiApp.name
output apiIngressFqdn string = apiApp.properties.configuration.ingress.fqdn
output apiPublicUrl string = deployFrontDoor ? 'https://${fdEndpoint.properties.hostName}' : 'https://${apiApp.properties.configuration.ingress.fqdn}'
output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
output migrateJobName string = migrateJob.name
output reseedJobName string = demoMode ? reseedJob.name : 'n/a (prod)'
output keyVaultName string = kv.name
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
output managedIdentityClientId string = uami.properties.clientId
