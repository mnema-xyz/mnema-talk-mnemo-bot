// Date and time in any time zone, with Node's built-in Intl data. A place
// name is turned into its zone with the Open-Meteo geocoder (no key).
import { z } from 'zod'
import { defineTool, ToolError, type ToolContext } from './types.ts'
import { geocode } from './weather.ts'

function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

async function resolveZone(ctx: ToolContext, where: string): Promise<{ zone: string; place?: string }> {
  const w = where.trim()
  if (/^utc$|^gmt$|^z$/i.test(w)) return { zone: 'UTC' }
  if (isZone(w)) return { zone: Intl.DateTimeFormat('en', { timeZone: w }).resolvedOptions().timeZone }
  const p = await geocode(ctx, w)
  if (!p.timezone) throw new ToolError(`no time zone known for "${where}"`)
  return { zone: p.timezone, place: [p.name, p.country].filter(Boolean).join(', ') }
}

/** Wall-clock parts of an instant in a zone. */
function partsIn(date: Date, zone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
    timeZoneName: 'longOffset',
  })
  const out: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value
  return out
}

/** Offset of a zone at an instant, in minutes east of UTC. */
export function offsetMinutes(date: Date, zone: string): number {
  const name = partsIn(date, zone).timeZoneName ?? 'GMT'
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

export function describeInstant(date: Date, zone: string): Record<string, string> {
  const p = partsIn(date, zone)
  return {
    time_zone: zone,
    date: `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''}`,
    time: `${p.hour ?? ''}:${p.minute ?? ''}`,
    weekday: p.weekday ?? '',
    utc_offset: (p.timeZoneName ?? 'GMT').replace('GMT', 'UTC') || 'UTC',
  }
}

/** Turns a local wall time ("2026-11-13 15:30") in a zone into an instant. */
export function fromLocal(local: string, zone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(local.trim())
  if (!m) throw new ToolError('time must look like "2026-11-13 15:30"')
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number]
  if (h > 23) throw new ToolError(`there is no hour ${h}: use 0 to 23`)
  if (mi > 59) throw new ToolError(`there is no minute ${mi}: use 0 to 59`)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const g = new Date(guess)
  if (g.getUTCMonth() !== mo - 1 || g.getUTCDate() !== d) {
    const month = new Date(Date.UTC(2000, Math.min(Math.max(mo, 1), 12) - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })
    throw new ToolError(mo < 1 || mo > 12 ? `there is no month ${mo}` : `the date does not exist: there is no ${d} ${month} ${y}`)
  }
  // Two passes settle the offset, also next to a daylight saving change.
  let t = guess - offsetMinutes(new Date(guess), zone) * 60_000
  t = guess - offsetMinutes(new Date(t), zone) * 60_000
  // In the hour skipped when the clocks move forward the wall time never
  // shows; say so instead of moving it silently.
  const back = partsIn(new Date(t), zone)
  if (Number(back.hour) !== h || Number(back.minute) !== mi) {
    throw new ToolError(`${local.trim()} does not exist in ${zone}: the clocks moved forward then`)
  }
  return new Date(t)
}

export const datetime = defineTool({
  name: 'datetime',
  description:
    'The current date and time for a place or IANA time zone, or a conversion of a local time from one ' +
    'place or zone to another. Use it for "what time is it in ...", "what day is it", and time zone math.',
  input: z.object({
    where: z.string().max(120).optional().describe('A place ("Tokyo") or zone ("Europe/Madrid"); default UTC'),
    convert: z
      .object({
        time: z.string().describe('Local time in "from", as "YYYY-MM-DD HH:MM"'),
        from: z.string().max(120),
        to: z.string().max(120),
      })
      .optional()
      .describe('Set to convert a time instead of telling the current one'),
  }),
  async run({ where, convert }, ctx) {
    if (convert) {
      const from = await resolveZone(ctx, convert.from)
      const to = await resolveZone(ctx, convert.to)
      const instant = fromLocal(convert.time, from.zone)
      return JSON.stringify({
        from: { ...describeInstant(instant, from.zone), place: from.place },
        to: { ...describeInstant(instant, to.zone), place: to.place },
      })
    }
    const z0 = await resolveZone(ctx, where ?? 'UTC')
    return JSON.stringify({ now: { ...describeInstant(ctx.now(), z0.zone), place: z0.place } })
  },
})
