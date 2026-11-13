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
    sentDisplayName: false,
  }

  it('says when no tool was used and what was sent', () => {
    const t = detailsText(base)
    assert.match(t, /No tools were used/)
    assert.match(t, /Sent to the AI provider: your question\./)
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
      sentDisplayName: true,
      costUsd: 0.00016,
    })
    assert.match(t, /- Weather \(Open-Meteo\): `\{"place":"Marbella"\}`/)
    assert.match(t, /- Calculator \(failed\): `\{"expression":"'x'"\}`/)
    assert.match(t, /your question, the last 4 messages of this thread, your display name/)
    assert.match(t, /about \$0\.0002/)
  })
})
