// Optional web search through Brave Search or Tavily. Off unless the
// operator sets a key; without one the model never sees this tool.
import { z } from 'zod'
import { defineTool, getJson, ToolError, type Tool } from './types.ts'

export type SearchBackend = 'brave' | 'tavily'

const MAX_SNIPPET = 400

const Brave = z.object({
  web: z
    .object({ results: z.array(z.object({ title: z.string(), url: z.string(), description: z.string().optional() })) })
    .optional(),
})

const Tavily = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string().optional() })),
})

const clip = (s: string | undefined): string =>
  (s ?? '').replace(/<[^>]+>/g, '').slice(0, MAX_SNIPPET)

export function webSearch(backend: SearchBackend, apiKey: string): Tool {
  return defineTool({
    name: 'web_search',
    description:
      'Searches the web and returns the top results (title, link, snippet). Use it for recent events, ' +
      'prices, opening hours and anything that may have changed since your training. Cite the links you use.',
    input: z.object({
      query: z.string().min(1).max(300),
      count: z.number().int().min(1).max(8).default(5),
    }),
    async run({ query, count }, ctx) {
      if (backend === 'brave') {
        const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(count) }).toString()}`
        const body = Brave.safeParse(
          await getJson(ctx, url, { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } }),
        )
        if (!body.success) throw new ToolError('Brave Search sent an answer in an unexpected shape')
        const results = (body.data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: clip(r.description) }))
        return JSON.stringify({ query, results, source: 'Brave Search' })
      }
      const body = Tavily.safeParse(
        await getJson(ctx, 'https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ query, max_results: count }),
        }),
      )
      if (!body.success) throw new ToolError('Tavily sent an answer in an unexpected shape')
      const results = body.data.results.map((r) => ({ title: r.title, url: r.url, snippet: clip(r.content) }))
      return JSON.stringify({ query, results, source: 'Tavily' })
    },
  })
}
