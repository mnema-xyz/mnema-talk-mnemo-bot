import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GatewayError, RestError } from 'mnema-talk-sdk'
import { afterClose, onConnectError } from '../src/lifecycle.ts'

const rest = (status: number) => new RestError({ status, method: 'GET', path: '/users/@me', body: { message: 'x', code: 0 } })

describe('connection lifecycle', () => {
  it('stops at start on a refused token or a fatal gateway close, and retries the rest', () => {
    assert.equal(onConnectError(rest(401)).action, 'exit')
    assert.equal(onConnectError(rest(403)).action, 'exit')
    for (const code of [4004, 4013, 4014]) {
      const v = onConnectError(new GatewayError(code, 'closed'))
      assert.equal(v.action, 'exit', String(code))
      assert.match(v.hint, code === 4014 ? /GUILD_MESSAGES/ : /./)
    }
    assert.equal(onConnectError(rest(502)).action, 'retry')
    assert.equal(onConnectError(new TypeError('fetch failed')).action, 'retry')
  })

  it('ends the process after a close the SDK will not reconnect from, unless Mnemo is stopping', () => {
    assert.equal(afterClose({ code: 4004, reason: 'authentication failed', reconnect: false }, false).action, 'exit')
    assert.equal(afterClose({ code: 4014, reason: 'intents', reconnect: false }, false).action, 'exit')
    assert.equal(afterClose({ code: 1006, reason: 'dropped', reconnect: true }, false).action, 'wait')
    assert.equal(afterClose({ code: 1000, reason: 'closed by the bot', reconnect: false }, true).action, 'wait')
  })
})
