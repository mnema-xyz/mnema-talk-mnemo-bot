// A small math parser and evaluator. It never uses eval or Function: the
// expression is tokenised, parsed by recursive descent and computed on
// numbers, so the worst a hostile expression can do is fail to parse.
//
// Grammar (lowest precedence first):
//   expr    = term (('+' | '-') term)*
//   term    = unary (('*' | '/' | 'mod') unary)*
//   unary   = ('-' | '+') unary | power
//   power   = postfix ('^' unary)?          right-associative, -2^2 = -4
//   postfix = primary ('!' | '%')*
//   primary = number | constant | func '(' expr (',' expr)* ')' | '(' expr ')'

export class MathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MathError'
  }
}

const MAX_LENGTH = 500
const MAX_DEPTH = 64

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI }

const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...a: number[]) => number }> = {
  sqrt: { arity: [1, 1], fn: (x) => checkDomain(x >= 0, 'sqrt of a negative number', Math.sqrt(x)) },
  cbrt: { arity: [1, 1], fn: Math.cbrt },
  abs: { arity: [1, 1], fn: Math.abs },
  sin: { arity: [1, 1], fn: Math.sin },
  cos: { arity: [1, 1], fn: Math.cos },
  tan: { arity: [1, 1], fn: Math.tan },
  asin: { arity: [1, 1], fn: Math.asin },
  acos: { arity: [1, 1], fn: Math.acos },
  atan: { arity: [1, 1], fn: Math.atan },
  ln: { arity: [1, 1], fn: (x) => checkDomain(x > 0, 'ln of a number that is not positive', Math.log(x)) },
  log: { arity: [1, 2], fn: (x, base = 10) => logOf(x, base) },
  log2: { arity: [1, 1], fn: (x) => logOf(x, 2) },
  exp: { arity: [1, 1], fn: Math.exp },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  round: { arity: [1, 2], fn: (x, d = 0) => roundTo(x, d) },
  min: { arity: [1, 25], fn: Math.min },
  max: { arity: [1, 25], fn: Math.max },
  rad: { arity: [1, 1], fn: (deg) => (deg * Math.PI) / 180 },
  deg: { arity: [1, 1], fn: (rad) => (rad * 180) / Math.PI },
}

type Token =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'id'; value: string; pos: number }
  | { kind: 'op'; value: string; pos: number }
  | { kind: 'end'; pos: number }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src.charAt(i)
    if (/\s/.test(c)) {
      i++
      continue
    }
    const num = /^(\d+(?:_\d+)*(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
    if (num) {
      out.push({ kind: 'num', value: Number(num[0].replaceAll('_', '')), pos: i })
      i += num[0].length
      continue
    }
    const id = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))
    if (id) {
      out.push({ kind: 'id', value: id[0].toLowerCase(), pos: i })
      i += id[0].length
      continue
    }
    if (c === '*' && src.charAt(i + 1) === '*') {
      out.push({ kind: 'op', value: '^', pos: i })
      i += 2
      continue
    }
    const ops: Record<string, string> = { '×': '*', '·': '*', '÷': '/', '−': '-' }
    const op = ops[c] ?? c
    if ('+-*/^()!%,'.includes(op)) {
      out.push({ kind: 'op', value: op, pos: i })
      i++
      continue
    }
    throw new MathError(`unexpected character "${c}" at position ${i + 1}`)
  }
  out.push({ kind: 'end', pos: src.length })
  return out
}

