// A scripted provider for tests and for trying Mnemo without any AI account
// (MNEMO_PROVIDER=fake). It never touches the network.
import type { ChatRequest, ChatResponse, Provider } from './types.ts'

export type FakeStep = Partial<ChatResponse> | ((req: ChatRequest) => Partial<ChatResponse>)

/**
 * Answers with the scripted steps in order, then repeats the last one.
 * Without steps it echoes the last user text, which is what the
 * integration test and a first dry run need.
 */
export function fakeProvider(steps: FakeStep[] = []): Provider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  let i = 0
  return {
    name: 'fake',
    model: 'fake-model',
    requests,
    chat(req: ChatRequest): Promise<ChatResponse> {
      requests.push(structuredClone({ ...req, signal: undefined }) as unknown as ChatRequest)
      const step = steps.length > 0 ? steps[Math.min(i, steps.length - 1)] : undefined
      i++
      const partial = typeof step === 'function' ? step(req) : (step ?? echo(req))
      return Promise.resolve({
        text: '',
        toolCalls: [],
        stop: partial.toolCalls && partial.toolCalls.length > 0 ? 'tool_use' : 'end',
        usage: { inputTokens: 10, outputTokens: 5 },
        ...partial,
      })
    },
  }
}

function echo(req: ChatRequest): Partial<ChatResponse> {
  const last = [...req.turns].reverse().find((t) => t.role === 'user')
  return { text: `You asked: ${last?.role === 'user' ? last.text : ''}` }
}
