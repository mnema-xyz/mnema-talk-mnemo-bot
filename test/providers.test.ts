// The provider adapters against recorded API answers, through the official
// SDKs with a replaced fetch: no network, no key.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { anthropicProvider } from '../src/providers/anthropic.ts'
import { openaiProvider } from '../src/providers/openai.ts'
import { ProviderError, type ChatRequest } from '../src/providers/types.ts'

const KEY = 'sk-test-0123456789abcdef'

function answering(status: number, body: unknown): typeof fetch & { bodies: unknown[] } {
  const bodies: unknown[] = []
  const f = (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined)
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  }
  return Object.assign(f, { bodies }) as typeof fetch & { bodies: unknown[] }
}

const req = (): ChatRequest => ({
  system: 'You are Mnemo.',
  turns: [{ role: 'user', text: 'hi' }],
  tools: [],
  maxOutputTokens: 256,
  signal: AbortSignal.timeout(5000),
})

async function failure(p: { chat: (r: ChatRequest) => Promise<unknown> }): Promise<ProviderError> {
  try {
    await p.chat(req())
  } catch (err) {
    assert.ok(err instanceof ProviderError)
    return err
  }
  throw new Error('expected a failure')
}

describe('provider errors', () => {
  it('Anthropic: keeps the error type and message for the log, never the key', async () => {
    const fetch = answering(400, { type: 'error', error: { type: 'invalid_request_error', message: 'model: not-a-model is not a valid model' } })
    const err = await failure(anthropicProvider({ apiKey: KEY, model: 'not-a-model', effort: 'low', timeoutMs: 5000, fetch }))
    assert.equal(err.status, 400)
    assert.match(err.message, /answered with an error \(400\)/)
    assert.match(err.detail ?? '', /invalid_request_error/)
    assert.match(err.detail ?? '', /not a valid model/)
    assert.doesNotMatch(JSON.stringify(err), new RegExp(KEY))
  })

  it('OpenAI-compatible: the same', async () => {
    const fetch = answering(404, { error: { type: 'invalid_request_error', code: 'model_not_found', message: 'The model x does not exist' } })
    const err = await failure(openaiProvider({ name: 'openai-compatible', apiKey: KEY, model: 'x', baseUrl: 'http://127.0.0.1:9/v1', timeoutMs: 5000, fetch }))
    assert.equal(err.status, 404)
    assert.match(err.detail ?? '', /model_not_found|does not exist/)
    assert.doesNotMatch(JSON.stringify(err), new RegExp(KEY))
  })
})
