// A short summary of a Wikipedia article (search, then the page summary),
// through Wikimedia's public REST API. No key.
import { z } from 'zod'
import { defineTool, getJson, ToolError } from './types.ts'

const MAX_EXTRACT = 1500

const Search = z.object({
  pages: z.array(z.object({ key: z.string(), title: z.string(), description: z.string().nullable().optional() })),
})

const Summary = z.object({
  title: z.string(),
  description: z.string().optional(),
  extract: z.string().optional(),
  type: z.string().optional(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }).optional(),
})

export const wikipedia = defineTool({
  name: 'wikipedia',
  description:
    'Looks up a topic on Wikipedia and returns the summary of the best matching article, with its link. ' +
    'Use it for facts about people, places, history, science and things that change rarely.',
  input: z.object({
    query: z.string().min(1).max(200),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[a-z]{2,8})?$/)
      .default('en')
      .describe('Wikipedia language edition, for example "en", "de", "es"'),
  }),
  async run({ query, language }, ctx) {
    const base = `https://${language}.wikipedia.org`
    const search = Search.safeParse(
      await getJson(ctx, `${base}/w/rest.php/v1/search/page?${new URLSearchParams({ q: query, limit: '3' }).toString()}`),
    )
    const first = search.success ? search.data.pages[0] : undefined
    if (!first) throw new ToolError(`no Wikipedia article found for "${query}"`)

    const summary = Summary.safeParse(await getJson(ctx, `${base}/api/rest_v1/page/summary/${encodeURIComponent(first.key)}`))
    if (!summary.success) throw new ToolError('Wikipedia sent an answer in an unexpected shape')
    const s = summary.data
    const extract = s.extract ?? ''
    return JSON.stringify({
      title: s.title,
      description: s.description,
      summary: extract.length > MAX_EXTRACT ? `${extract.slice(0, MAX_EXTRACT)}…` : extract,
      disambiguation: s.type === 'disambiguation' ? true : undefined,
      url: s.content_urls?.desktop.page ?? `${base}/wiki/${encodeURIComponent(first.key)}`,
      other_matches: search.success ? search.data.pages.slice(1).map((p) => p.title) : [],
    })
  },
})
