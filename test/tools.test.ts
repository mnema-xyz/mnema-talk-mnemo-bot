import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculator } from '../src/tools/calculator.ts'
import { datetime, fromLocal } from '../src/tools/datetime.ts'
import { runTool, selectTools, toolSpecs } from '../src/tools/index.ts'
import { convertUnits, units } from '../src/tools/units.ts'
import { describeWeatherCode, weather } from '../src/tools/weather.ts'
import { webSearch } from '../src/tools/websearch.ts'
import { wikipedia } from '../src/tools/wikipedia.ts'
import { ctxWith, fixture, recordedFetch } from './helpers.ts'

const openMeteo = () =>
  recordedFetch([
    [/geocoding-api\.open-meteo\.com/, fixture('open-meteo-geocode-marbella.json')],
    [/api\.open-meteo\.com\/v1\/forecast/, fixture('open-meteo-forecast-marbella.json')],
  ])

describe('weather tool (recorded Open-Meteo responses)', () => {
  it('answers "how warm is it in Marbella right now"', async () => {
    const f = openMeteo()
    const out = JSON.parse(await weather.run({ place: 'Marbella', days: 2, units: 'metric' }, ctxWith(f))) as {
      place: string
      timezone: string
      current: { temperature: string; conditions: string; feels_like: string }
      forecast: { date: string; max: string }[]
    }
    assert.equal(out.place, 'Marbella, Andalusia, Spain')
    assert.equal(out.timezone, 'Europe/Madrid')
    assert.equal(out.current.temperature, '18.3 °C')
    assert.equal(out.current.feels_like, '19 °C')
    assert.equal(out.current.conditions, 'mainly clear')
    assert.equal(out.forecast.length, 3)
    assert.match(f.calls[1] ?? '', /latitude=36\.51543&longitude=-4\.88583/)
    assert.match(f.calls[1] ?? '', /forecast_days=3/)
  })

  it('uses the country hint to pick among places of one name', async () => {
    const f = openMeteo()
    const out = JSON.parse(await weather.run({ place: 'Marbella, Costa Rica', days: 0, units: 'metric' }, ctxWith(f))) as {
      place: string
    }
    assert.equal(out.place, 'Marbella, Guanacaste Province, Costa Rica')
    assert.match(f.calls[0] ?? '', /name=Marbella&/)
  })

  it('asks for imperial units when told to', async () => {
    const f = openMeteo()
    await weather.run({ place: 'Marbella', days: 0, units: 'imperial' }, ctxWith(f))
    assert.match(f.calls[1] ?? '', /temperature_unit=fahrenheit/)
    assert.match(f.calls[1] ?? '', /wind_speed_unit=mph/)
  })

  it('reports an unknown place and an HTTP error as tool errors', async () => {
    const empty = recordedFetch([[/geocoding/, { generationtime_ms: 0.1 }]])
    const r1 = await runTool([weather], { id: '1', name: 'weather', input: { place: 'Nowhereville' } }, ctxWith(empty))
    assert.equal(r1.isError, true)
    assert.match(r1.content, /no place called "Nowhereville"/)

    const down = recordedFetch([[/geocoding/, {}, 503]])
    const r2 = await runTool([weather], { id: '2', name: 'weather', input: { place: 'Marbella' } }, ctxWith(down))
    assert.match(r2.content, /answered 503/)
  })

  it('names weather codes', () => {
    assert.equal(describeWeatherCode(95), 'thunderstorm')
    assert.equal(describeWeatherCode(1234), 'weather code 1234')
  })
})

describe('calculator tool', () => {
  it('answers "what is X + Y"', async () => {
    const r = await runTool([calculator], { id: '1', name: 'calculator', input: { expression: '1234 + 5678' } }, ctxWith(recordedFetch([])))
    assert.deepEqual(JSON.parse(r.content), { expression: '1234 + 5678', result: '6912' })
  })
  it('returns parse errors to the model', async () => {
    const r = await runTool([calculator], { id: '1', name: 'calculator', input: { expression: '2 +' } }, ctxWith(recordedFetch([])))
    assert.equal(r.isError, true)
    assert.match(r.content, /ends too early/)
  })
})

describe('datetime tool', () => {
  it('tells the time for a zone', async () => {
    const out = JSON.parse(await datetime.run({ where: 'Asia/Tokyo' }, ctxWith(recordedFetch([])))) as { now: Record<string, string> }
    assert.equal(out.now.time, '21:00')
    assert.equal(out.now.date, '2026-11-13')
    assert.equal(out.now.weekday, 'Friday')
    assert.equal(out.now.utc_offset, 'UTC+09:00')
  })
  it('resolves a place to its zone', async () => {
    const out = JSON.parse(await datetime.run({ where: 'Marbella' }, ctxWith(openMeteo()))) as { now: Record<string, string> }
    assert.equal(out.now.time_zone, 'Europe/Madrid')
    assert.equal(out.now.time, '13:00')
  })
  it('converts across zones and daylight saving', async () => {
    const out = JSON.parse(
      await datetime.run({ convert: { time: '2026-07-01 09:00', from: 'Europe/Berlin', to: 'America/New_York' } }, ctxWith(recordedFetch([]))),
    ) as { to: Record<string, string> }
    assert.equal(out.to.time, '03:00')
    assert.equal(fromLocal('2026-03-29 03:30', 'Europe/Berlin').toISOString(), '2026-03-29T01:30:00.000Z')
  })
})

