// Configuration: environment variables, optionally on top of a JSON file
// (MNEMO_CONFIG). Everything is validated at start; a mistake stops Mnemo
// with a message that names the variable. Secrets come only from the
// environment or from files (`*_FILE`), never from the config file.
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { TOOL_NAMES } from './tools/index.ts'

const bool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])]).transform((v) =>
  typeof v === 'boolean' ? v : ['true', '1', 'yes', 'on'].includes(v),
)
const list = z.union([z.array(z.string()), z.string()]).transform((v) =>
  (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean),
)
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max)
const num = (min: number) => z.coerce.number().min(min)
const httpUrl = z
  .url({ protocol: /^https?$/, error: 'must be a URL that starts with http:// or https://' })
  .transform((u) => u.replace(/\/+$/, ''))

/** The settings, with their defaults. The README's reference table follows this. */
export const SettingsSchema = z.object({
  mnemaUrl: httpUrl.describe('Address of your Mnema Talk server, e.g. https://talk.example.org'),
  provider: z.enum(['anthropic', 'openai', 'openai-compatible', 'fake']).default('anthropic'),
  model: z.string().min(1).optional(),
  baseUrl: httpUrl.optional(),
  anthropicEffort: z.enum(['low', 'medium', 'high']).default('low'),
  maxOutputTokens: int(256, 64000).default(4096),
  providerTimeoutMs: int(1000, 600000).default(60000),
  toolTimeoutMs: int(500, 120000).default(10000),
  maxToolCalls: int(0, 20).default(6),
  tools: list.pipe(z.array(z.enum(TOOL_NAMES))).default([...TOOL_NAMES]),
  searchProvider: z.enum(['brave', 'tavily']).optional(),
  sendDisplayName: bool.default(false),
  allowedChannels: list.default([]),
  replyInThread: bool.default(true),
  memberLimitPerMinute: int(0, 1000).default(5),
  channelLimitPerMinute: int(0, 10000).default(20),
  dailyTokenBudget: int(0, 1e12).default(1_000_000),
  dailyCostBudgetUsd: num(0).default(0),
  priceInputPerMTok: num(0).optional(),
  priceOutputPerMTok: num(0).optional(),
  threadMaxTurns: int(2, 100).default(12),
  threadMaxChars: int(1000, 200000).default(12000),
  threadTtlHours: int(1, 24 * 30).default(24),
  systemPrompt: z.string().min(1).max(20000).optional(),
  systemPromptFile: z.string().min(1).optional(),
  healthPort: int(0, 65535).default(8080),
  healthHost: z.string().default('127.0.0.1'),
  dataDir: z.string().min(1).default('data'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

/** Environment variable for each setting. */
export const ENV: Record<keyof z.input<typeof SettingsSchema>, string> = {
  mnemaUrl: 'MNEMA_URL',
  provider: 'MNEMO_PROVIDER',
  model: 'MNEMO_MODEL',
  baseUrl: 'MNEMO_BASE_URL',
  anthropicEffort: 'MNEMO_ANTHROPIC_EFFORT',
  maxOutputTokens: 'MNEMO_MAX_OUTPUT_TOKENS',
  providerTimeoutMs: 'MNEMO_PROVIDER_TIMEOUT_MS',
  toolTimeoutMs: 'MNEMO_TOOL_TIMEOUT_MS',
  maxToolCalls: 'MNEMO_MAX_TOOL_CALLS',
  tools: 'MNEMO_TOOLS',
  searchProvider: 'MNEMO_SEARCH_PROVIDER',
  sendDisplayName: 'MNEMO_SEND_DISPLAY_NAME',
  allowedChannels: 'MNEMO_ALLOWED_CHANNELS',
  replyInThread: 'MNEMO_REPLY_IN_THREAD',
  memberLimitPerMinute: 'MNEMO_MEMBER_LIMIT_PER_MINUTE',
  channelLimitPerMinute: 'MNEMO_CHANNEL_LIMIT_PER_MINUTE',
  dailyTokenBudget: 'MNEMO_DAILY_TOKEN_BUDGET',
  dailyCostBudgetUsd: 'MNEMO_DAILY_COST_BUDGET_USD',
  priceInputPerMTok: 'MNEMO_PRICE_INPUT_PER_MTOK',
  priceOutputPerMTok: 'MNEMO_PRICE_OUTPUT_PER_MTOK',
  threadMaxTurns: 'MNEMO_THREAD_MAX_TURNS',
  threadMaxChars: 'MNEMO_THREAD_MAX_CHARS',
  threadTtlHours: 'MNEMO_THREAD_TTL_HOURS',
  systemPrompt: 'MNEMO_SYSTEM_PROMPT',
  systemPromptFile: 'MNEMO_SYSTEM_PROMPT_FILE',
  healthPort: 'MNEMO_HEALTH_PORT',
  healthHost: 'MNEMO_HEALTH_HOST',
  dataDir: 'MNEMO_DATA_DIR',
  logLevel: 'MNEMO_LOG_LEVEL',
}

/** Secrets: each from `NAME` or from the file named by `NAME_FILE`. */
export const SECRETS = {
  mnemaToken: 'MNEMA_TOKEN',
  apiKey: 'MNEMO_API_KEY',
  searchApiKey: 'MNEMO_SEARCH_API_KEY',
} as const

/** The default model per provider. Anthropic's is chosen for cost; the
 * others have no default because their model lists differ per account. */
export const DEFAULT_MODEL: Partial<Record<string, string>> = {
  anthropic: 'claude-haiku-5-5',
  fake: 'fake-model',
}

/** Known list prices in USD per million tokens, for the cost budget. Set
 * MNEMO_PRICE_* for any other model. */
export const KNOWN_PRICES: Partial<Record<string, { input: number; output: number }>> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
}

export type Settings = z.infer<typeof SettingsSchema>

export interface Config extends Omit<Settings, 'model' | 'systemPromptFile' | 'priceInputPerMTok' | 'priceOutputPerMTok'> {
  model: string
  mnemaToken: string
  apiKey: string
  searchApiKey?: string | undefined
  priceInputPerMTok: number
  priceOutputPerMTok: number
}

export class ConfigError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`Mnemo's configuration has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

type Env = Record<string, string | undefined>

function readSecret(env: Env, name: string, problems: string[]): string | undefined {
  const direct = env[name]?.trim()
  const file = env[`${name}_FILE`]?.trim()
  if (direct && file) {
    problems.push(`${name} and ${name}_FILE are both set; use one`)
    return undefined
  }
  if (file) {
    try {
      const v = readFileSync(file, 'utf8').trim()
      if (!v) problems.push(`${name}_FILE points to an empty file`)
      return v || undefined
    } catch {
      problems.push(`${name}_FILE: cannot read ${file}`)
      return undefined
    }
  }
  return direct || undefined
}

function readFileConfig(path: string, problems: string[]): Record<string, unknown> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    problems.push(`MNEMO_CONFIG: cannot read ${path} as JSON (${err instanceof Error ? err.message : 'unknown error'})`)
    return {}
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push(`MNEMO_CONFIG: ${path} must hold a JSON object`)
    return {}
  }
  const obj: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === '$schema') continue
    if (k in ENV) {
      obj[k] = v
    } else if (/token|key|secret|password/i.test(k)) {
      // Not a setting, and named like one of the secrets: say where it goes.
      problems.push(`config file: "${k}" looks like a secret; secrets go in the environment (${Object.values(SECRETS).join(', ')}) or *_FILE`)
    } else {
      problems.push(`config file: unknown setting "${k}"`)
    }
  }
  return obj
}

/** Reads and checks the configuration. Throws ConfigError listing every problem. */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = []
  const merged: Record<string, unknown> = env.MNEMO_CONFIG ? readFileConfig(env.MNEMO_CONFIG, problems) : {}
  for (const [key, name] of Object.entries(ENV)) {
    const v = env[name]
    if (v !== undefined && v.trim() !== '') merged[key] = v.trim()
  }

  const parsed = SettingsSchema.safeParse(merged)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '')
      const name = ENV[key as keyof typeof ENV] as string | undefined
      problems.push(`${name ?? key}: ${issue.code === 'invalid_type' && merged[key] === undefined ? 'is required' : issue.message}`)
    }
  }

  const mnemaToken = readSecret(env, SECRETS.mnemaToken, problems)
  const apiKey = readSecret(env, SECRETS.apiKey, problems)
  const searchApiKey = readSecret(env, SECRETS.searchApiKey, problems)
  if (!mnemaToken) problems.push('MNEMA_TOKEN (or MNEMA_TOKEN_FILE) is required: the bot token from Admin area > Bots')

  if (!parsed.success) throw new ConfigError(problems)
  const s = parsed.data

  const model = s.model ?? DEFAULT_MODEL[s.provider]
  if (!model) problems.push(`MNEMO_MODEL is required for the ${s.provider} provider`)
  if ((s.provider === 'anthropic' || s.provider === 'openai') && !apiKey) {
    problems.push(`MNEMO_API_KEY (or MNEMO_API_KEY_FILE) is required for the ${s.provider} provider`)
  }
  if (s.provider === 'openai-compatible' && !s.baseUrl) {
    problems.push('MNEMO_BASE_URL is required for openai-compatible, e.g. http://localhost:11434/v1 for Ollama')
  }
  if (s.searchProvider && !searchApiKey) problems.push('MNEMO_SEARCH_PROVIDER is set but MNEMO_SEARCH_API_KEY is missing')
  if (searchApiKey && !s.searchProvider) problems.push('MNEMO_SEARCH_API_KEY is set; also set MNEMO_SEARCH_PROVIDER to brave or tavily')
  if (s.systemPrompt && s.systemPromptFile) problems.push('MNEMO_SYSTEM_PROMPT and MNEMO_SYSTEM_PROMPT_FILE are both set; use one')

  let systemPrompt = s.systemPrompt
  if (s.systemPromptFile) {
    try {
      systemPrompt = readFileSync(s.systemPromptFile, 'utf8').trim()
      if (!systemPrompt) problems.push('MNEMO_SYSTEM_PROMPT_FILE points to an empty file')
    } catch {
      problems.push(`MNEMO_SYSTEM_PROMPT_FILE: cannot read ${s.systemPromptFile}`)
    }
  }

  const known = model ? KNOWN_PRICES[model] : undefined
  const priceInputPerMTok = s.priceInputPerMTok ?? known?.input ?? 0
  const priceOutputPerMTok = s.priceOutputPerMTok ?? known?.output ?? 0
  if (s.dailyCostBudgetUsd > 0 && priceInputPerMTok === 0 && priceOutputPerMTok === 0) {
    problems.push(`MNEMO_DAILY_COST_BUDGET_USD needs prices: set MNEMO_PRICE_INPUT_PER_MTOK and MNEMO_PRICE_OUTPUT_PER_MTOK for ${model ?? 'the model'}`)
  }

  if (problems.length > 0) throw new ConfigError(problems)
  const { systemPromptFile, ...rest } = s
  return {
    ...rest,
    ...(systemPrompt ? { systemPrompt } : {}),
    model: model as string,
    mnemaToken: mnemaToken as string,
    apiKey: apiKey ?? '',
    searchApiKey,
    priceInputPerMTok,
    priceOutputPerMTok,
  }
}
