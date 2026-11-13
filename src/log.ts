// Structured logs: one JSON object per line on stdout. Fields whose name
// looks like a secret are replaced, and message texts are never logged,
// only their length, so logs hold no secrets and no chat content.

export type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SECRET = /token|key|secret|password|authorization/i

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (SECRET.test(k) && !/tokens$/i.test(k)) out[k] = '[redacted]'
    else if (v instanceof Error) out[k] = errorFields(v)
    else out[k] = v
  }
  return out
}

/** An error as log fields: name, message, and the code of its cause (a
 * network error's ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED ...). */
function errorFields(e: Error): Record<string, unknown> {
  const cause = e.cause as { code?: unknown } | undefined
  const code = typeof cause?.code === 'string' ? cause.code : undefined
  return { name: e.name, message: e.message, ...(code ? { cause: code } : {}) }
}

export function createLogger(level: Level, write: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (lvl: Level, msg: string, fields: Record<string, unknown> = {}): void => {
    if (ORDER[lvl] < ORDER[level]) return
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...redact(fields) }))
  }
  return {
    debug: (m, f) => {
      emit('debug', m, f)
    },
    info: (m, f) => {
      emit('info', m, f)
    },
    warn: (m, f) => {
      emit('warn', m, f)
    },
    error: (m, f) => {
      emit('error', m, f)
    },
  }
}

/** A logger that drops everything, for tests. */
export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