describe('unit conversion', () => {
  it('converts common units', () => {
    assert.equal(convertUnits(10, 'km', 'mi').toFixed(4), '6.2137')
    assert.equal(convertUnits(100, '°F', 'c').toFixed(2), '37.78')
    assert.equal(convertUnits(0, 'celsius', 'kelvin'), 273.15)
    assert.equal(convertUnits(1, 'cup', 'ml').toFixed(1), '236.6')
    assert.equal(convertUnits(1, 'GiB', 'MB').toFixed(3), '1073.742')
    assert.equal(convertUnits(5, 'feet', 'm').toFixed(3), '1.524')
  })
  it('refuses mixed dimensions and unknown units', async () => {
    const ctx = ctxWith(recordedFetch([]))
    const r1 = await runTool([units], { id: '1', name: 'convert_units', input: { value: 1, from: 'kg', to: 'm' } }, ctx)
    assert.match(r1.content, /cannot convert mass/)
    const r2 = await runTool([units], { id: '1', name: 'convert_units', input: { value: 1, from: 'smoots', to: 'm' } }, ctx)
    assert.match(r2.content, /unknown unit/)
    const r3 = await runTool([units], { id: '1', name: 'convert_units', input: { value: -500, from: 'c', to: 'k' } }, ctx)
    assert.match(r3.content, /absolute zero/)
  })
})

describe('wikipedia tool (recorded responses)', () => {
  it('returns the summary and link of the best match', async () => {
    const f = recordedFetch([
      [/search\/page/, fixture('wikipedia-search-marbella.json')],
      [/page\/summary\/Marbella/, fixture('wikipedia-summary-marbella.json')],
    ])
    const out = JSON.parse(await wikipedia.run({ query: 'Marbella', language: 'en' }, ctxWith(f))) as Record<string, string>
    assert.equal(out.title, 'Marbella')
    assert.match(out.summary ?? '', /southern Spain/)
    assert.equal(out.url, 'https://en.wikipedia.org/wiki/Marbella')
    assert.match(f.calls[0] ?? '', /^https:\/\/en\.wikipedia\.org\//)
  })
  it('refuses a language code that could change the host', async () => {
    const r = await runTool([wikipedia], { id: '1', name: 'wikipedia', input: { query: 'x', language: 'evil.example/' } }, ctxWith(recordedFetch([])))
    assert.equal(r.isError, true)
    assert.match(r.content, /invalid input/)
  })
})

describe('web search tool', () => {
  it('sends the key as a header and trims results', async () => {
    let seen: RequestInit | undefined
    const f = (url: string, init?: RequestInit): Promise<Response> => {
      seen = init
      assert.match(url, /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?q=mnema&count=2$/)
      return Promise.resolve(
        Response.json({ web: { results: [{ title: 'A', url: 'https://a.example', description: '<b>bold</b> text' }] } }),
      )
    }
    const out = JSON.parse(await webSearch('brave', 'k-123').run({ query: 'mnema', count: 2 }, ctxWith(f))) as {
      results: { snippet: string }[]
    }
    assert.equal((seen?.headers as Record<string, string>)['X-Subscription-Token'], 'k-123')
    assert.equal(out.results[0]?.snippet, 'bold text')
  })
  it('is only offered with a key', () => {
    const all = ['weather', 'calculator', 'datetime', 'convert_units', 'wikipedia', 'web_search']
    assert.equal(selectTools({ enabled: all }).some((t) => t.name === 'web_search'), false)
    assert.equal(selectTools({ enabled: all, webSearch: { backend: 'tavily', apiKey: 'x' } }).some((t) => t.name === 'web_search'), true)
  })
})

describe('tool registry', () => {
  it('describes inputs as JSON Schema with defaults optional', () => {
    const spec = toolSpecs([weather])[0]
    assert.equal(spec?.name, 'weather')
    const schema = spec?.inputSchema as { type: string; required: string[]; properties: Record<string, unknown> }
    assert.equal(schema.type, 'object')
    assert.deepEqual(schema.required, ['place'])
    assert.ok('days' in schema.properties)
  })
  it('refuses an unknown tool and bad input', async () => {
    const ctx = ctxWith(recordedFetch([]))
    assert.match((await runTool([calculator], { id: '1', name: 'shell', input: {} }, ctx)).content, /no tool called "shell"/)
    assert.match((await runTool([calculator], { id: '1', name: 'calculator', input: { expression: 3 } }, ctx)).content, /invalid input: expression/)
  })
})
