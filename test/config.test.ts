import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ConfigError, loadConfig } from '../src/config.ts'

const minimal = { MNEMA_URL: 'https://talk.example.org/', MNEMA_TOKEN: 'mnb_test', MNEMO_API_KEY: 'sk-test' }

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env)
  } catch (err) {
    if (err instanceof ConfigError) return err.problems
    throw err
  }
  return []
}

describe('config', () => {
  it('applies defaults: Anthropic, a cheap model, all key-free tools', () => {
    const c = loadConfig(minimal)
    assert.equal(c.mnemaUrl, 'https://talk.example.org')
    assert.equal(c.provider, 'anthropic')
    assert.equal(c.model, 'claude-haiku-5-5')
    assert.equal(c.sendDisplayName, false)
    assert.equal(c.priceInputPerMTok, 0.1)
    assert.ok(c.tools.includes('weather'))
    assert.deepEqual(c.allowedChannels, [])
  })

  it('names every missing or wrong variable at once', () => {
    const p = problems({ MNEMO_PROVIDER: 'openai', MNEMO_MAX_TOOL_CALLS: 'lots', MNEMO_TOOLS: 'weather,shell' })
    assert.ok(p.some((x) => x.startsWith('MNEMA_URL: is required')), p.join('\n'))
    assert.ok(p.some((x) => x.startsWith('MNEMO_MAX_TOOL_CALLS:')))
    assert.ok(p.some((x) => x.startsWith('MNEMO_TOOLS:')))
    assert.ok(p.some((x) => x.startsWith('MNEMA_TOKEN')))
  })

  it('checks what each provider needs', () => {
    assert.ok(problems({ ...minimal, MNEMO_PROVIDER: 'openai' }).some((p) => p.startsWith('MNEMO_MODEL is required')))
    assert.ok(problems({ ...minimal, MNEMO_PROVIDER: 'openai-compatible', MNEMO_MODEL: 'llama3.2' }).some((p) => p.startsWith('MNEMO_BASE_URL is required')))
    const { MNEMO_API_KEY, ...noKey } = minimal
    assert.ok(problems(noKey).some((p) => p.startsWith('MNEMO_API_KEY')))
    // A local server needs no key.
    const c = loadConfig({ ...noKey, MNEMO_PROVIDER: 'openai-compatible', MNEMO_MODEL: 'llama3.2', MNEMO_BASE_URL: 'http://localhost:11434/v1' })
    assert.equal(c.apiKey, '')
  })

  it('reads secrets from *_FILE and refuses both forms at once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-'))
    writeFileSync(join(dir, 'token'), 'mnb_from_file\n')
    const { MNEMA_TOKEN, ...rest } = minimal
    assert.equal(loadConfig({ ...rest, MNEMA_TOKEN_FILE: join(dir, 'token') }).mnemaToken, 'mnb_from_file')
    assert.ok(problems({ ...minimal, MNEMA_TOKEN_FILE: join(dir, 'token') }).some((p) => p.includes('both set')))
  })

  it('takes a JSON config file, lets the environment win, and refuses secrets in it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-'))
    const file = join(dir, 'mnemo.config.json')
    writeFileSync(file, JSON.stringify({ $schema: './x.json', maxToolCalls: 2, allowedChannels: ['a', 'b'], memberLimitPerMinute: 9 }))
    const c = loadConfig({ ...minimal, MNEMO_CONFIG: file, MNEMO_MEMBER_LIMIT_PER_MINUTE: '3' })
    assert.equal(c.maxToolCalls, 2)
    assert.deepEqual(c.allowedChannels, ['a', 'b'])
    assert.equal(c.memberLimitPerMinute, 3)

    writeFileSync(file, JSON.stringify({ apiKey: 'sk-oops', colour: 'blue' }))
    const p = problems({ ...minimal, MNEMO_CONFIG: file })
    assert.ok(p.some((x) => x.includes('"apiKey" looks like a secret')))
    assert.ok(p.some((x) => x.includes('unknown setting "colour"')))
  })

  it('needs prices for a cost budget on an unknown model', () => {
    const p = problems({ ...minimal, MNEMO_MODEL: 'some-new-model', MNEMO_DAILY_COST_BUDGET_USD: '1' })
    assert.ok(p.some((x) => x.startsWith('MNEMO_DAILY_COST_BUDGET_USD needs prices')))
  })

  it('pairs the search provider with its key', () => {
    assert.ok(problems({ ...minimal, MNEMO_SEARCH_PROVIDER: 'brave' }).some((p) => p.includes('MNEMO_SEARCH_API_KEY is missing')))
    assert.equal(loadConfig({ ...minimal, MNEMO_SEARCH_PROVIDER: 'brave', MNEMO_SEARCH_API_KEY: 'b' }).searchApiKey, 'b')
  })
})
