// Turning an answer into Mnema Talk messages: the components under it and
// the Details text. Pure functions, so they are easy to read and test.
import type { AskResult, ToolUse } from '../engine/engine.ts'

export const ID_PREFIX = 'mnemo'

export type ButtonKind = 'regen' | 'details' | 'follow'

export function customId(kind: ButtonKind | 'followup', answerId: string): string {
  return `${ID_PREFIX}:${kind}:${answerId}`
}

export function parseCustomId(id: string): { kind: string; answerId: string } | undefined {
  const m = /^mnemo:([a-z]+):([A-Za-z0-9_-]{1,40})$/.exec(id)
  return m ? { kind: m[1] ?? '', answerId: m[2] ?? '' } : undefined
}

const MAX_INPUT_CHARS = 120

function describeInput(input: unknown): string {
  let s: string
  try {
    s = JSON.stringify(input)
  } catch {
    s = '?'
  }
  return s.length > MAX_INPUT_CHARS ? `${s.slice(0, MAX_INPUT_CHARS)}…` : s
}

const TOOL_LABELS: Record<string, string> = {
  weather: 'Weather (Open-Meteo)',
  calculator: 'Calculator',
  datetime: 'Date and time',
  convert_units: 'Unit conversion',
  wikipedia: 'Wikipedia',
  web_search: 'Web search',
}

export interface AnswerDetails {
  provider: string
  model: string
  toolsUsed: ToolUse[]
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Earlier turns that were sent along, and where they came from. */
  historyTurns: number
  context: 'none' | 'thread' | 'follow-up'
  sentDisplayName: boolean
}

export function detailsFrom(
  r: Extract<AskResult, { kind: 'answer' }>,
  historyTurns: number,
  context: AnswerDetails['context'],
  sentDisplayName: boolean,
  costUsd: number,
): AnswerDetails {
  return {
    context,
    provider: r.provider,
    model: r.model,
    toolsUsed: r.toolsUsed,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    costUsd,
    historyTurns,
    sentDisplayName,
  }
}

/** The private note behind the Details button. */
export function detailsText(d: AnswerDetails): string {
  const lines = [`**How this answer was made**`, `-# ${d.provider} · ${d.model}`, '']
  if (d.toolsUsed.length === 0) {
    lines.push('No tools were used: the answer comes from the model alone, so check facts that matter.')
  } else {
    lines.push('Tools used:')
    for (const t of d.toolsUsed) {
      lines.push(`- ${TOOL_LABELS[t.name] ?? t.name}${t.ok ? '' : ' (failed)'}: \`${describeInput(t.input).replaceAll('`', "'")}\``)
    }
  }
  // Anyone may open Details, so it speaks of "the question", not "your".
  const sent = ['the question']
  if (d.historyTurns > 0) {
    sent.push(d.context === 'thread' ? `the last ${d.historyTurns} messages of the thread` : 'the earlier question and answer')
  }
  if (d.sentDisplayName) sent.push("the asker's display name")
  lines.push(
    '',
    `Sent to the AI provider: ${sent.join(', ')}.`,
    `Tokens: ${d.inputTokens} in, ${d.outputTokens} out${d.costUsd > 0 ? ` (about $${d.costUsd.toFixed(4)})` : ''}.`,
  )
  return lines.join('\n')
}
