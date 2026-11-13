// Writes mnemo.manifest.json: what an Owner sees and confirms when adding
// Mnemo (Admin area > Bots > Add from manifest). Run after changing the
// avatar, the description or the commands:  npm run manifest
import { readFileSync, writeFileSync } from 'node:fs'
import { COMMANDS } from '../src/bot/commands.ts'

const root = new URL('../', import.meta.url)
const png = readFileSync(new URL('assets/mnemo.png', root))
if (png.length > 256 * 1024) throw new Error(`assets/mnemo.png is ${png.length} bytes; the manifest allows 256 KB`)

const manifest = {
  manifest_version: 1,
  name: 'Mnemo',
  description:
    'A self-hosted AI helper: answers questions with live weather, a calculator, time zones, unit conversion and Wikipedia. You run it with your own AI provider and key.',
  homepage: 'https://github.com/mnema-xyz/mnema-talk-mnemo-bot',
  avatar: `data:image/png;base64,${png.toString('base64')}`,
  intents: ['GUILD_MESSAGES'],
  permissions: ['view_channel', 'send_messages', 'add_reactions'],
  commands: COMMANDS,
}

writeFileSync(new URL('mnemo.manifest.json', root), JSON.stringify(manifest, null, 2) + '\n')
console.log(`mnemo.manifest.json written (${JSON.stringify(manifest).length} bytes)`)
