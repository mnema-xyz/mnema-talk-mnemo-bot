// Mnemo on Mnema Talk: answers mentions, /ask and messages in the threads it
// started, with Regenerate, Details and Follow-up buttons. All chat-specific
// code is in this file; the answering itself is the Engine's.
import { randomBytes } from 'node:crypto'
import {
  actionRow,
  ActivityType,
  button,
  ButtonStyle,
  modal,
  RestError,
  textInput,
  TextInputStyle,
  type Client,
  type Interaction,
  type InteractionUser,
  type Message,
} from 'mnema-talk-sdk'
import type { AskResult, Engine } from '../engine/engine.ts'
import type { Budget } from '../engine/limits.ts'
import { boundHistory, LruMap, type HistoryTurn, type ThreadLimits } from '../engine/memory.ts'
import { splitMessage } from '../engine/split.ts'
import type { Logger } from '../log.ts'
import { COMMANDS } from './commands.ts'
import { customId, detailsFrom, detailsText, parseCustomId, type AnswerDetails } from './delivery.ts'

export interface BotSettings {
  /** Channel IDs Mnemo answers in; empty means all it can see. */
  allowedChannels: string[]
  /** Answer a mention in a new thread under the question (else as a reply). */
  replyInThread: boolean
  sendDisplayName: boolean
  thread: ThreadLimits & { ttlMs: number }
}

/** What a button needs to know about the answer it sits under. */
interface AnswerRecord {
  question: string
  answer: string
  history: HistoryTurn[]
  askerId: string
  channelId: string
  /** The thread the answer is in, if any. */
  threadId?: string | undefined
  ephemeral: boolean
  details: AnswerDetails
}

/** An interaction with the member who caused it (always set for clicks,
 * commands and submits; the SDK types it optional). */
type MemberInteraction = Interaction & { readonly user: InteractionUser }

const THINKING = '👀'
const MAX_ANSWERS = 2000

export class MnemoBot {
  private selfId = ''
  private selfUsername = ''
  private readonly threads: LruMap<HistoryTurn[]>
  private readonly answers = new LruMap<AnswerRecord>(MAX_ANSWERS, 24 * 3600_000)
  /** One question at a time per thread, so answers keep their order. */
  private readonly queues = new Map<string, Promise<void>>()

  private readonly client: Client
  private readonly engine: Engine
  private readonly budget: Budget
  private readonly s: BotSettings
  private readonly log: Logger

  constructor(client: Client, engine: Engine, budget: Budget, settings: BotSettings, log: Logger) {
    this.client = client
    this.engine = engine
    this.budget = budget
    this.s = settings
    this.log = log
    this.threads = new LruMap(1000, settings.thread.ttlMs)

    client.on('ready', (r) => {
      this.selfId = r.user.id
      this.selfUsername = r.user.username
      log.info('ready', { bot: r.user.username, session: r.session_id })
      void this.afterReady()
    })
    client.on('messageCreate', (m) => {
      void this.onMessage(m).catch((err: unknown) => {
        this.log.error('message_failed', { error: err })
      })
    })
    client.on('interactionCreate', (i) => {
      void this.onInteraction(i).catch((err: unknown) => {
        this.log.error('interaction_failed', { error: err })
      })
    })
  }

  private async afterReady(): Promise<void> {
    try {
      await this.client.commands.set(COMMANDS)
      this.client.setPresence({ status: 'online', activity: { type: ActivityType.Custom, name: 'Ask me: /ask or @mention' } })
    } catch (err) {
      this.log.warn('setup_failed', { error: err })
    }
  }

  private allowed(channelId: string): boolean {
    return this.s.allowedChannels.length === 0 || this.s.allowedChannels.includes(channelId)
  }

  // ---- mentions and threads ------------------------------------------------

  private async onMessage(m: Message): Promise<void> {
    if (!this.selfId || m.user_id === this.selfId || m.is_bot || !m.content.trim()) return
    if (!this.allowed(m.channel_id)) return

    const mentioned = m.mentions.includes(this.selfId)
    const inOurThread = m.parent_id !== undefined && this.threads.has(m.parent_id)
    if (!mentioned && !inOurThread) return

    // A mention in the channel starts a thread under the question; one inside
    // a thread is answered there.
    const threadId = m.parent_id ?? (this.s.replyInThread ? m.id : undefined)
    const key = threadId ?? m.id
    await this.serial(key, () => this.answerMessage(m, threadId))
  }

