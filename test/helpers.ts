// Test helpers: a fetch that serves recorded responses and fails on any
// request it does not know, so no unit test can reach the network.
import { readFileSync } from 'node:fs'
import type { ToolContext } from '../src/tools/types.ts'

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}

export type Route = [match: RegExp, body: unknown, status?: number]

export function recordedFetch(routes: Route[]): ToolContext['fetch'] & { calls: string[] } {
  const calls: string[] = []
  const f = (url: string): Promise<Response> => {
    calls.push(url)
    const route = routes.find(([re]) => re.test(url))
    if (!route) return Promise.reject(new Error(`unexpected request in a unit test: ${url}`))
    const [, body, status = 200] = route
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  }
  return Object.assign(f, { calls })
}

export function ctxWith(fetch: ToolContext['fetch'], now = new Date('2026-11-13T12:00:00Z')): ToolContext {
  return { fetch, now: () => now, signal: AbortSignal.timeout(5000) }
}
