// The one interface every AI provider implements. Mnemo's engine speaks
// only this neutral shape; each provider file translates it to its API.
// Adding a provider means one new file that exports a `Provider`.

/** A tool the model may call, described with a JSON Schema for its input. */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** One call the model asked for. `input` is parsed JSON, not yet validated. */
export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface ToolResult {
  id: string
  name: string
  content: string
  isError: boolean
}

/**
 * A turn of the conversation, in the order the model saw it.
 *
 * `raw` on an assistant turn is the provider's own copy of that turn (for
 * Anthropic: the content blocks, thinking blocks included). The provider that
 * produced it sends it back unchanged inside the same question's tool loop;
 * the engine never looks inside it.
 */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolResult[] }

export interface ChatRequest {
  /** The stable instructions: byte-identical from one request to the next,
   * so a provider can cache them. Nothing per request belongs here. */
  system: string
  /** Facts that change per request (the time, the asker's name). Providers
   * hand it to the model after `system` and before the conversation's last
   * user turn, never inside `system`, so the cached prefix survives. */
  context?: string | undefined
  turns: Turn[]
  tools: ToolSpec[]
  maxOutputTokens: number
  signal: AbortSignal
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'

export interface Usage {
  /** Every prompt token the call processed, cached ones included. */
  inputTokens: number
  outputTokens: number
  /** Of `inputTokens`: served from the provider's prompt cache (cheap). */
  cacheReadTokens?: number | undefined
  /** Of `inputTokens`: written to the prompt cache (a little dearer). */
  cacheWriteTokens?: number | undefined
}

/** The system prompt and the per-request context as one text, for providers
 * that do not cache explicitly. Same words the model always saw. */
export function systemWithContext(req: Pick<ChatRequest, 'system' | 'context'>): string {
  return req.context ? `${req.system}\n\n${req.context}` : req.system
}

export interface ChatResponse {
  text: string
  toolCalls: ToolCall[]
  stop: StopReason
  usage: Usage
  raw?: unknown
}

export interface Provider {
  /** `anthropic`, `openai`, `openai-compatible`, or your own. */
  readonly name: string
  readonly model: string
  chat(request: ChatRequest): Promise<ChatResponse>
}

/** A provider error. `message` is safe to show in the chat; `detail` is
 * for the log only: the provider's error type and message, which name the
 * cause (a wrong model id, an unsupported parameter) and never hold the key
 * or the request. */
export class ProviderError extends Error {
  readonly status: number | undefined
  readonly retryable: boolean
  readonly detail: string | undefined
  constructor(message: string, status?: number, retryable = false, detail?: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.retryable = retryable
    this.detail = detail
  }
}

const MAX_DETAIL = 300

/** The log detail of an SDK error: its class and message, cut short. */
export function errorDetail(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  return `${err.constructor.name}: ${err.message}`.slice(0, MAX_DETAIL)
}
