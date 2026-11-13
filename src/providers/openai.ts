// OpenAI's Chat Completions API with tools, through the official SDK.
// The same file serves every OpenAI-compatible server (Ollama, OpenRouter,
// LM Studio, vLLM, ...): they differ only in the base URL and the key.
import OpenAI from 'openai'
import { ProviderError, type ChatRequest, type ChatResponse, type Provider, type StopReason, type ToolCall, type Turn } from './types.ts'

export interface OpenAIOptions {
  /** `openai` or `openai-compatible`; only changes the name in logs. */
  name: string
  apiKey: string
  model: string
  baseUrl?: string | undefined
  timeoutMs: number
}

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam

export function openaiProvider(opts: OpenAIOptions): Provider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    timeout: opts.timeoutMs,
    maxRetries: 1,
  })

  return {
    name: opts.name,
    model: opts.model,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      let res: OpenAI.Chat.Completions.ChatCompletion
      try {
        res = await client.chat.completions.create(
          {
            model: opts.model,
            // OpenAI renamed the field; many compatible servers know only the old name.
            ...(opts.name === 'openai'
              ? { max_completion_tokens: req.maxOutputTokens }
              : // eslint-disable-next-line @typescript-eslint/no-deprecated -- compatible servers still need it
                { max_tokens: req.maxOutputTokens }),
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
