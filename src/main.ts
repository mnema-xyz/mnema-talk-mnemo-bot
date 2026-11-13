// Mnemo's entry point: read the configuration, build the engine, connect to
// Mnema Talk, serve the health endpoint, and shut down cleanly on SIGTERM.
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Client, Intents } from 'mnema-talk-sdk'
import pkg from '../package.json' with { type: 'json' }
import { MnemoBot } from './bot/bot.ts'
import { ConfigError, loadConfig } from './config.ts'
import { Engine } from './engine/engine.ts'
import { Budget, RateLimiter } from './engine/limits.ts'
import { DEFAULT_PERSONA } from './engine/prompt.ts'
import { startHealthServer } from './health.ts'
import { afterClose, onConnectError } from './lifecycle.ts'
import { createLogger } from './log.ts'
import { createProvider } from './providers/index.ts'
import { selectTools } from './tools/index.ts'

let config
try {
  config = loadConfig()
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message)
    console.error('\nSee the configuration reference: https://github.com/msch128/mnema-talk-mnemo-bot#configuration')
    process.exit(78) // EX_CONFIG
  }
  throw err
}

const log = createLogger(config.logLevel)
const provider = createProvider(config)
const tools = selectTools({
  enabled: config.tools,
  webSearch: config.searchProvider && config.searchApiKey ? { backend: config.searchProvider, apiKey: config.searchApiKey } : undefined,
})
const budget = new Budget({
  dailyTokens: config.dailyTokenBudget,
  dailyCostUsd: config.dailyCostBudgetUsd,
  inputUsdPerMTok: config.priceInputPerMTok,
  outputUsdPerMTok: config.priceOutputPerMTok,
  stateFile: join(config.dataDir, 'budget.json'),
})
const engine = new Engine({
  provider,
  tools,
  budget,
  log,
  memberLimit: new RateLimiter(config.memberLimitPerMinute, 60_000),
  channelLimit: new RateLimiter(config.channelLimitPerMinute, 60_000),
  settings: {
    persona: config.systemPrompt ?? DEFAULT_PERSONA,
    maxToolCalls: config.maxToolCalls,
    maxOutputTokens: config.maxOutputTokens,
    providerTimeoutMs: config.providerTimeoutMs,
    toolTimeoutMs: config.toolTimeoutMs,
    sendDisplayName: config.sendDisplayName,
    userAgent: `Mnemo/${pkg.version} (+${pkg.homepage})`,
  },
})

const client = new Client({ baseUrl: config.mnemaUrl, token: config.mnemaToken, intents: Intents.GuildMessages })
const bot = new MnemoBot(
  client,
  engine,
  budget,
  {
    allowedChannels: config.allowedChannels,
    replyInThread: config.replyInThread,
    sendDisplayName: config.sendDisplayName,
    thread: { maxTurns: config.threadMaxTurns, maxChars: config.threadMaxChars, ttlMs: config.threadTtlHours * 3600_000 },
  },
  log,
)

let connected = false
client.on('ready', () => {
  connected = true
})
client.on('resumed', () => {
  connected = true
})
let stopping = false
client.on('close', (info) => {
  connected = false
  log.warn('disconnected', { code: info.code, reason: info.reason, reconnecting: info.reconnect })
  const v = afterClose(info, stopping)
  if (v.action === 'exit') {
    // The SDK gives up on this close; staying up would be an offline bot
    // with a 503 health check. Exit so that Docker restarts Mnemo.
    log.error('gateway_closed_for_good', { code: info.code, hint: v.hint })
    process.exit(1)
  }
})
client.on('error', (err) => {
  log.error('client_error', { error: err })
})

const health =
  config.healthPort > 0
    ? await startHealthServer(config.healthHost, config.healthPort, {
        connected: () => connected,
        details: () => ({ version: pkg.version, provider: provider.name, model: provider.model, ...bot.stats(), budget: budget.snapshot() }),
      })
    : undefined

log.info('starting', {
  version: pkg.version,
  server: config.mnemaUrl,
  provider: provider.name,
  model: provider.model,
  tools: tools.map((t) => t.name),
  allowed_channels: config.allowedChannels.length || 'all',
  health: health ? `${config.healthHost}:${config.healthPort}` : 'off',
})

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  log.info('stopping', { signal })
  const force = setTimeout(() => process.exit(1), 10_000)
  force.unref()
  try {
    await client.close()
  } catch (err) {
    log.warn('close_failed', { error: err })
  }
  health?.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

// The server may still be starting (a shared Compose stack): retry with
// backoff. A refused token will not get better, so that one stops Mnemo.
for (let attempt = 1; ; attempt++) {
  try {
    await client.connect()
    break
  } catch (err) {
    const v = onConnectError(err)
    if (v.action === 'exit') {
      log.error('connect_refused', { error: err, hint: v.hint })
      process.exit(1)
    }
    const seconds = Math.min(60, 2 ** Math.min(attempt, 6))
    log.warn('connect_failed', { attempt, retry_in_s: seconds, error: err })
    await sleep(seconds * 1000)
  }
}
