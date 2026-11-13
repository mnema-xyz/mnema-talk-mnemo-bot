// Picks the provider from the configuration. A new provider is one file
// next to this one plus one case here.
import type { Config } from '../config.ts'
import { anthropicProvider } from './anthropic.ts'
import { fakeProvider } from './fake.ts'
import { openaiProvider } from './openai.ts'
import type { Provider } from './types.ts'

export function createProvider(c: Config): Provider {
  switch (c.provider) {
    case 'anthropic':
      return anthropicProvider({
        apiKey: c.apiKey,
        model: c.model,
        baseUrl: c.baseUrl,
        effort: c.anthropicEffort,
        timeoutMs: c.providerTimeoutMs,
      })
    case 'openai':
    case 'openai-compatible':
      return openaiProvider({
        name: c.provider,
        // Local servers ignore the key, but the SDK wants a value.
        apiKey: c.apiKey || 'not-needed',
        model: c.model,
        baseUrl: c.baseUrl,
        timeoutMs: c.providerTimeoutMs,
      })
    case 'fake':
      return fakeProvider()
  }
}
