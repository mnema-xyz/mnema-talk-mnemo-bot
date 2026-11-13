// Unit conversion from a fixed table: every unit is a factor to its
// dimension's base unit, temperature has its own formulas.
import { z } from 'zod'
import { formatNumber } from './math.ts'
import { defineTool, ToolError } from './types.ts'

type Dimension = 'length' | 'mass' | 'volume' | 'area' | 'speed' | 'time' | 'data' | 'pressure' | 'energy' | 'temperature'

interface Unit {
  dim: Dimension
  /** Multiply by this to get the base unit (metre, kilogram, litre, ...). */
  factor: number
}

const U = (dim: Dimension, factor: number, ...names: string[]): [string, Unit][] => names.map((n) => [n, { dim, factor }])

const UNITS = new Map<string, Unit>([
  // length, base metre
  ...U('length', 1, 'm', 'meter', 'metre', 'meters', 'metres'),
  ...U('length', 1000, 'km', 'kilometer', 'kilometre', 'kilometers', 'kilometres'),
  ...U('length', 0.01, 'cm', 'centimeter', 'centimetre', 'centimeters', 'centimetres'),
  ...U('length', 0.001, 'mm', 'millimeter', 'millimetre', 'millimeters', 'millimetres'),
  ...U('length', 0.0254, 'in', 'inch', 'inches', '"'),
  ...U('length', 0.3048, 'ft', 'foot', 'feet', "'"),
  ...U('length', 0.9144, 'yd', 'yard', 'yards'),
  ...U('length', 1609.344, 'mi', 'mile', 'miles'),
  ...U('length', 1852, 'nmi', 'nautical mile', 'nautical miles'),
  // mass, base kilogram
  ...U('mass', 1, 'kg', 'kilogram', 'kilograms', 'kilo', 'kilos'),
  ...U('mass', 0.001, 'g', 'gram', 'grams'),
  ...U('mass', 1e-6, 'mg', 'milligram', 'milligrams'),
  ...U('mass', 1000, 't', 'tonne', 'tonnes', 'metric ton', 'metric tons'),
  ...U('mass', 0.45359237, 'lb', 'lbs', 'pound', 'pounds'),
  ...U('mass', 0.028349523125, 'oz', 'ounce', 'ounces'),
  ...U('mass', 6.35029318, 'st', 'stone', 'stones'),
  // volume, base litre
  ...U('volume', 1, 'l', 'liter', 'litre', 'liters', 'litres'),
  ...U('volume', 0.001, 'ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres'),
  ...U('volume', 0.01, 'cl', 'centiliter', 'centilitre'),
  ...U('volume', 1000, 'm3', 'cubic meter', 'cubic metre', 'cubic meters', 'cubic metres'),
  ...U('volume', 3.785411784, 'gal', 'gallon', 'gallons', 'us gallon', 'us gallons'),
  ...U('volume', 4.54609, 'imperial gallon', 'imperial gallons', 'uk gallon', 'uk gallons'),
  ...U('volume', 0.946352946, 'qt', 'quart', 'quarts'),
  ...U('volume', 0.473176473, 'pt', 'pint', 'pints', 'us pint', 'us pints'),
  ...U('volume', 0.56826125, 'uk pint', 'uk pints', 'imperial pint', 'imperial pints'),
  ...U('volume', 0.2365882365, 'cup', 'cups'),
  ...U('volume', 0.0295735295625, 'fl oz', 'fluid ounce', 'fluid ounces'),
  ...U('volume', 0.01478676478125, 'tbsp', 'tablespoon', 'tablespoons'),
  ...U('volume', 0.00492892159375, 'tsp', 'teaspoon', 'teaspoons'),
  // area, base square metre
  ...U('area', 1, 'm2', 'square meter', 'square metre', 'square meters', 'square metres', 'sqm'),
  ...U('area', 1e6, 'km2', 'square kilometer', 'square kilometre', 'square kilometers', 'square kilometres'),
  ...U('area', 10000, 'ha', 'hectare', 'hectares'),
  ...U('area', 4046.8564224, 'acre', 'acres'),
  ...U('area', 0.09290304, 'ft2', 'sq ft', 'square foot', 'square feet'),
  ...U('area', 2589988.110336, 'mi2', 'sq mi', 'square mile', 'square miles'),
  // speed, base metre per second
  ...U('speed', 1, 'm/s', 'meters per second', 'metres per second'),
  ...U('speed', 1 / 3.6, 'km/h', 'kmh', 'kph', 'kilometers per hour', 'kilometres per hour'),
  ...U('speed', 0.44704, 'mph', 'miles per hour'),
  ...U('speed', 0.514444444, 'kn', 'knot', 'knots'),
  // time, base second
  ...U('time', 1, 's', 'sec', 'second', 'seconds'),
  ...U('time', 0.001, 'ms', 'millisecond', 'milliseconds'),
  ...U('time', 60, 'min', 'minute', 'minutes'),
  ...U('time', 3600, 'h', 'hr', 'hour', 'hours'),
  ...U('time', 86400, 'd', 'day', 'days'),
  ...U('time', 604800, 'wk', 'week', 'weeks'),
  ...U('time', 31557600, 'yr', 'year', 'years'),
  // data, base byte
  ...U('data', 1, 'b', 'byte', 'bytes'),
  ...U('data', 0.125, 'bit', 'bits'),
  ...U('data', 1e3, 'kb', 'kilobyte', 'kilobytes'),
  ...U('data', 1e6, 'mb', 'megabyte', 'megabytes'),
  ...U('data', 1e9, 'gb', 'gigabyte', 'gigabytes'),
  ...U('data', 1e12, 'tb', 'terabyte', 'terabytes'),
  ...U('data', 1024, 'kib', 'kibibyte', 'kibibytes'),
  ...U('data', 1024 ** 2, 'mib', 'mebibyte', 'mebibytes'),
  ...U('data', 1024 ** 3, 'gib', 'gibibyte', 'gibibytes'),
  ...U('data', 1024 ** 4, 'tib', 'tebibyte', 'tebibytes'),
  // pressure, base pascal
  ...U('pressure', 1, 'pa', 'pascal', 'pascals'),
  ...U('pressure', 100, 'hpa', 'hectopascal', 'hectopascals', 'mbar', 'millibar'),
  ...U('pressure', 1000, 'kpa', 'kilopascal', 'kilopascals'),
  ...U('pressure', 100000, 'bar', 'bars'),
  ...U('pressure', 6894.757293168, 'psi'),
  ...U('pressure', 101325, 'atm', 'atmosphere', 'atmospheres'),
  ...U('pressure', 133.322387415, 'mmhg'),
  // energy, base joule
  ...U('energy', 1, 'j', 'joule', 'joules'),
  ...U('energy', 1000, 'kj', 'kilojoule', 'kilojoules'),
  ...U('energy', 4.184, 'cal', 'calorie', 'calories'),
  ...U('energy', 4184, 'kcal', 'kilocalorie', 'kilocalories'),
  ...U('energy', 3600, 'wh', 'watt hour', 'watt hours'),
  ...U('energy', 3.6e6, 'kwh', 'kilowatt hour', 'kilowatt hours'),
  ...U('energy', 1055.05585262, 'btu'),
  // temperature: factor unused
  ...U('temperature', 1, 'c', '°c', 'celsius', 'degc'),
  ...U('temperature', 1, 'f', '°f', 'fahrenheit', 'degf'),
  ...U('temperature', 1, 'k', 'kelvin'),
])

