import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLogger, redact } from '../src/log.ts'

describe('log', () => {
  it('redacts secret-looking fields but keeps token counts', () => {
    assert.deepEqual(redact({ apiKey: 'sk-1', token: 't', input_tokens: 5, ok: true }), { apiKey: '[redacted]', token: '[redacted]', input_tokens: 5, ok: true })
  })

  it('keeps the cause code of a network error, so DNS, refused and TLS failures differ', () => {
    const lines: string[] = []
    const log = createLogger('debug', (l) => lines.push(l))
    const err = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) })
    log.warn('connect_failed', { error: err })
    const out = JSON.parse(lines[0] ?? '{}') as { error: Record<string, unknown> }
    assert.deepEqual(out.error, { name: 'TypeError', message: 'fetch failed', cause: 'ECONNREFUSED' })
  })
})
