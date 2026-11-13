import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MESSAGE_LIMIT, splitMessage } from '../src/engine/split.ts'

describe('splitMessage', () => {
  it('keeps a short answer whole', () => {
    assert.deepEqual(splitMessage('  hello  '), ['hello'])
  })

  it('cuts at paragraph boundaries and respects the limit', () => {
    const para = 'word '.repeat(150).trim() // 749 characters
    const text = Array.from({ length: 8 }, () => para).join('\n\n')
    const parts = splitMessage(text)
    assert.equal(parts.length, 2)
    for (const p of parts) assert.ok(p.length <= MESSAGE_LIMIT, `part of ${p.length}`)
    assert.ok(parts[0]?.endsWith('word'))
    assert.equal(parts.join('\n\n'), text)
  })

  it('closes and reopens a code fence cut in the middle', () => {
    const code = Array.from({ length: 300 }, (_, i) => `console.log(${i})`).join('\n')
    const text = `Here:\n\n\`\`\`ts\n${code}\n\`\`\`\n\nDone.`
    const parts = splitMessage(text)
    assert.ok(parts.length >= 2)
    for (const p of parts) {
      assert.ok(p.length <= MESSAGE_LIMIT)
      const fences = p.split('\n').filter((l) => l.startsWith('```')).length
      assert.equal(fences % 2, 0, 'every part has balanced fences')
    }
    assert.ok(parts[1]?.startsWith('```ts\n'))
  })

  it('cuts a word longer than the limit hard', () => {
    const parts = splitMessage('x'.repeat(9000))
    assert.equal(parts.length, 3)
    assert.ok(parts.every((p) => p.length <= MESSAGE_LIMIT))
    assert.equal(parts.join(''), 'x'.repeat(9000))
  })

  it('stops after the maximum number of parts and says so', () => {
    const parts = splitMessage('lorem ipsum. '.repeat(3000), MESSAGE_LIMIT, 2)
    assert.equal(parts.length, 2)
    assert.ok(parts[1]?.endsWith('(answer shortened)'))
    assert.ok(parts.every((p) => p.length <= MESSAGE_LIMIT))
  })
})
