// Every example the repository ships must be accepted as it is: a newcomer
// copies them first.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../src/config.ts'

const root = new URL('../', import.meta.url)
const secrets = { MNEMA_TOKEN: 'mnb_test', MNEMO_API_KEY: 'sk-test' }

/** The KEY=value lines of an env file, commented-out ones included when asked. */
function envFile(path: string, includeCommented: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of readFileSync(new URL(path, root), 'utf8').split('\n')) {
    const line = includeCommented ? raw.replace(/^#\s?(?=[A-Z_]+=)/, '') : raw
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m?.[1] && m[2] !== undefined && m[2] !== '') out[m[1]] = m[2]
  }
  return out
}

describe('shipped examples', () => {
  it('mnemo.config.example.json is accepted, every setting in it applied', () => {
    const file = fileURLToPath(new URL('mnemo.config.example.json', root))
    const c = loadConfig({ ...secrets, MNEMO_CONFIG: file })
    const example = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    for (const [k, v] of Object.entries(example)) {
      if (k === '$schema') continue
      assert.deepEqual((c as unknown as Record<string, unknown>)[k], v, k)
    }
  })

  it('.env.example is accepted once the secrets are filled in, also with every commented setting', () => {
    assert.equal(loadConfig({ ...envFile('.env.example', false), ...secrets }).provider, 'anthropic')
    const all = envFile('.env.example', true)
    // The commented search provider needs its key; the rest must pass as written.
    const c = loadConfig({ ...all, ...secrets, MNEMO_SEARCH_API_KEY: 'search-test' })
    assert.equal(c.searchProvider, 'brave')
  })
})
