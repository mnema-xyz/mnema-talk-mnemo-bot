import { z } from 'zod'
import { evaluate, formatNumber, MathError } from './math.ts'
import { defineTool, ToolError } from './types.ts'

export const calculator = defineTool({
  name: 'calculator',
  description:
    'Computes a math expression instead of guessing: whole numbers exactly up to 2^53, other results to 12 significant digits. Supports + - * / ^ (power), mod, ! (factorial), ' +
    '% (percent: 15% = 0.15), parentheses, pi, e, tau and sqrt, cbrt, abs, sin, cos, tan, asin, acos, atan ' +
    '(radians; rad(x) turns degrees into radians, deg(x) back), ln, log(x[, base]), log2, exp, floor, ceil, ' +
    'round(x[, digits]), min, max. Write multiplication explicitly (2*pi, not 2pi).',
  input: z.object({
    expression: z.string().min(1).max(500).describe('For example "(12.5 * 4)^2 / sqrt(16)" or "15% * 80"'),
  }),
  run({ expression }) {
    try {
      return Promise.resolve(JSON.stringify({ expression, result: formatNumber(evaluate(expression)) }))
    } catch (err) {
      if (err instanceof MathError) throw new ToolError(err.message)
      throw err
    }
  },
})
