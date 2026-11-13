// OpenAI through the official SDK: the Responses API for OpenAI itself
// (openai-responses.ts), Chat Completions with tools for every
// OpenAI-compatible server (Ollama, OpenRouter, LM Studio, vLLM, ...), which
// differ only in the base URL and the key.
import OpenAI from 'openai'
import { chatViaResponses } from './openai-responses.ts'
import { errorDetail, ProviderError, type ChatRequest, type ChatResponse, type Provider, type StopReason, type ToolCall, type Turn } from './types.ts'

export interface OpenAIOptions {
  /** `openai` (Responses API) or `openai-compatible` (Chat Completions). */
  name: string
  apiKey: string
  model: string
  baseUrl?: string | undefined
  timeoutMs: number
  /** Replaces the HTTP client; the tests use it. */
  fetch?: typeof fetch | undefined
}

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam

export function openaiProvider(opts: OpenAIOptions): Provider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    timeout: opts.timeoutMs,
    maxRetries: 1,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  })

  return {
    name: opts.name,
    model: opts.model,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (opts.name === 'openai') {
        try {
          return await chatViaResponses(client, opts.model, req)
        } catch (err) {
          throw toProviderError(err)
        }
      }
      let res: OpenAI.Chat.Completions.ChatCompletion
      try {
        res = await client.chat.completions.create(
          {
            model: opts.model,
            // Compatible servers know the old name; OpenAI itself goes through Responses.
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- compatible servers still need it
            max_tokens: req.maxOutputTokens,
            messages: [{ role: 'system', content: req.system }, ...toMessages(req.turns)],
            ...(req.tools.length > 0
              ? {
                  tools: req.tools.map((t) => ({
                    type: 'function' as const,
                    function: { name: t.name, description: t.description, parameters: t.inputSchema },
                  })),
                }
              : {}),
          },
          { signal: req.signal },
        )
      } catch (err) {
        throw toProviderError(err)
      }

      const choice = res.choices[0]
      if (!choice) throw new ProviderError('the AI provider sent no answer')
      const toolCalls: ToolCall[] = []
      for (const c of choice.message.tool_calls ?? []) {
        if (c.type !== 'function') continue
        toolCalls.push({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) })
      }
      return {
        text: choice.message.content ?? '',
        toolCalls,
        stop: stopReason(choice.finish_reason, choice.message.refusal),
        usage: {
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
        },
      }
    },
  }
}

function toMessages(turns: Turn[]): Msg[] {
  const out: Msg[] = []
  for (const t of turns) {
    if (t.role === 'user') {
      out.push({ role: 'user', content: t.text })
    } else if (t.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: t.text || null,
        ...(t.toolCalls.length > 0
          ? {
              tool_calls: t.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      })
    } else {
      for (const r of t.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content })
    }
  }
  return out
}

/** Arguments arrive as a JSON string; a broken one becomes an empty object
 * and the tool's own validation reports what is missing. */
function parseArgs(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return {}
  }
}

function stopReason(r: string | null, refusal: string | null | undefined): StopReason {
  if (refusal) return 'refusal'
  switch (r) {
    case 'stop':
      return 'end'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    default:
      return 'other'
  }
}

function toProviderError(err: unknown): ProviderError {
  const e = classify(err)
  return new ProviderError(e.message, e.status, e.retryable, errorDetail(err))
}

function classify(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError('the AI provider timed out', undefined, true)
  if (err instanceof OpenAI.APIUserAbortError) return new ProviderError('the request was cancelled')
  if (err instanceof OpenAI.AuthenticationError) return new ProviderError('the AI provider refused the API key', 401)
  if (err instanceof OpenAI.RateLimitError) return new ProviderError('the AI provider is rate limiting us', 429, true)
  if (err instanceof OpenAI.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined
    return new ProviderError(`the AI provider answered with an error${status ? ` (${status})` : ''}`, status, (status ?? 0) >= 500)
  }
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError('could not reach the AI provider', undefined, true)
  return new ProviderError('the AI provider call failed')
}
