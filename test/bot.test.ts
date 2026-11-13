import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { Client, Interaction } from '@mnema-xyz/bot-sdk'
import { MnemoBot, type BotSettings } from '../src/bot/bot.ts'
import { commandsFor } from '../src/bot/commands.ts'
import { Engine } from '../src/engine/engine.ts'
import { Budget, RateLimiter } from '../src/engine/limits.ts'
import { silentLogger } from '../src/log.ts'
import { fakeProvider } from '../src/providers/fake.ts'
import { BUILTIN_TOOLS } from '../src/tools/index.ts'

interface Sent {
  content?: string
  ephemeral?: boolean
  components?: { components: { custom_id?: string; customId?: string; label?: string }[] }[]
}

const SETTINGS: BotSettings = {
  allowedChannels: [],
  adminUserIds: ['admin'],
  maxRegenerations: 2,
  replyInThread: false,
  sendDisplayName: false,
  thread: { maxTurns: 12, maxChars: 12000, ttlMs: 3600_000 },
}

function setup(over: Partial<BotSettings> = {}, budget = new Budget({ dailyTokens: 0, dailyCostUsd: 0, inputUsdPerMTok: 0, outputUsdPerMTok: 0 })) {
  const events = new EventEmitter()
  const registered: string[][] = []
  const posted: Sent[] = []
  const client = Object.assign(events, {
    commands: {
      set: (c: { name: string }[]) => {
        registered.push(c.map((x) => x.name))
        return Promise.resolve()
      },
    },
    setPresence: () => undefined,
    rest: { createMessage: (_c: string, body: Sent) => Promise.resolve(void posted.push(body)) },
  }) as unknown as Client
  const engine = new Engine({
    provider: fakeProvider(),
    tools: BUILTIN_TOOLS,
    settings: {
      persona: 'You are Mnemo.',
      maxToolCalls: 3,
      maxOutputTokens: 1024,
      providerTimeoutMs: 5000,
      toolTimeoutMs: 5000,
      sendDisplayName: false,
      userAgent: 'Mnemo-test',
    },
    memberLimit: new RateLimiter(100, 60_000),
    channelLimit: new RateLimiter(100, 60_000),
    budget,
    log: silentLogger,
  })
  new MnemoBot(client, engine, budget, { ...SETTINGS, ...over }, silentLogger)
  const run = (i: object) => {
    events.emit('interactionCreate', i)
    return new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  return { events, registered, posted, run }
}

/** A fake interaction that records what it sent. */
function fake(kind: { command: string; options?: Record<string, string | boolean> } | { customId: string }, userId = 'u1', channelId = 'c1') {
  const sent: Sent[] = []
  const command = 'command' in kind
  const i = {
    user: { id: userId, username: userId, display_name: userId },
    channelId,
    commandName: command ? kind.command : '',
    customId: command ? '' : kind.customId,
    options: new Map(Object.entries(command ? (kind.options ?? {}) : {})),
    fields: new Map<string, string>(),
    isCommand: () => command,
    isButton: () => !command,
    isModalSubmit: () => false,
    reply: (d: Sent) => Promise.resolve(void sent.push(d)),
    deferReply: () => Promise.resolve(),
    deferUpdate: () => Promise.resolve(),
    editReply: (d: Sent) => Promise.resolve(void sent.push(d)),
    followUp: (d: Sent) => Promise.resolve(void sent.push(d)),
  }
  return { i: i as unknown as Interaction, sent }
}

const buttonsOf = (s: Sent | undefined) => (s?.components ?? []).flatMap((r) => r.components.map((c) => c.label))

/** Runs /ask and returns the custom id of the Regenerate button, if any. */
async function ask(t: ReturnType<typeof setup>, over: { private?: boolean; channel?: string } = {}) {
  const a = fake({ command: 'ask', options: { question: 'What is 2+2?', private: over.private ?? false } }, 'u1', over.channel ?? 'c1')
  await t.run(a.i)
  const last = a.sent.at(-1)
  const regen = last?.components?.[0]?.components.find((c) => c.label === 'Regenerate')
  return { last, regen: regen?.custom_id ?? regen?.customId }
}

describe('answer buttons', () => {
  it('never offer Details; Regenerate and Follow up remain', async () => {
    const t = setup()
    const { last } = await ask(t)
    assert.deepEqual(buttonsOf(last), ['Regenerate', 'Follow up'])
  })

  it('offer no Regenerate when MNEMO_MAX_REGENERATIONS is 0', async () => {
    const t = setup({ maxRegenerations: 0 })
    const { last } = await ask(t)
    assert.deepEqual(buttonsOf(last), ['Follow up'])
  })
})

describe('/details', () => {
  it('is registered only when admins are configured', async () => {
    assert.deepEqual(commandsFor([]).map((c) => c.name), ['ask'])
    assert.deepEqual(commandsFor(['admin']).map((c) => c.name), ['ask', 'details'])
    const t = setup()
    t.events.emit('ready', { user: { id: 'bot', username: 'mnemo' }, session_id: 's' })
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(t.registered, [['ask', 'details']])
  })

  it('shows an admin how the last public answer was made, privately', async () => {
    const t = setup()
    await ask(t)
    const d = fake({ command: 'details' }, 'admin')
    await t.run(d.i)
    assert.equal(d.sent.length, 1)
    assert.equal(d.sent[0]?.ephemeral, true)
    assert.match(d.sent[0]?.content ?? '', /How this answer was made/)
    assert.match(d.sent[0]?.content ?? '', /fake-model/)
  })

  it('refuses a member privately and leaks nothing', async () => {
    const t = setup()
    await ask(t)
    const d = fake({ command: 'details' }, 'u1')
    await t.run(d.i)
    assert.equal(d.sent[0]?.ephemeral, true)
    assert.equal(d.sent[0]?.content, 'Only Mnemo admins can see how an answer was made.')
    assert.doesNotMatch(d.sent[0]?.content ?? '', /model|token|fake/i)
  })

  it('refuses everyone when no admin is configured', async () => {
    const t = setup({ adminUserIds: [] })
    await ask(t)
    const d = fake({ command: 'details' }, 'admin')
    await t.run(d.i)
    assert.match(d.sent[0]?.content ?? '', /Only Mnemo admins/)
  })

  it('does not show details of a private answer', async () => {
    const t = setup()
    await ask(t, { private: true })
    const d = fake({ command: 'details' }, 'admin')
    await t.run(d.i)
    assert.match(d.sent[0]?.content ?? '', /no recent public answer/)
  })
})

describe('regeneration limit', () => {
  it('lets the asker regenerate twice, then the button is gone and a stale click is refused', async () => {
    const t = setup()
    const first = await ask(t)
    assert.ok(first.regen)

    const r1 = fake({ customId: first.regen }, 'u1')
    await t.run(r1.i)
    const second = r1.sent.at(-1)
    assert.deepEqual(buttonsOf(second), ['Regenerate', 'Follow up'])
    const regen2 = second?.components?.[0]?.components[0]
    const r2 = fake({ customId: regen2?.custom_id ?? regen2?.customId ?? '' }, 'u1')
    await t.run(r2.i)
    const third = r2.sent.at(-1)
    assert.deepEqual(buttonsOf(third), ['Follow up'])
  })

  it('removes the button after the only allowed regeneration, and the old button is dead', async () => {
    const t = setup({ maxRegenerations: 1 })
    const first = await ask(t)
    const r1 = fake({ customId: first.regen ?? '' }, 'u1')
    await t.run(r1.i)
    assert.deepEqual(buttonsOf(r1.sent.at(-1)), ['Follow up'])
    const stale = fake({ customId: first.regen ?? '' }, 'u1')
    await t.run(stale.i)
    assert.match(stale.sent[0]?.content ?? '', /too old/)
  })

  it('charges every regeneration to the daily budget', async () => {
    const budget = new Budget({ dailyTokens: 1_000_000, dailyCostUsd: 0, inputUsdPerMTok: 0, outputUsdPerMTok: 0 })
    const t = setup({}, budget)
    const first = await ask(t)
    const before = budget.snapshot().inputTokens
    await t.run(fake({ customId: first.regen ?? '' }, 'u1').i)
    assert.ok(budget.snapshot().inputTokens > before)
  })

  it('stays with the asker', async () => {
    const t = setup()
    const first = await ask(t)
    const other = fake({ customId: first.regen ?? '' }, 'u2')
    await t.run(other.i)
    assert.match(other.sent[0]?.content ?? '', /Only the person who asked/)
  })
})