  private async answerMessage(m: Message, threadId: string | undefined): Promise<void> {
    const question = this.stripMention(m.content)
    const history = threadId ? (this.threads.get(threadId) ?? []) : []
    await this.react(m, true)
    try {
      const result = await this.engine.ask({
        question,
        history,
        userId: m.user_id,
        channelId: m.channel_id,
        askerName: m.display_name || m.username,
      })
      const answerId = this.remember(result, { question, history, askerId: m.user_id, channelId: m.channel_id, threadId, ephemeral: false })
      const components = answerId ? this.buttons(answerId, false) : undefined
      await this.post(m.channel_id, result.text, components, threadId ? { parent_id: threadId } : { message_reference: { message_id: m.id } })
      if (threadId && result.kind === 'answer') {
        this.threads.set(threadId, boundHistory([...history, { role: 'user', text: question }, { role: 'assistant', text: result.text }], this.s.thread))
      }
    } finally {
      await this.react(m, false)
    }
  }

  /** Removes "@mnemo" from the question; the model does not need it. */
  private stripMention(content: string): string {
    // A mention is written with the bot's handle (`@bot-…`, as the mention
    // picker inserts it); READY names the bot by its display name.
    let s = content.replace(/(^|\s)@bot-[a-z0-9]+\b/gi, ' ')
    if (this.selfUsername) {
      const name = this.selfUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      s = s.replace(new RegExp(`(^|\\s)@${name}\\b`, 'gi'), ' ')
    }
    return s.replace(/\s+/g, ' ').trim()
  }

  private async react(m: Message, on: boolean): Promise<void> {
    try {
      if (on) await this.client.rest.addReaction(m.channel_id, m.id, THINKING)
      else await this.client.rest.removeReaction(m.channel_id, m.id, THINKING)
    } catch {
      // Reacting is a courtesy; without the permission Mnemo still answers.
    }
  }

  private async post(
    channelId: string,
    text: string,
    components: ReturnType<MnemoBot['buttons']> | undefined,
    where: { parent_id: string } | { message_reference: { message_id: string } },
  ): Promise<void> {
    const parts = splitMessage(text)
    for (const [n, content] of parts.entries()) {
      const last = n === parts.length - 1
      await this.client.rest.createMessage(channelId, {
        content,
        ...(n === 0 || 'parent_id' in where ? where : {}),
        ...(last && components ? { components } : {}),
        allowed_mentions: { parse: [] },
      })
    }
  }

  // ---- /ask and the buttons ------------------------------------------------

  private async onInteraction(i: Interaction): Promise<void> {
    if (!hasUser(i)) return
    if (i.isCommand() && i.commandName === 'ask') return this.onAsk(i)
    const id = i.isButton() || i.isModalSubmit() ? parseCustomId(i.customId) : undefined
    if (!id) return
    if (i.isModalSubmit() && id.kind === 'followup') return this.onFollowUpSubmit(i, id.answerId)
    const rec = this.answers.get(id.answerId)
    if (!rec) {
      await i.reply({ content: 'This answer is too old for that now. Ask me again.', ephemeral: true })
      return
    }
    if (id.kind === 'details') {
      await i.reply({ content: detailsText(rec.details), ephemeral: true })
    } else if (id.kind === 'regen') {
      await this.onRegenerate(i, id.answerId, rec)
    } else if (id.kind === 'follow') {
      await i.showModal(
        modal({
          customId: customId('followup', id.answerId),
          title: 'Ask Mnemo a follow-up',
          components: [
            actionRow(
              textInput({ customId: 'question', label: 'Your question', style: TextInputStyle.Paragraph, maxLength: 1000, required: true }),
            ),
          ],
        }),
      )
    }
  }

  private async onAsk(i: MemberInteraction): Promise<void> {
    const ephemeral = i.options.get('private') === true
    if (!this.allowed(i.channelId)) {
      await i.reply({ content: 'I do not answer in this channel. Ask me in one where I am enabled.', ephemeral: true })
      return
    }
    const question = String(i.options.get('question') ?? '')
    await i.deferReply({ ephemeral })
    await this.answerInteraction(i, { question, history: [], ephemeral, first: 'edit' })
  }

  private async onFollowUpSubmit(i: MemberInteraction, answerId: string): Promise<void> {
    const rec = this.answers.get(answerId)
    const question = i.fields.get('question') ?? ''
    const ephemeral = rec?.ephemeral ?? false
    await i.deferReply({ ephemeral })
    const history = rec ? boundHistory([...rec.history, { role: 'user', text: rec.question }, { role: 'assistant', text: rec.answer }], this.s.thread) : []
    await this.answerInteraction(i, { question, history, ephemeral, first: 'edit' })
  }

