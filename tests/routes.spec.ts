import { describe, expect, it } from 'vitest'
import { accountLabel, collectGoRoutes, credentialLabel, groupAccounts, maskSecret, openCodeGoOrigin } from '../src/routes.ts'

/** A settings document shaped like the harness's own, with decoys. */
const SETTINGS = {
  'llm-pi-ai': {
    providers: {
      'opencode-go-1-glm-5-3-flash': {
        displayName: 'OpenCodeGo_1 · GLM-5.3 Flash',
        apiKeyEnv: 'OPENCODE_GO_1_API_KEY',
        api: 'openai-completions',
        baseURL: 'https://opencode.ai/zen/go/v1',
        models: [
          { id: 'glm-5.3-flash' },
          { id: 'glm-5.3' },
        ],
      },
      'opencode-go-1-deepseek-v41': {
        displayName: 'OpenCodeGo_1 · DeepSeek V4.1 Flash',
        apiKeyEnv: 'OPENCODE_GO_1_API_KEY',
        baseURL: 'https://opencode.ai/zen/go/v1',
        models: [{ id: 'deepseek-v4.1-flash' }],
      },
      'opencode-go-weisiwu123456-glm-5-3': {
        displayName: 'OpenCodeGo_weisiwu123456@gmail.com · GLM-5.3',
        apiKeyEnv: 'OPENCODE_GO_WEISIWU123456_API_KEY',
        baseURL: 'https://opencode.ai/zen/go/v1',
        models: [{ id: 'glm-5.3' }],
      },
      // Decoys: the same host on a non-Go path, a route with no credential
      // reference, and an unrelated provider that shares the name family.
      'opencode-go-wrong-path': {
        displayName: 'OpenCodeGo · Zen',
        apiKeyEnv: 'OPENCODE_GO_ZEN_API_KEY',
        baseURL: 'https://opencode.ai/zen/v1',
        models: [{ id: 'gpt-5.6-luna' }],
      },
      'opencode-go-no-credential': {
        displayName: 'OpenCodeGo · 无凭据',
        baseURL: 'https://opencode.ai/zen/go/v1',
        models: [{ id: 'glm-5.3' }],
      },
      'deepseek-official': {
        displayName: 'DeepSeek 官方',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseURL: 'https://api.deepseek.com',
        models: [{ id: 'deepseek-v4-flash' }],
      },
    },
  },
}

describe('openCodeGoOrigin', () => {
  it('accepts the Go origin with and without a trailing slash', () => {
    expect(openCodeGoOrigin('https://opencode.ai/zen/go/v1')).toBe('https://opencode.ai/zen/go/v1')
    expect(openCodeGoOrigin('https://opencode.ai/zen/go/v1/')).toBe('https://opencode.ai/zen/go/v1')
  })

  it('rejects other paths, hosts and junk', () => {
    expect(openCodeGoOrigin('https://opencode.ai/zen/v1')).toBeUndefined()
    expect(openCodeGoOrigin('https://api.deepseek.com')).toBeUndefined()
    expect(openCodeGoOrigin('https://example.com/zen/go/v1')).toBeUndefined()
    expect(openCodeGoOrigin('not a url')).toBeUndefined()
  })
})

describe('collectGoRoutes', () => {
  const routes = collectGoRoutes(SETTINGS)

  it('keeps only credentialed Go routes and sorts them stably', () => {
    expect(routes.map(route => route.provider)).toEqual([
      'opencode-go-1-deepseek-v41',
      'opencode-go-1-glm-5-3-flash',
      'opencode-go-weisiwu123456-glm-5-3',
    ])
  })

  it('carries the credential reference and model ids through', () => {
    const route = routes.find(candidate => candidate.provider === 'opencode-go-1-glm-5-3-flash')
    expect(route?.apiKeyEnv).toBe('OPENCODE_GO_1_API_KEY')
    expect(route?.models).toEqual(['glm-5.3-flash', 'glm-5.3'])
    expect(route?.origin).toBe('https://opencode.ai/zen/go/v1')
  })

  it('tolerates a malformed document', () => {
    expect(collectGoRoutes(undefined)).toEqual([])
    expect(collectGoRoutes({})).toEqual([])
    expect(collectGoRoutes({ 'llm-pi-ai': { providers: 'nope' } })).toEqual([])
  })
})

describe('groupAccounts', () => {
  const accounts = groupAccounts(collectGoRoutes(SETTINGS))

  it('collapses routes that share a credential into one account', () => {
    expect(accounts.map(account => account.apiKeyEnv)).toEqual([
      'OPENCODE_GO_1_API_KEY',
      'OPENCODE_GO_WEISIWU123456_API_KEY',
    ])
    const first = accounts[0]
    expect(first.providers).toEqual(['opencode-go-1-deepseek-v41', 'opencode-go-1-glm-5-3-flash'])
    expect(first.models).toEqual(['deepseek-v4.1-flash', 'glm-5.3', 'glm-5.3-flash'])
  })

  it('labels the account from the shared display-name prefix', () => {
    expect(accounts.map(account => account.label)).toEqual(['OpenCodeGo_1', 'OpenCodeGo_weisiwu123456'])
  })
})

describe('accountLabel', () => {
  it('uses the shared prefix of the display names', () => {
    expect(accountLabel('X', ['OpenCodeGo_1 · A', 'OpenCodeGo_1 · B'])).toBe('OpenCodeGo_1')
  })

  it('drops the mail domain, which the strip has no room for', () => {
    expect(accountLabel('X', ['OpenCodeGo_siwu.wsw@gmail.com · GLM-5.3'])).toBe('OpenCodeGo_siwu.wsw')
  })

  it('falls back to the longest common prefix when names disagree', () => {
    expect(accountLabel('X', ['OpenCodeGo_2 · A', 'OpenCodeGo_2 · B'])).toBe('OpenCodeGo_2')
  })

  it('falls back to the credential reference when no display name is present', () => {
    expect(accountLabel('OPENCODE_GO_2_API_KEY', [])).toBe('账号 2')
    expect(accountLabel('OPENCODE_GO_WEIYL25441_API_KEY', [])).toBe('weiyl25441')
  })
})

describe('credentialLabel', () => {
  it('renders numeric accounts and named accounts differently', () => {
    expect(credentialLabel('OPENCODE_GO_1_API_KEY')).toBe('账号 1')
    expect(credentialLabel('OPENCODE_GO_12_API_KEY')).toBe('账号 12')
    expect(credentialLabel('OPENCODE_GO_SIWUWSW_API_KEY')).toBe('siwuwsw')
  })
})

describe('maskSecret', () => {
  it('keeps a short head and the last four characters', () => {
    const secret = 'sk-example0000000000000000000000000000000000000000000000001KEY'
    expect(maskSecret(secret)).toBe('sk-exam…1KEY')
  })

  it('hides short values entirely', () => {
    expect(maskSecret('short')).toBe('••••')
    expect(maskSecret('')).toBe('••••')
  })
})
