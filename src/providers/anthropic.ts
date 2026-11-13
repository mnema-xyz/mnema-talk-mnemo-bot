// Anthropic's Messages API with tool use, through the official SDK.
import Anthropic from '@anthropic-ai/sdk'
import { errorDetail, ProviderError, type ChatRequest, type ChatResponse, type Provider, type StopReason, type Turn } from './types.ts'

export interface AnthropicOptions {
  apiKey: string
  model: string
  /** Only for a proxy or gateway in front of the API. */
  baseUrl?: string | undefined
  /** `low` keeps answers quick and cheap; raise it for harder questions. */
  effort: 'low' | 'medium' | 'high'
  timeoutMs: number
  /** Replaces the HTTP client; the tests use it. */
  fetch?: typeof fetch | undefined
}

export function anthropicProvider(opts: AnthropicOptions): Provider {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    timeout: opts.timeoutMs,
    maxRetries: 1,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  })

  return {
    name: 'anthropic',
    model: opts.model,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      let res: Anthropic.Message
      try {
        res = await client.messages.create(
          {
            model: opts.model,
            max_tokens: req.maxOutputTokens,
            system: req.system,
            messages: toMessages(req.turns),
            output_config: { effort: opts.effort },
            ...(req.tools.length > 0
              ? {
                  tools: req.tools.map((t): Anthropic.Tool => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
                  })),
                }
              : {}),
          },
          { signal: req.signal },
        )
      } catch (err) {
        throw toProviderError(err)
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      const toolCalls = res.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }))
      return {
        text,
        toolCalls,
        stop: stopReason(res.stop_reason),
        usage: {
          inputTokens:
            res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
          outputTokens: res.usage.output_tokens,
        },
        // Sent back unchanged with the tool results: thinking blocks must not
        // be edited or dropped inside one tool loop.
        raw: res.content,
      }
    },
  }
}

function toMessages(turns: Turn[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const t of turns) {
    if (t.role === 'user') {
      out.push({ role: 'user', content: t.text })
    } else if (t.role === 'assistant') {
      if (t.raw !== undefined) {
        out.push({ role: 'assistant', content: t.raw as Anthropic.ContentBlockParam[] })
      } else {
        out.push({ role: 'assistant', content: t.text })
      }
    } else {
      // All results of one assistant turn go back in a single user message.
      out.push({
        role: 'user',
        content: t.results.map(
          (r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: r.content,
            is_error: r.isError,
          }),
        ),
      })
    }
  }
  return out
}

function stopReason(s: Anthropic.Message['stop_reason']): StopReason {
  switch (s) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end'
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
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
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('the AI provider timed out', undefined, true)
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError('the request was cancelled')
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError('the AI provider refused the API key', 401)
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('the AI provider is rate limiting us', 429, true)
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined
    return new ProviderError(`the AI provider answered with an error${status ? ` (${status})` : ''}`, status, (status ?? 0) >= 500)
  }
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('could not reach the AI provider', undefined, true)
  return new ProviderError('the AI provider call failed')
}
