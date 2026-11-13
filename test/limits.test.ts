import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Budget, RateLimiter } from '../src/engine/limits.ts'
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

  it('survives a restart through the state file, for the same day only', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mnemo-')), 'budget.json')
    const now = () => new Date('2026-11-13T10:00:00Z')
    new Budget({ ...base, dailyTokens: 100, stateFile: file }, now).add({ inputTokens: 70, outputTokens: 30 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { day: '2026-11-13', inputTokens: 70, outputTokens: 30 })
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
