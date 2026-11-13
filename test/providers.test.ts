// The provider adapters against recorded API answers, through the official
// SDKs with a replaced fetch: no network, no key.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { silentLogger } from '../src/log.ts'
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

describe('Anthropic prompt caching', () => {
  const message = (usage: Record<string, number>) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 5, output_tokens: 7, ...usage },
  })
  const provider = (fetch: typeof globalThis.fetch, log?: { debug: (m: string, f?: Record<string, unknown>) => void }) =>
    anthropicProvider({ apiKey: KEY, model: 'claude-haiku-5-5', effort: 'low', timeoutMs: 5000, fetch, ...(log ? { log: { ...silentLogger, ...log } } : {}) })

  it('marks the system prompt and lets the API place a breakpoint on the conversation tail', async () => {
    const fetch = answering(200, message({}))
    await provider(fetch).chat({ ...req(), tools: [{ name: 'weather', description: 'Weather', inputSchema: { type: 'object' } }] })
    const body = fetch.bodies[0] as { cache_control?: unknown; system?: unknown; tools?: unknown[] }
    assert.deepEqual(body.cache_control, { type: 'ephemeral' })
    assert.deepEqual(body.system, [{ type: 'text', text: 'You are Mnemo.', cache_control: { type: 'ephemeral' } }])
    assert.equal(body.tools?.length, 1, 'tools render before the system prompt and are covered by its breakpoint')
  })

  it('keeps the system prompt byte-identical while the time still reaches the model', async () => {
    const fetch = answering(200, message({}))
    const p = provider(fetch)
    const turns: ChatRequest['turns'] = [{ role: 'user', text: 'Earlier' }, { role: 'assistant', text: 'Reply', toolCalls: [] }, { role: 'user', text: 'What time is it?' }]
    await p.chat({ ...req(), turns, context: 'Current date and time (UTC): 2026-11-13 12:00.\nThe person asking is called Max.' })
    await p.chat({ ...req(), turns, context: 'Current date and time (UTC): 2026-11-13 12:07.' })
    const [a, b] = fetch.bodies as { system: unknown; messages: { role: string; content: unknown }[] }[]
    assert.equal(JSON.stringify(a?.system), JSON.stringify(b?.system))
    // The context sits in front of the last user turn only.
    assert.equal(a?.messages[0]?.content, 'Earlier')
    const content = a?.messages[2]?.content as { type: string; text: string }[]
    assert.match(content[0]?.text ?? '', /2026-11-13 12:00\.\nThe person asking is called Max\./)
    assert.equal(content[1]?.text, 'What time is it?')
    assert.match(JSON.stringify(b?.messages), /12:07/)
    assert.doesNotMatch(JSON.stringify(a?.system), /2026|Max/)
  })

  it('sends no context block when there is none', async () => {
    const fetch = answering(200, message({}))
    await provider(fetch).chat(req())
    assert.deepEqual((fetch.bodies[0] as { messages: unknown }).messages, [{ role: 'user', content: 'hi' }])
  })

  it('reports cache reads and writes inside the input total, and logs them at debug level', async () => {
    const fetch = answering(200, message({ input_tokens: 20, cache_read_input_tokens: 700, cache_creation_input_tokens: 80 }))
    const lines: Record<string, unknown>[] = []
    const r = await provider(fetch, { debug: (m, f) => lines.push({ m, ...f }) }).chat(req())
    assert.deepEqual(r.usage, { inputTokens: 800, outputTokens: 7, cacheReadTokens: 700, cacheWriteTokens: 80 })
    assert.deepEqual(lines, [{ m: 'anthropic_cache', model: 'claude-haiku-5-5', input_tokens: 20, cache_read_input_tokens: 700, cache_creation_input_tokens: 80, output_tokens: 7 }])
  })

  it('leaves the cache fields out of the usage when nothing was cached', async () => {
    const r = await provider(answering(200, message({}))).chat(req())
    assert.deepEqual(r.usage, { inputTokens: 5, outputTokens: 7 })
  })
})

describe('OpenAI providers with the per-request context', () => {
  it('Chat Completions and Responses send the system prompt and the context as the one text they always did', async () => {
    const full = 'You are Mnemo.\n\nCurrent date and time (UTC): 2026-11-13 12:00.'
    const chat = answering(200, { id: 'c', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok', refusal: null } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    await openaiProvider({ name: 'openai-compatible', apiKey: KEY, model: 'm', baseUrl: 'http://127.0.0.1:9/v1', timeoutMs: 5000, fetch: chat }).chat({ ...req(), context: 'Current date and time (UTC): 2026-11-13 12:00.' })
    assert.deepEqual((chat.bodies[0] as { messages: unknown[] }).messages[0], { role: 'system', content: full })
    const resp = answering(200, { id: 'r', object: 'response', status: 'completed', model: 'm', incomplete_details: null, output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } })
    await openaiProvider({ name: 'openai', apiKey: KEY, model: 'm', timeoutMs: 5000, fetch: resp }).chat({ ...req(), context: 'Current date and time (UTC): 2026-11-13 12:00.' })
    assert.equal((resp.bodies[0] as { instructions: string }).instructions, full)
  })
})
