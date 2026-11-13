// Anthropic's Messages API with tool use, through the official SDK.
import Anthropic from '@anthropic-ai/sdk'
import type { Logger } from '../log.ts'
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
  /** Where the cache hit counts go, at debug level. */
  log?: Logger | undefined
}

// Prompt caching, 5-minute lifetime. One breakpoint ends the stable system
// prompt (tools render before it, so they are cached with it); the request's
// own `cache_control` lets the API move a second one along the growing
// conversation, which is what a tool loop needs.
const EPHEMERAL = { type: 'ephemeral' } as const

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
            cache_control: EPHEMERAL,
            system: [{ type: 'text', text: req.system, cache_control: EPHEMERAL }],
            messages: toMessages(req.turns, req.context),
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
      const cacheRead = res.usage.cache_read_input_tokens ?? 0
      const cacheWrite = res.usage.cache_creation_input_tokens ?? 0
      opts.log?.debug('anthropic_cache', {
        model: opts.model,
        input_tokens: res.usage.input_tokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
        output_tokens: res.usage.output_tokens,
      })
      return {
        text,
        toolCalls,
        stop: stopReason(res.stop_reason),
        usage: {
          // The API's input_tokens is the uncached rest only; the total
          // prompt is the sum, and the cached parts are priced apart.
          inputTokens: res.usage.input_tokens + cacheRead + cacheWrite,
          outputTokens: res.usage.output_tokens,
          ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
          ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
        },
        // Sent back unchanged with the tool results: thinking blocks must not
        // be edited or dropped inside one tool loop.
        raw: res.content,
      }
    },
  }
}

/** The per-request context goes in front of the last user turn (the question
 * being answered), so it sits at the same place in every round of a tool
 * loop and never in the cached system prompt. */
function toMessages(turns: Turn[], context?: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  const last = turns.findLastIndex((t) => t.role === 'user')
  for (const [i, t] of turns.entries()) {
    if (t.role === 'user') {
      out.push({
        role: 'user',
        content: i === last && context ? [{ type: 'text', text: `Context from the chat (not written by the user):\n${context}` }, { type: 'text', text: t.text }] : t.text,
      })
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
