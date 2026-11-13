import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluate, formatNumber, MathError } from '../src/tools/math.ts'

const calc = (s: string): string => formatNumber(evaluate(s))

describe('math parser', () => {
  it('follows precedence and associativity', () => {
    assert.equal(calc('2 + 3 * 4'), '14')
    assert.equal(calc('(2 + 3) * 4'), '20')
    assert.equal(calc('2 ^ 3 ^ 2'), '512')
    assert.equal(calc('-2 ^ 2'), '-4')
    assert.equal(calc('2 ^ -1'), '0.5')
    assert.equal(calc('10 - 4 - 3'), '3')
    assert.equal(calc('100 / 10 / 5'), '2')
    assert.equal(calc('2 ** 10'), '1024')
  })

  it('knows functions, constants, factorial, percent and mod', () => {
    assert.equal(calc('sqrt(16) + cbrt(27)'), '7')
    assert.equal(calc('round(pi, 4)'), '3.1416')
    assert.equal(calc('5!'), '120')
    assert.equal(calc('15% * 80'), '12')
    assert.equal(calc('-7 mod 3'), '2')
    assert.equal(calc('log(1000)'), '3')
    assert.equal(calc('log(8, 2)'), '3')
    assert.equal(calc('max(1, 9, 4)'), '9')
    assert.equal(calc('sin(rad(30))'), '0.5')
    assert.equal(calc('1_000_000 * 3'), '3000000')
    assert.equal(calc('1.5e3 + .5'), '1500.5')
    assert.equal(calc('6 × 7 ÷ 2 − 1'), '20')
  })

  it('never prints digits it does not know: integers above 2^53 get 12 significant digits', () => {
    assert.equal(calc('2^53 - 1'), '9007199254740991')
    assert.equal(calc('2^53'), '9.00719925474e+15', '2^53 may stand for 2^53 + 1 as well')
    assert.equal(calc('9007199254740993'), '9.00719925474e+15')
    assert.equal(calc('3^40'), '1.21576654591e+19')
    assert.equal(calc('99999999999999999'), '1e+17')
    assert.equal(calc('-(3^40)'), '-1.21576654591e+19')
  })

  it('hides float noise', () => {
    assert.equal(calc('0.1 + 0.2'), '0.3')
    assert.equal(calc('1 / 3'), '0.333333333333')
  })

  it('refuses what is not math, with a reason', () => {
    const cases: [string, RegExp][] = [
      ['1 / 0', /division by zero/],
      ['sqrt(-1)', /negative/],
      ['2 +', /ends too early/],
      ['(1 + 2', /expected "\)"/],
      ['foo(1)', /unknown name "foo"/],
      ['process.exit()', /unknown name "process"|unexpected/],
      ['2pi', /unexpected "pi"/],
      ['171!', /too large/],
      ['10 ^ 400', /too large/],
      ['"; alert(1)', /unexpected character/],
      ['round(1, 2, 3)', /takes 1 to 2 arguments/],
    ]
    for (const [expr, msg] of cases) {
      assert.throws(() => evaluate(expr), (e: unknown) => e instanceof MathError && msg.test(e.message), expr)
    }
  })

  it('limits length and nesting', () => {
    assert.throws(() => evaluate('1+'.repeat(300) + '1'), /longer than/)
    assert.throws(() => evaluate('('.repeat(100) + '1' + ')'.repeat(100)), /nested too deeply/)
    assert.throws(() => evaluate('-'.repeat(100) + '1'), /nested too deeply/)
  })
})
