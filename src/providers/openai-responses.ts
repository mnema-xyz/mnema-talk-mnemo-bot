// OpenAI's Responses API with function tools. Mnemo uses it for
// MNEMO_PROVIDER=openai, because OpenAI's newest models call tools only
// through it; OpenAI-compatible servers keep Chat Completions (openai.ts).
//
// Nothing is stored at OpenAI between calls (store: false). The output
// items of one call, reasoning items with their encrypted content included,
// go back unchanged with the tool results, as OpenAI asks for.
import type OpenAI from 'openai'
import type { ChatRequest, ChatResponse, StopReason, ToolCall, Turn } from './types.ts'

type Item = OpenAI.Responses.ResponseInputItem

export async function chatViaResponses(client: OpenAI, model: string, req: ChatRequest): Promise<ChatResponse> {
  const res = await client.responses.create(
    {
      model,
      instructions: req.system,
      input: toInput(req.turns),
      max_output_tokens: req.maxOutputTokens,
      store: false,
      ...(req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: 'function' as const,
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
              strict: false,
            })),
          }
        : {}),
    },
    { signal: req.signal },
  )

  const toolCalls: ToolCall[] = []
  let text = ''
  let refused = false
  for (const item of res.output) {
    if (item.type === 'function_call') {
      toolCalls.push({ id: item.call_id, name: item.name, input: parseArgs(item.arguments) })
    } else if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'output_text') text += part.text
        else refused = true
      }
    }
  }
  return {
    text,
    toolCalls,
    stop: stopReason(res, toolCalls.length > 0, refused),
    usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
    raw: res.output,
  }
}

function toInput(turns: Turn[]): Item[] {
  const out: Item[] = []
  for (const t of turns) {
    if (t.role === 'user') {
      out.push({ role: 'user', content: t.text })
    } else if (t.role === 'assistant') {
      if (Array.isArray(t.raw)) out.push(...(t.raw as Item[]))
      else out.push({ role: 'assistant', content: t.text })
    } else {
      for (const r of t.results) out.push({ type: 'function_call_output', call_id: r.id, output: r.content })
    }
  }
  return out
}

function stopReason(res: OpenAI.Responses.Response, hasCalls: boolean, refused: boolean): StopReason {
  if (refused || res.incomplete_details?.reason === 'content_filter') return 'refusal'
  if (res.incomplete_details?.reason === 'max_output_tokens') return 'max_tokens'
  if (hasCalls) return 'tool_use'
  return res.status === 'completed' ? 'end' : 'other'
}

function parseArgs(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return {}
  }
}
