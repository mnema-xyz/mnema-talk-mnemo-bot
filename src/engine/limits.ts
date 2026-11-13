// Guards against runaway use: sliding-window rate limits per member and
// per channel, and a daily token and cost budget.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Usage } from '../providers/types.ts'

/** At most `max` hits per `windowMs` for each key. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly max: number
  private readonly windowMs: number
  private readonly now: () => number
  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max
    this.windowMs = windowMs
    this.now = now
  }

  /** Records a hit if allowed. Returns 0 when allowed, else the ms to wait. */
  take(key: string): number {
    if (this.max <= 0) return 0
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return this.windowMs - (t - (recent[0] ?? t))
    }
    recent.push(t)
    this.hits.set(key, recent)
    if (this.hits.size > 10_000) this.sweep(t)
    return 0
  }

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (v.every((h) => t - h >= this.windowMs)) this.hits.delete(k)
  }
}

/** Remembers that something was said to a key, for a while: a refusal is
 * posted once per member and window, not once per message. */
export class OncePerWindow {
  private readonly until = new Map<string, number>()
  private readonly now: () => number
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** True the first time for `key` within `windowMs`. */
  first(key: string, windowMs: number): boolean {
    const t = this.now()
    if ((this.until.get(key) ?? 0) > t) return false
    this.until.set(key, t + windowMs)
    if (this.until.size > 10_000) for (const [k, u] of this.until) if (u <= t) this.until.delete(k)
    return true
  }
}

export interface BudgetSettings {
  /** Tokens (input + output) per UTC day; 0 means no token limit. */
  dailyTokens: number
  /** US dollars per UTC day; 0 means no cost limit. Needs prices. */
  dailyCostUsd: number
  /** Price per million input and output tokens, for the cost limit and logs. */
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  /** Where the day's usage survives a restart; none keeps it in memory. */
  stateFile?: string | undefined
}

interface DayUsage {
  day: string
  inputTokens: number
  outputTokens: number
}

/** A call's estimated usage, held until the call reports what it used. */
export interface Reservation {
  /** Replaces the estimate with the real usage; later calls are ignored. */
  settle(actual: Usage): void
}

/**
 * The day's spend, reset at midnight UTC. Before each provider call the
 * engine reserves the call's estimated usage; a call that would not fit next
 * to the spent and the reserved tokens is not made, so questions running at
 * the same time cannot overshoot together.
 */
export class Budget {
  private usage: DayUsage
  private reserved = { inputTokens: 0, outputTokens: 0 }
  private readonly s: BudgetSettings
  private readonly now: () => Date
  constructor(s: BudgetSettings, now: () => Date = () => new Date()) {
    this.s = s
    this.now = now
    this.usage = this.load() ?? { day: this.today(), inputTokens: 0, outputTokens: 0 }
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10)
  }

  private current(): DayUsage {
    const day = this.today()
    if (this.usage.day !== day) this.usage = { day, inputTokens: 0, outputTokens: 0 }
    return this.usage
  }

  costUsd(u: { inputTokens: number; outputTokens: number }): number {
    return (u.inputTokens * this.s.inputUsdPerMTok + u.outputTokens * this.s.outputUsdPerMTok) / 1_000_000
  }

  /** True while anything is left (spent and reserved below the limits). */
  hasRoom(): boolean {
    return this.fits({ inputTokens: 0, outputTokens: 0 }, false)
  }

  /** Reserves an estimate, or answers undefined when it does not fit. */
  reserve(estimate: Usage): Reservation | undefined {
    if (!this.fits(estimate, true)) return undefined
    this.reserved.inputTokens += estimate.inputTokens
    this.reserved.outputTokens += estimate.outputTokens
    let open = true
    return {
      settle: (actual: Usage) => {
        if (!open) return
        open = false
        this.reserved.inputTokens -= estimate.inputTokens
        this.reserved.outputTokens -= estimate.outputTokens
        this.add(actual)
      },
    }
  }

  private fits(extra: Usage, inclusive: boolean): boolean {
    const u = this.current()
    const total = {
      inputTokens: u.inputTokens + this.reserved.inputTokens + extra.inputTokens,
      outputTokens: u.outputTokens + this.reserved.outputTokens + extra.outputTokens,
    }
    const over = (used: number, limit: number) => (inclusive ? used > limit : used >= limit)
    if (this.s.dailyTokens > 0 && over(total.inputTokens + total.outputTokens, this.s.dailyTokens)) return false
    if (this.s.dailyCostUsd > 0 && over(this.costUsd(total), this.s.dailyCostUsd)) return false
    return true
  }

  add(usage: Usage): void {
    const u = this.current()
    u.inputTokens += usage.inputTokens
    u.outputTokens += usage.outputTokens
    this.save()
  }

  snapshot(): DayUsage & { costUsd: number } {
    const u = this.current()
    return { ...u, costUsd: this.costUsd(u) }
  }

  private load(): DayUsage | undefined {
    if (!this.s.stateFile) return undefined
    try {
      const v = JSON.parse(readFileSync(this.s.stateFile, 'utf8')) as Partial<DayUsage>
      if (v.day === this.today() && typeof v.inputTokens === 'number' && typeof v.outputTokens === 'number') {
        return { day: v.day, inputTokens: v.inputTokens, outputTokens: v.outputTokens }
      }
    } catch {
      // No file yet, or unreadable: start the day at zero.
    }
    return undefined
  }

  private save(): void {
    if (!this.s.stateFile) return
    try {
      mkdirSync(dirname(this.s.stateFile), { recursive: true })
      const tmp = `${this.s.stateFile}.tmp`
      writeFileSync(tmp, JSON.stringify(this.usage))
      renameSync(tmp, this.s.stateFile)
    } catch {
      // Losing the counter on a full disk is better than failing the answer.
    }
  }
}
