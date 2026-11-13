// Bounded, in-memory state: the conversation of each thread Mnemo is in,
// and the answers its buttons refer to. Nothing is written to disk, so a
// restart forgets both (README: "Privacy").

/** A Map that keeps at most `max` entries, dropping the least recently used,
 * and forgets entries older than `ttlMs`. */
export class LruMap<V> {
  private readonly m = new Map<string, { v: V; at: number }>()
  private readonly max: number
  private readonly ttlMs: number
  private readonly now: () => number
  constructor(max: number, ttlMs: number, now: () => number = Date.now) {
    this.max = max
    this.ttlMs = ttlMs
    this.now = now
  }

  get(key: string): V | undefined {
    const e = this.m.get(key)
    if (!e) return undefined
    if (this.now() - e.at > this.ttlMs) {
      this.m.delete(key)
      return undefined
    }
    this.m.delete(key)
    this.m.set(key, { v: e.v, at: this.now() })
    return e.v
  }

  set(key: string, v: V): void {
    this.m.delete(key)
    this.m.set(key, { v, at: this.now() })
    while (this.m.size > this.max) {
      const oldest = this.m.keys().next().value
      if (oldest === undefined) break
      this.m.delete(oldest)
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  get size(): number {
    return this.m.size
  }
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ThreadLimits {
  /** Turns kept per thread (a question and an answer are two). */
  maxTurns: number
  /** Characters kept per thread; the oldest turns go first. */
  maxChars: number
}

/** Trims a history to the limits, keeping the newest turns and starting
 * with a question so that the provider sees a well-formed conversation. */
export function boundHistory(turns: HistoryTurn[], limits: ThreadLimits): HistoryTurn[] {
  let out = turns.slice(-limits.maxTurns)
  let chars = out.reduce((n, t) => n + t.text.length, 0)
  while (out.length > 0 && chars > limits.maxChars) {
    chars -= out[0]?.text.length ?? 0
    out = out.slice(1)
  }
  while (out.length > 0 && out[0]?.role !== 'user') out = out.slice(1)
  return out
}
