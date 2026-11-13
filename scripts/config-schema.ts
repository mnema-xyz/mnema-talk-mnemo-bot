// Writes mnemo.config.schema.json from the settings schema, so editors can
// check and complete a config file:  npm run config-schema
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { SettingsSchema } from '../src/config.ts'

const schema = z.toJSONSchema(SettingsSchema.partial(), { io: 'input', target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>
const properties = { $schema: { type: 'string' }, ...(schema.properties as Record<string, unknown>) }
const out = {
  ...schema,
  $id: 'https://github.com/msch128/mnema-talk-mnemo-bot/mnemo.config.schema.json',
  title: 'Mnemo configuration file',
  description: 'Settings for Mnemo (MNEMO_CONFIG). Environment variables override it. Secrets never go here.',
  properties,
  additionalProperties: false,
}
writeFileSync(new URL('../mnemo.config.schema.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log('mnemo.config.schema.json written')
