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

/** The day's spend, reset at midnight UTC. */
export class Budget {
  private usage: DayUsage
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

  /** True while there is budget left for another provider call. */
  hasRoom(): boolean {
    const u = this.current()
    if (this.s.dailyTokens > 0 && u.inputTokens + u.outputTokens >= this.s.dailyTokens) return false
    if (this.s.dailyCostUsd > 0 && this.costUsd(u) >= this.s.dailyCostUsd) return false
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
