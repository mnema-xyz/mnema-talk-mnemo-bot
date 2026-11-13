// The provider adapters against recorded API answers, through the official
// SDKs with a replaced fetch: no network, no key.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { anthropicProvider } from '../src/providers/anthropic.ts'
import { openaiProvider } from '../src/providers/openai.ts'
import { ProviderError, type ChatRequest } from '../src/providers/types.ts'

const KEY = 'fake-key-for-tests' // not a secret: the tests never send it anywhere

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

describe('OpenAI provider (Responses API)', () => {
  it('sends tools as functions, replays the output items, and returns the tool call and the answer', async () => {
    const first = {
      id: 'resp_1', object: 'response', status: 'completed', model: 'm', incomplete_details: null,
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'weather', arguments: '{"place":"Marbella"}', status: 'completed' },
      ],
      usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 10 } },
    }
    const second = {
      id: 'resp_2', object: 'response', status: 'completed', model: 'm', incomplete_details: null,
      output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'It is 18 °C.', annotations: [] }] }],
      usage: { input_tokens: 200, output_tokens: 8, total_tokens: 208, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    }
    const bodies: Record<string, unknown>[] = []
    const urls: string[] = []
    let n = 0
    const fetch = ((url: string | URL | Request, init?: RequestInit) => {
      urls.push(url instanceof Request ? url.url : url.toString())
      bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>)
      return Promise.resolve(Response.json(n++ === 0 ? first : second))
    }) as typeof globalThis.fetch
    const p = openaiProvider({ name: 'openai', apiKey: KEY, model: 'm', timeoutMs: 5000, fetch })
    const tools = [{ name: 'weather', description: 'Weather', inputSchema: { type: 'object', properties: { place: { type: 'string' } } } }]

    const r1 = await p.chat({ ...req(), tools })
    assert.equal(r1.stop, 'tool_use')
    assert.deepEqual(r1.toolCalls, [{ id: 'call_1', name: 'weather', input: { place: 'Marbella' } }])
    assert.deepEqual(r1.usage, { inputTokens: 120, outputTokens: 30 })
    assert.match(urls[0] ?? '', /\/responses$/)
    assert.equal(bodies[0]?.store, false)
    assert.equal(bodies[0]?.instructions, 'You are Mnemo.')
    assert.deepEqual((bodies[0]?.tools as unknown[])[0], { type: 'function', name: 'weather', description: 'Weather', parameters: tools[0]?.inputSchema, strict: false })

    const r2 = await p.chat({
      ...req(),
      tools,
      turns: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: '', toolCalls: r1.toolCalls, raw: r1.raw },
        { role: 'tool', results: [{ id: 'call_1', name: 'weather', content: '{"t":18}', isError: false }] },
      ],
    })
    assert.equal(r2.text, 'It is 18 °C.')
    assert.equal(r2.stop, 'end')
    const input = bodies[1]?.input as Record<string, unknown>[]
    assert.deepEqual(input.map((i) => i.type ?? i.role), ['user', 'reasoning', 'function_call', 'function_call_output'])
    assert.equal(input[1]?.encrypted_content, 'opaque', 'reasoning goes back unchanged')
    assert.deepEqual(input[3], { type: 'function_call_output', call_id: 'call_1', output: '{"t":18}' })
  })

  it('reports a cut answer and a refusal', async () => {
    const cut = { id: 'r', object: 'response', status: 'incomplete', model: 'm', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', id: 'x', role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: 'Part', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }
    const p1 = openaiProvider({ name: 'openai', apiKey: KEY, model: 'm', timeoutMs: 5000, fetch: (() => Promise.resolve(Response.json(cut))) as typeof globalThis.fetch })
    assert.equal((await p1.chat(req())).stop, 'max_tokens')
    const refused = { ...cut, status: 'completed', incomplete_details: null, output: [{ type: 'message', id: 'x', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }] }] }
    const p2 = openaiProvider({ name: 'openai', apiKey: KEY, model: 'm', timeoutMs: 5000, fetch: (() => Promise.resolve(Response.json(refused))) as typeof globalThis.fetch })
    assert.equal((await p2.chat(req())).stop, 'refusal')
  })
})