  private async onRegenerate(i: MemberInteraction, answerId: string, rec: AnswerRecord): Promise<void> {
    if (i.user.id !== rec.askerId) {
      await i.reply({ content: 'Only the person who asked can regenerate this answer.', ephemeral: true })
      return
    }
    await i.deferUpdate()
    // The old answer stays readable; its buttons go, the new answer gets them.
    await i.editReply({ components: [] }).catch(() => undefined)
    this.answers.delete(answerId)
    if (rec.threadId) {
      const threadId = rec.threadId
      await this.serial(threadId, async () => {
        const result = await this.engine.ask({ question: rec.question, history: rec.history, userId: i.user.id, channelId: rec.channelId, askerName: i.user.display_name })
        const newId = this.remember(result, { ...rec, ephemeral: false })
        await this.post(rec.channelId, result.text, newId ? this.buttons(newId, false) : undefined, { parent_id: threadId })
        if (result.kind === 'answer') this.replaceInThread(threadId, rec.answer, result.text)
      })
      return
    }
    await this.answerInteraction(i, { question: rec.question, history: rec.history, ephemeral: rec.ephemeral, first: 'followup' })
  }

  /** Answers through the interaction: the first part as the reply (or a
   * follow-up), the rest as follow-ups, the buttons under the last part. */
  private async answerInteraction(
    i: MemberInteraction,
    q: { question: string; history: HistoryTurn[]; ephemeral: boolean; first: 'edit' | 'followup' },
  ): Promise<void> {
    const result = await this.engine.ask({
      question: q.question,
      history: q.history,
      userId: i.user.id,
      channelId: i.channelId,
      askerName: i.user.display_name || i.user.username,
    })
    const answerId = this.remember(result, { question: q.question, history: q.history, askerId: i.user.id, channelId: i.channelId, ephemeral: q.ephemeral })
    const parts = splitMessage(result.text)
    for (const [n, content] of parts.entries()) {
      const last = n === parts.length - 1
      const data = { content, ...(last && answerId ? { components: this.buttons(answerId, true) } : {}) }
      // The first part replaces the deferred reply, which already knows
      // whether it is private; follow-ups say it themselves. Interaction
      // responses never notify @all or @here, so no allowed_mentions.
      if (n === 0 && q.first === 'edit') await i.editReply(data)
      else await i.followUp({ ...data, ephemeral: q.ephemeral })
    }
  }

  private buttons(answerId: string, followUp: boolean) {
    const row = [
      button({ customId: customId('regen', answerId), label: 'Regenerate', style: ButtonStyle.Secondary }),
      button({ customId: customId('details', answerId), label: 'Details', style: ButtonStyle.Secondary }),
    ]
    if (followUp) row.push(button({ customId: customId('follow', answerId), label: 'Follow up', style: ButtonStyle.Primary }))
    return [actionRow(...row)]
  }

  /** Keeps what the buttons need; refusals (limits, budget) get no buttons. */
  private remember(result: AskResult, r: Omit<AnswerRecord, 'answer' | 'details'>): string | undefined {
    if (result.kind !== 'answer') return undefined
    const id = randomBytes(9).toString('base64url')
    const details = detailsFrom(result, r.history.length, this.s.sendDisplayName, this.budget.costUsd(result.usage))
    this.answers.set(id, { ...r, answer: result.text, details })
    return id
  }

  private replaceInThread(threadId: string, oldText: string, newText: string): void {
    const turns = this.threads.get(threadId)
    if (!turns) return
    const at = turns.findLastIndex((t) => t.role === 'assistant' && t.text === oldText)
    if (at >= 0) this.threads.set(threadId, turns.map((t, n) => (n === at ? { role: 'assistant', text: newText } : t)))
  }

  private async serial(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => undefined)
    this.queues.set(key, tail)
    try {
      await next
    } catch (err) {
      if (err instanceof RestError) this.log.warn('mnema_api_error', { status: err.status, code: err.code, message: err.message })
      else throw err
    } finally {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    }
  }

  /** For the health endpoint. */
  stats(): Record<string, number> {
    return { threads: this.threads.size, answers: this.answers.size }
  }
}

function hasUser(i: Interaction): i is MemberInteraction {
  return i.user !== undefined
}
