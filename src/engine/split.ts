// Splits a long answer into messages that fit Mnema Talk's limit, at
// paragraph, line, sentence or word boundaries, and keeps fenced code
// blocks valid across a cut (closed at the end of one part, reopened with
// the same language at the start of the next).

/** Mnema Talk's message limit, in characters. */
export const MESSAGE_LIMIT = 4000

const SHORTENED = '\n\n-# (answer shortened)'

export function splitMessage(text: string, limit = MESSAGE_LIMIT, maxParts = 4): string[] {
  const parts: string[] = []
  let rest = text.trim()
  let reopen = ''
  while (rest.length > 0) {
    rest = reopen + rest
    reopen = ''
    if (rest.length <= limit) {
      parts.push(rest)
      break
    }
    // Leave room to close a code fence that the cut leaves open.
    const budget = limit - 4
    let cut = bestCut(rest, budget)
    let chunk = rest.slice(0, cut).trimEnd()
    const fence = openFence(chunk)
    if (fence !== null) {
      chunk += '\n```'
      reopen = `\`\`\`${fence}\n`
    }
    if (chunk.trim().length === 0) {
      // A single token longer than the limit: cut it hard.
      cut = budget
      chunk = rest.slice(0, cut)
    }
    parts.push(chunk)
    rest = rest.slice(cut).replace(/^\s+/, '')
  }

  if (parts.length > maxParts) {
    const kept = parts.slice(0, maxParts)
    const lastIndex = maxParts - 1
    let last = kept[lastIndex] ?? ''
    if (last.length + SHORTENED.length > limit) last = last.slice(0, limit - SHORTENED.length - 1).trimEnd() + '…'
    if (openFence(last) !== null) last = last.slice(0, limit - SHORTENED.length - 5) + '\n```'
    kept[lastIndex] = last + SHORTENED
    return kept
  }
  return parts
}

function bestCut(s: string, max: number): number {
  const window = s.slice(0, max + 1)
  const min = Math.floor(max * 0.5)
  for (const sep of ['\n\n', '\n', '. ', '! ', '? ', ' ']) {
    const at = window.lastIndexOf(sep)
    if (at >= min) return at + sep.length
  }
  return max
}

/** The language of a fenced code block left open in `s`, or null. */
function openFence(s: string): string | null {
  let open: string | null = null
  for (const line of s.split('\n')) {
    const m = /^\s*```(\S*)/.exec(line)
    if (!m) continue
    open = open === null ? (m[1] ?? '') : null
  }
  return open
}
