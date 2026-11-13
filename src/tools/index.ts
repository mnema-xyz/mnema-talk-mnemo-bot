// The tool registry: which tools exist, which are on, and how a call from
// the model is validated and run.
import { z } from 'zod'
import type { ToolResult, ToolSpec } from '../providers/types.ts'
import { calculator } from './calculator.ts'
import { datetime } from './datetime.ts'
import { ToolError, type Tool, type ToolContext } from './types.ts'
import { units } from './units.ts'
import { weather } from './weather.ts'
import { webSearch, type SearchBackend } from './websearch.ts'
import { wikipedia } from './wikipedia.ts'

/** Tools that need no key. Add yours here. */
export const BUILTIN_TOOLS: Tool[] = [weather, calculator, datetime, units, wikipedia]

export const TOOL_NAMES = [...BUILTIN_TOOLS.map((t) => t.name), 'web_search'] as const

/** A tool's result is cut to this many characters before the model sees it. */
const MAX_RESULT_CHARS = 6000

export interface ToolSettings {
  /** Names of the tools to offer; `web_search` also needs a key. */
  enabled: readonly string[]
  webSearch?: { backend: SearchBackend; apiKey: string } | undefined
}

export function selectTools(s: ToolSettings): Tool[] {
  const all = [...BUILTIN_TOOLS]
  if (s.webSearch) all.push(webSearch(s.webSearch.backend, s.webSearch.apiKey))
  return all.filter((t) => s.enabled.includes(t.name))
}

export function toolSpecs(tools: Tool[]): ToolSpec[] {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.input, { io: 'input', target: 'draft-2020-12' }) as Record<string, unknown>
    delete schema.$schema
    return { name: t.name, description: t.description, inputSchema: schema }
  })
}

/**
 * Runs one call. Never throws: every failure becomes an error result the
 * model can read and react to ("no place called X was found").
 */
export async function runTool(
  tools: Tool[],
  call: { id: string; name: string; input: unknown },
  ctx: ToolContext,
): Promise<ToolResult> {
  const fail = (message: string): ToolResult => ({ id: call.id, name: call.name, content: `Error: ${message}`, isError: true })
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) return fail(`there is no tool called "${call.name}"`)
  const parsed = tool.input.safeParse(call.input ?? {})
  if (!parsed.success) {
    return fail(`invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`)
  }
  try {
    const out = await tool.run(parsed.data, ctx)
    const content = out.length > MAX_RESULT_CHARS ? `${out.slice(0, MAX_RESULT_CHARS)}…(cut)` : out
    return { id: call.id, name: call.name, content, isError: false }
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message)
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return fail('the lookup timed out')
    return fail('the lookup failed')
  }
}
