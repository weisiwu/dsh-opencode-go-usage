/**
 * Host-side harness-state access: locate the harness home, read the settings
 * document that declares model routes, and resolve credential references.
 *
 * The two stores this reads are the harness's own:
 *  - `<home>/settings.yaml` — `llm-pi-ai.providers`, the model route table;
 *  - the process environment, then `<home>/.credentials.yaml` `refs` — the
 *    credential values behind each route's `apiKeyEnv`.
 *
 * Nothing here writes, and every read failure degrades to "nothing found"
 * rather than an exception, so a missing file can never take the strip down.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { collectGoRoutes, groupAccounts, type AccountSeed } from './routes.ts'
import type { SecretResolver } from './usage-service.ts'

/** Reads a file as UTF-8 text. */
export type FileReader = (path: string) => Promise<string>

/**
 * Resolve the harness home the same way the harness does: `$DSH_HOME`, else
 * `~/.dsh`.
 * @param env - process environment (injectable for tests).
 * @returns the absolute harness home.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME
  if (typeof configured === 'string' && configured.length > 0) return configured
  return join(homedir(), '.dsh')
}

/**
 * Read and parse the settings document.
 * @param homeDir - the harness home.
 * @param readFileImpl - file reader (injectable for tests).
 * @returns the parsed document, or undefined when it is absent or unparsable.
 */
export async function readSettingsDocument(
  homeDir: string,
  readFileImpl: FileReader = path => readFile(path, 'utf8'),
): Promise<unknown> {
  try {
    return parseYaml(await readFileImpl(join(homeDir, 'settings.yaml')))
  } catch {
    return undefined
  }
}

/**
 * Discover the OpenCode Go accounts declared by the current settings.
 * @param homeDir - the harness home.
 * @param readFileImpl - file reader (injectable for tests).
 * @returns the accounts the usage endpoint can answer for.
 */
export async function discoverAccounts(
  homeDir: string,
  readFileImpl: FileReader = path => readFile(path, 'utf8'),
): Promise<AccountSeed[]> {
  const document = await readSettingsDocument(homeDir, readFileImpl)
  return groupAccounts(collectGoRoutes(document))
}

/**
 * Build a credential resolver over the two places a reference can live: the
 * process environment and the harness credential table.
 * @param options - harness home, environment and file reader.
 * @returns a resolver that never throws on a missing or unreadable store.
 */
export function createSecretResolver(options: {
  homeDir: string
  env?: NodeJS.ProcessEnv
  readFileImpl?: FileReader
}): SecretResolver {
  const env = options.env ?? process.env
  const readFileImpl = options.readFileImpl ?? (path => readFile(path, 'utf8'))
  let refsPromise: Promise<Record<string, string>> | undefined

  const loadRefs = async (): Promise<Record<string, string>> => {
    if (refsPromise === undefined) {
      refsPromise = (async () => {
        try {
          return parseCredentialRefs(await readFileImpl(join(options.homeDir, '.credentials.yaml')))
        } catch {
          return {}
        }
      })()
    }
    return await refsPromise
  }

  return async (ref: string) => {
    const fromEnv = env[ref]
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
    const refs = await loadRefs()
    const stored = refs[ref]
    return typeof stored === 'string' && stored.length > 0 ? stored : undefined
  }
}

/**
 * Pull the `refs` string map out of a credential document.
 * @param text - the raw `.credentials.yaml` text.
 * @returns reference → value; empty when the document is unusable.
 */
export function parseCredentialRefs(text: string): Record<string, string> {
  let document: unknown
  try {
    document = parseYaml(text)
  } catch {
    return {}
  }
  if (!isRecord(document) || !isRecord(document.refs)) return {}
  const refs: Record<string, string> = {}
  for (const [key, value] of Object.entries(document.refs)) {
    if (typeof value === 'string' && value.length > 0) refs[key] = value
  }
  return refs
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
