/**
 * Host-side discovery of OpenCode Go routes: which `llm-pi-ai.providers`
 * entries point at the Go endpoint, and which credential reference each one
 * resolves through.
 *
 * This module is pure — it reads a parsed settings document (never the disk)
 * and returns accounts, so every labelling and grouping rule is testable
 * without a harness home.
 */

/** One managed route as declared in `settings.yaml`. */
export interface GoRoute {
  /** The settings key (`opencode-go-1-glm-5-3-flash`). */
  provider: string
  /** Credential reference the route resolves through (`OPENCODE_GO_1_API_KEY`). */
  apiKeyEnv: string
  /** Display name declared for the route, when present. */
  displayName: string
  /** Origin the route points at. */
  origin: string
  /** Model ids the route exposes. */
  models: readonly string[]
}

/** One credential's worth of routes: the unit the usage endpoint answers for. */
export interface AccountSeed {
  /** Stable identity — the credential reference. */
  apiKeyEnv: string
  /** Route keys sharing the credential, in settings order. */
  providers: readonly string[]
  /** Model ids across those routes, deduplicated and sorted. */
  models: readonly string[]
  /** Label for display. */
  label: string
  /** Origin the routes point at. */
  origin: string
}

const PROVIDER_SECTION = 'llm-pi-ai'
const CREDENTIAL_PREFIX = 'OPENCODE_GO_'

/**
 * The origin of a Go route: `https://opencode.ai/zen/go/v1`, with any trailing
 * slash removed so `${origin}${path}` never doubles a separator.
 * @param baseURL - the route's declared base URL.
 * @returns the normalized origin, or undefined when it is not a Go endpoint.
 */
export function openCodeGoOrigin(baseURL: string): string | undefined {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return undefined
  }
  if (url.hostname !== 'opencode.ai') return undefined
  const path = url.pathname.replace(/\/+$/, '')
  if (!path.startsWith('/zen/go')) return undefined
  return `${url.protocol}//${url.host}${path}`
}

/**
 * Collect every OpenCode Go route declared in a settings document.
 * @param settings - the parsed `settings.yaml` document.
 * @returns routes in a stable (provider-name) order.
 */
export function collectGoRoutes(settings: unknown): GoRoute[] {
  const providers = providerTable(settings)
  const routes: GoRoute[] = []
  for (const [provider, value] of Object.entries(providers)) {
    if (!isRecord(value)) continue
    const apiKeyEnv = typeof value.apiKeyEnv === 'string' ? value.apiKeyEnv : ''
    if (apiKeyEnv.length === 0) continue
    const baseURL = typeof value.baseURL === 'string' ? value.baseURL : ''
    const origin = openCodeGoOrigin(baseURL)
    if (origin === undefined) continue
    const displayName = typeof value.displayName === 'string' ? value.displayName : ''
    routes.push({ provider, apiKeyEnv, displayName, origin, models: modelIds(value.models) })
  }
  return routes.sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * Group routes into the accounts the usage endpoint answers for.
 * @param routes - routes from {@link collectGoRoutes}.
 * @returns one seed per credential reference, in first-seen order.
 */
export function groupAccounts(routes: readonly GoRoute[]): AccountSeed[] {
  const byCredential = new Map<string, { providers: string[]; models: Set<string>; names: string[]; origin: string }>()
  for (const route of routes) {
    const entry = byCredential.get(route.apiKeyEnv)
    if (entry === undefined) {
      byCredential.set(route.apiKeyEnv, {
        providers: [route.provider],
        models: new Set(route.models),
        names: route.displayName.length > 0 ? [route.displayName] : [],
        origin: route.origin,
      })
      continue
    }
    entry.providers.push(route.provider)
    for (const model of route.models) entry.models.add(model)
    if (route.displayName.length > 0) entry.names.push(route.displayName)
  }

  return [...byCredential.entries()].map(([apiKeyEnv, entry]) => ({
    apiKeyEnv,
    providers: [...entry.providers].sort((left, right) => left.localeCompare(right)),
    models: [...entry.models].sort((left, right) => left.localeCompare(right)),
    label: accountLabel(apiKeyEnv, entry.names),
    origin: entry.origin,
  }))
}

/**
 * Label an account from its routes' display names, falling back to the
 * credential reference. Route display names carry the human account name
 * (`OpenCodeGo_1 · GLM-5.3 Flash`); the shared prefix before ` · ` is that name
 * and is what makes two accounts tellable apart in the strip.
 * @param apiKeyEnv - the credential reference.
 * @param displayNames - display names of the routes sharing the credential.
 * @returns the display label.
 */
export function accountLabel(apiKeyEnv: string, displayNames: readonly string[]): string {
  const prefixes = displayNames
    .map(name => name.split('·')[0]?.trim() ?? '')
    .filter(prefix => prefix.length > 0)
  if (prefixes.length > 0) {
    const first = prefixes[0]
    if (prefixes.every(prefix => prefix === first)) return compactLabel(first)
    let shared = first
    for (const prefix of prefixes.slice(1)) shared = commonPrefix(shared, prefix)
    if (shared.length > 0) return compactLabel(shared)
    return compactLabel(first)
  }
  return credentialLabel(apiKeyEnv)
}

/**
 * Drop the mail domain from a route-derived label: the strip is one line wide,
 * and `OpenCodeGo_siwu.wsw@gmail.com` names the same account as
 * `OpenCodeGo_siwu.wsw`.
 * @param label - the label derived from route display names.
 * @returns the compact label.
 */
export function compactLabel(label: string): string {
  const at = label.indexOf('@')
  return at > 0 ? label.slice(0, at) : label
}

/**
 * Human label for a credential reference: `OPENCODE_GO_1_API_KEY` → `账号 1`,
 * `OPENCODE_GO_WEISIWU123456_API_KEY` → `weisiwu123456`.
 * @param apiKeyEnv - the credential reference.
 * @returns the label.
 */
export function credentialLabel(apiKeyEnv: string): string {
  let core = apiKeyEnv
  if (core.startsWith(CREDENTIAL_PREFIX)) core = core.slice(CREDENTIAL_PREFIX.length)
  core = core.replace(/_API_KEY$/, '')
  if (/^\d+$/.test(core)) return `账号 ${core}`
  return core.length > 0 ? core.toLowerCase() : apiKeyEnv
}

/**
 * Mask a credential for display: keep a short head and the last four
 * characters, so two keys of the same account family stay distinguishable
 * without carrying a usable secret into the browser.
 * @param secret - the resolved credential value.
 * @returns the masked form.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 12) return '••••'
  return `${secret.slice(0, 7)}…${secret.slice(-4)}`
}

function providerTable(settings: unknown): Record<string, unknown> {
  if (!isRecord(settings)) return {}
  const section = settings[PROVIDER_SECTION]
  if (!isRecord(section)) return {}
  const providers = section.providers
  if (!isRecord(providers)) return {}
  return providers
}

function modelIds(models: unknown): readonly string[] {
  if (!Array.isArray(models)) return []
  const ids: string[] = []
  for (const model of models) {
    if (isRecord(model) && typeof model.id === 'string' && model.id.length > 0) ids.push(model.id)
  }
  return ids
}

/**
 * Longest common prefix of two labels, with a dangling separator trimmed and
 * the result trimmed of whitespace.
 * @param left - first label.
 * @param right - second label.
 * @returns the shared prefix.
 */
function commonPrefix(left: string, right: string): string {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return left.slice(0, index).trim().replace(/[·_\-]$/, '').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