class Parser {
  private i = 0
  private depth = 0
  private readonly tokens: Token[]
  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): number {
    const v = this.expr()
    const t = this.peek()
    if (t.kind !== 'end') throw new MathError(`unexpected "${describe(t)}" at position ${t.pos + 1}`)
    return v
  }

  private peek(): Token {
    return this.tokens[this.i] ?? { kind: 'end', pos: 0 }
  }
  private next(): Token {
    const t = this.peek()
    this.i++
    return t
  }
  private isOp(v: string): boolean {
    const t = this.peek()
    return t.kind === 'op' && t.value === v
  }
  private expect(v: string): void {
    const t = this.next()
    if (t.kind !== 'op' || t.value !== v) throw new MathError(`expected "${v}" at position ${t.pos + 1}`)
  }
  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new MathError('expression is nested too deeply')
  }
  private leave(): void {
    this.depth--
  }

  private expr(): number {
    this.enter()
    let v = this.term()
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next()
      const r = this.term()
      v = op.kind === 'op' && op.value === '+' ? v + r : v - r
    }
    this.leave()
    return v
  }

  private term(): number {
    let v = this.unary()
    for (;;) {
      const t = this.peek()
      if (t.kind === 'op' && (t.value === '*' || t.value === '/')) {
        this.next()
        const r = this.unary()
        if (t.value === '/' && r === 0) throw new MathError('division by zero')
        v = t.value === '*' ? v * r : v / r
      } else if (t.kind === 'id' && t.value === 'mod') {
        this.next()
        const r = this.unary()
        if (r === 0) throw new MathError('modulo by zero')
        v = ((v % r) + r) % r
      } else {
        return v
      }
    }
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.next()
      this.enter()
      const v = -this.unary()
      this.leave()
      return v
    }
    if (this.isOp('+')) {
      this.next()
      return this.unary()
    }
    return this.power()
  }

  private power(): number {
    const base = this.postfix()
    if (this.isOp('^')) {
      this.next()
      this.enter()
      const exp = this.unary()
      this.leave()
      return Math.pow(base, exp)
    }
    return base
  }

  private postfix(): number {
    let v = this.primary()
    for (;;) {
      if (this.isOp('!')) {
        this.next()
        v = factorial(v)
      } else if (this.isOp('%')) {
        this.next()
        v = v / 100
      } else {
        return v
      }
    }
  }

  private primary(): number {
    const t = this.next()
    if (t.kind === 'num') return t.value
    if (t.kind === 'op' && t.value === '(') {
      const v = this.expr()
      this.expect(')')
      return v
    }
    if (t.kind === 'id') {
      const constant = CONSTANTS[t.value]
      if (constant !== undefined) return constant
      const f = FUNCTIONS[t.value]
      if (!f) throw new MathError(`unknown name "${t.value}"`)
      this.expect('(')
      const args = [this.expr()]
      while (this.isOp(',')) {
        this.next()
        args.push(this.expr())
      }
      this.expect(')')
      const [lo, hi] = f.arity
      if (args.length < lo || args.length > hi) {
        throw new MathError(`${t.value} takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'}`)
      }
      return f.fn(...args)
    }
    throw new MathError(t.kind === 'end' ? 'the expression ends too early' : `unexpected "${describe(t)}" at position ${t.pos + 1}`)
  }
}

function describe(t: Token): string {
  return t.kind === 'end' ? 'end' : String(t.value)
}

function checkDomain(ok: boolean, message: string, v: number): number {
  if (!ok) throw new MathError(message)
  return v
}

function logOf(x: number, base: number): number {
  if (x <= 0) throw new MathError('log of a number that is not positive')
  if (base <= 0 || base === 1) throw new MathError('log base must be positive and not 1')
  return Math.log(x) / Math.log(base)
}

function roundTo(x: number, digits: number): number {
  if (!Number.isInteger(digits) || digits < 0 || digits > 15) throw new MathError('round takes 0 to 15 digits')
  const f = 10 ** digits
  return Math.round(x * f) / f
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new MathError('factorial needs a whole number that is not negative')
  if (n > 170) throw new MathError('factorial is too large (at most 170!)')
  let r = 1
  for (let k = 2; k <= n; k++) r *= k
  return r
}

/** Evaluates an expression such as `2 * (3 + 4)^2 / sqrt(16)`. */
export function evaluate(expression: string): number {
  if (expression.length > MAX_LENGTH) throw new MathError(`expression is longer than ${MAX_LENGTH} characters`)
  const v = new Parser(tokenize(expression)).parse()
  if (Number.isNaN(v)) throw new MathError('the result is not a number')
  if (!Number.isFinite(v)) throw new MathError('the result is too large')
  return v
}

/** Formats a result for people: at most 12 significant digits, no float noise. */
export function formatNumber(v: number): string {
  if (Object.is(v, -0)) return '0'
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v)
  const s = Number(v.toPrecision(12))
  return String(s)
}
