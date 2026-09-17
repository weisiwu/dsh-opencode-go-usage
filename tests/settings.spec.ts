import { describe, expect, it } from 'vitest'
import { createSecretResolver, discoverAccounts, parseCredentialRefs, readSettingsDocument, resolveDshHome } from '../src/settings.ts'

const CREDENTIALS_YAML = [
  'version: 1',
  'refs:',
  '  HUOSHANG_API_KEY: ark-abc',
  '  OPENCODE_GO_1_API_KEY: sk-example0000000000000000000000000000000000000000000000001KEY',
  '  OPENCODE_GO_2_API_KEY: sk-example0000000000000000000000000000000000000000000000002KEY',
  'records:',
  '  client-connection/browser-session:',
  '    kind: grant',
  '',
].join('\n')

const SETTINGS_YAML = [
  'llm-pi-ai:',
  '  providers:',
  '    opencode-go-1-glm-5-3:',
  '      displayName: OpenCodeGo_1 · GLM-5.3',
  '      apiKeyEnv: OPENCODE_GO_1_API_KEY',
  '      baseURL: https://opencode.ai/zen/go/v1',
  '      models:',
  '        - id: glm-5.3',
  '    deepseek-official:',
  '      displayName: DeepSeek',
  '      apiKeyEnv: DEEPSEEK_API_KEY',
  '      baseURL: https://api.deepseek.com',
  '      models:',
  '        - id: deepseek-v4-flash',
  '',
].join('\n')

/** A reader over an in-memory file table. */
function readerFor(files: Record<string, string>): (path: string) => Promise<string> {
  return async (path: string) => {
    const name = path.split('/').pop() ?? path
    const content = files[name]
    if (content === undefined) throw new Error(`ENOENT: ${path}`)
    return content
  }
}

describe('resolveDshHome', () => {
  it('prefers $DSH_HOME and otherwise uses ~/.dsh', () => {
    expect(resolveDshHome({ DSH_HOME: '/tmp/harness' } as NodeJS.ProcessEnv)).toBe('/tmp/harness')
    expect(resolveDshHome({ DSH_HOME: '' } as NodeJS.ProcessEnv).endsWith('/.dsh')).toBe(true)
    expect(resolveDshHome({} as NodeJS.ProcessEnv).endsWith('/.dsh')).toBe(true)
  })
})

describe('parseCredentialRefs', () => {
  it('reads the refs table out of a credential document', () => {
    const refs = parseCredentialRefs(CREDENTIALS_YAML)
    expect(Object.keys(refs)).toEqual(['HUOSHANG_API_KEY', 'OPENCODE_GO_1_API_KEY', 'OPENCODE_GO_2_API_KEY'])
    expect(refs.OPENCODE_GO_1_API_KEY).toBe('sk-example0000000000000000000000000000000000000000000000001KEY')
  })

  it('returns nothing for junk instead of throwing', () => {
    expect(parseCredentialRefs('{{{ not yaml')).toEqual({})
    expect(parseCredentialRefs('version: 1')).toEqual({})
    expect(parseCredentialRefs('refs: [1, 2]')).toEqual({})
  })
})

describe('createSecretResolver', () => {
  it('prefers the process environment over the stored table', async () => {
    const resolve = createSecretResolver({
      homeDir: '/home/.dsh',
      env: { OPENCODE_GO_1_API_KEY: 'from-env' } as NodeJS.ProcessEnv,
      readFileImpl: readerFor({ '.credentials.yaml': CREDENTIALS_YAML }),
    })
    expect(await resolve('OPENCODE_GO_1_API_KEY')).toBe('from-env')
  })

  it('falls back to the stored table', async () => {
    const resolve = createSecretResolver({
      homeDir: '/home/.dsh',
      env: {} as NodeJS.ProcessEnv,
      readFileImpl: readerFor({ '.credentials.yaml': CREDENTIALS_YAML }),
    })
    expect(await resolve('OPENCODE_GO_2_API_KEY')).toBe(
      'sk-example0000000000000000000000000000000000000000000000002KEY',
    )
  })

  it('resolves nothing for an unknown reference or an unreadable store', async () => {
    const resolve = createSecretResolver({
      homeDir: '/home/.dsh',
      env: {} as NodeJS.ProcessEnv,
      readFileImpl: readerFor({}),
    })
    expect(await resolve('OPENCODE_GO_9_API_KEY')).toBeUndefined()
  })
})

describe('settings discovery', () => {
  it('parses the settings document from the harness home', async () => {
    const document = await readSettingsDocument('/home/.dsh', readerFor({ 'settings.yaml': SETTINGS_YAML }))
    expect(document).toMatchObject({ 'llm-pi-ai': { providers: { 'opencode-go-1-glm-5-3': {} } } })
  })

  it('returns undefined for a missing or unparsable document', async () => {
    expect(await readSettingsDocument('/home/.dsh', readerFor({}))).toBeUndefined()
    expect(await readSettingsDocument('/home/.dsh', readerFor({ 'settings.yaml': '{{{' }))).toBeUndefined()
  })

  it('discovers only the Go accounts declared in settings', async () => {
    const accounts = await discoverAccounts('/home/.dsh', readerFor({ 'settings.yaml': SETTINGS_YAML }))
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.apiKeyEnv).toBe('OPENCODE_GO_1_API_KEY')
    expect(accounts[0]?.label).toBe('OpenCodeGo_1')
    expect(accounts[0]?.providers).toEqual(['opencode-go-1-glm-5-3'])
  })
})
