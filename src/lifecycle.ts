// What to do when the connection to Mnema Talk fails or closes. Kept apart
// from main.ts so that it can be tested.
import { GatewayError, RestError, type GatewayCloseInfo } from '@mnema-xyz/bot-sdk'

export type Verdict = { action: 'exit'; hint: string } | { action: 'retry' }

const FATAL_HINTS: Record<number, string> = {
  4004: 'the token was refused, revoked or the bot is disabled or banned: regenerate it in Admin area > Bots',
  4013: 'the intents are invalid',
  4014: 'the bot may not use the GUILD_MESSAGES intent: allow it in Admin area > Bots',
}

/** A failure of `client.connect()` at start. Problems that waiting cannot
 * fix end Mnemo; the server being down or unreachable is retried. */
export function onConnectError(err: unknown): Verdict {
  if (err instanceof RestError && (err.status === 401 || err.status === 403)) {
    return { action: 'exit', hint: 'the token was refused: check MNEMA_TOKEN, or regenerate it in Admin area > Bots' }
  }
  // The SDK rejects with a GatewayError only on a close it will not retry.
  if (err instanceof GatewayError) {
    return { action: 'exit', hint: FATAL_HINTS[err.code] ?? `the gateway closed with ${err.code}: ${err.reason}` }
  }
  return { action: 'retry' }
}

/** A close of the gateway after start. When the SDK will not reconnect, Mnemo
 * exits non-zero so that Docker restarts it and the operator sees it. */
export function afterClose(info: GatewayCloseInfo, stopping: boolean): Verdict | { action: 'wait' } {
  if (info.reconnect || stopping) return { action: 'wait' }
  return { action: 'exit', hint: FATAL_HINTS[info.code] ?? `the gateway closed with ${info.code}: ${info.reason}` }
}
