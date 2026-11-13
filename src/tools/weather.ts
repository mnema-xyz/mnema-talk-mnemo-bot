// Current weather and a short forecast from Open-Meteo (open-meteo.com):
// free, no key, no account. Place names are resolved with its geocoder.
import { z } from 'zod'
import { defineTool, getJson, ToolError, type ToolContext } from './types.ts'

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

/** WMO weather interpretation codes, as Open-Meteo documents them. */
const WMO: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  85: 'light snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with light hail',
  99: 'thunderstorm with heavy hail',
}

export function describeWeatherCode(code: number | undefined): string {
  return code === undefined ? 'unknown' : (WMO[code] ?? `weather code ${code}`)
}

const GeoResult = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
})
type Place = z.infer<typeof GeoResult>

const Forecast = z.object({
  timezone: z.string().optional(),
  current: z
    .object({
      time: z.string(),
      temperature_2m: z.number(),
      apparent_temperature: z.number().optional(),
      relative_humidity_2m: z.number().optional(),
      precipitation: z.number().optional(),
      weather_code: z.number().optional(),
      wind_speed_10m: z.number().optional(),
      wind_direction_10m: z.number().optional(),
      is_day: z.number().optional(),
    })
    .optional(),
  current_units: z.record(z.string(), z.string()).optional(),
  daily: z
    .object({
      time: z.array(z.string()),
      weather_code: z.array(z.number().nullable()).optional(),
      temperature_2m_max: z.array(z.number().nullable()).optional(),
      temperature_2m_min: z.array(z.number().nullable()).optional(),
      precipitation_probability_max: z.array(z.number().nullable()).optional(),
      precipitation_sum: z.array(z.number().nullable()).optional(),
      wind_speed_10m_max: z.array(z.number().nullable()).optional(),
    })
    .optional(),
  daily_units: z.record(z.string(), z.string()).optional(),
})

/** Resolves "Marbella" or "Marbella, Spain" to coordinates. */
export async function geocode(ctx: ToolContext, query: string): Promise<Place> {
  const [name = '', ...rest] = query.split(',').map((s) => s.trim())
  const hint = rest.join(' ').toLowerCase()
  if (!name) throw new ToolError('no place name given')
  const url = `${GEOCODE_URL}?${new URLSearchParams({ name, count: '10', language: 'en', format: 'json' }).toString()}`
  const body = z.object({ results: z.array(GeoResult).optional() }).safeParse(await getJson(ctx, url))
  const results = body.success ? (body.data.results ?? []) : []
  if (results.length === 0) throw new ToolError(`no place called "${query}" was found`)
  if (hint) {
    const match = results.find((r) =>
      [r.country, r.country_code, r.admin1].some((v) => v !== undefined && v.toLowerCase().includes(hint)),
    )
    if (match) return match
  }
  // Results come ordered by population, so the first is the likeliest.
  return results[0] as Place
}

export const weather = defineTool({
  name: 'weather',
  description:
    'Current weather and a daily forecast for a place, from Open-Meteo. Use it for any question about ' +
    'temperature, rain, wind or the weather now or in the next days. Give the place as "City" or ' +
    '"City, Country" to pick the right one.',
  input: z.object({
    place: z.string().min(1).max(120).describe('For example "Marbella" or "Springfield, Illinois"'),
    days: z.number().int().min(0).max(7).default(1).describe('Days of forecast after today, 0 for current only'),
    units: z.enum(['metric', 'imperial']).default('metric'),
  }),
  async run({ place, days, units }, ctx) {
    const p = await geocode(ctx, place)
    const params = new URLSearchParams({
      latitude: String(p.latitude),
      longitude: String(p.longitude),
      current:
        'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
      timezone: 'auto',
      forecast_days: String(days + 1),
      temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
      wind_speed_unit: units === 'imperial' ? 'mph' : 'kmh',
      precipitation_unit: units === 'imperial' ? 'inch' : 'mm',
    })
    const parsed = Forecast.safeParse(await getJson(ctx, `${FORECAST_URL}?${params.toString()}`))
    if (!parsed.success) throw new ToolError('Open-Meteo sent an answer in an unexpected shape')
    const f = parsed.data
    const tempUnit = units === 'imperial' ? '°F' : '°C'
    const windUnit = units === 'imperial' ? 'mph' : 'km/h'

    const current = f.current
      ? {
          local_time: f.current.time,
          temperature: `${f.current.temperature_2m} ${tempUnit}`,
          feels_like: f.current.apparent_temperature !== undefined ? `${f.current.apparent_temperature} ${tempUnit}` : undefined,
          conditions: describeWeatherCode(f.current.weather_code),
          humidity_percent: f.current.relative_humidity_2m,
          wind: f.current.wind_speed_10m !== undefined ? `${f.current.wind_speed_10m} ${windUnit}` : undefined,
          precipitation: f.current.precipitation,
        }
      : undefined

    const d = f.daily
    const forecast = d
      ? d.time.map((date, i) => ({
          date,
          conditions: describeWeatherCode(d.weather_code?.[i] ?? undefined),
          min: d.temperature_2m_min?.[i] != null ? `${d.temperature_2m_min[i]} ${tempUnit}` : undefined,
          max: d.temperature_2m_max?.[i] != null ? `${d.temperature_2m_max[i]} ${tempUnit}` : undefined,
          rain_chance_percent: d.precipitation_probability_max?.[i] ?? undefined,
          wind_max: d.wind_speed_10m_max?.[i] != null ? `${d.wind_speed_10m_max[i]} ${windUnit}` : undefined,
        }))
      : []

    return JSON.stringify({
      place: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
      timezone: f.timezone ?? p.timezone,
      current,
      forecast: days > 0 ? forecast : forecast.slice(0, 1),
      source: 'Open-Meteo (open-meteo.com)',
    })
  },
})
