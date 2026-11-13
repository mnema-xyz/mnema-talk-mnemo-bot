import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Budget, OncePerWindow, RateLimiter } from '../src/engine/limits.ts'
import { boundHistory, LruMap } from '../src/engine/memory.ts'

describe('RateLimiter', () => {
  it('allows max hits per window, per key, then tells the wait', () => {
    let t = 0
    const rl = new RateLimiter(2, 60_000, () => t)
    assert.equal(rl.take('a'), 0)
    assert.equal(rl.take('a'), 0)
    t = 10_000
    assert.equal(rl.take('a'), 50_000)
    assert.equal(rl.take('b'), 0, 'other keys are independent')
    t = 60_001
    assert.equal(rl.take('a'), 0, 'the window slides')
  })
  it('is off at 0', () => {
    const rl = new RateLimiter(0, 1000)
    for (let i = 0; i < 100; i++) assert.equal(rl.take('a'), 0)
  })
})

describe('OncePerWindow', () => {
  it('says yes once per key until the window ends', () => {
    let t = 0
    const once = new OncePerWindow(() => t)
    assert.equal(once.first('u1', 30_000), true)
    assert.equal(once.first('u1', 30_000), false)
    assert.equal(once.first('u2', 30_000), true)
    t = 30_001
    assert.equal(once.first('u1', 30_000), true)
  })
})

describe('Budget', () => {
  const base = { dailyTokens: 0, dailyCostUsd: 0, inputUsdPerMTok: 1, outputUsdPerMTok: 5 }

  it('stops at the daily token budget and resets at midnight UTC', () => {
    let now = new Date('2026-11-13T23:59:00Z')
    const b = new Budget({ ...base, dailyTokens: 1000 }, () => now)
    assert.equal(b.hasRoom(), true)
    b.add({ inputTokens: 600, outputTokens: 400 })
    assert.equal(b.hasRoom(), false)
    now = new Date('2026-11-14T00:00:01Z')
    assert.equal(b.hasRoom(), true)
    assert.equal(b.snapshot().inputTokens, 0)
  })

  it('stops at the daily cost budget', () => {
    const b = new Budget({ ...base, dailyCostUsd: 0.01 })
    b.add({ inputTokens: 5000, outputTokens: 0 }) // $0.005
    assert.equal(b.hasRoom(), true)
    b.add({ inputTokens: 0, outputTokens: 1000 }) // +$0.005
    assert.equal(b.hasRoom(), false)
    assert.equal(b.snapshot().costUsd.toFixed(3), '0.010')
  })

  it('reserves the estimate of a call in flight, so concurrent calls cannot overshoot', () => {
    const b = new Budget({ ...base, dailyTokens: 10_000 })
    const first = b.reserve({ inputTokens: 4000, outputTokens: 2000 })
    assert.ok(first)
    assert.equal(b.reserve({ inputTokens: 4000, outputTokens: 2000 }), undefined, 'the second does not fit next to the first')
    first.settle({ inputTokens: 900, outputTokens: 100 })
    assert.equal(b.snapshot().inputTokens, 900)
    const second = b.reserve({ inputTokens: 4000, outputTokens: 2000 })
    assert.ok(second, 'settling released the rest of the estimate')
    second.settle({ inputTokens: 0, outputTokens: 0 })
    second.settle({ inputTokens: 5000, outputTokens: 0 }) // a second settle is ignored
    assert.equal(b.snapshot().inputTokens, 900)
  })

  it('reserves against the cost budget as well', () => {
    const b = new Budget({ ...base, dailyCostUsd: 0.01 }) // $1 in, $5 out per MTok
    assert.ok(b.reserve({ inputTokens: 1000, outputTokens: 1000 })) // $0.006
    assert.equal(b.reserve({ inputTokens: 1000, outputTokens: 1000 }), undefined)
  })

  it('prices cache reads at a tenth and cache writes at 1.25 times the input price', () => {
    const b = new Budget(base) // $1 in, $5 out per MTok
    // 1,000,000 prompt tokens: 800k read, 100k written, 100k plain; 100k out.
    const cost = b.costUsd({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 800_000, cacheWriteTokens: 100_000 })
    assert.equal(cost.toFixed(4), (0.1 + 0.08 + 0.125 + 0.5).toFixed(4))
    assert.equal(b.costUsd({ inputTokens: 1000, outputTokens: 0 }), 0.001, 'without a split everything is plain input')
  })

  it('lets a day of cache reads cost a tenth, while the token budget still counts every token', () => {
    const cost = new Budget({ ...base, dailyCostUsd: 0.01 })
    cost.add({ inputTokens: 90_000, outputTokens: 0, cacheReadTokens: 90_000 }) // $0.009, not $0.09
    assert.equal(cost.hasRoom(), true)
    const tokens = new Budget({ ...base, dailyTokens: 100_000 })
    tokens.add({ inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 100_000 })
    assert.equal(tokens.hasRoom(), false)
    assert.deepEqual({ ...cost.snapshot(), costUsd: 0 }, { day: cost.snapshot().day, inputTokens: 90_000, outputTokens: 0, cacheReadTokens: 90_000, cacheWriteTokens: 0, costUsd: 0 })
  })

  it('reads a state file written before the cache counters existed', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mnemo-')), 'budget.json')
    const now = () => new Date('2026-11-13T10:00:00Z')
    writeFileSync(file, JSON.stringify({ day: '2026-11-13', inputTokens: 70, outputTokens: 30 }))
    const b = new Budget({ ...base, stateFile: file }, now)
    assert.equal(b.snapshot().inputTokens, 70)
    assert.equal(b.snapshot().cacheReadTokens, 0)
  })

  it('survives a restart through the state file, for the same day only', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mnemo-')), 'budget.json')
    const now = () => new Date('2026-11-13T10:00:00Z')
    new Budget({ ...base, dailyTokens: 100, stateFile: file }, now).add({ inputTokens: 70, outputTokens: 30 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { day: '2026-11-13', inputTokens: 70, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 })
    assert.equal(new Budget({ ...base, dailyTokens: 100, stateFile: file }, now).hasRoom(), false)
    assert.equal(new Budget({ ...base, dailyTokens: 100, stateFile: file }, () => new Date('2026-11-14T10:00:00Z')).hasRoom(), true)
  })
})

describe('memory', () => {
  it('LruMap drops the least recently used and expired entries', () => {
    let t = 0
    const m = new LruMap<number>(2, 1000, () => t)
    m.set('a', 1)
    m.set('b', 2)
    m.get('a')
    m.set('c', 3)
    assert.equal(m.has('b'), false)
    assert.equal(m.get('a'), 1)
    t = 2000
    assert.equal(m.get('c'), undefined)
  })

  it('boundHistory keeps the newest turns and starts with a question', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? ('user' as const) : ('assistant' as const), text: `t${i}`.padEnd(100, '.') }))
    const byTurns = boundHistory(turns, { maxTurns: 5, maxChars: 100_000 })
    assert.equal(byTurns.length, 4)
    assert.equal(byTurns[0]?.role, 'user')
    assert.ok(byTurns[0]?.text.startsWith('t6'))
    const byChars = boundHistory(turns, { maxTurns: 100, maxChars: 350 })
    assert.equal(byChars.length, 2)
    assert.ok(byChars[0]?.text.startsWith('t8'))
  })
})