function lookup(name: string): [string, Unit] {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ').replace('²', '2').replace('³', '3')
  const u = UNITS.get(key) ?? UNITS.get(key.replace(/^degrees? /, '')) ?? UNITS.get(key.replace(/s$/, ''))
  if (!u) throw new ToolError(`unknown unit "${name}"`)
  return [key, u]
}

function toKelvin(v: number, unit: string): number {
  if (unit.endsWith('c') || unit === 'celsius') return v + 273.15
  if (unit.endsWith('f') || unit === 'fahrenheit') return ((v - 32) * 5) / 9 + 273.15
  return v
}

function fromKelvin(k: number, unit: string): number {
  if (unit.endsWith('c') || unit === 'celsius') return k - 273.15
  if (unit.endsWith('f') || unit === 'fahrenheit') return ((k - 273.15) * 9) / 5 + 32
  return k
}

export function convertUnits(value: number, from: string, to: string): number {
  const [fk, fu] = lookup(from)
  const [tk, tu] = lookup(to)
  if (fu.dim !== tu.dim) throw new ToolError(`cannot convert ${fu.dim} (${from}) to ${tu.dim} (${to})`)
  if (fu.dim === 'temperature') {
    const k = toKelvin(value, fk)
    if (k < 0) throw new ToolError('that is below absolute zero')
    return fromKelvin(k, tk)
  }
  return (value * fu.factor) / tu.factor
}

export const units = defineTool({
  name: 'convert_units',
  description:
    'Converts a value between units of length, mass, volume (US and imperial), area, speed, time, data ' +
    '(kB = 1000 B, KiB = 1024 B), pressure, energy and temperature. Not for currencies.',
  input: z.object({
    value: z.number(),
    from: z.string().min(1).max(40).describe('For example "mi", "pounds", "°F", "cups"'),
    to: z.string().min(1).max(40),
  }),
  run({ value, from, to }) {
    return Promise.resolve(JSON.stringify({ value, from, to, result: formatNumber(convertUnits(value, from, to)) }))
  },
})
