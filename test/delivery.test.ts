import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { customId, detailsText, parseCustomId, type AnswerDetails } from '../src/bot/delivery.ts'

describe('button ids', () => {
  it('round-trip and refuse foreign ids', () => {
    const id = customId('regen', 'AbC_12-x')
    assert.equal(id, 'mnemo:regen:AbC_12-x')
    assert.deepEqual(parseCustomId(id), { kind: 'regen', answerId: 'AbC_12-x' })
    assert.equal(parseCustomId('deploy:v2'), undefined)
    assert.equal(parseCustomId('mnemo:regen:../../etc'), undefined)
  })
})

describe('details text', () => {
  const base: AnswerDetails = {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    toolsUsed: [],
    inputTokens: 1200,
    outputTokens: 80,
    costUsd: 0,
    historyTurns: 0,
    context: 'none',
    sentDisplayName: false,
  }

  it('says when no tool was used and what was sent', () => {
    const t = detailsText(base)
    assert.match(t, /No tools were used/)
    assert.match(t, /Sent to the AI provider: the question\./)
    assert.doesNotMatch(t, /your/)
    assert.match(t, /Tokens: 1200 in, 80 out\./)
  })

  it('lists tools with their input, the thread context and the name', () => {
    const t = detailsText({
      ...base,
      toolsUsed: [
        { name: 'weather', input: { place: 'Marbella' }, ok: true },
        { name: 'calculator', input: { expression: '`x`' }, ok: false },
      ],
      historyTurns: 4,
      context: 'thread',
      sentDisplayName: true,
      costUsd: 0.00016,
    })
    assert.match(t, /- Weather \(Open-Meteo\): `\{"place":"Marbella"\}`/)
    assert.match(t, /- Calculator \(failed\): `\{"expression":"'x'"\}`/)
    assert.match(t, /the question, the last 4 messages of the thread, the asker's display name/)
    assert.match(detailsText({ ...base, historyTurns: 2, context: 'follow-up' }), /the question, the earlier question and answer\./)
    assert.match(t, /about \$0\.0002/)
  })
})
