// What a tool is. To add your own, write one file that exports a `Tool`
// and list it in tools/index.ts (README: "Writing your own tool").
import type { z } from 'zod'

export interface ToolContext {
  /** Use this instead of the global fetch: tests replace it, and it carries
   * Mnemo's User-Agent and the per-question timeout. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  /** The current time; tests pin it. */
  now: () => Date
  signal: AbortSignal
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  /** Letters, digits and underscores; what the model calls. */
  name: string
  /** Tells the model when to use the tool. Be concrete, it reads this. */
  description: string
  /** The input, validated before `run` sees it. */
  input: S
  /** Returns text (often JSON) for the model. Throw `ToolError` for a
   * failure the model should hear about. */
  run(input: z.infer<S>, ctx: ToolContext): Promise<string>
}

/** A failure that is reported to the model as the tool's result. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** Helper that keeps the input type when defining a tool. */
export function defineTool<S extends z.ZodType>(t: Tool<S>): Tool<S> {
  return t
}

/** Fetches JSON and turns HTTP failures into a ToolError. */
export async function getJson(ctx: ToolContext, url: string, init?: RequestInit): Promise<unknown> {
  const res = await ctx.fetch(url, init)
  if (!res.ok) throw new ToolError(`${new URL(url).host} answered ${res.status}`)
  return await res.json()
}
