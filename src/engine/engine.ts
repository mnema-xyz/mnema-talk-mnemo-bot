// The answering engine: one question in, one answer out. It owns the tool
// loop, the limits and the budget, and knows nothing about Mnema Talk, so
// it is tested without a server and reusable in another chat.
import type { Logger } from '../log.ts'
import { ProviderError, type Provider, type ToolCall, type Turn, type Usage } from '../providers/types.ts'
import { runTool, toolSpecs } from '../tools/index.ts'
import type { Tool, ToolContext } from '../tools/types.ts'
import { Budget, RateLimiter } from './limits.ts'
import type { HistoryTurn } from './memory.ts'
import { buildSystemPrompt } from './prompt.ts'

export interface EngineSettings {
  persona: string
  /** Tool calls allowed per question; more are refused to the model. */
  maxToolCalls: number
  maxOutputTokens: number
  /** Limit for one provider call. */
  providerTimeoutMs: number
  /** Limit for one tool call. */
  toolTimeoutMs: number
  /** Send the asker's display name to the provider. */
  sendDisplayName: boolean
  userAgent: string
}

export interface ToolUse {
  name: string
  input: unknown
  ok: boolean
}

export type AskResult =
  | { kind: 'answer'; text: string; toolsUsed: ToolUse[]; usage: Usage; model: string; provider: string }
  | { kind: 'refused'; reason: 'member_rate' | 'channel_rate' | 'budget' | 'provider' | 'empty'; text: string }

export interface AskInput {
  question: string
  history: HistoryTurn[]
  userId: string
  channelId: string
  askerName?: string | undefined
}

export interface EngineDeps {
  provider: Provider
  tools: Tool[]
  settings: EngineSettings
  memberLimit: RateLimiter
  channelLimit: RateLimiter
  budget: Budget
  log: Logger
  fetch?: typeof fetch
  now?: () => Date
}

/** Rounds of model calls per question; a safety net above the tool limit. */
const MAX_ROUNDS = 8

export class Engine {
  private readonly d: EngineDeps
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  constructor(deps: EngineDeps) {
    this.d = deps
    this.fetchImpl = deps.fetch ?? fetch
    this.now = deps.now ?? (() => new Date())
  }

  get model(): string {
    return this.d.provider.model
  }

  async ask(input: AskInput): Promise<AskResult> {
    const question = input.question.trim()
    if (!question) return { kind: 'refused', reason: 'empty', text: 'What would you like to know? Ask me anything.' }

    const memberWait = this.d.memberLimit.take(input.userId)
    if (memberWait > 0) {
      return { kind: 'refused', reason: 'member_rate', text: `You are asking quickly. Try again in ${Math.ceil(memberWait / 1000)} s.` }
    }
    const channelWait = this.d.channelLimit.take(input.channelId)
    if (channelWait > 0) {
      return {
        kind: 'refused',
        reason: 'channel_rate',
        text: `This channel is keeping me busy. Try again in ${Math.ceil(channelWait / 1000)} s.`,
      }
    }
    if (!this.d.budget.hasRoom()) return budgetRefusal()

    const s = this.d.settings
    const name = s.sendDisplayName ? cleanName(input.askerName) : undefined
    const system = buildSystemPrompt(s.persona, this.now(), name)
    const specs = toolSpecs(this.d.tools)
    const turns: Turn[] = [
      ...input.history.map((h): Turn => (h.role === 'user' ? { role: 'user', text: h.text } : { role: 'assistant', text: h.text, toolCalls: [] })),
      { role: 'user', text: question },
    ]
    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    const toolsUsed: ToolUse[] = []
    let text = ''

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (round > 0 && !this.d.budget.hasRoom()) break
      let res
      try {
        res = await this.d.provider.chat({
          system,
          turns,
          tools: specs,
          maxOutputTokens: s.maxOutputTokens,
          signal: AbortSignal.timeout(s.providerTimeoutMs),
        })
      } catch (err) {
        const message = err instanceof ProviderError ? err.message : 'the AI provider call failed'
        this.d.log.warn('provider_error', { provider: this.d.provider.name, status: err instanceof ProviderError ? err.status : undefined, message })
        return { kind: 'refused', reason: 'provider', text: `Sorry, I could not answer: ${message}. Try again in a moment.` }
      }
      usage.inputTokens += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
      this.d.budget.add(res.usage)
      text = res.text

      if (res.stop === 'refusal') {
        text = 'I can not help with that one.'
        break
      }
      if (res.stop !== 'tool_use' || res.toolCalls.length === 0) {
        if (res.stop === 'max_tokens') text = `${text.trimEnd()}…`
        break
      }

      turns.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw })
      const results = await Promise.all(res.toolCalls.map((c) => this.callTool(c, toolsUsed)))
      turns.push({ role: 'tool', results })
    }

    text = text.trim()
    if (!text) {
      if (!this.d.budget.hasRoom()) return budgetRefusal()
      text = 'Sorry, I could not come up with an answer. Try asking in another way.'
    }
    this.d.log.info('answered', {
      provider: this.d.provider.name,
      model: this.d.provider.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      tools: toolsUsed.map((t) => t.name),
    })
    return { kind: 'answer', text, toolsUsed, usage, model: this.d.provider.model, provider: this.d.provider.name }
  }

  private async callTool(call: ToolCall, used: ToolUse[]): Promise<{ id: string; name: string; content: string; isError: boolean }> {
    if (used.length >= this.d.settings.maxToolCalls) {
      used.push({ name: call.name, input: call.input, ok: false })
      return {
        id: call.id,
        name: call.name,
        content: 'Error: the tool call limit for this question is reached. Answer now with what you have.',
        isError: true,
      }
    }
    const entry: ToolUse = { name: call.name, input: call.input, ok: false }
    used.push(entry)
    const signal = AbortSignal.timeout(this.d.settings.toolTimeoutMs)
    const ctx: ToolContext = {
      signal,
      now: this.now,
      fetch: (url, init) =>
        this.fetchImpl(url, {
          ...init,
          signal,
          headers: { 'User-Agent': this.d.settings.userAgent, ...(init?.headers as Record<string, string> | undefined) },
        }),
    }
    const result = await runTool(this.d.tools, call, ctx)
    entry.ok = !result.isError
    if (result.isError) this.d.log.debug('tool_error', { tool: call.name, message: result.content })
    return result
  }
}

function budgetRefusal(): AskResult {
  return {
    kind: 'refused',
    reason: 'budget',
    text: 'I have used up today\'s budget for answers. It resets at midnight UTC; ask again then.',
  }
}

/** A display name is user-controlled text: keep it short and on one line. */
function cleanName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const s = name.replace(/[\p{C}\n\r]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  return s || undefined
}
